import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ActivityLogsService } from '../activity-logs/activity-logs.service'

@Injectable()
export class AttendanceRequestQueryService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService
  ) {}

  async list() {
    const queries = await this.prisma.attendanceRequestQuery.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        employee: {
          select: {
            departmentId: true,
            subDepartmentId: true,
            designationId: true,
          },
        },
      },
    })

    // Fetch all departments and designations for mapping
    const departments = await this.prisma.department.findMany({
      include: { subDepartments: true },
    })
    const designations = await this.prisma.designation.findMany()

    // Map IDs to names
    const mappedQueries = queries.map((query) => {
      // Map department and subDepartment from AttendanceRequestQuery fields
      const dept = query.department
        ? departments.find((d) => d.id === query.department)
        : null
      const subDept =
        dept && query.subDepartment
          ? dept.subDepartments.find((sd) => sd.id === query.subDepartment)
          : null

      // Map designation from employee relation if available
      const employeeDesignationId = query.employee?.designationId
      const designation = employeeDesignationId
        ? designations.find((d) => d.id === employeeDesignationId)
        : null

      return {
        ...query,
        department: dept?.name || query.department,
        subDepartment: subDept?.name || query.subDepartment,
        designation: designation?.name || null,
      }
    })

    return { status: true, data: mappedQueries }
  }

  async get(id: string) {
    const query = await this.prisma.attendanceRequestQuery.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            departmentId: true,
            subDepartmentId: true,
            designationId: true,
          },
        },
      },
    })

    if (!query) {
      return { status: false, message: 'Attendance request query not found' }
    }

    // Fetch department and designation for mapping
    const department = query.department
      ? await this.prisma.department.findUnique({
          where: { id: query.department },
          include: { subDepartments: true },
        })
      : null

    const subDepartment =
      department && query.subDepartment
        ? department.subDepartments.find((sd) => sd.id === query.subDepartment)
        : null

    const designation = query.employee?.designationId
      ? await this.prisma.designation.findUnique({
          where: { id: query.employee.designationId },
        })
      : null

    return {
      status: true,
      data: {
        ...query,
        department: department?.name || query.department,
        subDepartment: subDepartment?.name || query.subDepartment,
        designation: designation?.name || null,
      },
    }
  }

  async create(body: any, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
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
          approvalStatus: body.approvalStatus || 'pending',
        },
      })

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
      })

      return { status: true, data: created }
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
      })

      return {
        status: false,
        message: error?.message || 'Failed to create attendance request query',
      }
    }
  }

  async update(
    id: string,
    body: any,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string }
  ) {
    try {
      const existing = await this.prisma.attendanceRequestQuery.findUnique({
        where: { id },
      })
      if (!existing) {
        return { status: false, message: 'Attendance request query not found' }
      }

      const updated = await this.prisma.attendanceRequestQuery.update({
        where: { id },
        data: {
          approvalStatus: body.approvalStatus || existing.approvalStatus,
          approvedBy: body.approvedBy || ctx.userId || null,
          approvedAt:
            body.approvalStatus && body.approvalStatus !== 'pending'
              ? new Date()
              : null,
          rejectionReason: body.rejectionReason || null,
        },
      })

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'attendance-request-query',
        entity: 'AttendanceRequestQuery',
        entityId: id,
        description: `Updated attendance request query status to ${body.approvalStatus}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })

      return { status: true, data: updated }
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
      })

      return {
        status: false,
        message: error?.message || 'Failed to update attendance request query',
      }
    }
  }

  async remove(id: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.attendanceRequestQuery.findUnique({
        where: { id },
      })
      if (!existing) {
        return { status: false, message: 'Attendance request query not found' }
      }

      await this.prisma.attendanceRequestQuery.delete({ where: { id } })

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
      })

      return { status: true, message: 'Attendance request query deleted successfully' }
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
      })

      return {
        status: false,
        message: error?.message || 'Failed to delete attendance request query',
      }
    }
  }
}

