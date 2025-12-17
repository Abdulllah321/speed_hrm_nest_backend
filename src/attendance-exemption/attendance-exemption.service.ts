import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ActivityLogsService } from '../activity-logs/activity-logs.service'

@Injectable()
export class AttendanceExemptionService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService
  ) {}

  async list() {
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
    })

    // Fetch all departments and designations for mapping
    const departments = await this.prisma.department.findMany({
      include: { subDepartments: true },
    })
    const designations = await this.prisma.designation.findMany()

    // Map IDs to names
    const mappedExemptions = exemptions.map((exemption) => {
      // Map department and subDepartment from AttendanceExemption fields
      const dept = exemption.department
        ? departments.find((d) => d.id === exemption.department)
        : null
      const subDept =
        dept && exemption.subDepartment
          ? dept.subDepartments.find((sd) => sd.id === exemption.subDepartment)
          : null

      // Map designation from employee relation if available
      const employeeDesignationId = exemption.employee?.designationId
      const designation = employeeDesignationId
        ? designations.find((d) => d.id === employeeDesignationId)
        : null

      return {
        ...exemption,
        department: dept?.name || exemption.department,
        subDepartment: subDept?.name || exemption.subDepartment,
        designation: designation?.name || null,
        employeeId: exemption.employee?.employeeId || exemption.employeeId,
      }
    })

    return { status: true, data: mappedExemptions }
  }

  async get(id: string) {
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
    })

    if (!exemption) {
      return { status: false, message: 'Attendance exemption not found' }
    }

    // Fetch department and designation for mapping
    const department = exemption.department
      ? await this.prisma.department.findUnique({
          where: { id: exemption.department },
          include: { subDepartments: true },
        })
      : null

    const subDepartment =
      department && exemption.subDepartment
        ? department.subDepartments.find((sd) => sd.id === exemption.subDepartment)
        : null

    const designation = exemption.employee?.designationId
      ? await this.prisma.designation.findUnique({
          where: { id: exemption.employee.designationId },
        })
      : null

    return {
      status: true,
      data: {
        ...exemption,
        department: department?.name || exemption.department,
        subDepartment: subDepartment?.name || exemption.subDepartment,
        designation: designation?.name || null,
        employeeId: exemption.employee?.employeeId || exemption.employeeId,
      },
    }
  }

  async create(body: any, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
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
          approvalStatus: body.approvalStatus || 'pending',
          createdById: ctx.userId || null,
        },
      })

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
      })

      return { status: true, data: created }
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
      })

      return {
        status: false,
        message: error?.message || 'Failed to create attendance exemption',
      }
    }
  }

  async update(
    id: string,
    body: any,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string }
  ) {
    try {
      const existing = await this.prisma.attendanceExemption.findUnique({
        where: { id },
      })
      if (!existing) {
        return { status: false, message: 'Attendance exemption not found' }
      }

      const updated = await this.prisma.attendanceExemption.update({
        where: { id },
        data: {
          approvalStatus: body.approvalStatus || existing.approvalStatus,
          approvedBy: body.approvedBy || ctx.userId || null,
          approvedAt:
            body.approvalStatus && body.approvalStatus !== 'pending'
              ? new Date()
              : null,
          rejectionReason: body.rejectionReason || null,
          updatedById: ctx.userId || null,
        },
      })

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
      })

      return { status: true, data: updated }
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
      })

      return {
        status: false,
        message: error?.message || 'Failed to update attendance exemption',
      }
    }
  }

  async remove(id: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.attendanceExemption.findUnique({
        where: { id },
      })
      if (!existing) {
        return { status: false, message: 'Attendance exemption not found' }
      }

      await this.prisma.attendanceExemption.delete({ where: { id } })

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
      })

      return { status: true, message: 'Attendance exemption deleted successfully' }
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
      })

      return {
        status: false,
        message: error?.message || 'Failed to delete attendance exemption',
      }
    }
  }
}

