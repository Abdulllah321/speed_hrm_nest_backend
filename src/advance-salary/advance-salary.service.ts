import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateAdvanceSalaryDto,
  UpdateAdvanceSalaryDto,
  ApproveAdvanceSalaryDto,
} from './dto/create-advance-salary.dto';

@Injectable()
export class AdvanceSalaryService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
    private notifications: NotificationsService,
  ) { }

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
    if (req.approvalStatus === 'approved' || req.approvalStatus === 'rejected')
      return null;

    if (
      req.approval1Status !== 'approved' &&
      req.approval1Status !== 'auto-approved'
    ) {
      return 1;
    }

    if (req.approval2 && req.approval2Status !== 'approved') return 2;

    return null;
  }

  async list(params?: {
    employeeId?: string;
    deductionMonth?: string;
    deductionYear?: string;
    deductionMonthYear?: string;
    approvalStatus?: string;
    status?: string;
  }) {
    try {
      const where: any = {};

      if (params?.employeeId) {
        where.employeeId = params.employeeId;
      }

      if (params?.deductionMonth) {
        where.deductionMonth = params.deductionMonth;
      }

      if (params?.deductionYear) {
        where.deductionYear = params.deductionYear;
      }

      if (params?.deductionMonthYear) {
        where.deductionMonthYear = params.deductionMonthYear;
      }

      if (params?.approvalStatus) {
        where.approvalStatus = params.approvalStatus;
      }

      if (params?.status) {
        where.status = params.status;
      }

      const advanceSalaries = await this.prisma.advanceSalary.findMany({
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

      return { status: true, data: advanceSalaries };
    } catch (error) {
      console.error('Error listing advance salaries:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to list advance salaries',
      };
    }
  }

  async get(id: string) {
    try {
      const advanceSalary = await this.prisma.advanceSalary.findUnique({
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

      if (!advanceSalary) {
        return { status: false, message: 'Advance salary not found' };
      }

      return { status: true, data: advanceSalary };
    } catch (error) {
      console.error('Error getting advance salary:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to get advance salary',
      };
    }
  }

  async create(
    body: CreateAdvanceSalaryDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!body.advanceSalaries || body.advanceSalaries.length === 0) {
        return {
          status: false,
          message: 'At least one advance salary item is required',
        };
      }

      // Validate all employees exist
      const employeeIds = body.advanceSalaries.map((a) => a.employeeId);
      const employees = await this.prisma.employee.findMany({
        where: { id: { in: employeeIds } },
        select: {
          id: true,
          employeeId: true,
          employeeName: true,
          departmentId: true,
          subDepartmentId: true,
          reportingManager: true,
          userId: true,
        },
      });

      if (employees.length !== employeeIds.length) {
        return { status: false, message: 'One or more employees not found' };
      }

      const employeeById = new Map(employees.map((e) => [e.id, e]));

      const forwarding =
        await this.prisma.requestForwardingConfiguration.findUnique({
          where: { requestType: 'advance-salary' },
          include: { approvalLevels: { orderBy: { level: 'asc' } } },
        });
      const activeForwarding =
        forwarding && forwarding.status === 'active' ? forwarding : null;

      // Create advance salaries in a transaction
      const result = await this.prisma.$transaction(async (tx) => {
        const createdAdvanceSalaries: any[] = [];

        for (const advanceSalaryItem of body.advanceSalaries) {
          const neededOnDate = new Date(advanceSalaryItem.neededOn);
          const employee = employeeById.get(advanceSalaryItem.employeeId);
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

          const created = await tx.advanceSalary.create({
            data: {
              employeeId: advanceSalaryItem.employeeId,
              amount: advanceSalaryItem.amount,
              neededOn: neededOnDate,
              deductionMonth: advanceSalaryItem.deductionMonth,
              deductionYear: advanceSalaryItem.deductionYear,
              deductionMonthYear: advanceSalaryItem.deductionMonthYear,
              reason: advanceSalaryItem.reason,
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
          createdAdvanceSalaries.push(created);
        }

        // Provide a typed return instead of `any[]`
        return createdAdvanceSalaries as {
          id: string;
          employeeId: string;
          amount: number;
          neededOn: Date;
          deductionMonth: number | null;
          deductionYear: number | null;
          deductionMonthYear: string | null;
          reason: string | null;
          approvalStatus: string;
          status: string;
          createdById: string | null;
        }[];
      });

      // Log activity
      if (Array.isArray(result) && result.length > 0 && ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'advance-salary',
          entity: 'AdvanceSalary',
          entityId: result[0].id,
          description: `Created ${result.length} advance salary request(s)`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      for (const created of result as any[]) {
        const employee = employeeById.get(created.employeeId);
        const requesterUserId = ctx.userId || employee?.userId || null;

        if (created.status === 'pending' && created.approval1) {
          await this.notifications.create({
            userId: created.approval1,
            title: 'Advance salary request awaiting approval',
            message: `${employee?.employeeName || 'Employee'} requested advance salary`,
            category: 'advance-salary',
            priority: 'high',
            actionType: 'advance-salary.pending-approval',
            actionPayload: { requestId: created.id, level: 1 },
            entityType: 'AdvanceSalary',
            entityId: created.id,
            channels: ['inApp', 'email', 'sms'],
          });
        }

        if (requesterUserId) {
          await this.notifications.create({
            userId: requesterUserId,
            title:
              created.approvalStatus === 'approved'
                ? 'Advance salary request approved'
                : 'Advance salary request submitted',
            message: `Amount: ${created.amount}`,
            category: 'advance-salary',
            priority: created.approvalStatus === 'approved' ? 'normal' : 'low',
            actionType: 'advance-salary.view',
            actionPayload: { requestId: created.id },
            entityType: 'AdvanceSalary',
            entityId: created.id,
            channels: ['inApp'],
          });
        }
      }

      return {
        status: true,
        data: result,
        message: `Successfully created ${result.length} advance salary request(s)`,
      };
    } catch (error) {
      console.error('Error creating advance salary:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to create advance salary',
      };
    }
  }

  async update(
    id: string,
    body: UpdateAdvanceSalaryDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.advanceSalary.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Advance salary not found' };
      }

      const updateData: any = {
        updatedById: ctx.userId,
      };

      if (body.amount !== undefined) {
        updateData.amount = body.amount;
      }

      if (body.neededOn !== undefined) {
        updateData.neededOn = new Date(body.neededOn);
      }

      if (body.deductionMonth !== undefined) {
        updateData.deductionMonth = body.deductionMonth;
      }

      if (body.deductionYear !== undefined) {
        updateData.deductionYear = body.deductionYear;
      }

      if (body.deductionMonthYear !== undefined) {
        updateData.deductionMonthYear = body.deductionMonthYear;
      }

      if (body.reason !== undefined) {
        updateData.reason = body.reason;
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

      const updated = await this.prisma.advanceSalary.update({
        where: { id },
        data: updateData,
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'advance-salary',
          entity: 'AdvanceSalary',
          entityId: id,
          description: 'Updated advance salary request',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return {
        status: true,
        data: updated,
        message: 'Advance salary updated successfully',
      };
    } catch (error) {
      console.error('Error updating advance salary:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to update advance salary',
      };
    }
  }

  async approve(
    id: string,
    body: ApproveAdvanceSalaryDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    return this.approveLevel(id, undefined, body, ctx);
  }

  async approveLevel(
    id: string,
    level: 1 | 2 | undefined,
    body: ApproveAdvanceSalaryDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!ctx.userId) return { status: false, message: 'Unauthorized' };

      const existing = await this.prisma.advanceSalary.findUnique({
        where: { id },
        include: {
          employee: { select: { id: true, employeeName: true, userId: true } },
        },
      });
      if (!existing)
        return { status: false, message: 'Advance salary not found' };
      if (existing.approvalStatus === 'approved') {
        return { status: false, message: 'Advance salary already approved' };
      }
      if (existing.approvalStatus === 'rejected') {
        return { status: false, message: 'Advance salary already rejected' };
      }

      const effectiveLevel = level || this.getPendingApprovalLevel(existing);
      if (!effectiveLevel)
        return { status: false, message: 'No pending approval found' };

      if (effectiveLevel === 1) {
        if (!(existing as any).approval1)
          return {
            status: false,
            message: 'No approver configured for level 1',
          };
        if ((existing as any).approval1 !== ctx.userId)
          return { status: false, message: 'Forbidden' };

        const nextApprovalStatus = (existing as any).approval2
          ? 'pending'
          : 'approved';
        const nextStatus =
          nextApprovalStatus === 'approved' ? 'active' : 'pending';

        const updated = await this.prisma.advanceSalary.update({
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
              select: { id: true, employeeName: true, userId: true },
            },
          },
        });

        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'approve',
          module: 'advance-salary',
          entity: 'AdvanceSalary',
          entityId: id,
          description: `Approved advance salary (Level 1) for ${updated.employee.employeeName}`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });

        await this.notifications.markRelatedAsRead(ctx.userId, {
          entityType: 'AdvanceSalary',
          entityId: id,
        });

        const requesterUserId =
          existing.createdById || (existing as any).employee?.userId || null;
        if ((existing as any).approval2 && nextApprovalStatus === 'pending') {
          await this.notifications.create({
            userId: (existing as any).approval2,
            title: 'Advance salary request awaiting approval',
            message: `${updated.employee.employeeName} is awaiting Level 2 approval`,
            category: 'advance-salary',
            priority: 'high',
            actionType: 'advance-salary.pending-approval',
            actionPayload: { requestId: id, level: 2 },
            entityType: 'AdvanceSalary',
            entityId: id,
            channels: ['inApp', 'email', 'sms'],
          });
        }

        if (requesterUserId) {
          await this.notifications.create({
            userId: requesterUserId,
            title:
              nextApprovalStatus === 'approved'
                ? 'Advance salary request approved'
                : 'Advance salary request partially approved',
            message:
              nextApprovalStatus === 'approved'
                ? 'Approved'
                : 'Approved at Level 1',
            category: 'advance-salary',
            priority: nextApprovalStatus === 'approved' ? 'normal' : 'low',
            actionType: 'advance-salary.view',
            actionPayload: { requestId: id },
            entityType: 'AdvanceSalary',
            entityId: id,
            channels: ['inApp'],
          });
        }

        return {
          status: true,
          data: updated,
          message: 'Advance salary approved successfully',
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
        if (!(existing as any).approval2)
          return {
            status: false,
            message: 'No approver configured for level 2',
          };
        if ((existing as any).approval2 !== ctx.userId)
          return { status: false, message: 'Forbidden' };

        const updated = await this.prisma.advanceSalary.update({
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
              select: { id: true, employeeName: true, userId: true },
            },
          },
        });

        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'approve',
          module: 'advance-salary',
          entity: 'AdvanceSalary',
          entityId: id,
          description: `Approved advance salary (Level 2) for ${updated.employee.employeeName}`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });

        await this.notifications.markRelatedAsRead(ctx.userId, {
          entityType: 'AdvanceSalary',
          entityId: id,
        });

        const requesterUserId =
          existing.createdById || (existing as any).employee?.userId || null;
        if (requesterUserId) {
          await this.notifications.create({
            userId: requesterUserId,
            title: 'Advance salary request approved',
            message: 'Approved at Level 2',
            category: 'advance-salary',
            priority: 'normal',
            actionType: 'advance-salary.view',
            actionPayload: { requestId: id },
            entityType: 'AdvanceSalary',
            entityId: id,
            channels: ['inApp'],
          });
        }

        return {
          status: true,
          data: updated,
          message: 'Advance salary approved successfully',
        };
      }

      return { status: false, message: 'Invalid approval level' };
    } catch (error) {
      console.error('Error approving advance salary:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to approve advance salary',
      };
    }
  }

  async reject(
    id: string,
    body: ApproveAdvanceSalaryDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    return this.rejectLevel(id, undefined, body, ctx);
  }

  async rejectLevel(
    id: string,
    level: 1 | 2 | undefined,
    body: ApproveAdvanceSalaryDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!ctx.userId) return { status: false, message: 'Unauthorized' };

      const existing = await this.prisma.advanceSalary.findUnique({
        where: { id },
        include: {
          employee: { select: { id: true, employeeName: true, userId: true } },
        },
      });
      if (!existing)
        return { status: false, message: 'Advance salary not found' };
      if (
        existing.approvalStatus === 'approved' ||
        existing.approvalStatus === 'rejected'
      ) {
        return {
          status: false,
          message: `Advance salary already ${existing.approvalStatus}`,
        };
      }

      const effectiveLevel = level || this.getPendingApprovalLevel(existing);
      if (!effectiveLevel)
        return { status: false, message: 'No pending approval found' };

      const updateData: any = {
        approvalStatus: 'rejected',
        status: 'rejected',
        rejectionReason: body.rejectionReason,
        updatedById: ctx.userId,
      };

      if (effectiveLevel === 1) {
        if ((existing as any).approval1 !== ctx.userId)
          return { status: false, message: 'Forbidden' };
        updateData.approval1Status = 'rejected';
        updateData.approval1Date = new Date();
      } else if (effectiveLevel === 2) {
        if ((existing as any).approval2 !== ctx.userId)
          return { status: false, message: 'Forbidden' };
        updateData.approval2Status = 'rejected';
        updateData.approval2Date = new Date();
      }

      const updated = await this.prisma.advanceSalary.update({
        where: { id },
        data: updateData,
        include: {
          employee: { select: { id: true, employeeName: true, userId: true } },
        },
      });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'reject',
        module: 'advance-salary',
        entity: 'AdvanceSalary',
        entityId: id,
        description: `Rejected advance salary (Level ${effectiveLevel}) for ${updated.employee.employeeName}`,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      await this.notifications.markRelatedAsRead(ctx.userId, {
        entityType: 'AdvanceSalary',
        entityId: id,
      });

      const requesterUserId =
        existing.createdById || (existing as any).employee?.userId || null;
      if (requesterUserId) {
        await this.notifications.create({
          userId: requesterUserId,
          title: 'Advance salary request rejected',
          message: body.rejectionReason || 'Request was rejected',
          category: 'advance-salary',
          priority: 'high',
          actionType: 'advance-salary.view',
          actionPayload: { requestId: id },
          entityType: 'AdvanceSalary',
          entityId: id,
          channels: ['inApp', 'email'],
        });
      }

      return {
        status: true,
        data: updated,
        message: 'Advance salary rejected successfully',
      };
    } catch (error) {
      console.error('Error rejecting advance salary:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to reject advance salary',
      };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.advanceSalary.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Advance salary not found' };
      }

      await this.prisma.advanceSalary.delete({
        where: { id },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'advance-salary',
          entity: 'AdvanceSalary',
          entityId: id,
          description: 'Deleted advance salary request',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return { status: true, message: 'Advance salary deleted successfully' };
    } catch (error) {
      console.error('Error deleting advance salary:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to delete advance salary',
      };
    }
  }
}
