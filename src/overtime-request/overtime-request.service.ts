import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateOvertimeRequestDto,
  UpdateOvertimeRequestDto,
} from './dto/create-overtime-request.dto';

@Injectable()
export class OvertimeRequestService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
    private notifications: NotificationsService,
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
    if (req.status === 'approved' || req.status === 'rejected') return null;

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
    overtimeType?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }) {
    try {
      const where: any = {};

      if (params?.employeeId) {
        where.employeeId = params.employeeId;
      }

      if (params?.overtimeType) {
        where.overtimeType = params.overtimeType;
      }

      if (params?.status) {
        where.status = params.status;
      }

      if (params?.startDate || params?.endDate) {
        where.date = {};
        if (params?.startDate) {
          where.date.gte = new Date(params.startDate);
        }
        if (params?.endDate) {
          where.date.lte = new Date(params.endDate);
        }
      }

      const overtimeRequests = await this.prisma.overtimeRequest.findMany({
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

      // Transform data to match frontend expectations
      const transformedData = overtimeRequests.map((request) => ({
        id: request.id,
        employeeId: request.employeeId,
        employeeName: request.employee.employeeName,
        employeeCode: request.employee.employeeId,
        overtimeType: request.overtimeType,
        title: request.title,
        description: request.description,
        date: request.date.toISOString(),
        weekdayOvertimeHours: Number(request.weekdayOvertimeHours),
        holidayOvertimeHours: Number(request.holidayOvertimeHours),
        status: request.status,
        approval1: request.approval1,
        approval1Status: (request as any).approval1Status || null,
        approval1Date: (request as any).approval1Date
          ? (request as any).approval1Date.toISOString()
          : null,
        approval2: request.approval2,
        approval2Status: (request as any).approval2Status || null,
        approval2Date: (request as any).approval2Date
          ? (request as any).approval2Date.toISOString()
          : null,
        remarks: (request as any).remarks || null,
        createdById: request.createdById,
        createdAt: request.createdAt.toISOString(),
        updatedAt: request.updatedAt.toISOString(),
      }));

      return { status: true, data: transformedData };
    } catch (error) {
      console.error('Error listing overtime requests:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to list overtime requests',
      };
    }
  }

  async get(id: string) {
    try {
      const overtimeRequest = await this.prisma.overtimeRequest.findUnique({
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

      if (!overtimeRequest) {
        return { status: false, message: 'Overtime request not found' };
      }

      // Transform data to match frontend expectations
      const transformedData = {
        id: overtimeRequest.id,
        employeeId: overtimeRequest.employeeId,
        employeeName: overtimeRequest.employee.employeeName,
        employeeCode: overtimeRequest.employee.employeeId,
        overtimeType: overtimeRequest.overtimeType,
        title: overtimeRequest.title,
        description: overtimeRequest.description,
        date: overtimeRequest.date.toISOString(),
        weekdayOvertimeHours: Number(overtimeRequest.weekdayOvertimeHours),
        holidayOvertimeHours: Number(overtimeRequest.holidayOvertimeHours),
        status: overtimeRequest.status,
        approval1: overtimeRequest.approval1,
        approval1Status: (overtimeRequest as any).approval1Status || null,
        approval1Date: (overtimeRequest as any).approval1Date
          ? (overtimeRequest as any).approval1Date.toISOString()
          : null,
        approval2: overtimeRequest.approval2,
        approval2Status: (overtimeRequest as any).approval2Status || null,
        approval2Date: (overtimeRequest as any).approval2Date
          ? (overtimeRequest as any).approval2Date.toISOString()
          : null,
        remarks: (overtimeRequest as any).remarks || null,
        createdById: overtimeRequest.createdById,
        createdAt: overtimeRequest.createdAt.toISOString(),
        updatedAt: overtimeRequest.updatedAt.toISOString(),
      };

      return { status: true, data: transformedData };
    } catch (error) {
      console.error('Error getting overtime request:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to get overtime request',
      };
    }
  }

  async create(
    body: CreateOvertimeRequestDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const employee = await this.prisma.employee.findUnique({
        where: { id: body.employeeId },
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

      if (!employee) {
        return { status: false, message: 'Employee not found' };
      }

      const date = new Date(body.date);
      const forwarding =
        await this.prisma.requestForwardingConfiguration.findUnique({
          where: { requestType: 'overtime' },
          include: { approvalLevels: { orderBy: { level: 'asc' } } },
        });
      const activeForwarding =
        forwarding && forwarding.status === 'active' ? forwarding : null;

      const now = new Date();
      let status: string = 'pending';
      let approval1: string | null = null;
      let approval1Status: string | null = null;
      let approval1Date: Date | null = null;
      let approval2: string | null = null;
      let approval2Status: string | null = null;
      const approval2Date: Date | null = null;

      if (activeForwarding?.approvalFlow === 'auto-approved') {
        status = 'approved';
        approval1Status = 'auto-approved';
        approval1Date = now;
      } else if (activeForwarding?.approvalFlow === 'multi-level') {
        const level1 = activeForwarding.approvalLevels.find(
          (l) => l.level === 1,
        );
        if (!level1) {
          return {
            status: false,
            message: 'Approval level 1 is required for multi-level flow',
          };
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
          return {
            status: false,
            message: 'Could not resolve approver for approval level 1',
          };
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
            return {
              status: false,
              message: 'Could not resolve approver for approval level 2',
            };
          }
          approval2 = approver2UserId;
          approval2Status = 'pending';
        }
      }

      const overtimeRequest = await this.prisma.overtimeRequest.create({
        data: {
          employeeId: body.employeeId,
          overtimeType: body.overtimeType,
          title: body.title,
          description: body.description ?? null,
          date: date,
          weekdayOvertimeHours: body.weekdayOvertimeHours,
          holidayOvertimeHours: body.holidayOvertimeHours,
          status,
          approval1,
          approval1Status,
          approval1Date,
          approval2,
          approval2Status,
          approval2Date,
          createdById: ctx.userId,
        },
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

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'overtime-request',
          entity: 'OvertimeRequest',
          entityId: overtimeRequest.id,
          description: `Created overtime request for employee ${overtimeRequest.employee.employeeName}`,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      const requesterUserId = ctx.userId || employee.userId || null;

      if (overtimeRequest.status === 'pending' && approval1) {
        await this.notifications.create({
          userId: approval1,
          title: 'Overtime request awaiting approval',
          message: `${overtimeRequest.employee.employeeName} requested overtime`,
          category: 'overtime',
          priority: 'high',
          actionType: 'overtime-request.pending-approval',
          actionPayload: { requestId: overtimeRequest.id, level: 1 },
          entityType: 'OvertimeRequest',
          entityId: overtimeRequest.id,
          channels: ['inApp', 'email', 'sms'],
        });
      }

      if (requesterUserId) {
        await this.notifications.create({
          userId: requesterUserId,
          title:
            overtimeRequest.status === 'approved'
              ? 'Overtime request approved'
              : 'Overtime request submitted',
          message: `${overtimeRequest.title} (${overtimeRequest.overtimeType})`,
          category: 'overtime',
          priority: overtimeRequest.status === 'approved' ? 'normal' : 'low',
          actionType: 'overtime-request.view',
          actionPayload: { requestId: overtimeRequest.id },
          entityType: 'OvertimeRequest',
          entityId: overtimeRequest.id,
          channels: ['inApp'],
        });
      }

      // Transform data to match frontend expectations
      const transformedData = {
        id: overtimeRequest.id,
        employeeId: overtimeRequest.employeeId,
        employeeName: overtimeRequest.employee.employeeName,
        employeeCode: overtimeRequest.employee.employeeId,
        overtimeType: overtimeRequest.overtimeType,
        title: overtimeRequest.title,
        description: overtimeRequest.description,
        date: overtimeRequest.date.toISOString(),
        weekdayOvertimeHours: Number(overtimeRequest.weekdayOvertimeHours),
        holidayOvertimeHours: Number(overtimeRequest.holidayOvertimeHours),
        status: overtimeRequest.status,
        approval1: overtimeRequest.approval1,
        approval1Status: (overtimeRequest as any).approval1Status || null,
        approval1Date: (overtimeRequest as any).approval1Date
          ? (overtimeRequest as any).approval1Date.toISOString()
          : null,
        approval2: overtimeRequest.approval2,
        approval2Status: (overtimeRequest as any).approval2Status || null,
        approval2Date: (overtimeRequest as any).approval2Date
          ? (overtimeRequest as any).approval2Date.toISOString()
          : null,
        remarks: (overtimeRequest as any).remarks || null,
        createdById: overtimeRequest.createdById,
        createdAt: overtimeRequest.createdAt.toISOString(),
        updatedAt: overtimeRequest.updatedAt.toISOString(),
      };

      return {
        status: true,
        data: transformedData,
        message: 'Overtime request created successfully',
      };
    } catch (error) {
      console.error('Error creating overtime request:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to create overtime request',
      };
    }
  }

  async approve(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    return this.approveLevel(id, undefined, ctx);
  }

  async approveLevel(
    id: string,
    level: 1 | 2 | undefined,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!ctx.userId) return { status: false, message: 'Unauthorized' };

      const existing = await this.prisma.overtimeRequest.findUnique({
        where: { id },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              employeeName: true,
              userId: true,
            },
          },
        },
      });
      if (!existing)
        return { status: false, message: 'Overtime request not found' };
      if (existing.status === 'approved')
        return { status: false, message: 'Overtime request already approved' };
      if (existing.status === 'rejected')
        return { status: false, message: 'Overtime request already rejected' };

      const effectiveLevel = level || this.getPendingApprovalLevel(existing);
      if (!effectiveLevel)
        return { status: false, message: 'No pending approval found' };

      if (effectiveLevel === 1) {
        if (!existing.approval1)
          return {
            status: false,
            message: 'No approver configured for level 1',
          };
        if (existing.approval1 !== ctx.userId)
          return { status: false, message: 'Forbidden' };

        const nextStatus = existing.approval2 ? 'pending' : 'approved';
        const updated = await this.prisma.overtimeRequest.update({
          where: { id },
          data: {
            status: nextStatus,
            approval1Status: 'approved',
            approval1Date: new Date(),
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
          action: 'update',
          module: 'overtime-request',
          entity: 'OvertimeRequest',
          entityId: id,
          description: `Approved overtime request (Level 1) for ${updated.employee.employeeName}`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });

        await this.notifications.markRelatedAsRead(ctx.userId, {
          entityType: 'OvertimeRequest',
          entityId: id,
        });

        const requesterUserId =
          existing.createdById || (existing as any).employee?.userId || null;

        if (existing.approval2 && nextStatus === 'pending') {
          await this.notifications.create({
            userId: existing.approval2,
            title: 'Overtime request awaiting approval',
            message: `${updated.employee.employeeName} is awaiting Level 2 approval`,
            category: 'overtime',
            priority: 'high',
            actionType: 'overtime-request.pending-approval',
            actionPayload: { requestId: id, level: 2 },
            entityType: 'OvertimeRequest',
            entityId: id,
            channels: ['inApp', 'email', 'sms'],
          });
        }

        if (requesterUserId) {
          await this.notifications.create({
            userId: requesterUserId,
            title:
              nextStatus === 'approved'
                ? 'Overtime request approved'
                : 'Overtime request partially approved',
            message:
              nextStatus === 'approved'
                ? `Overtime request approved`
                : `Overtime request approved at Level 1`,
            category: 'overtime',
            priority: nextStatus === 'approved' ? 'normal' : 'low',
            actionType: 'overtime-request.view',
            actionPayload: { requestId: id },
            entityType: 'OvertimeRequest',
            entityId: id,
            channels: ['inApp'],
          });
        }

        return { status: true, data: updated };
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
        if (!existing.approval2)
          return {
            status: false,
            message: 'No approver configured for level 2',
          };
        if (existing.approval2 !== ctx.userId)
          return { status: false, message: 'Forbidden' };

        const updated = await this.prisma.overtimeRequest.update({
          where: { id },
          data: {
            status: 'approved',
            approval2Status: 'approved',
            approval2Date: new Date(),
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
          action: 'update',
          module: 'overtime-request',
          entity: 'OvertimeRequest',
          entityId: id,
          description: `Approved overtime request (Level 2) for ${updated.employee.employeeName}`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });

        await this.notifications.markRelatedAsRead(ctx.userId, {
          entityType: 'OvertimeRequest',
          entityId: id,
        });

        const requesterUserId =
          existing.createdById || (existing as any).employee?.userId || null;
        if (requesterUserId) {
          await this.notifications.create({
            userId: requesterUserId,
            title: 'Overtime request approved',
            message: 'Overtime request approved at Level 2',
            category: 'overtime',
            priority: 'normal',
            actionType: 'overtime-request.view',
            actionPayload: { requestId: id },
            entityType: 'OvertimeRequest',
            entityId: id,
            channels: ['inApp'],
          });
        }

        return { status: true, data: updated };
      }

      return { status: false, message: 'Invalid approval level' };
    } catch (error: any) {
      console.error('Error approving overtime request:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to approve overtime request',
      };
    }
  }

  async reject(
    id: string,
    remarks: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    return this.rejectLevel(id, undefined, remarks, ctx);
  }

  async rejectLevel(
    id: string,
    level: 1 | 2 | undefined,
    remarks: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!ctx.userId) return { status: false, message: 'Unauthorized' };

      const existing = await this.prisma.overtimeRequest.findUnique({
        where: { id },
        include: {
          employee: { select: { id: true, employeeName: true, userId: true } },
        },
      });
      if (!existing)
        return { status: false, message: 'Overtime request not found' };
      if (existing.status === 'approved')
        return { status: false, message: 'Overtime request already approved' };
      if (existing.status === 'rejected')
        return { status: false, message: 'Overtime request already rejected' };

      const effectiveLevel = level || this.getPendingApprovalLevel(existing);
      if (!effectiveLevel)
        return { status: false, message: 'No pending approval found' };

      if (effectiveLevel === 1) {
        if (!existing.approval1)
          return {
            status: false,
            message: 'No approver configured for level 1',
          };
        if (existing.approval1 !== ctx.userId)
          return { status: false, message: 'Forbidden' };

        const updated = await this.prisma.overtimeRequest.update({
          where: { id },
          data: {
            status: 'rejected',
            approval1Status: 'rejected',
            approval1Date: new Date(),
            remarks,
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
          action: 'update',
          module: 'overtime-request',
          entity: 'OvertimeRequest',
          entityId: id,
          description: `Rejected overtime request (Level 1) for ${updated.employee.employeeName}`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });

        await this.notifications.markRelatedAsRead(ctx.userId, {
          entityType: 'OvertimeRequest',
          entityId: id,
        });

        const requesterUserId =
          existing.createdById || (existing as any).employee?.userId || null;
        if (requesterUserId) {
          await this.notifications.create({
            userId: requesterUserId,
            title: 'Overtime request rejected',
            message: remarks || 'Rejected at Level 1',
            category: 'overtime',
            priority: 'normal',
            actionType: 'overtime-request.view',
            actionPayload: { requestId: id },
            entityType: 'OvertimeRequest',
            entityId: id,
            channels: ['inApp'],
          });
        }

        return { status: true, data: updated };
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
        if (!existing.approval2)
          return {
            status: false,
            message: 'No approver configured for level 2',
          };
        if (existing.approval2 !== ctx.userId)
          return { status: false, message: 'Forbidden' };

        const updated = await this.prisma.overtimeRequest.update({
          where: { id },
          data: {
            status: 'rejected',
            approval2Status: 'rejected',
            approval2Date: new Date(),
            remarks,
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
          action: 'update',
          module: 'overtime-request',
          entity: 'OvertimeRequest',
          entityId: id,
          description: `Rejected overtime request (Level 2) for ${updated.employee.employeeName}`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });

        await this.notifications.markRelatedAsRead(ctx.userId, {
          entityType: 'OvertimeRequest',
          entityId: id,
        });

        const requesterUserId =
          existing.createdById || (existing as any).employee?.userId || null;
        if (requesterUserId) {
          await this.notifications.create({
            userId: requesterUserId,
            title: 'Overtime request rejected',
            message: remarks || 'Rejected at Level 2',
            category: 'overtime',
            priority: 'normal',
            actionType: 'overtime-request.view',
            actionPayload: { requestId: id },
            entityType: 'OvertimeRequest',
            entityId: id,
            channels: ['inApp'],
          });
        }

        return { status: true, data: updated };
      }

      return { status: false, message: 'Invalid rejection level' };
    } catch (error: any) {
      console.error('Error rejecting overtime request:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to reject overtime request',
      };
    }
  }

  async update(
    id: string,
    body: UpdateOvertimeRequestDto,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.overtimeRequest.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Overtime request not found' };
      }

      // Validate employee if employeeId is being updated
      if (body.employeeId && body.employeeId !== existing.employeeId) {
        const employee = await this.prisma.employee.findUnique({
          where: { id: body.employeeId },
          select: { id: true },
        });

        if (!employee) {
          return { status: false, message: 'Employee not found' };
        }
      }

      const updateData: any = {};
      if (body.employeeId) updateData.employeeId = body.employeeId;
      if (body.overtimeType) updateData.overtimeType = body.overtimeType;
      if (body.title) updateData.title = body.title;
      if (body.description !== undefined)
        updateData.description = body.description;
      if (body.date) updateData.date = new Date(body.date);
      if (body.weekdayOvertimeHours !== undefined)
        updateData.weekdayOvertimeHours = body.weekdayOvertimeHours;
      if (body.holidayOvertimeHours !== undefined)
        updateData.holidayOvertimeHours = body.holidayOvertimeHours;
      if (body.status) updateData.status = body.status;
      updateData.updatedById = ctx.userId;

      const updated = await this.prisma.overtimeRequest.update({
        where: { id },
        data: updateData,
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

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'overtime-request',
          entity: 'OvertimeRequest',
          entityId: id,
          description: 'Updated overtime request',
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      // Transform data to match frontend expectations
      const transformedData = {
        id: updated.id,
        employeeId: updated.employeeId,
        employeeName: updated.employee.employeeName,
        employeeCode: updated.employee.employeeId,
        overtimeType: updated.overtimeType,
        title: updated.title,
        description: updated.description,
        date: updated.date.toISOString(),
        weekdayOvertimeHours: Number(updated.weekdayOvertimeHours),
        holidayOvertimeHours: Number(updated.holidayOvertimeHours),
        status: updated.status,
        approval1: updated.approval1,
        approval1Status: (updated as any).approval1Status || null,
        approval1Date: (updated as any).approval1Date
          ? (updated as any).approval1Date.toISOString()
          : null,
        approval2: updated.approval2,
        approval2Status: (updated as any).approval2Status || null,
        approval2Date: (updated as any).approval2Date
          ? (updated as any).approval2Date.toISOString()
          : null,
        remarks: (updated as any).remarks || null,
        createdById: updated.createdById,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };

      return {
        status: true,
        data: transformedData,
        message: 'Overtime request updated successfully',
      };
    } catch (error) {
      console.error('Error updating overtime request:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to update overtime request',
      };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.overtimeRequest.findUnique({
        where: { id },
      });

      if (!existing) {
        return { status: false, message: 'Overtime request not found' };
      }

      await this.prisma.overtimeRequest.delete({
        where: { id },
      });

      // Log activity
      if (ctx.userId) {
        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'overtime-request',
          entity: 'OvertimeRequest',
          entityId: id,
          description: 'Deleted overtime request',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });
      }

      return { status: true, message: 'Overtime request deleted successfully' };
    } catch (error) {
      console.error('Error deleting overtime request:', error);
      return {
        status: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to delete overtime request',
      };
    }
  }
}
