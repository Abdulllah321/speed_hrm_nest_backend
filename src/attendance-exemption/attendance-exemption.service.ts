import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { PrismaMasterService } from '../database/prisma-master.service';

@Injectable()
export class AttendanceExemptionService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
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

  async list() {
    try {
      const exemptions = await this.prisma.attendanceExemption.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          employee: {
            select: {
              departmentId: true,
              subDepartmentId: true,
              designationId: true,
              employeeId: true,
            },
          },
        },
      });

      if (exemptions.length === 0) {
        return { status: true, data: [] };
      }

      // Collect IDs for Master Data fetching
      const deptIds = new Set<string>();
      const subDeptIds = new Set<string>();
      const desgIds = new Set<string>();

      exemptions.forEach((ex) => {
        if (ex.department) deptIds.add(ex.department);
        if (ex.subDepartment) subDeptIds.add(ex.subDepartment);
        if (ex.employee?.designationId) desgIds.add(ex.employee.designationId);
      });

      const [departments, subDepartments, designations] = await Promise.all([
        this.prisma.department.findMany({
          where: { id: { in: Array.from(deptIds) } },
          select: { id: true, name: true },
        }),
        this.prisma.subDepartment.findMany({
          where: { id: { in: Array.from(subDeptIds) } },
          select: { id: true, name: true },
        }),
        this.prisma.designation.findMany({
          where: { id: { in: Array.from(desgIds) } },
          select: { id: true, name: true },
        }),
      ]);

      const deptMap = new Map(departments.map((d) => [d.id, d.name]));
      const subDeptMap = new Map(subDepartments.map((sd) => [sd.id, sd.name]));
      const desgMap = new Map(designations.map((d) => [d.id, d.name]));

      const mappedExemptions = exemptions.map((exemption) => {
        return {
          ...exemption,
          department: exemption.department
            ? deptMap.get(exemption.department) || exemption.department
            : exemption.department,
          subDepartment: exemption.subDepartment
            ? subDeptMap.get(exemption.subDepartment) || exemption.subDepartment
            : exemption.subDepartment,
          designation: exemption.employee?.designationId
            ? desgMap.get(exemption.employee.designationId) || null
            : null,
          employeeId: exemption.employee?.employeeId || exemption.employeeId,
        };
      });

      return { status: true, data: mappedExemptions };
    } catch (error: any) {
      console.error('Error listing exemptions:', error);
      return { status: false, message: 'Failed to list exemptions', data: [] };
    }
  }

  async get(id: string) {
    try {
      const exemption = await this.prisma.attendanceExemption.findUnique({
        where: { id },
        include: {
          employee: {
            select: {
              departmentId: true,
              subDepartmentId: true,
              designationId: true,
              employeeId: true,
            },
          },
        },
      });

      if (!exemption) {
        return { status: false, message: 'Attendance exemption not found' };
      }

      const [department, subDepartment, designation] = await Promise.all([
        exemption.department
          ? this.prisma.department.findUnique({
            where: { id: exemption.department },
            select: { name: true },
          })
          : null,
        exemption.subDepartment
          ? this.prisma.subDepartment.findUnique({
            where: { id: exemption.subDepartment },
            select: { name: true },
          })
          : null,
        exemption.employee?.designationId
          ? this.prisma.designation.findUnique({
            where: { id: exemption.employee.designationId },
            select: { name: true },
          })
          : null,
      ]);

      return {
        status: true,
        data: {
          ...exemption,
          department: department?.name || exemption.department,
          subDepartment: subDepartment?.name || exemption.subDepartment,
          designation: designation?.name || null,
          employeeId: exemption.employee?.employeeId || exemption.employeeId,
        },
      };
    } catch (error: any) {
      console.error('Error getting exemption:', error);
      return { status: false, message: 'Failed to get exemption' };
    }
  }

  async create(
    body: any,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!body.employeeId) {
        return {
          status: false,
          message: 'Employee is required to create attendance exemption',
        };
      }

      const employee = await this.prisma.employee.findUnique({
        where: { id: body.employeeId },
        select: {
          id: true,
          departmentId: true,
          subDepartmentId: true,
          reportingManager: true,
          employeeId: true,
        },
      });

      if (!employee) {
        return { status: false, message: 'Employee not found' };
      }

      const forwarding =
        await this.prisma.requestForwardingConfiguration.findUnique({
          where: { requestType: 'exemption' },
          include: { approvalLevels: { orderBy: { level: 'asc' } } },
        });
      const activeForwarding =
        forwarding && forwarding.status === 'active' ? forwarding : null;

      const now = new Date();
      let approvalStatus: string = 'pending';
      let approval1: string | null = null;
      let approval1Status: string | null = null;
      let approval1Date: Date | null = null;
      let approval2: string | null = null;
      let approval2Status: string | null = null;
      const approval2Date: Date | null = null;

      if (activeForwarding?.approvalFlow === 'auto-approved') {
        approvalStatus = 'approved';
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

      const created = await this.prisma.attendanceExemption.create({
        data: {
          employeeId: body.employeeId || null,
          employeeName: body.employeeName || null,
          department: body.department || null,
          subDepartment: body.subDepartment || null,
          attendanceDate: new Date(body.attendanceDate),
          flagType: body.flagType,
          exemptionType: body.exemptionType,
          reason: body.reason,
          approval1,
          approval1Status,
          approval1Date,
          approval2,
          approval2Status,
          approval2Date,
          approvalStatus,
          createdById: ctx.userId || null,
        },
      });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'attendance-exemption',
        entity: 'AttendanceExemption',
        entityId: created.id,
        description: `Created attendance exemption for ${body.employeeName || 'Unknown'}`,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return { status: true, data: created };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'attendance-exemption',
        entity: 'AttendanceExemption',
        description: 'Failed to create attendance exemption',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });

      return {
        status: false,
        message: error?.message || 'Failed to create attendance exemption',
      };
    }
  }

  async update(
    id: string,
    body: any,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (body.approvalStatus || body.rejectionReason) {
      return this.updateApproval(id, body, ctx);
    }

    try {
      const existing = await this.prisma.attendanceExemption.findUnique({
        where: { id },
      });
      if (!existing) {
        return { status: false, message: 'Attendance exemption not found' };
      }

      const updated = await this.prisma.attendanceExemption.update({
        where: { id },
        data: {
          approvalStatus: body.approvalStatus || existing.approvalStatus,
          updatedById: ctx.userId || null,
        },
      });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'attendance-exemption',
        entity: 'AttendanceExemption',
        entityId: id,
        description: `Updated attendance exemption status to ${body.approvalStatus}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return { status: true, data: updated };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'attendance-exemption',
        entity: 'AttendanceExemption',
        entityId: id,
        description: 'Failed to update attendance exemption',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });

      return {
        status: false,
        message: error?.message || 'Failed to update attendance exemption',
      };
    }
  }

  async updateApproval(
    id: string,
    body: any,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!ctx.userId) {
        return { status: false, message: 'Unauthorized' };
      }

      const existing = await this.prisma.attendanceExemption.findUnique({
        where: { id },
      });
      if (!existing) {
        return { status: false, message: 'Attendance exemption not found' };
      }

      if (existing.approvalStatus === 'approved') {
        return {
          status: false,
          message: 'Attendance exemption already approved',
        };
      }

      if (existing.approvalStatus === 'rejected') {
        return {
          status: false,
          message: 'Attendance exemption already rejected',
        };
      }

      const status = body.approvalStatus;
      if (status !== 'approved' && status !== 'rejected') {
        return { status: false, message: 'Invalid approval status' };
      }

      const levelFromBody =
        body.level !== undefined && body.level !== null
          ? Number(body.level)
          : undefined;
      const explicitLevel =
        levelFromBody === 1 || levelFromBody === 2
          ? (levelFromBody as 1 | 2)
          : undefined;

      const effectiveLevel =
        explicitLevel || this.getPendingApprovalLevel(existing);
      if (!effectiveLevel) {
        return { status: false, message: 'No pending approval found' };
      }

      const rejectionReason =
        typeof body.rejectionReason === 'string' ? body.rejectionReason : null;

      if (status === 'approved') {
        if (effectiveLevel === 1) {
          if (!existing.approval1) {
            return {
              status: false,
              message: 'No approver configured for level 1',
            };
          }
          if (existing.approval1 !== ctx.userId) {
            return { status: false, message: 'Forbidden' };
          }

          const nextApprovalStatus = existing.approval2
            ? 'pending'
            : 'approved';

          const updated = await this.prisma.attendanceExemption.update({
            where: { id },
            data: {
              approval1Status: 'approved',
              approval1Date: new Date(),
              approvalStatus: nextApprovalStatus,
              approvedBy: nextApprovalStatus === 'approved' ? ctx.userId : null,
              approvedAt: nextApprovalStatus === 'approved' ? new Date() : null,
            },
          });

          await this.activityLogs.log({
            userId: ctx.userId,
            action: 'approve',
            module: 'attendance-exemption',
            entity: 'AttendanceExemption',
            entityId: id,
            description: 'Approved attendance exemption (Level 1)',
            oldValues: JSON.stringify(existing),
            newValues: JSON.stringify(updated),
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            status: 'success',
          });

          return { status: true, data: updated };
        }

        if (effectiveLevel === 2) {
          if (
            existing.approval1Status !== 'approved' &&
            existing.approval1Status !== 'auto-approved'
          ) {
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
          if (existing.approval2 !== ctx.userId) {
            return { status: false, message: 'Forbidden' };
          }

          const updated = await this.prisma.attendanceExemption.update({
            where: { id },
            data: {
              approval2Status: 'approved',
              approval2Date: new Date(),
              approvalStatus: 'approved',
              approvedBy: ctx.userId,
              approvedAt: new Date(),
            },
          });

          await this.activityLogs.log({
            userId: ctx.userId,
            action: 'approve',
            module: 'attendance-exemption',
            entity: 'AttendanceExemption',
            entityId: id,
            description: 'Approved attendance exemption (Level 2)',
            oldValues: JSON.stringify(existing),
            newValues: JSON.stringify(updated),
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            status: 'success',
          });

          return { status: true, data: updated };
        }
      }

      if (status === 'rejected') {
        if (effectiveLevel === 1) {
          if (!existing.approval1) {
            return {
              status: false,
              message: 'No approver configured for level 1',
            };
          }
          if (existing.approval1 !== ctx.userId) {
            return { status: false, message: 'Forbidden' };
          }

          const updated = await this.prisma.attendanceExemption.update({
            where: { id },
            data: {
              approval1Status: 'rejected',
              approval1Date: new Date(),
              approvalStatus: 'rejected',
              rejectionReason,
              approvedBy: ctx.userId,
              approvedAt: new Date(),
            },
          });

          await this.activityLogs.log({
            userId: ctx.userId,
            action: 'reject',
            module: 'attendance-exemption',
            entity: 'AttendanceExemption',
            entityId: id,
            description: 'Rejected attendance exemption (Level 1)',
            oldValues: JSON.stringify(existing),
            newValues: JSON.stringify(updated),
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            status: 'success',
          });

          return { status: true, data: updated };
        }

        if (effectiveLevel === 2) {
          if (
            existing.approval1Status !== 'approved' &&
            existing.approval1Status !== 'auto-approved'
          ) {
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
          if (existing.approval2 !== ctx.userId) {
            return { status: false, message: 'Forbidden' };
          }

          const updated = await this.prisma.attendanceExemption.update({
            where: { id },
            data: {
              approval2Status: 'rejected',
              approval2Date: new Date(),
              approvalStatus: 'rejected',
              rejectionReason,
              approvedBy: ctx.userId,
              approvedAt: new Date(),
            },
          });

          await this.activityLogs.log({
            userId: ctx.userId,
            action: 'reject',
            module: 'attendance-exemption',
            entity: 'AttendanceExemption',
            entityId: id,
            description: 'Rejected attendance exemption (Level 2)',
            oldValues: JSON.stringify(existing),
            newValues: JSON.stringify(updated),
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            status: 'success',
          });

          return { status: true, data: updated };
        }
      }

      return { status: false, message: 'Invalid approval level' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'attendance-exemption',
        entity: 'AttendanceExemption',
        entityId: id,
        description: 'Failed to update attendance exemption approval',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });

      return {
        status: false,
        message:
          error?.message || 'Failed to update attendance exemption approval',
      };
    }
  }

  async approve(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    return this.updateApproval(id, { approvalStatus: 'approved' }, ctx);
  }

  async approveLevel(
    id: string,
    level: 1 | 2 | undefined,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    return this.updateApproval(id, { approvalStatus: 'approved', level }, ctx);
  }

  async reject(
    id: string,
    body: { rejectionReason?: string },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    return this.updateApproval(
      id,
      { approvalStatus: 'rejected', rejectionReason: body.rejectionReason },
      ctx,
    );
  }

  async rejectLevel(
    id: string,
    level: 1 | 2 | undefined,
    body: { rejectionReason?: string },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    return this.updateApproval(
      id,
      {
        approvalStatus: 'rejected',
        rejectionReason: body.rejectionReason,
        level,
      },
      ctx,
    );
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.attendanceExemption.findUnique({
        where: { id },
      });
      if (!existing) {
        return { status: false, message: 'Attendance exemption not found' };
      }

      await this.prisma.attendanceExemption.delete({ where: { id } });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'attendance-exemption',
        entity: 'AttendanceExemption',
        entityId: id,
        description: `Deleted attendance exemption for ${existing.employeeName || 'Unknown'}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return {
        status: true,
        message: 'Attendance exemption deleted successfully',
      };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'attendance-exemption',
        entity: 'AttendanceExemption',
        entityId: id,
        description: 'Failed to delete attendance exemption',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });

      return {
        status: false,
        message: error?.message || 'Failed to delete attendance exemption',
      };
    }
  }
}
