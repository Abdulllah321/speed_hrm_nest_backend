import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/client';

@Injectable()
export class PFService {
  private readonly logger = new Logger(PFService.name);

  constructor(private readonly prisma: PrismaService) {}

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
          designation: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          employeeName: 'asc',
        },
      });

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
            department: employee.department?.name || 'N/A',
            subDepartment: employee.subDepartment?.name || 'N/A',
            designation: employee.designation?.name || 'N/A',
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
        include: {
          employee: {
            select: {
              employeeId: true,
              employeeName: true,
              department: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      return {
        status: true,
        data: withdrawal,
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
          createdBy: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
          approvedBy: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
      });

      return {
        status: true,
        data: withdrawals,
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
