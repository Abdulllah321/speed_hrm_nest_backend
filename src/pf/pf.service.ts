import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Decimal } from '@prisma/client/runtime/client';
import { PrismaMasterService } from '../database/prisma-master.service';

@Injectable()
export class PFService {
  private readonly logger = new Logger(PFService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaMaster: PrismaMasterService
  ) {}

  async getPFEmployees() {
    try {
      // Get all employees with PF enabled
      const employees = await this.prisma.employee.findMany({
        where: {
          providentFund: true,
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

      // Calculate PF balances for each employee
      const pfData = await Promise.all(
        employees.map(async (employee) => {
          // Get all confirmed payroll details for this employee
          const payrollDetails = await this.prisma.payrollDetail.findMany({
            where: {
              employeeId: employee.id,
              payroll: {
                status: 'confirmed',
              },
            },
            select: {
              providentFundDeduction: true,
              payroll: {
                select: {
                  month: true,
                  year: true,
                },
              },
            },
            orderBy: [
              { payroll: { year: 'desc' } },
              { payroll: { month: 'desc' } },
            ],
          });

          // Calculate total PF (employee contribution + employer contribution)
          // Assuming employer matches employee contribution (multiply by 2)
          const totalEmployeeContribution = payrollDetails.reduce(
            (sum, detail) =>
              sum.add(new Decimal(detail.providentFundDeduction || 0)),
            new Decimal(0),
          );

          const totalEmployerContribution = totalEmployeeContribution; // Matching contribution
          const totalPFBalance = totalEmployeeContribution.add(
            totalEmployerContribution,
          );

          // Get latest contribution month/year
          const latestDetail = payrollDetails[0];

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
            totalPFBalance: totalPFBalance.toNumber(),
            lastContributionMonth: latestDetail
              ? `${latestDetail.payroll.month}/${latestDetail.payroll.year}`
              : 'N/A',
            totalMonths: payrollDetails.length,
          };
        }),
      );

      return {
        status: true,
        data: pfData,
      };
    } catch (error) {
      this.logger.error('Error fetching PF employees:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to fetch PF employee data',
      };
    }
  }

  async createPFWithdrawal(data: {
    employeeId: string;
    withdrawalAmount: number;
    month: string;
    year: string;
    reason?: string;
    createdById?: string;
  }) {
    try {
      const { employeeId, withdrawalAmount, month, year, reason, createdById } =
        data;

      // Validate employee exists and has PF enabled
      const employee = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: {
          id: true,
          employeeId: true,
          employeeName: true,
          providentFund: true,
        },
      });

      if (!employee) {
        return {
          status: false,
          message: 'Employee not found',
        };
      }

      if (!employee.providentFund) {
        return {
          status: false,
          message: 'Employee does not have Provident Fund enabled',
        };
      }

      // Create monthYear string
      const monthYear = `${year}-${month.padStart(2, '0')}`;

      // Create PF withdrawal
      const withdrawal = await this.prisma.pFWithdrawal.create({
        data: {
          employeeId,
          withdrawalAmount: new Decimal(withdrawalAmount),
          month,
          year,
          monthYear,
          reason,
          createdById,
          withdrawalDate: new Date(),
        },
      });

      // Map relation data for response
      const dept = employeeId
        ? await this.prisma.employee
            .findUnique({
              where: { id: employeeId },
              select: { departmentId: true },
            })
            .then(async (e) => {
              if (e?.departmentId) {
                return this.prisma.department.findUnique({
                  where: { id: e.departmentId },
                  select: { name: true },
                });
              }
              return null;
            })
        : null;

      const mappedWithdrawal = {
        ...withdrawal,
        employee: {
          employeeId: employee.employeeId,
          employeeName: employee.employeeName,
          department: dept,
        },
      };

      return {
        status: true,
        data: mappedWithdrawal,
        message: 'PF withdrawal created successfully',
      };
    } catch (error) {
      this.logger.error('Error creating PF withdrawal:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to create PF withdrawal',
      };
    }
  }

  async getPFWithdrawals(filters?: {
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

      if (filters?.departmentId) {
        where.employee = {
          departmentId: filters.departmentId,
        };
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

      const withdrawals = await this.prisma.pFWithdrawal.findMany({
        where,
        orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
      });

      // Collect IDs for manual fetching
      const employeeIds = [...new Set(withdrawals.map((w) => w.employeeId))];
      const userIds = new Set<string>();
      withdrawals.forEach((w) => {
        if (w.createdById) userIds.add(w.createdById);
        if (w.approvedById) userIds.add(w.approvedById);
      });

      const [employees, users] = await Promise.all([
        this.prisma.employee.findMany({
          where: { id: { in: employeeIds } },
          select: {
            id: true,
            employeeId: true,
            employeeName: true,
            departmentId: true,
            subDepartmentId: true,
          },
        }),
        this.prismaMaster.user.findMany({
          where: { id: { in: Array.from(userIds) } },
          select: { id: true, firstName: true, lastName: true },
        }),
      ]);

      const deptIds = [
        ...new Set(employees.map((e) => e.departmentId).filter(Boolean)),
      ] as string[];
      const subDeptIds = [
        ...new Set(employees.map((e) => e.subDepartmentId).filter(Boolean)),
      ] as string[];

      const [departments, subDepartments] = await Promise.all([
        this.prisma.department.findMany({
          where: { id: { in: deptIds } },
          select: { id: true, name: true },
        }),
        this.prisma.subDepartment.findMany({
          where: { id: { in: subDeptIds } },
          select: { id: true, name: true },
        }),
      ]);

      const deptMap = new Map(departments.map((d) => [d.id, d]));
      const subDeptMap = new Map(subDepartments.map((sd) => [sd.id, sd]));
      const userMap = new Map(users.map((u) => [u.id, u]));
      const employeeMap = new Map(
        employees.map((e) => [
          e.id,
          {
            ...e,
            department: e.departmentId ? deptMap.get(e.departmentId) : null,
            subDepartment: e.subDepartmentId
              ? subDeptMap.get(e.subDepartmentId)
              : null,
          },
        ]),
      );

      const mappedWithdrawals = withdrawals.map((w) => ({
        ...w,
        employee: employeeMap.get(w.employeeId) || null,
        createdBy: w.createdById ? userMap.get(w.createdById) : null,
        approvedBy: w.approvedById ? userMap.get(w.approvedById) : null,
      }));

      return {
        status: true,
        data: mappedWithdrawals,
      };
    } catch (error) {
      this.logger.error('Error fetching PF withdrawals:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to fetch PF withdrawals',
      };
    }
  }
}
