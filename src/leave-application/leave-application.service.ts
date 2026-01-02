import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ActivityLogsService } from '../activity-logs/activity-logs.service'

@Injectable()
export class LeaveApplicationService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) { }

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
      })

      if (!employee) {
        return { status: false, message: 'Employee not found' }
      }

      if (!employee.leavesPolicy) {
        return { status: false, message: 'Employee does not have a leave policy assigned' }
      }

      // Get all approved leave applications for this employee
      const leaveApplications = await (this.prisma as any).leaveApplication.findMany({
        where: {
          employeeId,
          status: 'approved',
        },
        include: {
          leaveType: true,
        },
      })

      // Calculate used leaves by leave type
      const usedLeavesMap = new Map<string, number>()

      leaveApplications.forEach((app) => {
        const leaveTypeId = app.leaveTypeId
        const currentUsed = usedLeavesMap.get(leaveTypeId) || 0

        // Calculate days between fromDate and toDate
        const fromDate = new Date(app.fromDate)
        const toDate = new Date(app.toDate)
        const diffTime = Math.abs(toDate.getTime() - fromDate.getTime())
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1 // +1 to include both dates

        // Adjust based on day type
        let daysToDeduct = diffDays
        if (app.dayType === 'halfDay') {
          daysToDeduct = diffDays * 0.5
        } else if (app.dayType === 'shortLeave') {
          daysToDeduct = diffDays * 0.25 // Assuming short leave is 0.25 day
        }

        usedLeavesMap.set(leaveTypeId, currentUsed + daysToDeduct)
      })

      // Build leave balance array
      const leaveBalances = employee.leavesPolicy.leaveTypes.map((policyLeaveType) => {
        const totalLeaves = policyLeaveType.numberOfLeaves
        const usedLeaves = usedLeavesMap.get(policyLeaveType.leaveTypeId) || 0
        const remainingLeaves = Math.max(0, totalLeaves - usedLeaves)

        return {
          id: policyLeaveType.leaveTypeId, // Add id for DataTable compatibility
          leaveTypeId: policyLeaveType.leaveTypeId,
          leaveTypeName: policyLeaveType.leaveType.name,
          totalLeaves,
          usedLeaves: Math.round(usedLeaves * 100) / 100, // Round to 2 decimal places
          remainingLeaves: Math.round(remainingLeaves * 100) / 100,
        }
      })

      const totalTaken = leaveBalances.reduce((sum, bal) => sum + bal.usedLeaves, 0)
      const totalRemaining = leaveBalances.reduce((sum, bal) => sum + bal.remainingLeaves, 0)

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
      }
    } catch (error: any) {
      console.error('Error fetching leave balance:', error)
      return { status: false, message: error?.message || 'Failed to fetch leave balance' }
    }
  }

  async create(
    body: {
      employeeId: string
      leaveTypeId: string
      dayType: 'fullDay' | 'halfDay' | 'shortLeave'
      fromDate: string
      toDate: string
      reasonForLeave: string
      addressWhileOnLeave: string
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
      })

      if (!employee) {
        return { status: false, message: 'Employee not found' }
      }

      if (!employee.leavesPolicy) {
        return { status: false, message: 'Employee does not have a leave policy assigned' }
      }

      // Check if leave type exists in policy
      const policyLeaveType = employee.leavesPolicy.leaveTypes.find(
        (lt) => lt.leaveTypeId === body.leaveTypeId,
      )

      if (!policyLeaveType) {
        return { status: false, message: 'Leave type not found in employee leave policy' }
      }

      // Check leave balance
      const balanceResult = await this.getLeaveBalance(body.employeeId)
      if (!balanceResult.status || !balanceResult.data) {
        return balanceResult
      }

      const leaveBalance = balanceResult.data.leaveBalances.find(
        (bal: any) => bal.leaveTypeId === body.leaveTypeId,
      )

      if (!leaveBalance || leaveBalance.remainingLeaves <= 0) {
        return { status: false, message: 'Insufficient leave balance' }
      }

      // Calculate days requested
      const fromDate = new Date(body.fromDate)
      const toDate = new Date(body.toDate)
      const diffTime = Math.abs(toDate.getTime() - fromDate.getTime())
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1

      // Check if attendance already exists for any day in the requested range
      const checkFromDate = new Date(fromDate)
      checkFromDate.setHours(0, 0, 0, 0)
      const checkToDate = new Date(toDate)
      checkToDate.setHours(23, 59, 59, 999)

      const existingAttendance = await this.prisma.attendance.findFirst({
        where: {
          employeeId: body.employeeId,
          date: {
            gte: checkFromDate,
            lte: checkToDate,
          },
        },
      })

      if (existingAttendance) {
        return {
          status: false,
          message: 'Attendance result already marked for one or more days in this range. Cannot apply for leave.',
        }
      }

      let daysToDeduct = diffDays
      if (body.dayType === 'halfDay') {
        daysToDeduct = diffDays * 0.5
      } else if (body.dayType === 'shortLeave') {
        daysToDeduct = diffDays * 0.25
      }

      if (daysToDeduct > leaveBalance.remainingLeaves) {
        return { status: false, message: 'Requested days exceed remaining leave balance' }
      }

      // Create leave application
      const created = await (this.prisma as any).leaveApplication.create({
        data: {
          employeeId: body.employeeId,
          leaveTypeId: body.leaveTypeId,
          dayType: body.dayType,
          fromDate: new Date(body.fromDate) as any,
          toDate: new Date(body.toDate) as any,
          reasonForLeave: body.reasonForLeave,
          addressWhileOnLeave: body.addressWhileOnLeave,
          status: 'pending',
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
      })

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
      })

      return { status: true, data: created }
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
      })
      return { status: false, message: error?.message || 'Failed to create leave application' }
    }
  }

  async list(filters?: {
    departmentId?: string
    subDepartmentId?: string
    employeeId?: string
    status?: string
    fromDate?: string
    toDate?: string
  }) {
    try {
      const where: any = {}

      if (filters?.employeeId) {
        where.employeeId = filters.employeeId
      }

      if (filters?.status && filters.status !== 'all') {
        where.status = filters.status
      }

      if (filters?.fromDate) {
        where.fromDate = { gte: new Date(filters.fromDate) }
      }
      if (filters?.toDate) {
        where.toDate = { lte: new Date(filters.toDate) }
      }

      const leaveApplications = await (this.prisma as any).leaveApplication.findMany({
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
      })

      // Filter by department/sub-department if needed
      let filtered = leaveApplications

      if (filters?.departmentId) {
        filtered = filtered.filter(
          (app) =>
            app.employee.departmentId === filters.departmentId ||
            app.employee.department?.id === filters.departmentId,
        )
      }

      if (filters?.subDepartmentId) {
        filtered = filtered.filter(
          (app) =>
            app.employee.subDepartmentId === filters.subDepartmentId ||
            app.employee.subDepartment?.id === filters.subDepartmentId,
        )
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
        approval2: app.approval2 || null,
        approval2Status: app.approval2Status || null,
        remarks: app.remarks || null,
        status: app.status,
        createdAt: app.createdAt.toISOString(),
        updatedAt: app.updatedAt.toISOString(),
      }))

      return { status: true, data: mapped }
    } catch (error: any) {
      console.error('Error fetching leave applications:', error)
      return { status: false, message: error?.message || 'Failed to fetch leave applications' }
    }
  }

  async approve(id: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
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
      })

      if (!existing) {
        return { status: false, message: 'Leave application not found' }
      }

      if (existing.status === 'approved') {
        return { status: false, message: 'Leave application already approved' }
      }

      const updated = await (this.prisma as any).leaveApplication.update({
        where: { id },
        data: {
          status: 'approved',
          approval1: ctx.userId,
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
      })

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'leave-applications',
        entity: 'LeaveApplication',
        entityId: id,
        description: `Approved leave application for ${updated.employee.employeeName}`,
        oldValues: JSON.stringify({ status: existing.status }),
        newValues: JSON.stringify({ status: 'approved' }),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })

      return { status: true, data: updated }
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
      })
      return { status: false, message: error?.message || 'Failed to approve leave application' }
    }
  }

  async reject(id: string, remarks: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
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
      })

      if (!existing) {
        return { status: false, message: 'Leave application not found' }
      }

      if (existing.status === 'rejected') {
        return { status: false, message: 'Leave application already rejected' }
      }

      const updated = await (this.prisma as any).leaveApplication.update({
        where: { id },
        data: {
          status: 'rejected',
          approval1: ctx.userId,
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
      })

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'leave-applications',
        entity: 'LeaveApplication',
        entityId: id,
        description: `Rejected leave application for ${updated.employee.employeeName}`,
        oldValues: JSON.stringify({ status: existing.status }),
        newValues: JSON.stringify({ status: 'rejected', remarks }),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })

      return { status: true, data: updated }
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
      })
      return { status: false, message: error?.message || 'Failed to reject leave application' }
    }
  }
}

