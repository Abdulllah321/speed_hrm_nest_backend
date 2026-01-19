import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import {
  CreateLeaveEncashmentDto,
  UpdateLeaveEncashmentDto,
  ApproveLeaveEncashmentDto,
} from './dto/leave-encashment.dto';

@Injectable()
export class LeaveEncashmentService {
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
    paymentMonth?: string;
    paymentYear?: string;
    paymentMonthYear?: string;
    approvalStatus?: string;
    status?: string;
  }) {
    try {
      const where: any = {};

      if (params?.employeeId) {
        where.employeeId = params.employeeId;
      }

      if (params?.paymentMonth) {
        where.paymentMonth = params.paymentMonth;
      }

      if (params?.paymentYear) {
        where.paymentYear = params.paymentYear;
      }

      if (params?.paymentMonthYear) {
        where.paymentMonthYear = params.paymentMonthYear;
      }

      if (params?.approvalStatus) {
        where.approvalStatus = params.approvalStatus;
      }

      if (params?.status) {
        where.status = params.status;
      }

      const leaveEncashments = await this.prisma.leaveEncashment.findMany({
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

      return { status: true, data: leaveEncashments };
    } catch (error) {
      console.error('Error listing leave encashments:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to list leave encashments',
      };
    }
  }

  async get(id: string) {
    try {
      const leaveEncashment = await this.prisma.leaveEncashment.findUnique({
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

      if (!leaveEncashment) {
        return { status: false, message: 'Leave encashment not found' };
      }

      return { status: true, data: leaveEncashment };
    } catch (error) {
      console.error('Error getting leave encashment:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to get leave encashment',
      };
    }
  }

  async create(
    body: CreateLeaveEncashmentDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!body.leaveEncashments || body.leaveEncashments.length === 0) {
        return {
          status: false,
          message: 'At least one leave encashment item is required',
        };
      }

      // Validate all employees exist
      const employeeIds = body.leaveEncashments.map((l) => l.employeeId);
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

      const forwarding =
        await this.prisma.requestForwardingConfiguration.findUnique({
          where: { requestType: 'leave-encashment' },
          include: { approvalLevels: { orderBy: { level: 'asc' } } },
        });
      const activeForwarding =
        forwarding && forwarding.status === 'active' ? forwarding : null;

      const result = await this.prisma.$transaction(async (tx) => {
        const createdLeaveEncashments: any[] = [];

        for (const leaveEncashmentItem of body.leaveEncashments) {
          const encashmentDate = new Date(leaveEncashmentItem.encashmentDate);

          const employee = employeeById.get(leaveEncashmentItem.employeeId);
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
            status = 'active';
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

          const created = await tx.leaveEncashment.create({
            data: {
              employeeId: leaveEncashmentItem.employeeId,
              encashmentDate: encashmentDate,
              encashmentDays: leaveEncashmentItem.encashmentDays,
              encashmentAmount: leaveEncashmentItem.encashmentAmount,
              paymentMonth: leaveEncashmentItem.paymentMonth,
              paymentYear: leaveEncashmentItem.paymentYear,
              paymentMonthYear: leaveEncashmentItem.paymentMonthYear,
              grossSalary: leaveEncashmentItem.grossSalary
                ? leaveEncashmentItem.grossSalary
                : null,
              annualSalary: leaveEncashmentItem.annualSalary
                ? leaveEncashmentItem.annualSalary
                : null,
              perDayAmount: leaveEncashmentItem.perDayAmount
                ? leaveEncashmentItem.perDayAmount
                : null,
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
          });
          createdLeaveEncashments.push(created);
        }

        return createdLeaveEncashments;
      });

      // Log activity
      if (Array.isArray(result) && result.length > 0 && ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'leave-encashment',
          entity: 'LeaveEncashment',
          entityId: result[0].id,
          description: `Created ${result.length} leave encashment request(s)`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: result,
        message: `Successfully created ${result.length} leave encashment request(s)`,
      };
    } catch (error) {
      console.error('Error creating leave encashment:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to create leave encashment',
      };
    }
  }

  async update(
    id: string,
    body: UpdateLeaveEncashmentDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.leaveEncashment.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Leave encashment not found' };
      }

      const updateData: any = {
        updatedById: ctx.userId,
      };

      if (body.encashmentDate !== undefined) {
        updateData.encashmentDate = new Date(body.encashmentDate);
      }

      if (body.encashmentDays !== undefined) {
        updateData.encashmentDays = body.encashmentDays;
      }

      if (body.encashmentAmount !== undefined) {
        updateData.encashmentAmount = body.encashmentAmount;
      }

      if (body.paymentMonth !== undefined) {
        updateData.paymentMonth = body.paymentMonth;
      }

      if (body.paymentYear !== undefined) {
        updateData.paymentYear = body.paymentYear;
      }

      if (body.paymentMonthYear !== undefined) {
        updateData.paymentMonthYear = body.paymentMonthYear;
      }

      if (body.grossSalary !== undefined) {
        updateData.grossSalary = body.grossSalary;
      }

      if (body.annualSalary !== undefined) {
        updateData.annualSalary = body.annualSalary;
      }

      if (body.perDayAmount !== undefined) {
        updateData.perDayAmount = body.perDayAmount;
      }

      if (body.approvalStatus !== undefined) {
        updateData.approvalStatus = body.approvalStatus;
      }

      if (body.rejectionReason !== undefined) {
        updateData.rejectionReason = body.rejectionReason;
      }

      if (body.status !== undefined) {
        updateData.status = body.status;
      }

      const updated = await this.prisma.leaveEncashment.update({
        where: { id },
        data: updateData,
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'leave-encashment',
          entity: 'LeaveEncashment',
          entityId: id,
          description: 'Updated leave encashment request',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: updated,
        message: 'Leave encashment updated successfully',
      };
    } catch (error) {
      console.error('Error updating leave encashment:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to update leave encashment',
      };
    }
  }

  async approve(
    id: string,
    body: ApproveLeaveEncashmentDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    return this.approveLevel(id, undefined, body, ctx);
  }

  async approveLevel(
    id: string,
    level: 1 | 2 | undefined,
    body: ApproveLeaveEncashmentDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!ctx.userId) {
        return { status: false, message: 'Unauthorized' };
      }

      const existing = await this.prisma.leaveEncashment.findUnique({
        where: { id },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
            },
          },
        },
      });

      if (!existing) {
        return { status: false, message: 'Leave encashment not found' };
      }

      if (existing.approvalStatus === 'approved') {
        return { status: false, message: 'Leave encashment already approved' };
      }

      if (existing.approvalStatus === 'rejected') {
        return { status: false, message: 'Leave encashment already rejected' };
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
          nextApprovalStatus === 'approved' ? 'active' : 'pending';

        const updated = await this.prisma.leaveEncashment.update({
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
              },
            },
          },
        });

        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'approve',
          module: 'leave-encashment',
          entity: 'LeaveEncashment',
          entityId: id,
          description: `Approved leave encashment request (Level 1) for ${updated.employee.employeeName}`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });

        return {
          status: true,
          data: updated,
          message: 'Leave encashment approved successfully',
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

        const updated = await this.prisma.leaveEncashment.update({
          where: { id },
          data: {
            approval2Status: 'approved',
            approval2Date: new Date(),
            approvalStatus: 'approved',
            status: 'active',
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
              },
            },
          },
        });

        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'approve',
          module: 'leave-encashment',
          entity: 'LeaveEncashment',
          entityId: id,
          description: `Approved leave encashment request (Level 2) for ${updated.employee.employeeName}`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });

        return {
          status: true,
          data: updated,
          message: 'Leave encashment approved successfully',
        };
      }

      return { status: false, message: 'Invalid approval level' };
    } catch (error) {
      console.error('Error approving leave encashment:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to approve leave encashment',
      };
    }
  }

  async reject(
    id: string,
    body: ApproveLeaveEncashmentDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    return this.rejectLevel(id, undefined, body, ctx);
  }

  async rejectLevel(
    id: string,
    level: 1 | 2 | undefined,
    body: ApproveLeaveEncashmentDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!ctx.userId) {
        return { status: false, message: 'Unauthorized' };
      }

      const existing = await this.prisma.leaveEncashment.findUnique({
        where: { id },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
            },
          },
        },
      });

      if (!existing) {
        return { status: false, message: 'Leave encashment not found' };
      }

      if (existing.approvalStatus === 'approved') {
        return { status: false, message: 'Leave encashment already approved' };
      }

      if (existing.approvalStatus === 'rejected') {
        return { status: false, message: 'Leave encashment already rejected' };
      }

      const effectiveLevel = level || this.getPendingApprovalLevel(existing);
      if (!effectiveLevel) {
        return { status: false, message: 'No pending approval found' };
      }

      const rejectionReason = body.rejectionReason || null;

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

        const updated = await this.prisma.leaveEncashment.update({
          where: { id },
          data: {
            approval1Status: 'rejected',
            approval1Date: new Date(),
            approvalStatus: 'rejected',
            status: 'rejected',
            rejectionReason,
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
              },
            },
          },
        });

        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'reject',
          module: 'leave-encashment',
          entity: 'LeaveEncashment',
          entityId: id,
          description: `Rejected leave encashment request (Level 1) for ${updated.employee.employeeName}`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });

        return {
          status: true,
          data: updated,
          message: 'Leave encashment rejected successfully',
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

        const updated = await this.prisma.leaveEncashment.update({
          where: { id },
          data: {
            approval2Status: 'rejected',
            approval2Date: new Date(),
            approvalStatus: 'rejected',
            status: 'rejected',
            rejectionReason,
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
              },
            },
          },
        });

        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'reject',
          module: 'leave-encashment',
          entity: 'LeaveEncashment',
          entityId: id,
          description: `Rejected leave encashment request (Level 2) for ${updated.employee.employeeName}`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });

        return {
          status: true,
          data: updated,
          message: 'Leave encashment rejected successfully',
        };
      }

      return { status: false, message: 'Invalid rejection level' };
    } catch (error) {
      console.error('Error rejecting leave encashment:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to reject leave encashment',
      };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.leaveEncashment.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Leave encashment not found' };
      }

      await this.prisma.leaveEncashment.delete({
        where: { id },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'leave-encashment',
          entity: 'LeaveEncashment',
          entityId: id,
          description: 'Deleted leave encashment request',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return { status: true, message: 'Leave encashment deleted successfully' };
    } catch (error) {
      console.error('Error deleting leave encashment:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to delete leave encashment',
      };
    }
  }
}
