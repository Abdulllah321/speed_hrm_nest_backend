import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ActivityLogsService } from '../activity-logs/activity-logs.service'
import { Decimal } from '@prisma/client/runtime/client'

@Injectable()
export class AttendanceService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list(filters?: {
    employeeId?: string
    dateFrom?: Date
    dateTo?: Date
    status?: string
  }) {
    const where: any = {}
    if (filters?.employeeId) where.employeeId = filters.employeeId
    if (filters?.dateFrom || filters?.dateTo) {
      where.date = {}
      if (filters.dateFrom) where.date.gte = filters.dateFrom
      if (filters.dateTo) where.date.lte = filters.dateTo
    }
    if (filters?.status) where.status = filters.status

    const attendances = await this.prisma.attendance.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            employeeName: true,
            departmentId: true,
            subDepartmentId: true,
            workingHoursPolicyId: true,
          },
        },
      },
      orderBy: { date: 'desc' },
    })
    return { status: true, data: attendances }
  }

  async get(id: string) {
    const attendance = await this.prisma.attendance.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            employeeName: true,
            departmentId: true,
            subDepartmentId: true,
            workingHoursPolicyId: true,
          },
        },
      },
    })
    if (!attendance) return { status: false, message: 'Attendance not found' }
    return { status: true, data: attendance }
  }

  /**
   * Calculate overtime hours based on WorkingHoursPolicy
   */
  private async calculateOvertime(
    employeeId: string,
    date: Date,
    checkIn: Date,
    checkOut: Date,
  ): Promise<{ workingHours: Decimal; overtimeHours: Decimal; lateMinutes: number; earlyLeaveMinutes: number; breakDuration: number }> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { workingHoursPolicyId: true },
    })

    if (!employee || !employee.workingHoursPolicyId) {
      // Default calculation if no policy
      const hours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60)
      return {
        workingHours: new Decimal(hours),
        overtimeHours: new Decimal(0),
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        breakDuration: 0,
      }
    }

    const policy = await this.prisma.workingHoursPolicy.findUnique({
      where: { id: employee.workingHoursPolicyId },
    })

    if (!policy) {
      const hours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60)
      return {
        workingHours: new Decimal(hours),
        overtimeHours: new Decimal(0),
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        breakDuration: 0,
      }
    }

    // Get day name (monday, tuesday, etc.)
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const dayName = dayNames[date.getDay()]

    // Check for day override
    let startTime = policy.startWorkingHours
    let endTime = policy.endWorkingHours
    let startBreak = policy.startBreakTime
    let endBreak = policy.endBreakTime
    let expectedHours = this.parseTimeToHours(endTime) - this.parseTimeToHours(startTime)

    if (policy.dayOverrides && typeof policy.dayOverrides === 'object') {
      const overrides = policy.dayOverrides as any
      if (overrides[dayName]?.enabled) {
        const override = overrides[dayName]
        if (override.overrideHours) {
          startTime = override.startTime || startTime
          endTime = override.endTime || endTime
          expectedHours = this.parseTimeToHours(endTime) - this.parseTimeToHours(startTime)
        }
        if (override.overrideBreak && override.startBreakTime && override.endBreakTime) {
          startBreak = override.startBreakTime
          endBreak = override.endBreakTime
        }
      }
    }

    // Parse times
    const checkInHours = this.parseTimeToHours(this.formatTime(checkIn))
    const checkOutHours = this.parseTimeToHours(this.formatTime(checkOut))
    const startHours = this.parseTimeToHours(startTime)
    const endHours = this.parseTimeToHours(endTime)
    const breakStartHours = startBreak ? this.parseTimeToHours(startBreak) : null
    const breakEndHours = endBreak ? this.parseTimeToHours(endBreak) : null

    // Calculate break duration
    let breakDuration = 0
    if (breakStartHours !== null && breakEndHours !== null) {
      breakDuration = Math.max(0, breakEndHours - breakStartHours) * 60 // in minutes
    }

    // Calculate late minutes
    const lateMinutes = Math.max(0, (checkInHours - startHours) * 60)

    // Calculate early leave minutes
    const earlyLeaveMinutes = Math.max(0, (endHours - checkOutHours) * 60)

    // Calculate total working hours (excluding break)
    const totalHours = checkOutHours - checkInHours - (breakDuration / 60)
    const workingHours = new Decimal(Math.max(0, totalHours))

    // Calculate overtime (hours worked beyond expected hours)
    const overtimeHours = new Decimal(Math.max(0, totalHours - expectedHours))

    return {
      workingHours,
      overtimeHours,
      lateMinutes: Math.round(lateMinutes),
      earlyLeaveMinutes: Math.round(earlyLeaveMinutes),
      breakDuration: Math.round(breakDuration),
    }
  }

  /**
   * Parse time string (HH:mm) to decimal hours
   */
  private parseTimeToHours(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map(Number)
    return hours + minutes / 60
  }

  /**
   * Format Date to HH:mm string
   */
  private formatTime(date: Date): string {
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    return `${hours}:${minutes}`
  }

  async create(
    body: {
      employeeId: string
      date: string | Date
      checkIn?: string | Date
      checkOut?: string | Date
      status?: string
      isRemote?: boolean
      location?: string
      latitude?: number
      longitude?: number
      notes?: string
    },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const date = new Date(body.date)
      date.setHours(0, 0, 0, 0) // Normalize to start of day

      const checkIn = body.checkIn ? new Date(body.checkIn) : null
      const checkOut = body.checkOut ? new Date(body.checkOut) : null

      // Check if attendance already exists
      const existing = await this.prisma.attendance.findUnique({
        where: {
          employeeId_date: {
            employeeId: body.employeeId,
            date: date,
          },
        },
      })

      if (existing) {
        return { status: false, message: 'Attendance record already exists for this date' }
      }

      let workingHours: Decimal | null = null
      let overtimeHours: Decimal | null = null
      let lateMinutes: number | null = null
      let earlyLeaveMinutes: number | null = null
      let breakDuration: number | null = null

      // Calculate hours if both check-in and check-out are provided
      if (checkIn && checkOut) {
        const calculated = await this.calculateOvertime(body.employeeId, date, checkIn, checkOut)
        workingHours = calculated.workingHours
        overtimeHours = calculated.overtimeHours
        lateMinutes = calculated.lateMinutes
        earlyLeaveMinutes = calculated.earlyLeaveMinutes
        breakDuration = calculated.breakDuration
      }

      const created = await this.prisma.attendance.create({
        data: {
          employeeId: body.employeeId,
          date: date,
          checkIn: checkIn,
          checkOut: checkOut,
          status: body.status || 'present',
          isRemote: body.isRemote || false,
          location: body.location || null,
          latitude: body.latitude ? new Decimal(body.latitude) : null,
          longitude: body.longitude ? new Decimal(body.longitude) : null,
          workingHours: workingHours,
          overtimeHours: overtimeHours,
          lateMinutes: lateMinutes,
          earlyLeaveMinutes: earlyLeaveMinutes,
          breakDuration: breakDuration,
          notes: body.notes || null,
          createdById: ctx.userId,
        },
        include: {
          employee: {
            select: {
              employeeId: true,
              employeeName: true,
            },
          },
        },
      })

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'attendances',
        entity: 'Attendance',
        entityId: created.id,
        description: `Created attendance record for ${created.employee.employeeName} on ${date.toISOString().split('T')[0]}`,
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
        module: 'attendances',
        entity: 'Attendance',
        description: 'Failed to create attendance record',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: error?.message || 'Failed to create attendance record' }
    }
  }

  /**
   * Create attendance records for a date range
   */
  async createForDateRange(
    body: {
      employeeId: string
      fromDate: string | Date
      toDate: string | Date
      checkIn?: string
      checkOut?: string
      status?: string
      isRemote?: boolean
      location?: string
      latitude?: number
      longitude?: number
      notes?: string
    },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const fromDate = new Date(body.fromDate)
      const toDate = new Date(body.toDate)
      fromDate.setHours(0, 0, 0, 0)
      toDate.setHours(23, 59, 59, 999)

      const results: any[] = []
      const errors: Array<{ date: string; error: string }> = []

      // Iterate through each day in the range
      const currentDate = new Date(fromDate)
      while (currentDate <= toDate) {
        const dateStr = currentDate.toISOString().split('T')[0]
        const checkInDateTime = body.checkIn ? new Date(`${dateStr}T${body.checkIn}`) : undefined
        const checkOutDateTime = body.checkOut ? new Date(`${dateStr}T${body.checkOut}`) : undefined

        try {
          const result = await this.create(
            {
              employeeId: body.employeeId,
              date: new Date(currentDate),
              checkIn: checkInDateTime,
              checkOut: checkOutDateTime,
              status: body.status,
              isRemote: body.isRemote,
              location: body.location,
              latitude: body.latitude,
              longitude: body.longitude,
              notes: body.notes,
            },
            ctx,
          )

          if (result.status) {
            results.push(result.data)
          } else {
            errors.push({ date: dateStr, error: result.message })
          }
        } catch (error: any) {
          errors.push({ date: dateStr, error: error.message })
        }

        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1)
      }

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'attendances',
        entity: 'Attendance',
        description: `Created attendance records for date range ${fromDate.toISOString().split('T')[0]} to ${toDate.toISOString().split('T')[0]}`,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: errors.length === 0 ? 'success' : 'failure',
      })

      return {
        status: errors.length === 0,
        data: results,
        errors: errors.length > 0 ? errors : undefined,
        message: errors.length > 0 ? `${results.length} records created, ${errors.length} failed` : `${results.length} records created successfully`,
      }
    } catch (error: any) {
      return { status: false, message: error?.message || 'Failed to create attendance records' }
    }
  }

  async update(
    id: string,
    body: {
      checkIn?: string | Date
      checkOut?: string | Date
      status?: string
      isRemote?: boolean
      location?: string
      latitude?: number
      longitude?: number
      notes?: string
    },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.attendance.findUnique({ where: { id } })
      if (!existing) {
        return { status: false, message: 'Attendance not found' }
      }

      const updateData: any = {}
      if (body.checkIn !== undefined) updateData.checkIn = body.checkIn ? new Date(body.checkIn) : null
      if (body.checkOut !== undefined) updateData.checkOut = body.checkOut ? new Date(body.checkOut) : null
      if (body.status !== undefined) updateData.status = body.status
      if (body.isRemote !== undefined) updateData.isRemote = body.isRemote
      if (body.location !== undefined) updateData.location = body.location || null
      if (body.latitude !== undefined) updateData.latitude = body.latitude ? new Decimal(body.latitude) : null
      if (body.longitude !== undefined) updateData.longitude = body.longitude ? new Decimal(body.longitude) : null
      if (body.notes !== undefined) updateData.notes = body.notes || null
      updateData.updatedById = ctx.userId

      // Recalculate hours if check-in or check-out changed
      if ((body.checkIn !== undefined || body.checkOut !== undefined) && updateData.checkIn && updateData.checkOut) {
        const calculated = await this.calculateOvertime(
          existing.employeeId,
          existing.date,
          updateData.checkIn,
          updateData.checkOut,
        )
        updateData.workingHours = calculated.workingHours
        updateData.overtimeHours = calculated.overtimeHours
        updateData.lateMinutes = calculated.lateMinutes
        updateData.earlyLeaveMinutes = calculated.earlyLeaveMinutes
        updateData.breakDuration = calculated.breakDuration
      }

      const updated = await this.prisma.attendance.update({
        where: { id },
        data: updateData,
        include: {
          employee: {
            select: {
              employeeId: true,
              employeeName: true,
            },
          },
        },
      })

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'attendances',
        entity: 'Attendance',
        entityId: updated.id,
        description: `Updated attendance record for ${updated.employee.employeeName}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(updateData),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })

      return { status: true, data: updated }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'attendances',
        entity: 'Attendance',
        description: 'Failed to update attendance record',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: error?.message || 'Failed to update attendance record' }
    }
  }

  async delete(id: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.attendance.findUnique({
        where: { id },
        include: {
          employee: {
            select: {
              employeeId: true,
              employeeName: true,
            },
          },
        },
      })

      if (!existing) {
        return { status: false, message: 'Attendance not found' }
      }

      await this.prisma.attendance.delete({ where: { id } })

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'attendances',
        entity: 'Attendance',
        entityId: id,
        description: `Deleted attendance record for ${existing.employee.employeeName} on ${existing.date.toISOString().split('T')[0]}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })

      return { status: true, message: 'Attendance deleted successfully' }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'attendances',
        entity: 'Attendance',
        description: 'Failed to delete attendance record',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: error?.message || 'Failed to delete attendance record' }
    }
  }

  /**
   * Bulk upload attendance from CSV file
   * Expected CSV format: EmployeeID,Date,CheckIn,CheckOut,Status,Location,Latitude,Longitude,Notes
   */
  async bulkUploadFromCSV(
    filePath: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const fs = await import('fs')
      const { parse } = await import('csv-parse/sync')

      const fileContent = fs.readFileSync(filePath, 'utf-8')
      const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Array<Record<string, string>>

      const results: any[] = []
      const errors: Array<{ row: Record<string, string>; error: string }> = []

      for (const record of records) {
        try {
          // Find employee by employeeId
          const employee = await this.prisma.employee.findUnique({
            where: { employeeId: record.EmployeeID || record.employeeId || record['Employee ID'] },
            select: { id: true, employeeId: true },
          })

          if (!employee) {
            errors.push({
              row: record,
              error: `Employee not found: ${record.EmployeeID || record.employeeId || record['Employee ID']}`,
            })
            continue
          }

          // Parse date
          const date = new Date(record.Date || record.date)
          date.setHours(0, 0, 0, 0)

          // Parse check-in and check-out times
          const checkIn = record.CheckIn || record.checkIn || record['Check In']
            ? new Date(`${record.Date || record.date}T${record.CheckIn || record.checkIn || record['Check In']}`)
            : undefined
          const checkOut = record.CheckOut || record.checkOut || record['Check Out']
            ? new Date(`${record.Date || record.date}T${record.CheckOut || record.checkOut || record['Check Out']}`)
            : undefined

          const result = await this.create(
            {
              employeeId: employee.id,
              date: date,
              checkIn: checkIn,
              checkOut: checkOut,
              status: record.Status || record.status || 'present',
              isRemote: record.IsRemote === 'true' || record.isRemote === 'true' || false,
              location: record.Location || record.location || undefined,
              latitude: record.Latitude || record.latitude ? parseFloat(record.Latitude || record.latitude) : undefined,
              longitude: record.Longitude || record.longitude ? parseFloat(record.Longitude || record.longitude) : undefined,
              notes: record.Notes || record.notes || undefined,
            },
            ctx,
          )

          if (result.status) {
            results.push(result.data)
          } else {
            errors.push({ row: record, error: result.message })
          }
        } catch (error: any) {
          errors.push({ row: record, error: error.message })
        }
      }

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'bulk_upload',
        module: 'attendances',
        entity: 'Attendance',
        description: `Bulk uploaded ${results.length} attendance records from CSV`,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: errors.length === 0 ? 'success' : 'failure',
      })

      return {
        status: errors.length === 0,
        data: results,
        errors: errors.length > 0 ? errors : undefined,
        message: errors.length > 0
          ? `${results.length} records imported, ${errors.length} failed`
          : `${results.length} records imported successfully`,
      }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'bulk_upload',
        module: 'attendances',
        entity: 'Attendance',
        description: 'Failed to bulk upload attendance records',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: error?.message || 'Failed to process CSV file' }
    }
  }
}

