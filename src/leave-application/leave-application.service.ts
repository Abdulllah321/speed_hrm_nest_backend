import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class LeaveApplicationService {
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

  private getPendingApprovalLevel(app: any): 1 | 2 | null {
    if (app.status === 'approved' || app.status === 'rejected') return null;

    if (!app.approval1Status || app.approval1Status !== 'approved') return 1;

    if (app.approval2 && app.approval2Status !== 'approved') return 2;

    return null;
  }

  async getLeaveBalance(employeeId: string) {
    try {
      // Get employee with leave policy
      const employee = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        include: {
          leavesPolicy: {
            include: {
              leaveTypes: {
                include: {
                  leaveType: true,
                },
              },
            },
          },
        },
      });

      if (!employee) {
        return { status: false, message: 'Employee not found' };
      }

      if (!employee.leavesPolicy) {
        return {
          status: false,
          message: 'Employee does not have a leave policy assigned',
        };
      }

      // Get all approved leave applications for this employee
      const leaveApplications = await (
        this.prisma as any
      ).leaveApplication.findMany({
        where: {
          employeeId,
          status: 'approved',
        },
        include: {
          leaveType: true,
        },
      });

      // Calculate used leaves by leave type
      const usedLeavesMap = new Map<string, number>();

      leaveApplications.forEach((app) => {
        const leaveTypeId = app.leaveTypeId;
        const currentUsed = usedLeavesMap.get(leaveTypeId) || 0;

        // Calculate days between fromDate and toDate
        const fromDate = new Date(app.fromDate);
        const toDate = new Date(app.toDate);
        const diffTime = Math.abs(toDate.getTime() - fromDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both dates

        // Adjust based on day type
        let daysToDeduct = diffDays;
        if (app.dayType === 'halfDay') {
          daysToDeduct = diffDays * 0.5;
        } else if (app.dayType === 'shortLeave') {
          daysToDeduct = diffDays * 0.25; // Assuming short leave is 0.25 day
        }

        usedLeavesMap.set(leaveTypeId, currentUsed + daysToDeduct);
      });

      // Build leave balance array
      const leaveBalances = employee.leavesPolicy.leaveTypes.map(
        (policyLeaveType) => {
          const totalLeaves = policyLeaveType.numberOfLeaves;
          const usedLeaves =
            usedLeavesMap.get(policyLeaveType.leaveTypeId) || 0;
          const remainingLeaves = Math.max(0, totalLeaves - usedLeaves);

          return {
            id: policyLeaveType.leaveTypeId, // Add id for DataTable compatibility
            leaveTypeId: policyLeaveType.leaveTypeId,
            leaveTypeName: policyLeaveType.leaveType.name,
            totalLeaves,
            usedLeaves: Math.round(usedLeaves * 100) / 100, // Round to 2 decimal places
            remainingLeaves: Math.round(remainingLeaves * 100) / 100,
          };
        },
      );

      const totalTaken = leaveBalances.reduce(
        (sum, bal) => sum + bal.usedLeaves,
        0,
      );
      const totalRemaining = leaveBalances.reduce(
        (sum, bal) => sum + bal.remainingLeaves,
        0,
      );

      return {
        status: true,
        data: {
          employeeId: employee.id,
          employeeName: employee.employeeName,
          leavePolicyId: employee.leavesPolicyId,
          leavePolicyName: employee.leavesPolicy.name,
          leaveBalances,
          totalTaken: Math.round(totalTaken * 100) / 100,
          totalRemaining: Math.round(totalRemaining * 100) / 100,
        },
      };
    } catch (error: any) {
      console.error('Error fetching leave balance:', error);
      return {
        status: false,
        message: error?.message || 'Failed to fetch leave balance',
      };
    }
  }

  async create(
    body: {
      employeeId: string;
      leaveTypeId: string;
      dayType: 'fullDay' | 'halfDay' | 'shortLeave';
      fromDate: string;
      toDate: string;
      reasonForLeave: string;
      addressWhileOnLeave: string;
    },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      // Validate employee exists
      const employee = await this.prisma.employee.findUnique({
        where: { id: body.employeeId },
        include: {
          leavesPolicy: {
            include: {
              leaveTypes: true,
            },
          },
        },
      });

      if (!employee) {
        return { status: false, message: 'Employee not found' };
      }

      if (!employee.leavesPolicy) {
        return {
          status: false,
          message: 'Employee does not have a leave policy assigned',
        };
      }

      // Check if leave type exists in policy
      const policyLeaveType = employee.leavesPolicy.leaveTypes.find(
        (lt) => lt.leaveTypeId === body.leaveTypeId,
      );

      if (!policyLeaveType) {
        return {
          status: false,
          message: 'Leave type not found in employee leave policy',
        };
      }

      // Check leave balance
      const balanceResult = await this.getLeaveBalance(body.employeeId);
      if (!balanceResult.status || !balanceResult.data) {
        return balanceResult;
      }

      const leaveBalance = balanceResult.data.leaveBalances.find(
        (bal: any) => bal.leaveTypeId === body.leaveTypeId,
      );

      if (!leaveBalance || leaveBalance.remainingLeaves <= 0) {
        return { status: false, message: 'Insufficient leave balance' };
      }

      // Calculate days requested
      const fromDate = new Date(body.fromDate);
      const toDate = new Date(body.toDate);
      const diffTime = Math.abs(toDate.getTime() - fromDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

      // Check if attendance already exists for any day in the requested range
      const checkFromDate = new Date(fromDate);
      checkFromDate.setHours(0, 0, 0, 0);
      const checkToDate = new Date(toDate);
      checkToDate.setHours(23, 59, 59, 999);

      const existingAttendance = await this.prisma.attendance.findFirst({
        where: {
          employeeId: body.employeeId,
          date: {
            gte: checkFromDate,
            lte: checkToDate,
          },
        },
      });

      if (existingAttendance) {
        return {
          status: false,
          message:
            'Attendance result already marked for one or more days in this range. Cannot apply for leave.',
        };
      }

      let daysToDeduct = diffDays;
      if (body.dayType === 'halfDay') {
        daysToDeduct = diffDays * 0.5;
      } else if (body.dayType === 'shortLeave') {
        daysToDeduct = diffDays * 0.25;
      }

      if (daysToDeduct > leaveBalance.remainingLeaves) {
        return {
          status: false,
          message: 'Requested days exceed remaining leave balance',
        };
      }

      // Create leave application
      const forwarding =
        await this.prisma.requestForwardingConfiguration.findUnique({
          where: { requestType: 'leave-application' },
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

      const created = await (this.prisma as any).leaveApplication.create({
        data: {
          employeeId: body.employeeId,
          leaveTypeId: body.leaveTypeId,
          dayType: body.dayType,
          fromDate: new Date(body.fromDate) as any,
          toDate: new Date(body.toDate) as any,
          reasonForLeave: body.reasonForLeave,
          addressWhileOnLeave: body.addressWhileOnLeave,
          status,
          approval1,
          approval1Status,
          approval1Date: approval1Date as any,
          approval2,
          approval2Status,
          approval2Date: approval2Date as any,
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
          leaveType: true,
        },
      });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'leave-applications',
        entity: 'LeaveApplication',
        entityId: created.id,
        description: `Created leave application for ${created.employee.employeeName}`,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      const requesterUserId =
        ctx.userId ||
        (
          await this.prisma.employee.findUnique({
            where: { id: created.employeeId },
            select: { userId: true },
          })
        )?.userId ||
        null;

      const dateRange = `${new Date(body.fromDate).toLocaleDateString()} - ${new Date(body.toDate).toLocaleDateString()}`;
      if (created.status === 'pending' && created.approval1) {
        await this.notifications.create({
          userId: created.approval1,
          title: 'Leave application awaiting approval',
          message: `${created.employee.employeeName} requested ${dateRange}`,
          category: 'leave-application',
          priority: 'high',
          actionType: 'leave-application.pending-approval',
          actionPayload: { applicationId: created.id, level: 1 },
          entityType: 'LeaveApplication',
          entityId: created.id,
          channels: ['inApp', 'email', 'sms'],
        });
      }

      if (requesterUserId) {
        await this.notifications.create({
          userId: requesterUserId,
          title:
            created.status === 'approved'
              ? 'Leave application approved'
              : 'Leave application submitted',
          message: `${created.leaveType.name} (${created.dayType}) ${dateRange}`,
          category: 'leave-application',
          priority: created.status === 'approved' ? 'normal' : 'low',
          actionType: 'leave-application.view',
          actionPayload: { applicationId: created.id },
          entityType: 'LeaveApplication',
          entityId: created.id,
          channels: ['inApp'],
        });
      }

      return { status: true, data: created };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'leave-applications',
        entity: 'LeaveApplication',
        description: 'Failed to create leave application',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return {
        status: false,
        message: error?.message || 'Failed to create leave application',
      };
    }
  }

  async list(filters?: {
    departmentId?: string;
    subDepartmentId?: string;
    employeeId?: string;
    status?: string;
    fromDate?: string;
    toDate?: string;
  }) {
    try {
      const where: any = {};

      if (filters?.employeeId) {
        where.employeeId = filters.employeeId;
      }

      if (filters?.status && filters.status !== 'all') {
        where.status = filters.status;
      }

      if (filters?.fromDate) {
        where.fromDate = { gte: new Date(filters.fromDate) };
      }
      if (filters?.toDate) {
        where.toDate = { lte: new Date(filters.toDate) };
      }

      const leaveApplications = await (
        this.prisma as any
      ).leaveApplication.findMany({
        where,
        include: {
          employee: {
            include: {
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
          leaveType: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Filter by department/sub-department if needed
      let filtered = leaveApplications;

      if (filters?.departmentId) {
        filtered = filtered.filter(
          (app) =>
            app.employee.departmentId === filters.departmentId ||
            app.employee.department?.id === filters.departmentId,
        );
      }

      if (filters?.subDepartmentId) {
        filtered = filtered.filter(
          (app) =>
            app.employee.subDepartmentId === filters.subDepartmentId ||
            app.employee.subDepartment?.id === filters.subDepartmentId,
        );
      }

      // Map to response format
      const mapped = filtered.map((app) => ({
        id: app.id,
        employeeId: app.employeeId,
        employeeName: app.employee.employeeName,
        employeeCode: app.employee.employeeId,
        department: app.employee.department?.name || null,
        subDepartment: app.employee.subDepartment?.name || null,
        leaveType: app.leaveTypeId,
        leaveTypeName: app.leaveType.name,
        dayType: app.dayType,
        fromDate: app.fromDate.toISOString(),
        toDate: app.toDate.toISOString(),
        approval1: app.approval1 || null,
        approval1Status: app.approval1Status || null,
        approval1Date: app.approval1Date
          ? app.approval1Date.toISOString()
          : null,
        approval2: app.approval2 || null,
        approval2Status: app.approval2Status || null,
        approval2Date: app.approval2Date
          ? app.approval2Date.toISOString()
          : null,
        remarks: app.remarks || null,
        status: app.status,
        createdAt: app.createdAt.toISOString(),
        updatedAt: app.updatedAt.toISOString(),
      }));

      return { status: true, data: mapped };
    } catch (error: any) {
      console.error('Error fetching leave applications:', error);
      return {
        status: false,
        message: error?.message || 'Failed to fetch leave applications',
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
      if (!ctx.userId) {
        return { status: false, message: 'Unauthorized' };
      }

      const existing = await (this.prisma as any).leaveApplication.findUnique({
        where: { id },
        include: {
          employee: {
            select: {
              id: true,
              employeeName: true,
            },
          },
          leaveType: true,
        },
      });

      if (!existing) {
        return { status: false, message: 'Leave application not found' };
      }

      if (existing.status === 'approved') {
        return { status: false, message: 'Leave application already approved' };
      }

      if (existing.status === 'rejected') {
        return { status: false, message: 'Leave application already rejected' };
      }

      const effectiveLevel = level || this.getPendingApprovalLevel(existing);
      if (!effectiveLevel) {
        return { status: false, message: 'No pending approval found' };
      }

      // Check for Admin Override (Allow 'admin' role or 'leave-application.update' permission to bypass approver check)
      let canOverride = false;
      const user = await this.prisma.user.findUnique({
        where: { id: ctx.userId },
        include: { role: { include: { permissions: { include: { permission: true } } } } }
      });

      if (user?.role?.name === 'admin') {
        canOverride = true;
      } else if (user?.role?.permissions.some(p => p.permission.name === 'leave-application.update')) {
        // canOverride = true; // Uncomment if we want to allow anyone with update permission to override
        // For now, let's stick to Admin or explicit approver
      }

      if (effectiveLevel === 1) {
        if (!existing.approval1) {
          return {
            status: false,
            message: 'No approver configured for level 1',
          };
        }
        
        // Strict check: Must be the assigned approver OR be an Admin overriding it
        if (existing.approval1 !== ctx.userId && !canOverride) {
          return { status: false, message: 'Forbidden: You are not the assigned approver' };
        }

        const nextStatus = existing.approval2 ? 'pending' : 'approved';

        const updated = await (this.prisma as any).leaveApplication.update({
          where: { id },
          data: {
            status: nextStatus,
            approval1Status: 'approved',
            approval1Date: new Date() as any,
            updatedById: ctx.userId,
          },
          include: {
            employee: {
              select: {
                id: true,
                employeeName: true,
              },
            },
            leaveType: true,
          },
        });

        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'leave-applications',
          entity: 'LeaveApplication',
          entityId: id,
          description: `Approved leave application (Level 1) for ${updated.employee.employeeName}`,
          oldValues: JSON.stringify({
            status: existing.status,
            approval1Status: existing.approval1Status,
          }),
          newValues: JSON.stringify({
            status: nextStatus,
            approval1Status: 'approved',
          }),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });

        await this.notifications.markRelatedAsRead(ctx.userId, {
          entityType: 'LeaveApplication',
          entityId: id,
        });

        const requesterUserId =
          existing.createdById ||
          (
            await this.prisma.employee.findUnique({
              where: { id: existing.employeeId },
              select: { userId: true },
            })
          )?.userId ||
          null;

        if (existing.approval2 && nextStatus === 'pending') {
          await this.notifications.create({
            userId: existing.approval2,
            title: 'Leave application awaiting approval',
            message: `${updated.employee.employeeName} is awaiting Level 2 approval`,
            category: 'leave-application',
            priority: 'high',
            actionType: 'leave-application.pending-approval',
            actionPayload: { applicationId: id, level: 2 },
            entityType: 'LeaveApplication',
            entityId: id,
            channels: ['inApp', 'email', 'sms'],
          });
        }

        if (requesterUserId) {
          await this.notifications.create({
            userId: requesterUserId,
            title:
              nextStatus === 'approved'
                ? 'Leave application approved'
                : 'Leave application partially approved',
            message:
              nextStatus === 'approved'
                ? `${updated.leaveType.name} approved`
                : `${updated.leaveType.name} approved at Level 1`,
            category: 'leave-application',
            priority: nextStatus === 'approved' ? 'normal' : 'low',
            actionType: 'leave-application.view',
            actionPayload: { applicationId: id },
            entityType: 'LeaveApplication',
            entityId: id,
            channels: ['inApp'],
          });
        }

        return { status: true, data: updated };
      }

      if (effectiveLevel === 2) {
        if (existing.approval1Status !== 'approved') {
          return {
            status: false,
            message: 'Approval level 1 must be approved first',
          };
        }
        if (!existing.approval2) {
          return {
            status: false,
            message: 'No approver configured for level 2',
          };
        }
        if (existing.approval2 !== ctx.userId && !canOverride) {
          return { status: false, message: 'Forbidden: You are not the assigned approver' };
        }

        const updated = await (this.prisma as any).leaveApplication.update({
          where: { id },
          data: {
            status: 'approved',
            approval2Status: 'approved',
            approval2Date: new Date() as any,
            updatedById: ctx.userId,
          },
          include: {
            employee: {
              select: {
                id: true,
                employeeName: true,
              },
            },
            leaveType: true,
          },
        });

        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'leave-applications',
          entity: 'LeaveApplication',
          entityId: id,
          description: `Approved leave application (Level 2) for ${updated.employee.employeeName}`,
          oldValues: JSON.stringify({
            status: existing.status,
            approval2Status: existing.approval2Status,
          }),
          newValues: JSON.stringify({
            status: 'approved',
            approval2Status: 'approved',
          }),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });

        await this.notifications.markRelatedAsRead(ctx.userId, {
          entityType: 'LeaveApplication',
          entityId: id,
        });

        const requesterUserId =
          existing.createdById ||
          (
            await this.prisma.employee.findUnique({
              where: { id: existing.employeeId },
              select: { userId: true },
            })
          )?.userId ||
          null;

        if (requesterUserId) {
          await this.notifications.create({
            userId: requesterUserId,
            title: 'Leave application approved',
            message: `${updated.leaveType.name} approved at Level 2`,
            category: 'leave-application',
            priority: 'normal',
            actionType: 'leave-application.view',
            actionPayload: { applicationId: id },
            entityType: 'LeaveApplication',
            entityId: id,
            channels: ['inApp'],
          });
        }

        return { status: true, data: updated };
      }

      return { status: false, message: 'Invalid approval level' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'leave-applications',
        entity: 'LeaveApplication',
        entityId: id,
        description: 'Failed to approve leave application',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return {
        status: false,
        message: error?.message || 'Failed to approve leave application',
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
      if (!ctx.userId) {
        return { status: false, message: 'Unauthorized' };
      }

      const existing = await (this.prisma as any).leaveApplication.findUnique({
        where: { id },
        include: {
          employee: {
            select: {
              id: true,
              employeeName: true,
            },
          },
          leaveType: true,
        },
      });

      if (!existing) {
        return { status: false, message: 'Leave application not found' };
      }

      if (existing.status === 'approved') {
        return { status: false, message: 'Leave application already approved' };
      }

      if (existing.status === 'rejected') {
        return { status: false, message: 'Leave application already rejected' };
      }

      const effectiveLevel = level || this.getPendingApprovalLevel(existing);
      if (!effectiveLevel) {
        return { status: false, message: 'No pending approval found' };
      }

      // Check for Admin Override
      let canOverride = false;
      const user = await this.prisma.user.findUnique({
        where: { id: ctx.userId },
        include: { role: { include: { permissions: { include: { permission: true } } } } }
      });

      if (user?.role?.name === 'admin') {
        canOverride = true;
      }

      if (effectiveLevel === 1) {
        if (!existing.approval1) {
          return {
            status: false,
            message: 'No approver configured for level 1',
          };
        }
        if (existing.approval1 !== ctx.userId && !canOverride) {
          return { status: false, message: 'Forbidden' };
        }

        const updated = await (this.prisma as any).leaveApplication.update({
          where: { id },
          data: {
            status: 'rejected',
            approval1Status: 'rejected',
            approval1Date: new Date() as any,
            remarks: remarks || existing.remarks,
            updatedById: ctx.userId,
          },
          include: {
            employee: {
              select: {
                id: true,
                employeeName: true,
              },
            },
            leaveType: true,
          },
        });

        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'leave-applications',
          entity: 'LeaveApplication',
          entityId: id,
          description: `Rejected leave application (Level 1) for ${updated.employee.employeeName}`,
          oldValues: JSON.stringify({
            status: existing.status,
            approval1Status: existing.approval1Status,
            remarks: existing.remarks,
          }),
          newValues: JSON.stringify({
            status: 'rejected',
            approval1Status: 'rejected',
            remarks,
          }),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });

        await this.notifications.markRelatedAsRead(ctx.userId, {
          entityType: 'LeaveApplication',
          entityId: id,
        });

        const requesterUserId =
          existing.createdById ||
          (
            await this.prisma.employee.findUnique({
              where: { id: existing.employeeId },
              select: { userId: true },
            })
          )?.userId ||
          null;

        if (requesterUserId) {
          await this.notifications.create({
            userId: requesterUserId,
            title: 'Leave application rejected',
            message: `${updated.leaveType.name} rejected at Level 1${remarks ? `: ${remarks}` : ''}`,
            category: 'leave-application',
            priority: 'normal',
            actionType: 'leave-application.view',
            actionPayload: { applicationId: id },
            entityType: 'LeaveApplication',
            entityId: id,
            channels: ['inApp'],
          });
        }

        return { status: true, data: updated };
      }

      if (effectiveLevel === 2) {
        if (existing.approval1Status !== 'approved') {
          return {
            status: false,
            message: 'Approval level 1 must be approved first',
          };
        }
        if (!existing.approval2) {
          return {
            status: false,
            message: 'No approver configured for level 2',
          };
        }
        if (existing.approval2 !== ctx.userId && !canOverride) {
          return { status: false, message: 'Forbidden' };
        }

        const updated = await (this.prisma as any).leaveApplication.update({
          where: { id },
          data: {
            status: 'rejected',
            approval2Status: 'rejected',
            approval2Date: new Date() as any,
            remarks: remarks || existing.remarks,
            updatedById: ctx.userId,
          },
          include: {
            employee: {
              select: {
                id: true,
                employeeName: true,
              },
            },
            leaveType: true,
          },
        });

        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'leave-applications',
          entity: 'LeaveApplication',
          entityId: id,
          description: `Rejected leave application (Level 2) for ${updated.employee.employeeName}`,
          oldValues: JSON.stringify({
            status: existing.status,
            approval2Status: existing.approval2Status,
            remarks: existing.remarks,
          }),
          newValues: JSON.stringify({
            status: 'rejected',
            approval2Status: 'rejected',
            remarks,
          }),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });

        await this.notifications.markRelatedAsRead(ctx.userId, {
          entityType: 'LeaveApplication',
          entityId: id,
        });

        const requesterUserId =
          existing.createdById ||
          (
            await this.prisma.employee.findUnique({
              where: { id: existing.employeeId },
              select: { userId: true },
            })
          )?.userId ||
          null;

        if (requesterUserId) {
          await this.notifications.create({
            userId: requesterUserId,
            title: 'Leave application rejected',
            message: `${updated.leaveType.name} rejected at Level 2${remarks ? `: ${remarks}` : ''}`,
            category: 'leave-application',
            priority: 'normal',
            actionType: 'leave-application.view',
            actionPayload: { applicationId: id },
            entityType: 'LeaveApplication',
            entityId: id,
            channels: ['inApp'],
          });
        }

        return { status: true, data: updated };
      }

      return { status: false, message: 'Invalid approval level' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'leave-applications',
        entity: 'LeaveApplication',
        entityId: id,
        description: 'Failed to reject leave application',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return {
        status: false,
        message: error?.message || 'Failed to reject leave application',
      };
    }
  }
}
