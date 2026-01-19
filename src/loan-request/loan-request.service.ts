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
  ) {}

  private async resolveApproverUserId(args: {
    level: {
      approverType: string;
      departmentHeadMode?: string | null;
      specificEmployeeId?: string | null;
      departmentId?: string | null;
      subDepartmentId?: string | null;
    };
    employee: {
      departmentId: string;
      subDepartmentId?: string | null;
      reportingManager?: string | null;
    };
  }) {
    const { level, employee } = args;

    if (level.approverType === 'reporting-manager') {
      if (!employee.reportingManager) return null;
      const manager = await this.prisma.employee.findUnique({
        where: { id: employee.reportingManager },
        select: { userId: true },
      });
      return manager?.userId || null;
    }

    if (level.approverType === 'specific-employee') {
      if (!level.specificEmployeeId) return null;
      const specific = await this.prisma.employee.findUnique({
        where: { id: level.specificEmployeeId },
        select: { userId: true },
      });
      return specific?.userId || null;
    }

    if (level.approverType === 'department-head') {
      const departmentId =
        level.departmentHeadMode === 'specific'
          ? level.departmentId
          : employee.departmentId;
      if (!departmentId) return null;
      const department = await this.prisma.department.findUnique({
        where: { id: departmentId },
        select: { headId: true },
      });
      if (!department?.headId) return null;
      const head = await this.prisma.employee.findUnique({
        where: { id: department.headId },
        select: { userId: true },
      });
      return head?.userId || null;
    }

    if (level.approverType === 'sub-department-head') {
      const subDepartmentId =
        level.departmentHeadMode === 'specific'
          ? level.subDepartmentId
          : employee.subDepartmentId;
      if (!subDepartmentId) return null;
      const subDepartment = await this.prisma.subDepartment.findUnique({
        where: { id: subDepartmentId },
        select: { headId: true },
      });
      if (!subDepartment?.headId) return null;
      const head = await this.prisma.employee.findUnique({
        where: { id: subDepartment.headId },
        select: { userId: true },
      });
      return head?.userId || null;
    }

    return null;
  }

  private getPendingApprovalLevel(req: any): 1 | 2 | null {
    if (
      req.approvalStatus === 'approved' ||
      req.approvalStatus === 'rejected'
    ) {
      return null;
    }

    if (
      req.approval1Status !== 'approved' &&
      req.approval1Status !== 'auto-approved'
    ) {
      return 1;
    }

    if (req.approval2 && req.approval2Status !== 'approved') {
      return 2;
    }

    return null;
  }

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
          error instanceof Error ? error.message : 'Failed to get loan request',
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
          message:
            'Only one loan request per employee is allowed. Please create separate requests for multiple employees.',
        };
      }

      const employeeIds = body.loanRequests.map((l) => l.employeeId);
      const employees = await this.prisma.employee.findMany({
        where: { id: { in: employeeIds } },
        select: {
          id: true,
          departmentId: true,
          subDepartmentId: true,
          reportingManager: true,
        },
      });

      if (employees.length !== employeeIds.length) {
        return { status: false, message: 'One or more employees not found' };
      }

      const employeeById = new Map(employees.map((e) => [e.id, e]));

      const loanTypeIds = body.loanRequests.map((l) => l.loanTypeId);
      const loanTypes = await this.prisma.loanType.findMany({
        where: { id: { in: loanTypeIds }, status: 'active' },
        select: { id: true },
      });

      if (loanTypes.length !== loanTypeIds.length) {
        return {
          status: false,
          message: 'One or more loan types not found or inactive',
        };
      }

      const forwarding =
        await this.prisma.requestForwardingConfiguration.findUnique({
          where: { requestType: 'loan' },
          include: { approvalLevels: { orderBy: { level: 'asc' } } },
        });
      const activeForwarding =
        forwarding && forwarding.status === 'active' ? forwarding : null;

      const result = await this.prisma.$transaction(async (tx) => {
        const createdLoanRequests: any[] = [];

        for (const loanRequestItem of body.loanRequests) {
          const requestedDate = new Date(loanRequestItem.requestedDate);

          const employee = employeeById.get(loanRequestItem.employeeId);
          if (!employee) {
            throw new Error('Employee not found');
          }

          const now = new Date();
          let approvalStatus: string = 'pending';
          let status: string = 'pending';
          let approval1: string | null = null;
          let approval1Status: string | null = null;
          let approval1Date: Date | null = null;
          let approval2: string | null = null;
          let approval2Status: string | null = null;
          const approval2Date: Date | null = null;

          if (activeForwarding?.approvalFlow === 'auto-approved') {
            approvalStatus = 'approved';
            status = 'approved';
            approval1Status = 'auto-approved';
            approval1Date = now;
          } else if (activeForwarding?.approvalFlow === 'multi-level') {
            const level1 = activeForwarding.approvalLevels.find(
              (l) => l.level === 1,
            );
            if (!level1) {
              throw new Error(
                'Approval level 1 is required for multi-level flow',
              );
            }

            const approver1UserId = await this.resolveApproverUserId({
              level: level1,
              employee: {
                departmentId: employee.departmentId,
                subDepartmentId: employee.subDepartmentId,
                reportingManager: employee.reportingManager,
              },
            });
            if (!approver1UserId) {
              throw new Error(
                'Could not resolve approver for approval level 1',
              );
            }
            approval1 = approver1UserId;
            approval1Status = 'pending';

            const level2 = activeForwarding.approvalLevels.find(
              (l) => l.level === 2,
            );
            if (level2) {
              const approver2UserId = await this.resolveApproverUserId({
                level: level2,
                employee: {
                  departmentId: employee.departmentId,
                  subDepartmentId: employee.subDepartmentId,
                  reportingManager: employee.reportingManager,
                },
              });
              if (!approver2UserId) {
                throw new Error(
                  'Could not resolve approver for approval level 2',
                );
              }
              approval2 = approver2UserId;
              approval2Status = 'pending';
            }
          }

          const created = await tx.loanRequest.create({
            data: {
              employeeId: loanRequestItem.employeeId,
              loanTypeId: loanRequestItem.loanTypeId,
              amount: loanRequestItem.amount,
              requestedDate: requestedDate,
              repaymentStartMonthYear:
                loanRequestItem.repaymentStartMonthYear || null,
              numberOfInstallments:
                loanRequestItem.numberOfInstallments || null,
              reason: loanRequestItem.reason,
              additionalDetails: loanRequestItem.additionalDetails || null,
              approval1,
              approval1Status,
              approval1Date,
              approval2,
              approval2Status,
              approval2Date,
              approvalStatus,
              status,
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
        updateData.repaymentStartMonthYear =
          body.repaymentStartMonthYear || null;
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
    return this.approveLevel(id, undefined, body, ctx);
  }

  async reject(
    id: string,
    body: ApproveLoanRequestDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    return this.rejectLevel(id, undefined, body, ctx);
  }

  async approveLevel(
    id: string,
    level: 1 | 2 | undefined,
    body: ApproveLoanRequestDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!ctx.userId) {
        return { status: false, message: 'Unauthorized' };
      }

      const existing = await this.prisma.loanRequest.findUnique({
        where: { id },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
            },
          },
          loanType: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (!existing) {
        return { status: false, message: 'Loan request not found' };
      }

      if (existing.approvalStatus === 'approved') {
        return { status: false, message: 'Loan request already approved' };
      }

      if (existing.approvalStatus === 'rejected') {
        return { status: false, message: 'Loan request already rejected' };
      }

      const effectiveLevel = level || this.getPendingApprovalLevel(existing);
      if (!effectiveLevel) {
        return { status: false, message: 'No pending approval found' };
      }

      if (effectiveLevel === 1) {
        if (!(existing as any).approval1) {
          return {
            status: false,
            message: 'No approver configured for level 1',
          };
        }
        if ((existing as any).approval1 !== ctx.userId) {
          return { status: false, message: 'Forbidden' };
        }

        const nextApprovalStatus = (existing as any).approval2
          ? 'pending'
          : 'approved';
        const nextStatus =
          nextApprovalStatus === 'approved' ? 'approved' : 'pending';

        const updated = await this.prisma.loanRequest.update({
          where: { id },
          data: {
            approval1Status: 'approved',
            approval1Date: new Date(),
            approvalStatus: nextApprovalStatus,
            status: nextStatus,
            approvedById: nextApprovalStatus === 'approved' ? ctx.userId : null,
            approvedAt: nextApprovalStatus === 'approved' ? new Date() : null,
            updatedById: ctx.userId,
          } as any,
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

        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'approve',
          module: 'loan-request',
          entity: 'LoanRequest',
          entityId: id,
          description: 'Approved loan request (Level 1)',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });

        return {
          status: true,
          data: updated,
          message: 'Loan request approved successfully',
        };
      }

      if (effectiveLevel === 2) {
        if (
          (existing as any).approval1Status !== 'approved' &&
          (existing as any).approval1Status !== 'auto-approved'
        ) {
          return {
            status: false,
            message: 'Approval level 1 must be approved first',
          };
        }

        if (!(existing as any).approval2) {
          return {
            status: false,
            message: 'No approver configured for level 2',
          };
        }

        if ((existing as any).approval2 !== ctx.userId) {
          return { status: false, message: 'Forbidden' };
        }

        const updated = await this.prisma.loanRequest.update({
          where: { id },
          data: {
            approval2Status: 'approved',
            approval2Date: new Date(),
            approvalStatus: 'approved',
            status: 'approved',
            approvedById: ctx.userId,
            approvedAt: new Date(),
            updatedById: ctx.userId,
          } as any,
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

        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'approve',
          module: 'loan-request',
          entity: 'LoanRequest',
          entityId: id,
          description: 'Approved loan request (Level 2)',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });

        return {
          status: true,
          data: updated,
          message: 'Loan request approved successfully',
        };
      }

      return { status: false, message: 'Invalid approval level' };
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

  async rejectLevel(
    id: string,
    level: 1 | 2 | undefined,
    body: ApproveLoanRequestDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!ctx.userId) {
        return { status: false, message: 'Unauthorized' };
      }

      const existing = await this.prisma.loanRequest.findUnique({
        where: { id },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
            },
          },
          loanType: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (!existing) {
        return { status: false, message: 'Loan request not found' };
      }

      if (existing.approvalStatus === 'approved') {
        return { status: false, message: 'Loan request already approved' };
      }

      if (existing.approvalStatus === 'rejected') {
        return { status: false, message: 'Loan request already rejected' };
      }

      const effectiveLevel = level || this.getPendingApprovalLevel(existing);
      if (!effectiveLevel) {
        return { status: false, message: 'No pending approval found' };
      }

      if (effectiveLevel === 1) {
        if (!(existing as any).approval1) {
          return {
            status: false,
            message: 'No approver configured for level 1',
          };
        }
        if ((existing as any).approval1 !== ctx.userId) {
          return { status: false, message: 'Forbidden' };
        }

        const updated = await this.prisma.loanRequest.update({
          where: { id },
          data: {
            approval1Status: 'rejected',
            approval1Date: new Date(),
            approvalStatus: 'rejected',
            status: 'rejected',
            rejectionReason: body.rejectionReason || null,
            approvedById: ctx.userId,
            approvedAt: new Date(),
            updatedById: ctx.userId,
          } as any,
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

        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'reject',
          module: 'loan-request',
          entity: 'LoanRequest',
          entityId: id,
          description: 'Rejected loan request (Level 1)',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });

        return {
          status: true,
          data: updated,
          message: 'Loan request rejected successfully',
        };
      }

      if (effectiveLevel === 2) {
        if (
          (existing as any).approval1Status !== 'approved' &&
          (existing as any).approval1Status !== 'auto-approved'
        ) {
          return {
            status: false,
            message: 'Approval level 1 must be approved first',
          };
        }

        if (!(existing as any).approval2) {
          return {
            status: false,
            message: 'No approver configured for level 2',
          };
        }

        if ((existing as any).approval2 !== ctx.userId) {
          return { status: false, message: 'Forbidden' };
        }

        const updated = await this.prisma.loanRequest.update({
          where: { id },
          data: {
            approval2Status: 'rejected',
            approval2Date: new Date(),
            approvalStatus: 'rejected',
            status: 'rejected',
            rejectionReason: body.rejectionReason || null,
            approvedById: ctx.userId,
            approvedAt: new Date(),
            updatedById: ctx.userId,
          } as any,
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

        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'reject',
          module: 'loan-request',
          entity: 'LoanRequest',
          entityId: id,
          description: 'Rejected loan request (Level 2)',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });

        return {
          status: true,
          data: updated,
          message: 'Loan request rejected successfully',
        };
      }

      return {
        status: false,
        message: 'Invalid approval level',
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
