import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';

@Injectable()
export class AttendanceRequestQueryService {
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
  async list() {
    const queries = await this.prisma.attendanceRequestQuery.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        employee: {
          select: {
            employeeId: true,
            departmentId: true,
            subDepartmentId: true,
            designationId: true,
          },
        },
      },
    });

    // Fetch all departments and designations for mapping
    const departments = await this.prisma.department.findMany({
      include: { subDepartments: true },
    });
    const designations = await this.prisma.designation.findMany();

    // Map IDs to names
    const mappedQueries = queries.map((query) => {
      // Map department and subDepartment from AttendanceRequestQuery fields
      const dept = query.department
        ? departments.find((d) => d.id === query.department)
        : null;
      const subDept =
        dept && query.subDepartment
          ? dept.subDepartments.find((sd) => sd.id === query.subDepartment)
          : null;

      // Map designation from employee relation if available
      const employeeDesignationId = query.employee?.designationId;
      const designation = employeeDesignationId
        ? designations.find((d) => d.id === employeeDesignationId)
        : null;

      return {
        ...query,
        employeeId: query.employee?.employeeId || query.employeeId, // Use actual employeeId from employee relation
        department: dept?.name || query.department,
        subDepartment: subDept?.name || query.subDepartment,
        designation: designation?.name || null,
      };
    });

    return { status: true, data: mappedQueries };
  }

  async get(id: string) {
    const query = await this.prisma.attendanceRequestQuery.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            employeeId: true,
            departmentId: true,
            subDepartmentId: true,
            designationId: true,
          },
        },
      },
    });

    if (!query) {
      return { status: false, message: 'Attendance request query not found' };
    }

    // Fetch department and designation for mapping
    const department = query.department
      ? await this.prisma.department.findUnique({
          where: { id: query.department },
          include: { subDepartments: true },
        })
      : null;

    const subDepartment =
      department && query.subDepartment
        ? department.subDepartments.find((sd) => sd.id === query.subDepartment)
        : null;

    const designation = query.employee?.designationId
      ? await this.prisma.designation.findUnique({
          where: { id: query.employee.designationId },
        })
      : null;

    return {
      status: true,
      data: {
        ...query,
        employeeId: query.employee?.employeeId || query.employeeId, // Use actual employeeId from employee relation
        department: department?.name || query.department,
        subDepartment: subDepartment?.name || query.subDepartment,
        designation: designation?.name || null,
      },
    };
  }

  async create(
    body: any,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!body.employeeId) {
        return {
          status: false,
          message: 'Employee is required to create attendance request query',
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
          where: { requestType: 'attendance' },
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

      const created = await this.prisma.attendanceRequestQuery.create({
        data: {
          employeeId: body.employeeId || null,
          employeeName: body.employeeName || null,
          department: body.department || null,
          subDepartment: body.subDepartment || null,
          attendanceDate: new Date(body.attendanceDate),
          clockInTimeRequest: body.clockInTimeRequest || null,
          clockOutTimeRequest: body.clockOutTimeRequest || null,
          breakIn: body.breakIn || null,
          breakOut: body.breakOut || null,
          query: body.query,
          approval1,
          approval1Status,
          approval1Date,
          approval2,
          approval2Status,
          approval2Date,
          approvalStatus,
        },
      });

      // Fetch the created record with employee relation to get actual employeeId
      const createdWithEmployee =
        await this.prisma.attendanceRequestQuery.findUnique({
          where: { id: created.id },
          include: {
            employee: {
              select: {
                employeeId: true,
              },
            },
          },
        });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'attendance-request-query',
        entity: 'AttendanceRequestQuery',
        entityId: created.id,
        description: `Created attendance request query for ${body.employeeName || 'Unknown'}`,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return {
        status: true,
        data: createdWithEmployee
          ? {
              ...createdWithEmployee,
              employeeId:
                createdWithEmployee.employee?.employeeId ||
                createdWithEmployee.employeeId,
            }
          : created,
      };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'attendance-request-query',
        entity: 'AttendanceRequestQuery',
        description: 'Failed to create attendance request query',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });

      return {
        status: false,
        message: error?.message || 'Failed to create attendance request query',
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
      const existing = await this.prisma.attendanceRequestQuery.findUnique({
        where: { id },
      });
      if (!existing) {
        return { status: false, message: 'Attendance request query not found' };
      }

      const updated = await this.prisma.attendanceRequestQuery.update({
        where: { id },
        data: {
          employeeName:
            body.employeeName !== undefined
              ? body.employeeName
              : existing.employeeName,
          department:
            body.department !== undefined
              ? body.department
              : existing.department,
          subDepartment:
            body.subDepartment !== undefined
              ? body.subDepartment
              : existing.subDepartment,
          attendanceDate:
            body.attendanceDate !== undefined
              ? new Date(body.attendanceDate)
              : existing.attendanceDate,
          clockInTimeRequest:
            body.clockInTimeRequest !== undefined
              ? body.clockInTimeRequest
              : existing.clockInTimeRequest,
          clockOutTimeRequest:
            body.clockOutTimeRequest !== undefined
              ? body.clockOutTimeRequest
              : existing.clockOutTimeRequest,
          breakIn: body.breakIn !== undefined ? body.breakIn : existing.breakIn,
          breakOut:
            body.breakOut !== undefined ? body.breakOut : existing.breakOut,
          query: body.query !== undefined ? body.query : existing.query,
        },
      });

      const updatedWithEmployee =
        await this.prisma.attendanceRequestQuery.findUnique({
          where: { id },
          include: {
            employee: {
              select: {
                employeeId: true,
              },
            },
          },
        });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'attendance-request-query',
        entity: 'AttendanceRequestQuery',
        entityId: id,
        description: 'Updated attendance request query',
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return {
        status: true,
        data: updatedWithEmployee
          ? {
              ...updatedWithEmployee,
              employeeId:
                updatedWithEmployee.employee?.employeeId ||
                updatedWithEmployee.employeeId,
            }
          : updated,
      };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'attendance-request-query',
        entity: 'AttendanceRequestQuery',
        entityId: id,
        description: 'Failed to update attendance request query',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });

      return {
        status: false,
        message: error?.message || 'Failed to update attendance request query',
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

      const existing = await this.prisma.attendanceRequestQuery.findUnique({
        where: { id },
      });
      if (!existing) {
        return { status: false, message: 'Attendance request query not found' };
      }

      if (existing.approvalStatus === 'approved') {
        return {
          status: false,
          message: 'Attendance request query already approved',
        };
      }

      if (existing.approvalStatus === 'rejected') {
        return {
          status: false,
          message: 'Attendance request query already rejected',
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

          const updated = await this.prisma.attendanceRequestQuery.update({
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
            module: 'attendance-request-query',
            entity: 'AttendanceRequestQuery',
            entityId: id,
            description: 'Approved attendance request query (Level 1)',
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

          const updated = await this.prisma.attendanceRequestQuery.update({
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
            module: 'attendance-request-query',
            entity: 'AttendanceRequestQuery',
            entityId: id,
            description: 'Approved attendance request query (Level 2)',
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

          const updated = await this.prisma.attendanceRequestQuery.update({
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
            module: 'attendance-request-query',
            entity: 'AttendanceRequestQuery',
            entityId: id,
            description: 'Rejected attendance request query (Level 1)',
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

          const updated = await this.prisma.attendanceRequestQuery.update({
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
            module: 'attendance-request-query',
            entity: 'AttendanceRequestQuery',
            entityId: id,
            description: 'Rejected attendance request query (Level 2)',
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
        module: 'attendance-request-query',
        entity: 'AttendanceRequestQuery',
        entityId: id,
        description: 'Failed to update attendance request query approval',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });

      return {
        status: false,
        message:
          error?.message ||
          'Failed to update attendance request query approval',
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
      const existing = await this.prisma.attendanceRequestQuery.findUnique({
        where: { id },
      });
      if (!existing) {
        return { status: false, message: 'Attendance request query not found' };
      }

      await this.prisma.attendanceRequestQuery.delete({ where: { id } });

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'attendance-request-query',
        entity: 'AttendanceRequestQuery',
        entityId: id,
        description: `Deleted attendance request query for ${existing.employeeName || 'Unknown'}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });

      return {
        status: true,
        message: 'Attendance request query deleted successfully',
      };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'attendance-request-query',
        entity: 'AttendanceRequestQuery',
        entityId: id,
        description: 'Failed to delete attendance request query',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });

      return {
        status: false,
        message: error?.message || 'Failed to delete attendance request query',
      };
    }
  }
}
