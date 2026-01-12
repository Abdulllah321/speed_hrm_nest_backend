/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import {
  CreateLoanRequestDto,
  UpdateLoanRequestDto,
  ApproveLoanRequestDto,
} from './dto/create-loan-request.dto';

@Injectable()
export class LoanRequestService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) { }

  async list(params?: {
    employeeId?: string;
    loanTypeId?: string;
    status?: string;
    approvalStatus?: string;
    requestedDate?: string;
    repaymentStartMonthYear?: string;
  }) {
    try {
      const where: any = {};

      if (params?.employeeId) {
        where.employeeId = params.employeeId;
      }

      if (params?.loanTypeId) {
        where.loanTypeId = params.loanTypeId;
      }

      if (params?.status) {
        where.status = params.status;
      }

      if (params?.approvalStatus) {
        where.approvalStatus = params.approvalStatus;
      }

      if (params?.requestedDate) {
        where.requestedDate = new Date(params.requestedDate);
      }

      if (params?.repaymentStartMonthYear) {
        where.repaymentStartMonthYear = params.repaymentStartMonthYear;
      }

      const loanRequests = await this.prisma.loanRequest.findMany({
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
          loanType: {
            select: {
              id: true,
              name: true,
            },
          },
          approvedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          updatedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Calculate paid amount for each loan request
      const data = await Promise.all(
        loanRequests.map(async (loan) => {
          // Fetch total loan deductions for this employee from confirmed payrolls
          const payrollDetails = await this.prisma.payrollDetail.aggregate({
            where: {
              employeeId: loan.employeeId,
              payroll: {
                status: 'confirmed',
              },
            },
            _sum: {
              loanDeduction: true,
            },
          });

          const paidAmount = payrollDetails._sum.loanDeduction
            ? Number(payrollDetails._sum.loanDeduction.toString())
            : 0;

          return {
            ...loan,
            paidAmount,
          };
        }),
      );

      return { status: true, data };
    } catch (error) {
      console.error('Error listing loan requests:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to list loan requests',
      };
    }
  }

  async get(id: string) {
    try {
      const loanRequest = await this.prisma.loanRequest.findUnique({
        where: { id },
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
          loanType: {
            select: {
              id: true,
              name: true,
            },
          },
          approvedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          updatedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      if (!loanRequest) {
        return { status: false, message: 'Loan request not found' };
      }

      return { status: true, data: loanRequest };
    } catch (error) {
      console.error('Error getting loan request:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to get loan request',
      };
    }
  }

  async create(
    body: CreateLoanRequestDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!body.loanRequests || body.loanRequests.length === 0) {
        return {
          status: false,
          message: 'Loan request data is required',
        };
      }

      // Validate only one loan request is provided (single employee per request)
      if (body.loanRequests.length > 1) {
        return {
          status: false,
          message: 'Only one loan request per employee is allowed. Please create separate requests for multiple employees.',
        };
      }

      // Validate all employees exist
      const employeeIds = body.loanRequests.map((l) => l.employeeId);
      const employees = await this.prisma.employee.findMany({
        where: { id: { in: employeeIds } },
        select: { id: true },
      });

      if (employees.length !== employeeIds.length) {
        return { status: false, message: 'One or more employees not found' };
      }

      // Validate all loan types exist
      const loanTypeIds = body.loanRequests.map((l) => l.loanTypeId);
      const loanTypes = await this.prisma.loanType.findMany({
        where: { id: { in: loanTypeIds }, status: 'active' },
        select: { id: true },
      });

      if (loanTypes.length !== loanTypeIds.length) {
        return { status: false, message: 'One or more loan types not found or inactive' };
      }

      // Create loan requests in a transaction
      const result = await this.prisma.$transaction(async (tx) => {
        const createdLoanRequests: any[] = [];

        for (const loanRequestItem of body.loanRequests) {
          const requestedDate = new Date(loanRequestItem.requestedDate);

          const created = await tx.loanRequest.create({
            data: {
              employeeId: loanRequestItem.employeeId,
              loanTypeId: loanRequestItem.loanTypeId,
              amount: loanRequestItem.amount,
              requestedDate: requestedDate,
              repaymentStartMonthYear: loanRequestItem.repaymentStartMonthYear || null,
              numberOfInstallments: loanRequestItem.numberOfInstallments || null,
              reason: loanRequestItem.reason,
              additionalDetails: loanRequestItem.additionalDetails || null,
              approvalStatus: 'pending',
              status: 'pending',
              createdById: ctx.userId,
            },
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
              loanType: {
                select: {
                  id: true,
                  name: true,
                },
              },
              createdBy: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          });
          createdLoanRequests.push(created);
        }

        return createdLoanRequests;
      });

      // Log activity
      if (Array.isArray(result) && result.length > 0 && ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'loan-request',
          entity: 'LoanRequest',
          entityId: result[0].id,
          description: 'Created loan request',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: result.length === 1 ? result[0] : result,
        message: 'Loan request created successfully',
      };
    } catch (error) {
      console.error('Error creating loan request:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to create loan request',
      };
    }
  }

  async update(
    id: string,
    body: UpdateLoanRequestDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.loanRequest.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Loan request not found' };
      }

      const updateData: any = {
        updatedById: ctx.userId,
      };

      if (body.loanTypeId !== undefined) {
        // Validate loan type exists
        const loanType = await this.prisma.loanType.findUnique({
          where: { id: body.loanTypeId },
        });
        if (!loanType || loanType.status !== 'active') {
          return { status: false, message: 'Loan type not found or inactive' };
        }
        updateData.loanTypeId = body.loanTypeId;
      }

      if (body.amount !== undefined) {
        updateData.amount = body.amount;
      }

      if (body.requestedDate !== undefined) {
        updateData.requestedDate = new Date(body.requestedDate);
      }

      if (body.repaymentStartMonthYear !== undefined) {
        updateData.repaymentStartMonthYear = body.repaymentStartMonthYear || null;
      }

      if (body.numberOfInstallments !== undefined) {
        updateData.numberOfInstallments = body.numberOfInstallments || null;
      }

      if (body.reason !== undefined) {
        updateData.reason = body.reason;
      }

      if (body.additionalDetails !== undefined) {
        updateData.additionalDetails = body.additionalDetails || null;
      }

      if (body.approvalStatus !== undefined) {
        updateData.approvalStatus = body.approvalStatus;
      }

      if (body.rejectionReason !== undefined) {
        updateData.rejectionReason = body.rejectionReason || null;
      }

      if (body.status !== undefined) {
        updateData.status = body.status;
      }

      const updated = await this.prisma.loanRequest.update({
        where: { id },
        data: updateData,
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
          loanType: {
            select: {
              id: true,
              name: true,
            },
          },
          approvedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          updatedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'loan-request',
          entity: 'LoanRequest',
          entityId: id,
          description: 'Updated loan request',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: updated,
        message: 'Loan request updated successfully',
      };
    } catch (error) {
      console.error('Error updating loan request:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to update loan request',
      };
    }
  }

  async approve(
    id: string,
    body: ApproveLoanRequestDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.loanRequest.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Loan request not found' };
      }

      if (existing.approvalStatus !== 'pending') {
        return {
          status: false,
          message: 'Loan request is not pending approval',
        };
      }

      const updated = await this.prisma.loanRequest.update({
        where: { id },
        data: {
          approvalStatus: 'approved',
          status: 'approved',
          approvedById: ctx.userId,
          approvedAt: new Date(),
          updatedById: ctx.userId,
        },
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
          loanType: {
            select: {
              id: true,
              name: true,
            },
          },
          approvedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'approve',
          module: 'loan-request',
          entity: 'LoanRequest',
          entityId: id,
          description: 'Approved loan request',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: updated,
        message: 'Loan request approved successfully',
      };
    } catch (error) {
      console.error('Error approving loan request:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to approve loan request',
      };
    }
  }

  async reject(
    id: string,
    body: ApproveLoanRequestDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.loanRequest.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Loan request not found' };
      }

      if (existing.approvalStatus !== 'pending') {
        return {
          status: false,
          message: 'Loan request is not pending approval',
        };
      }

      const updated = await this.prisma.loanRequest.update({
        where: { id },
        data: {
          approvalStatus: 'rejected',
          status: 'rejected',
          rejectionReason: body.rejectionReason || null,
          approvedById: ctx.userId,
          approvedAt: new Date(),
          updatedById: ctx.userId,
        },
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
          loanType: {
            select: {
              id: true,
              name: true,
            },
          },
          approvedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'reject',
          module: 'loan-request',
          entity: 'LoanRequest',
          entityId: id,
          description: 'Rejected loan request',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: updated,
        message: 'Loan request rejected successfully',
      };
    } catch (error) {
      console.error('Error rejecting loan request:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to reject loan request',
      };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.loanRequest.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Loan request not found' };
      }

      await this.prisma.loanRequest.delete({
        where: { id },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'loan-request',
          entity: 'LoanRequest',
          entityId: id,
          description: 'Deleted loan request',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return { status: true, message: 'Loan request deleted successfully' };
    } catch (error) {
      console.error('Error deleting loan request:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to delete loan request',
      };
    }
  }
}
