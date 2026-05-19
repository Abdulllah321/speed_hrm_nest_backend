import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Decimal } from '@prisma/client/runtime/client';
import { PrismaMasterService } from '../database/prisma-master.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { runInBackground } from '../common/utils/run-in-background.util';

@Injectable()
export class EOBIService {
  private readonly logger = new Logger(EOBIService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaMaster: PrismaMasterService,
    private activityLogs: ActivityLogsService,
  ) {}

  async getEOBIEmployees() {
    try {
      // Get all employees with EOBI enabled
      const employees = await this.prisma.employee.findMany({
        where: {
          eobi: true,
          status: 'active',
        },
        select: {
          id: true,
          employeeId: true,
          employeeName: true,
          departmentId: true,
          subDepartmentId: true,
          designationId: true,
        },
        orderBy: {
          employeeName: 'asc',
        },
      });

      // Fetch Master data for all employees
      const deptIds = [
        ...new Set(employees.map((e) => e.departmentId).filter(Boolean)),
      ] as string[];
      const subDeptIds = [
        ...new Set(employees.map((e) => e.subDepartmentId).filter(Boolean)),
      ] as string[];
      const desgIds = [
        ...new Set(employees.map((e) => e.designationId).filter(Boolean)),
      ] as string[];

      const [departments, subDepartments, designations] = await Promise.all([
        this.prisma.department.findMany({
          where: { id: { in: deptIds } },
          select: { id: true, name: true },
        }),
        this.prisma.subDepartment.findMany({
          where: { id: { in: subDeptIds } },
          select: { id: true, name: true },
        }),
        this.prisma.designation.findMany({
          where: { id: { in: desgIds } },
          select: { id: true, name: true },
        }),
      ]);

      const deptMap = new Map(departments.map((d) => [d.id, d]));
      const subDeptMap = new Map(subDepartments.map((sd) => [sd.id, sd]));
      const desgMap = new Map(designations.map((d) => [d.id, d]));

      // Calculate EOBI balances for each employee
      const eobiData = await Promise.all(
        employees.map(async (employee) => {
          // Get all EOBI contributions for this employee
          const contributions = await this.prisma.eOBIContribution.findMany({
            where: {
              employeeId: employee.id,
            },
            select: {
              employeeContribution: true,
              employerContribution: true,
              totalContribution: true,
              month: true,
              year: true,
            },
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
          });

          // Calculate total EOBI (employee contribution + employer contribution)
          const totalEmployeeContribution = contributions.reduce(
            (sum, contrib) =>
              sum.add(new Decimal(contrib.employeeContribution || 0)),
            new Decimal(0),
          );

          const totalEmployerContribution = contributions.reduce(
            (sum, contrib) =>
              sum.add(new Decimal(contrib.employerContribution || 0)),
            new Decimal(0),
          );

          const totalEOBIBalance = totalEmployeeContribution.add(
            totalEmployerContribution,
          );

          // Get latest contribution month/year
          const latestContribution = contributions[0];

          return {
            id: employee.id,
            employeeId: employee.employeeId,
            employeeName: employee.employeeName,
            department:
              (employee.departmentId
                ? deptMap.get(employee.departmentId)?.name
                : null) || 'N/A',
            subDepartment:
              (employee.subDepartmentId
                ? subDeptMap.get(employee.subDepartmentId)?.name
                : null) || 'N/A',
            designation:
              (employee.designationId
                ? desgMap.get(employee.designationId)?.name
                : null) || 'N/A',
            employeeContribution: totalEmployeeContribution.toNumber(),
            employerContribution: totalEmployerContribution.toNumber(),
            totalEOBIBalance: totalEOBIBalance.toNumber(),
            lastContributionMonth: latestContribution
              ? `${latestContribution.month}/${latestContribution.year}`
              : 'N/A',
            totalMonths: contributions.length,
          };
        }),
      );

      return {
        status: true,
        data: eobiData,
      };
    } catch (error) {
      this.logger.error('Error fetching EOBI employees:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to fetch EOBI employee data',
      };
    }
  }

  async createEOBIWithdrawal(data: {
    employeeId: string;
    withdrawalAmount: number;
    month: string;
    year: string;
    reason?: string;
    createdById?: string;
  }) {
    try {
      // Validate employee exists and has EOBI enabled
      const employee = await this.prisma.employee.findUnique({
        where: { id: data.employeeId },
        select: { id: true, eobi: true, employeeName: true, employeeId: true },
      });

      if (!employee) {
        return {
          status: false,
          message: 'Employee not found',
        };
      }

      if (!employee.eobi) {
        return {
          status: false,
          message: 'Employee does not have EOBI enabled',
        };
      }

      // Format monthYear
      const monthNames = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ];
      const monthIndex = parseInt(data.month, 10) - 1;
      const monthName = monthNames[monthIndex];
      const monthYear = `${monthName} ${data.year}`;

      // Create withdrawal
      const withdrawal = await this.prisma.eOBIWithdrawal.create({
        data: {
          employeeId: data.employeeId,
          withdrawalAmount: new Decimal(data.withdrawalAmount),
          month: data.month,
          year: data.year,
          monthYear: monthYear,
          reason: data.reason,
          createdById: data.createdById,
          status: 'pending',
          approvalStatus: 'pending',
        },
      });

      // Log activity
      runInBackground(
        'Activity Log',
        this.activityLogs.log({
          action: 'CREATE',
          module: 'EOBI',
          entity: 'EOBIWithdrawal',
          entityId: withdrawal.id,
          description: `EOBI withdrawal created for employee ${employee.employeeName} (${employee.employeeId}) - Amount: ${data.withdrawalAmount}`,
          status: 'success',
          userId: data.createdById,
        }),
      );

      return {
        status: true,
        message: 'EOBI withdrawal created successfully',
        data: withdrawal,
      };
    } catch (error) {
      this.logger.error('Error creating EOBI withdrawal:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to create EOBI withdrawal',
      };
    }
  }

  async getEOBIWithdrawals(filters?: {
    employeeId?: string;
    departmentId?: string;
    month?: string;
    year?: string;
    status?: string;
  }) {
    try {
      const where: any = {};

      if (filters?.employeeId) {
        where.employeeId = filters.employeeId;
      }

      if (filters?.month) {
        where.month = filters.month;
      }

      if (filters?.year) {
        where.year = filters.year;
      }

      if (filters?.status) {
        where.status = filters.status;
      }

      // If departmentId filter is provided, we need to filter by employee's department
      let employeeIds: string[] | undefined;
      if (filters?.departmentId) {
        const employees = await this.prisma.employee.findMany({
          where: { departmentId: filters.departmentId },
          select: { id: true },
        });
        employeeIds = employees.map((e) => e.id);
        where.employeeId = { in: employeeIds };
      }

      const withdrawals = await this.prisma.eOBIWithdrawal.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
              department: {
                select: {
                  id: true,
                  name: true,
                },
              },
              subDepartment: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
        orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
      });

      // Format response
      const formattedWithdrawals = withdrawals.map((w) => ({
        id: w.id,
        employeeId: w.employeeId,
        employeeDetails: `${w.employee.employeeId} - ${w.employee.employeeName}`,
        department: w.employee.department?.name || 'N/A',
        subDepartment: w.employee.subDepartment?.name || 'N/A',
        withdrawalAmount: Number(w.withdrawalAmount),
        withdrawalDate: w.withdrawalDate,
        month: w.month,
        year: w.year,
        monthYear: w.monthYear,
        reason: w.reason,
        approvalStatus: w.approvalStatus,
        status: w.status,
        createdAt: w.createdAt,
      }));

      return {
        status: true,
        data: formattedWithdrawals,
      };
    } catch (error) {
      this.logger.error('Error fetching EOBI withdrawals:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to fetch EOBI withdrawals',
      };
    }
  }

  // This method will be called from PayrollService when payroll is generated
  async addEOBIContribution(data: {
    employeeId: string;
    employeeContribution: Decimal;
    employerContribution: Decimal;
    month: string;
    year: string;
    payrollId?: string;
  }) {
    try {
      // Format monthYear
      const monthNames = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ];
      const monthIndex = parseInt(data.month, 10) - 1;
      const monthName = monthNames[monthIndex];
      const monthYear = `${monthName} ${data.year}`;

      const totalContribution = data.employeeContribution.add(
        data.employerContribution,
      );

      // Check if contribution already exists for this employee and month/year
      const existingContribution =
        await this.prisma.eOBIContribution.findFirst({
          where: {
            employeeId: data.employeeId,
            month: data.month,
            year: data.year,
          },
        });

      if (existingContribution) {
        this.logger.warn(
          `EOBI contribution already exists for employee ${data.employeeId} for ${monthYear}`,
        );
        return {
          status: false,
          message: 'EOBI contribution already exists for this month',
        };
      }

      // Create EOBI contribution
      const contribution = await this.prisma.eOBIContribution.create({
        data: {
          employeeId: data.employeeId,
          employeeContribution: data.employeeContribution,
          employerContribution: data.employerContribution,
          totalContribution: totalContribution,
          month: data.month,
          year: data.year,
          monthYear: monthYear,
          payrollId: data.payrollId,
        },
      });

      this.logger.log(
        `EOBI contribution added for employee ${data.employeeId} for ${monthYear}`,
      );

      return {
        status: true,
        data: contribution,
      };
    } catch (error) {
      this.logger.error('Error adding EOBI contribution:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to add EOBI contribution',
      };
    }
  }
}
