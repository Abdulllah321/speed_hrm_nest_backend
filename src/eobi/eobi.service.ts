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

  async getEOBIEmployees(filters?: {
    month?: string;
    year?: string;
    region?: string;
    departmentId?: string;
  }) {
    try {
      const whereClause: any = {
        eobi: true,
        status: 'active',
      };

      if (filters?.departmentId && filters.departmentId !== 'all') {
        whereClause.departmentId = filters.departmentId;
      }

      if (filters?.region && filters.region.toLowerCase() !== 'all') {
        const regionFilter = filters.region.trim();
        if (regionFilter.toLowerCase() === 'punjab') {
          whereClause.OR = [
            { eobiRegion: { equals: 'Punjab', mode: 'insensitive' } },
            { eobiRegion: null },
            { eobiRegion: '' },
          ];
        } else {
          whereClause.eobiRegion = { equals: regionFilter, mode: 'insensitive' };
        }
      }

      // Get all employees with EOBI enabled
      const employees = await this.prisma.employee.findMany({
        where: whereClause,
        select: {
          id: true,
          employeeId: true,
          employeeName: true,
          departmentId: true,
          subDepartmentId: true,
          designationId: true,
          eobiRegion: true,
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

      const [departments, subDepartments, designations, distinctContributions, masterEOBIRecords] = await Promise.all([
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
        this.prisma.eOBIContribution.findMany({
          select: { month: true, year: true, monthYear: true },
          distinct: ['month', 'year'],
          orderBy: [{ year: 'desc' }, { month: 'desc' }],
        }),
        this.prisma.eOBI.findMany({
          where: { isDeleted: false, status: 'active' },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      const deptMap = new Map(departments.map((d) => [d.id, d]));
      const subDeptMap = new Map(subDepartments.map((sd) => [sd.id, sd]));
      const desgMap = new Map(designations.map((d) => [d.id, d]));

      // Map dynamic rates from Master EOBI table
      const masterRateMap = new Map<string, { employeeContribution: number; employerContribution: number }>();
      for (const rec of masterEOBIRecords) {
        const regKey = (rec.region || 'punjab').toLowerCase().trim();
        if (!masterRateMap.has(regKey)) {
          masterRateMap.set(regKey, {
            employeeContribution: Number(rec.employeeContribution || 400),
            employerContribution: Number(rec.employerContribution || 2000),
          });
        }
      }

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
              monthYear: true,
            },
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
          });

          // Get approved withdrawals for this employee
          const approvedWithdrawals = await this.prisma.eOBIWithdrawal.findMany({
            where: {
              employeeId: employee.id,
              approvalStatus: 'approved',
            },
            select: { withdrawalAmount: true },
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

          const totalWithdrawn = approvedWithdrawals.reduce(
            (sum, w) => sum.add(new Decimal(w.withdrawalAmount || 0)),
            new Decimal(0),
          );

          const availableBalance = totalEOBIBalance.sub(totalWithdrawn);

          // Get latest contribution month/year
          const latestContribution = contributions[0];

          // Check if specific month/year is requested
          let selectedMonthContribution: any = null;
          let selectedMonthEmp = 0;
          let selectedMonthEmpr = 0;
          let selectedMonthTotal = 0;
          let hasSelectedMonth = false;

          if (filters?.month && filters?.year) {
            const targetMonth = String(parseInt(filters.month, 10));
            const targetYear = String(filters.year);
            const match = contributions.find((c) => {
              const cMonth = String(parseInt(c.month, 10));
              return cMonth === targetMonth && String(c.year) === targetYear;
            });
            if (match) {
              selectedMonthContribution = match;
              selectedMonthEmp = Number(match.employeeContribution || 0);
              selectedMonthEmpr = Number(match.employerContribution || 0);
              selectedMonthTotal = Number(match.totalContribution || 0);
              hasSelectedMonth = true;
            }
          }

          const region = employee.eobiRegion || 'Punjab';

          return {
            id: employee.id,
            employeeId: employee.employeeId,
            employeeName: employee.employeeName,
            eobiRegion: region,
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
            totalWithdrawn: totalWithdrawn.toNumber(),
            availableBalance: availableBalance.toNumber(),
            lastContributionMonth: latestContribution
              ? `${latestContribution.month}/${latestContribution.year}`
              : 'N/A',
            totalMonths: contributions.length,
            // Selected month specific contributions
            selectedMonthEmployeeContribution: selectedMonthEmp,
            selectedMonthEmployerContribution: selectedMonthEmpr,
            selectedMonthTotalContribution: selectedMonthTotal,
            hasContributionInSelectedMonth: hasSelectedMonth,
          };
        }),
      );

      const isbRates = masterRateMap.get('islamabad') || { employeeContribution: 407, employerContribution: 2035 };
      const pjbRates = masterRateMap.get('punjab') || { employeeContribution: 400, employerContribution: 2000 };
      const sndRates = masterRateMap.get('sindh') || { employeeContribution: 400, employerContribution: 2000 };

      // Compute Region Breakdown
      const regionStats: Record<
        string,
        {
          count: number;
          employeeContribution: number;
          employerContribution: number;
          totalContribution: number;
          totalBalance: number;
          selectedMonthTotal: number;
          employeeMonthlyRate: number;
          employerMonthlyRate: number;
        }
      > = {
        Islamabad: {
          count: 0,
          employeeContribution: 0,
          employerContribution: 0,
          totalContribution: 0,
          totalBalance: 0,
          selectedMonthTotal: 0,
          employeeMonthlyRate: isbRates.employeeContribution,
          employerMonthlyRate: isbRates.employerContribution,
        },
        Punjab: {
          count: 0,
          employeeContribution: 0,
          employerContribution: 0,
          totalContribution: 0,
          totalBalance: 0,
          selectedMonthTotal: 0,
          employeeMonthlyRate: pjbRates.employeeContribution,
          employerMonthlyRate: pjbRates.employerContribution,
        },
        Sindh: {
          count: 0,
          employeeContribution: 0,
          employerContribution: 0,
          totalContribution: 0,
          totalBalance: 0,
          selectedMonthTotal: 0,
          employeeMonthlyRate: sndRates.employeeContribution,
          employerMonthlyRate: sndRates.employerContribution,
        },
      };

      for (const emp of eobiData) {
        const reg =
          emp.eobiRegion && regionStats[emp.eobiRegion]
            ? emp.eobiRegion
            : 'Punjab';

        if (!regionStats[reg]) {
          regionStats[reg] = {
            count: 0,
            employeeContribution: 0,
            employerContribution: 0,
            totalContribution: 0,
            totalBalance: 0,
            selectedMonthTotal: 0,
            employeeMonthlyRate: 400,
            employerMonthlyRate: 2000,
          };
        }

        regionStats[reg].count += 1;
        regionStats[reg].employeeContribution += emp.employeeContribution;
        regionStats[reg].employerContribution += emp.employerContribution;
        regionStats[reg].totalContribution += emp.totalEOBIBalance;
        regionStats[reg].totalBalance += emp.availableBalance;
        regionStats[reg].selectedMonthTotal += emp.selectedMonthTotalContribution || 0;
      }

      return {
        status: true,
        data: eobiData,
        availableMonths: distinctContributions.map((c) => ({
          month: c.month,
          year: c.year,
          monthYear: c.monthYear,
        })),
        regionBreakdown: regionStats,
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
      // Validate available balance first
      const contributions = await this.prisma.eOBIContribution.findMany({
        where: { employeeId: data.employeeId },
        select: { employeeContribution: true, employerContribution: true },
      });
      const totalBalance = contributions.reduce(
        (sum, c) =>
          sum
            .add(new Decimal(c.employeeContribution || 0))
            .add(new Decimal(c.employerContribution || 0)),
        new Decimal(0),
      );
      const approvedWithdrawals = await this.prisma.eOBIWithdrawal.findMany({
        where: { employeeId: data.employeeId, approvalStatus: 'approved' },
        select: { withdrawalAmount: true },
      });
      const totalWithdrawn = approvedWithdrawals.reduce(
        (sum, w) => sum.add(new Decimal(w.withdrawalAmount || 0)),
        new Decimal(0),
      );
      const availableBalance = totalBalance.sub(totalWithdrawn);

      if (new Decimal(data.withdrawalAmount).greaterThan(availableBalance)) {
        return {
          status: false,
          message: `Insufficient balance. Available: PKR ${availableBalance.toFixed(0)}, Requested: PKR ${new Decimal(data.withdrawalAmount).toFixed(0)}`,
        };
      }

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
        employee: {
          id: w.employee.id,
          employeeId: w.employee.employeeId,
          employeeName: w.employee.employeeName,
          department: w.employee.department
            ? { id: w.employee.department.id, name: w.employee.department.name }
            : null,
          subDepartment: w.employee.subDepartment
            ? { id: w.employee.subDepartment.id, name: w.employee.subDepartment.name }
            : null,
        },
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

  async approveEOBIWithdrawal(id: string, approvedById?: string) {
    try {
      const withdrawal = await this.prisma.eOBIWithdrawal.findUnique({
        where: { id },
      });

      if (!withdrawal) {
        return { status: false, message: 'EOBI withdrawal not found' };
      }

      if (withdrawal.approvalStatus === 'approved') {
        return { status: false, message: 'EOBI withdrawal is already approved' };
      }

      const updated = await this.prisma.eOBIWithdrawal.update({
        where: { id },
        data: {
          approvalStatus: 'approved',
          status: 'processed',
          approvedById,
        },
      });

      runInBackground(
        'Activity Log',
        this.activityLogs.log({
          action: 'UPDATE',
          module: 'EOBI',
          entity: 'EOBIWithdrawal',
          entityId: id,
          description: 'EOBI withdrawal approved',
          status: 'success',
          userId: approvedById,
        }),
      );

      return {
        status: true,
        message: 'EOBI withdrawal approved successfully',
        data: updated,
      };
    } catch (error) {
      this.logger.error('Error approving EOBI withdrawal:', error);
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to approve EOBI withdrawal',
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
        const updated = await this.prisma.eOBIContribution.update({
          where: { id: existingContribution.id },
          data: {
            employeeContribution: data.employeeContribution,
            employerContribution: data.employerContribution,
            totalContribution: totalContribution,
            payrollId: data.payrollId,
          },
        });
        return {
          status: true,
          data: updated,
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

  async recalculateEOBIContributions(month?: string, year?: string) {
    try {
      this.logger.log(`Recalculating EOBI contributions by employee region...`);
      const where: any = {};
      if (month) where.month = month;
      if (year) where.year = year;

      const contributions = await this.prisma.eOBIContribution.findMany({
        where,
        include: {
          employee: {
            include: {
              location: true,
            },
          },
        },
      });

      const masterEOBIRecords = await this.prisma.eOBI.findMany({
        where: { isDeleted: false, status: 'active' },
        orderBy: { createdAt: 'desc' },
      });

      const masterRateMap = new Map<string, { employeeContribution: number; employerContribution: number }>();
      for (const rec of masterEOBIRecords) {
        const regKey = (rec.region || 'punjab').toLowerCase().trim();
        if (!masterRateMap.has(regKey)) {
          masterRateMap.set(regKey, {
            employeeContribution: Number(rec.employeeContribution || 400),
            employerContribution: Number(rec.employerContribution || 2000),
          });
        }
      }

      let updatedCount = 0;

      for (const contrib of contributions) {
        if (!contrib.employee) continue;

        const emp = contrib.employee;
        const loc = emp.location;
        const locCode = (loc?.code || '').toUpperCase();
        const locName = (loc?.name || '').toUpperCase();
        const region = (emp.eobiRegion || '').toLowerCase();

        const isIslamabad =
          locCode === 'N10004' ||
          locCode === 'N10005' ||
          locCode === 'SS1007' ||
          locCode === 'SS1008' ||
          locCode === 'CK1006' ||
          locCode === 'W10004' ||
          locCode === 'W10005' ||
          locCode === 'W10010' ||
          locName.includes('ISLAMABAD') ||
          locName.includes('RAWALPINDI') ||
          locName.includes('SAFA') ||
          locName.includes('GIGA') ||
          locName.includes('CENTAURUS') ||
          region.includes('islamabad');

        const isSindh =
          region.includes('sindh') ||
          locName.includes('KARACHI') ||
          locName.includes('HYDERABAD') ||
          locName.includes('SINDH');

        const targetRegionKey = isIslamabad ? 'islamabad' : (isSindh ? 'sindh' : 'punjab');
        const rates = masterRateMap.get(targetRegionKey) || {
          employeeContribution: isIslamabad ? 407 : 400,
          employerContribution: isIslamabad ? 2035 : 2000,
        };

        const empContrib = new Decimal(rates.employeeContribution);
        const emprContrib = new Decimal(rates.employerContribution);
        const totContrib = empContrib.add(emprContrib);

        await this.prisma.eOBIContribution.update({
          where: { id: contrib.id },
          data: {
            employeeContribution: empContrib,
            employerContribution: emprContrib,
            totalContribution: totContrib,
          },
        });
        updatedCount++;
      }

      return {
        status: true,
        message: `Successfully recalculated EOBI rates according to employee regions for ${updatedCount} contribution record(s).`,
        updatedCount,
      };
    } catch (error) {
      this.logger.error('Error recalculating EOBI contributions:', error);
      return {
        status: false,
        message: error instanceof Error ? error.message : 'Failed to recalculate EOBI contributions',
      };
    }
  }
}

