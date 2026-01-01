import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ActivityLogsService } from '../activity-logs/activity-logs.service'
import { Decimal } from '@prisma/client/runtime/client'

@Injectable()
export class AttendanceService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) { }

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

    // First, check for date-based policy assignment
    const dateStart = new Date(date)
    dateStart.setHours(0, 0, 0, 0)
    const dateEnd = new Date(date)
    dateEnd.setHours(23, 59, 59, 999)

    const policyAssignment = await this.prisma.workingHoursPolicyAssignment.findFirst({
      where: {
        employeeId,
        startDate: { lte: dateEnd },
        endDate: { gte: dateStart },
      },
      include: {
        workingHoursPolicy: true,
      },
      orderBy: { createdAt: 'desc' }, // Most recent assignment takes precedence
    })

    // Use assigned policy if exists, otherwise fall back to employee's default policy
    let policy = policyAssignment?.workingHoursPolicy || null

    if (!policy && employee?.workingHoursPolicyId) {
      policy = await this.prisma.workingHoursPolicy.findUnique({
        where: { id: employee.workingHoursPolicyId },
      })
    }

    if (!policy) {
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

    // Get day name (monday, tuesday, etc.)
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const dayName = dayNames[date.getDay()]

    // Check for day override
    let startTime = policy.startWorkingHours
    let endTime = policy.endWorkingHours
    let startBreak = policy.startBreakTime
    let endBreak = policy.endBreakTime
    let expectedHours = this.parseTimeToHours(endTime) - this.parseTimeToHours(startTime)
    let isDayOff = false

    // If it's a weekend, default to 0 expected hours (unless overridden)
    if (dayName === 'saturday' || dayName === 'sunday') {
      expectedHours = 0
      isDayOff = true
    }

    if (policy.dayOverrides && typeof policy.dayOverrides === 'object') {
      const overrides = policy.dayOverrides as any
      if (overrides[dayName]?.enabled) {
        // If override is enabled for this day, it might be a working day now
        isDayOff = false
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
    const lateMinutes = isDayOff ? 0 : Math.max(0, (checkInHours - startHours) * 60)

    // Calculate early leave minutes
    const earlyLeaveMinutes = isDayOff ? 0 : Math.max(0, (endHours - checkOutHours) * 60)

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

      // Fetch all active holidays
      const holidays = await this.prisma.holiday.findMany({
        where: { status: 'active' },
      })

      // Iterate through each day in the range
      const currentDate = new Date(fromDate)
      while (currentDate <= toDate) {
        // Skip Weekends (Saturday & Sunday)
        if (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
          currentDate.setDate(currentDate.getDate() + 1)
          continue
        }

        // Skip Holidays (Recurring check)
        const isHoliday = holidays.some(holiday => {
          const holidayStart = new Date(holiday.dateFrom)
          const holidayEnd = new Date(holiday.dateTo)

          // Normalize years to current date's year for comparison
          holidayStart.setFullYear(currentDate.getFullYear())
          holidayEnd.setFullYear(currentDate.getFullYear())

          // Reset hours for comparison
          const checkDate = new Date(currentDate)
          checkDate.setHours(0, 0, 0, 0)
          holidayStart.setHours(0, 0, 0, 0)
          holidayEnd.setHours(23, 59, 59, 999)

          return checkDate >= holidayStart && checkDate <= holidayEnd
        })

        if (isHoliday) {
          currentDate.setDate(currentDate.getDate() + 1)
          continue
        }

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
   * Bulk upload attendance from CSV or XLSX file
   * Expected format: ID (or EmployeeID), DATE (or Date), CLOCK_IN (or CheckIn), CLOCK_OUT (or CheckOut), Status, Location, Notes
   */
  async bulkUploadFromCSV(
    filePath: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const fs = await import('fs')
      const path = await import('path')

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        throw new Error('File not found')
      }

      // Detect file type from extension
      const fileExtension = path.extname(filePath).toLowerCase()
      let records: Array<Record<string, string>>

      if (fileExtension === '.xlsx' || fileExtension === '.xls') {
        // Parse Excel file
        try {
          const XLSX = await import('xlsx')

          // Read file buffer
          const fileBuffer = fs.readFileSync(filePath)

          // Parse workbook from buffer
          const workbook = XLSX.read(fileBuffer, { type: 'buffer' })

          // Get first sheet
          const sheetName = workbook.SheetNames[0]
          if (!sheetName) {
            throw new Error('Excel file has no sheets')
          }

          const worksheet = workbook.Sheets[sheetName]

          // Convert to array of arrays (first row is headers)
          const excelData = XLSX.utils.sheet_to_json(worksheet, {
            header: 1,
            defval: '', // Default value for empty cells
            raw: false, // Convert all values to strings
          }) as any[][]

          // Validate we got data
          if (!excelData || excelData.length === 0) {
            throw new Error('Excel file is empty')
          }

          // Convert array of arrays to array of objects (first row is headers)
          const headers = excelData[0] as string[]
          if (!headers || headers.length === 0) {
            throw new Error('Excel file has no header row')
          }

          records = excelData.slice(1)
            .map((row: any[]) => {
              const obj: Record<string, string> = {}
              headers.forEach((header, index) => {
                // Include all columns - extra columns like "Total No Of Employees" will be ignored when processing
                if (header && String(header).trim().length > 0) {
                  obj[String(header).trim()] = row[index] ? String(row[index]).trim() : ''
                }
              })
              return obj
            })
            .filter((row: Record<string, string>) => {
              // Filter out completely empty rows
              const hasData = Object.values(row).some(val => val && String(val).trim().length > 0)
              if (!hasData) return false

              // Check for required fields (ID and DATE) - case insensitive
              const rowKeys = Object.keys(row).map(k => k.toLowerCase().trim())
              const hasId = rowKeys.some(k => ['id', 'employeeid', 'employee_id', 'employee id'].includes(k)) &&
                Object.entries(row).some(([key, val]) => {
                  const lowerKey = key.toLowerCase().trim()
                  return (['id', 'employeeid', 'employee_id', 'employee id'].includes(lowerKey) && val && String(val).trim().length > 0)
                })
              const hasDate = rowKeys.includes('date') &&
                Object.entries(row).some(([key, val]) => {
                  return (key.toLowerCase().trim() === 'date' && val && String(val).trim().length > 0)
                })

              return hasId && hasDate
            })
        } catch (error: any) {
          throw new Error(`Failed to parse Excel file: ${error.message}`)
        }
      } else {
        // Parse CSV file
        const { parse } = await import('csv-parse/sync')

        // Read file and validate it's a text file
        let fileContent: string
        try {
          fileContent = fs.readFileSync(filePath, 'utf-8')
        } catch (error: any) {
          throw new Error('Invalid file format. The file appears to be corrupted or not a valid CSV file.')
        }

        // Validate file content is not empty
        if (!fileContent || fileContent.trim().length === 0) {
          throw new Error('The CSV file is empty')
        }

        // Try to parse CSV with better error handling
        try {
          // First, parse without columns to get raw data and handle inconsistent column counts
          const rawData = parse(fileContent, {
            skip_empty_lines: true,
            trim: true,
            bom: true,
            relax_quotes: true,
            relax_column_count: true, // Allow inconsistent column counts
            cast: false,
          }) as any[][]

          if (!rawData || rawData.length === 0) {
            throw new Error('CSV file has no data')
          }

          // First row contains headers
          const headers = rawData[0].map((h: any) => String(h || '').trim())
          if (headers.length === 0) {
            throw new Error('CSV file has no headers')
          }

          // Convert to array of objects, handling rows with fewer columns
          const parsedRecords: Array<Record<string, string>> = []
          for (let i = 1; i < rawData.length; i++) {
            const row = rawData[i]
            // Skip completely empty rows
            if (!row || row.length === 0 || !row.some((cell: any) => cell && String(cell).trim().length > 0)) {
              continue
            }

            const obj: Record<string, string> = {}
            // Map row values to headers, handling cases where row has fewer columns
            headers.forEach((header, index) => {
              if (header && header.trim().length > 0) {
                obj[header] = row[index] ? String(row[index]).trim() : ''
              }
            })
            parsedRecords.push(obj)
          }

          // Filter records to only include those with required fields
          // Extra columns like "Total No Of Employees" are automatically ignored
          records = parsedRecords
            .filter((row: Record<string, string>) => {
              // Filter out completely empty rows
              const hasData = Object.values(row).some(val => val && String(val).trim().length > 0)
              if (!hasData) return false

              // Check for required fields (ID and DATE) - case insensitive
              const rowKeys = Object.keys(row).map(k => k.toLowerCase().trim())
              const hasId = rowKeys.some(k => ['id', 'employeeid', 'employee_id', 'employee id'].includes(k)) &&
                Object.entries(row).some(([key, val]) => {
                  const lowerKey = key.toLowerCase().trim()
                  return (['id', 'employeeid', 'employee_id', 'employee id'].includes(lowerKey) && val && String(val).trim().length > 0)
                })
              const hasDate = rowKeys.includes('date') &&
                Object.entries(row).some(([key, val]) => {
                  return (key.toLowerCase().trim() === 'date' && val && String(val).trim().length > 0)
                })

              return hasId && hasDate
            })
            .map((row: Record<string, string>) => {
              // Create a clean record - extra columns are automatically ignored when we access specific fields
              const cleanRow: Record<string, string> = {}
              Object.keys(row).forEach(key => {
                if (row[key] !== undefined && row[key] !== null) {
                  cleanRow[key] = String(row[key]).trim()
                }
              })
              return cleanRow
            })
        } catch (parseError: any) {
          throw new Error(`Invalid CSV format: ${parseError.message}`)
        }
      }

      // Validate we got records
      if (!records || records.length === 0) {
        throw new Error('No valid records found in file. Please check the file format.')
      }

      const results: any[] = []
      const errors: Array<{ row: Record<string, string>; error: string }> = []

      for (const record of records) {
        try {
          // Find employee by employeeId - support multiple column name formats
          const employeeIdValue = record.ID || record.id || record.EmployeeID || record.employeeId || record['Employee ID'] || record['ID']
          const employee = await this.prisma.employee.findUnique({
            where: { employeeId: employeeIdValue },
            select: { id: true, employeeId: true },
          })

          if (!employee) {
            errors.push({
              row: record,
              error: `Employee not found: ${employeeIdValue}`,
            })
            continue
          }

          // Parse date - support multiple column name formats
          const dateValue = record.DATE || record.Date || record.date
          const date = new Date(dateValue)
          if (isNaN(date.getTime())) {
            errors.push({ row: record, error: `Invalid date format: ${dateValue}` })
            continue
          }
          date.setHours(0, 0, 0, 0)

          // Helper function to convert 12-hour time (HH:MM:SS AM/PM) to 24-hour format (HH:MM:SS)
          const convertTo24Hour = (timeStr: string): string => {
            if (!timeStr || !timeStr.trim()) return timeStr

            const trimmed = timeStr.trim().toUpperCase()
            // Check if already in 24-hour format (no AM/PM)
            if (!trimmed.includes('AM') && !trimmed.includes('PM')) {
              return trimmed
            }

            // Extract time and AM/PM - handle formats like "9:45:00 AM" or "7:43:00 PM"
            // Pattern: (hours):(minutes):(optional seconds) (AM/PM)
            const match = trimmed.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)/)
            if (!match) return timeStr // Return original if can't parse

            let hours = parseInt(match[1], 10)
            const minutes = match[2]
            const seconds = match[3] || '00'
            const ampm = match[4]

            // Convert to 24-hour format
            if (ampm === 'PM' && hours !== 12) {
              hours += 12
            } else if (ampm === 'AM' && hours === 12) {
              hours = 0
            }

            // Format as HH:MM:SS
            return `${hours.toString().padStart(2, '0')}:${minutes}:${seconds}`
          }

          // Get date string in YYYY-MM-DD format
          const dateStr = date.toISOString().split('T')[0]

          // Parse check-in and check-out times - support multiple column name formats
          const checkInValue = record.CLOCK_IN || record.clock_in || record.ClockIn || record.CheckIn || record.checkIn || record['Check In'] || record['CLOCK_IN'] || record['Clock In']
          const checkIn = checkInValue && checkInValue.trim()
            ? (() => {
              const time24 = convertTo24Hour(checkInValue)
              const dateTimeStr = `${dateStr}T${time24}`
              const parsed = new Date(dateTimeStr)
              return isNaN(parsed.getTime()) ? undefined : parsed
            })()
            : undefined

          const checkOutValue = record.CLOCK_OUT || record.clock_out || record.ClockOut || record.CheckOut || record.checkOut || record['Check Out'] || record['CLOCK_OUT'] || record['Clock Out']
          const checkOut = checkOutValue && checkOutValue.trim()
            ? (() => {
              const time24 = convertTo24Hour(checkOutValue)
              const dateTimeStr = `${dateStr}T${time24}`
              const parsed = new Date(dateTimeStr)
              return isNaN(parsed.getTime()) ? undefined : parsed
            })()
            : undefined
          // Check if this date is a public holiday
          const holiday = await this.prisma.holiday.findFirst({
            where: {
              dateFrom: { lte: date },
              dateTo: { gte: date },
              status: 'active',
            },
          })

          // Check for date-based policy assignment first
          const dateStart = new Date(date)
          dateStart.setHours(0, 0, 0, 0)
          const dateEnd = new Date(date)
          dateEnd.setHours(23, 59, 59, 999)

          const policyAssignment = await this.prisma.workingHoursPolicyAssignment.findFirst({
            where: {
              employeeId: employee.id,
              startDate: { lte: dateEnd },
              endDate: { gte: dateStart },
            },
            include: {
              workingHoursPolicy: true,
            },
            orderBy: { createdAt: 'desc' },
          })

          // Get employee's default working hours policy
          const employeeWithPolicy = await this.prisma.employee.findUnique({
            where: { id: employee.id },
            select: { workingHoursPolicyId: true },
          })

          // Use assigned policy if exists, otherwise use default
          let policy = policyAssignment?.workingHoursPolicy || null
          if (!policy && employeeWithPolicy?.workingHoursPolicyId) {
            policy = await this.prisma.workingHoursPolicy.findUnique({
              where: { id: employeeWithPolicy.workingHoursPolicyId },
            })
          }

          let isWeeklyOff = false
          if (policy) {
            // Check dayOverrides for weekly off days (dayType === 'off')
            if (policy.dayOverrides && typeof policy.dayOverrides === 'object') {
              const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
              const dayName = dayNames[date.getDay()]
              const overrides = policy.dayOverrides as Record<string, any>
              const dayConfig = overrides[dayName]
              if (dayConfig && dayConfig.dayType === 'off') {
                isWeeklyOff = true
              }
            }
          }

          // Determine status: if it's holiday/weekly off with attendance, mark as overtime/present-on-holiday
          let status = record.Status || record.status || 'present'
          const isOnHolidayOrOff = !!holiday || isWeeklyOff

          // Calculate working hours if check-in and check-out exist
          let workingHours: Decimal | null = null
          let overtimeHours: Decimal | null = null
          let lateMinutes: number | null = null
          let earlyLeaveMinutes: number | null = null
          let breakDuration: number | null = null

          if (checkIn && checkOut) {
            const calculated = await this.calculateOvertime(employee.id, date, checkIn, checkOut)
            workingHours = calculated.workingHours
            lateMinutes = calculated.lateMinutes
            earlyLeaveMinutes = calculated.earlyLeaveMinutes
            breakDuration = calculated.breakDuration

            // If on holiday/weekly off, all hours are overtime
            if (isOnHolidayOrOff) {
              overtimeHours = workingHours
              status = 'present' // They worked on their off day
            } else {
              overtimeHours = calculated.overtimeHours
            }
          }

          // Upsert: update if exists, create if not
          const upserted = await this.prisma.attendance.upsert({
            where: {
              employeeId_date: {
                employeeId: employee.id,
                date: date,
              },
            },
            update: {
              checkIn: checkIn,
              checkOut: checkOut,
              status: status,
              isRemote: record.IsRemote === 'true' || record.isRemote === 'true' || false,
              location: record.Location || record.location || null,
              latitude: record.Latitude || record.latitude ? new Decimal(parseFloat(record.Latitude || record.latitude)) : null,
              longitude: record.Longitude || record.longitude ? new Decimal(parseFloat(record.Longitude || record.longitude)) : null,
              workingHours: workingHours,
              overtimeHours: overtimeHours,
              lateMinutes: lateMinutes,
              earlyLeaveMinutes: earlyLeaveMinutes,
              breakDuration: breakDuration,
              notes: record.Notes || record.notes || null,
              updatedAt: new Date(),
            },
            create: {
              employeeId: employee.id,
              date: date,
              checkIn: checkIn,
              checkOut: checkOut,
              status: status,
              isRemote: record.IsRemote === 'true' || record.isRemote === 'true' || false,
              location: record.Location || record.location || null,
              latitude: record.Latitude || record.latitude ? new Decimal(parseFloat(record.Latitude || record.latitude)) : null,
              longitude: record.Longitude || record.longitude ? new Decimal(parseFloat(record.Longitude || record.longitude)) : null,
              workingHours: workingHours,
              overtimeHours: overtimeHours,
              lateMinutes: lateMinutes,
              earlyLeaveMinutes: earlyLeaveMinutes,
              breakDuration: breakDuration,
              notes: record.Notes || record.notes || null,
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

          results.push(upserted)
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

  /**
   * Get attendance progress summary for employees
   * Calculates comprehensive attendance statistics for the given date range
   */
  async getProgressSummary(filters?: {
    employeeId?: string
    departmentId?: string
    subDepartmentId?: string
    dateFrom?: Date
    dateTo?: Date
  }) {
    try {
      // Build employee filter
      const employeeWhere: any = {}
      if (filters?.employeeId) {
        // Handle multiple employee IDs (comma-separated)
        const employeeIds = filters.employeeId.split(',').map(id => id.trim()).filter(Boolean)
        if (employeeIds.length === 1) {
          employeeWhere.id = employeeIds[0]
        } else if (employeeIds.length > 1) {
          employeeWhere.id = { in: employeeIds }
        }
      }
      if (filters?.departmentId) employeeWhere.departmentId = filters.departmentId
      if (filters?.subDepartmentId) employeeWhere.subDepartmentId = filters.subDepartmentId

      // Get employees with their related data
      const employees = await this.prisma.employee.findMany({
        where: employeeWhere,
        include: {
          department: {
            select: { id: true, name: true },
          },
          subDepartment: {
            select: { id: true, name: true },
          },
          designation: {
            select: { id: true, name: true },
          },
          workingHoursPolicy: true,
        },
      })

      // Get holidays for the date range
      const dateFrom = filters?.dateFrom || new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      const dateTo = filters?.dateTo || new Date()

      // Normalize dates to start of day
      const startDate = new Date(dateFrom)
      startDate.setHours(0, 0, 0, 0)
      const endDate = new Date(dateTo)
      endDate.setHours(23, 59, 59, 999)

      // Get all holidays (they're stored normalized to year 2000, so we check if they fall in the month/day range)
      const allHolidays = await this.prisma.holiday.findMany({
        where: { status: 'active' },
      })

      // Helper to check if a date is a holiday
      const isHoliday = (date: Date): boolean => {
        const month = date.getMonth() + 1
        const day = date.getDate()
        return allHolidays.some(holiday => {
          const holidayFrom = new Date(holiday.dateFrom)
          const holidayTo = new Date(holiday.dateTo)
          const holidayMonthFrom = holidayFrom.getMonth() + 1
          const holidayDayFrom = holidayFrom.getDate()
          const holidayMonthTo = holidayTo.getMonth() + 1
          const holidayDayTo = holidayTo.getDate()

          // Check if date falls within holiday range
          if (holidayMonthFrom === holidayMonthTo) {
            return month === holidayMonthFrom && day >= holidayDayFrom && day <= holidayDayTo
          } else {
            // Holiday spans across months
            return (month === holidayMonthFrom && day >= holidayDayFrom) ||
              (month === holidayMonthTo && day <= holidayDayTo)
          }
        })
      }

      // Helper to check if a date is a weekend
      const isWeekend = (date: Date): boolean => {
        const day = date.getDay()
        return day === 0 || day === 6 // Sunday or Saturday
      }

      // Helper to calculate scheduled hours per day based on working hours policy
      const getScheduledHoursPerDay = (policy: any): number => {
        if (!policy) return 8 // Default 8 hours
        const start = policy.startWorkingHours || '09:00'
        const end = policy.endWorkingHours || '17:00'
        const [startHour, startMin] = start.split(':').map(Number)
        const [endHour, endMin] = end.split(':').map(Number)
        const startTime = startHour + startMin / 60
        const endTime = endHour + endMin / 60
        let hours = endTime - startTime
        // Subtract break time if configured
        if (policy.startBreakTime && policy.endBreakTime) {
          const [breakStartHour, breakStartMin] = policy.startBreakTime.split(':').map(Number)
          const [breakEndHour, breakEndMin] = policy.endBreakTime.split(':').map(Number)
          const breakStart = breakStartHour + breakStartMin / 60
          const breakEnd = breakEndHour + breakEndMin / 60
          hours -= (breakEnd - breakStart)
        }
        return Math.max(0, hours)
      }

      // Helper to format hours as "Xh" or "Xh Ym"
      const formatHours = (hours: number): string => {
        if (hours === 0) return '0h'
        const wholeHours = Math.floor(hours)
        const minutes = Math.round((hours - wholeHours) * 60)
        if (minutes === 0) return `${wholeHours}h`
        return `${wholeHours}h ${minutes}m`
      }

      const results: Array<{
        id: string
        employeeId: string
        employeeName: string
        department: string
        departmentName?: string
        subDepartment?: string
        subDepartmentName?: string
        designation?: string
        designationName?: string
        days: number
        scheduleDays: number
        offDays: number
        present: number
        presentOnHoliday: number
        leaves: number
        absents: number
        late: number
        halfDay: number
        shortDays: number
        scheduleTime: string
        actualWorkedTime: string
        breakTime: string
        absentTime: string
        overtimeBeforeTime: string
        overtimeAfterTime: string
        shortExcessTime: string
      }> = []

      for (const employee of employees) {
        // Get all attendance records for this employee in the date range
        // Normalize date comparison - attendance.date is DateTime but we compare by date only
        const attendances = await this.prisma.attendance.findMany({
          where: {
            employeeId: employee.id,
            date: {
              gte: startDate,
              lte: endDate,
            },
          },
          orderBy: { date: 'asc' },
        })

        // Get approved leave applications for this employee in the date range
        // Leave applications overlap if: (fromDate <= endDate) AND (toDate >= startDate)
        const leaveApplications = await this.prisma.leaveApplication.findMany({
          where: {
            employeeId: employee.id,
            status: 'approved',
            fromDate: { lte: endDate },
            toDate: { gte: startDate },
          },
        })

        // Create a map of leave applications by date
        const leaveMap = new Map<string, typeof leaveApplications[0]>()
        leaveApplications.forEach(leave => {
          const leaveStart = new Date(leave.fromDate)
          leaveStart.setHours(0, 0, 0, 0)
          const leaveEnd = new Date(leave.toDate)
          leaveEnd.setHours(23, 59, 59, 999)
          const currentLeaveDate = new Date(leaveStart)
          while (currentLeaveDate <= leaveEnd) {
            const dateKey = currentLeaveDate.toISOString().split('T')[0]
            if (currentLeaveDate >= startDate && currentLeaveDate <= endDate) {
              leaveMap.set(dateKey, leave)
            }
            currentLeaveDate.setDate(currentLeaveDate.getDate() + 1)
          }
        })

        // Calculate date range statistics
        const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
        let scheduleDays = 0
        let offDays = 0
        let present = 0
        let presentOnHoliday = 0
        let leaves = 0
        let absents = 0
        let late = 0
        let halfDay = 0
        let shortDays = 0
        let totalScheduleTime = 0
        let totalActualWorkedTime = 0
        let totalBreakTime = 0
        let totalOvertimeAfter = 0

        // Create a map of attendance by date for quick lookup
        // Normalize date to YYYY-MM-DD format for comparison
        const attendanceMap = new Map<string, typeof attendances[0]>()
        attendances.forEach(att => {
          const attDate = new Date(att.date)
          attDate.setHours(0, 0, 0, 0)
          const dateKey = attDate.toISOString().split('T')[0]
          attendanceMap.set(dateKey, att)
        })

        // Iterate through each day in the range
        const currentDate = new Date(startDate)
        while (currentDate <= endDate) {
          const dateKey = currentDate.toISOString().split('T')[0]
          const attendance = attendanceMap.get(dateKey)
          const leaveApplication = leaveMap.get(dateKey)
          const isHolidayDate = isHoliday(currentDate)
          const isWeekendDate = isWeekend(currentDate)

          // Check if this is a scheduled working day (not weekend and not holiday)
          if (!isWeekendDate && !isHolidayDate) {
            scheduleDays++
            const scheduledHours = getScheduledHoursPerDay(employee.workingHoursPolicy)
            totalScheduleTime += scheduledHours

            // Check for approved leave application FIRST
            // This ensures we count the leave even if they are marked Present
            let isApprovedLeave = false
            if (leaveApplication) {
              leaves++
              isApprovedLeave = true
              // Adjust scheduled time for leave days
              totalScheduleTime -= scheduledHours
              scheduleDays-- // Don't count leave days as scheduled
            }

            if (attendance) {
              // Handle different attendance statuses according to schema
              const status = attendance.status.toLowerCase()

              if (status === 'present') {
                present++
                // Count late if has lateMinutes > 0
                if (attendance.lateMinutes && attendance.lateMinutes > 0) {
                  late++
                }
              } else if (status === 'late') {
                present++ // Late is still considered present
                late++
              } else if (status === 'absent') {
                if (!isApprovedLeave) {
                  absents++
                }
              } else if (status === 'half-day' || status === 'halfday') {
                halfDay++
                present++ // Half day is partially present
                // Count late if applicable
                if (attendance.lateMinutes && attendance.lateMinutes > 0) {
                  late++
                }
              } else if (status === 'short-day' || status === 'shortday') {
                shortDays++
                present++ // Short day is still present
                // Count late if applicable
                if (attendance.lateMinutes && attendance.lateMinutes > 0) {
                  late++
                }
              } else if (status === 'on-leave' || status === 'onleave') {
                // Only count if not already counted as approved leave
                if (!isApprovedLeave) {
                  leaves++
                  // Adjust scheduled time for leave days
                  totalScheduleTime -= scheduledHours
                  scheduleDays-- // Don't count leave days as scheduled
                }
              } else if (status === 'holiday') {
                // Holiday status - treat as off day but check if present
                offDays++
                if (attendance.checkIn || attendance.checkOut) {
                  presentOnHoliday++
                }

                // Revert the schedule addition at the top if it turns out to be a holiday status
                // But wait, if it was !isHolidayDate, how can status be holiday?
                // Edge case: Master list says it's workday, but attendance says holiday (override?)
                // For now, let's treat it consistent with logic above: remove from schedule
                scheduleDays--
                totalScheduleTime -= scheduledHours
                continue
              }

              // Sum working hours (only if checkIn and checkOut exist)
              if (attendance.workingHours) {
                totalActualWorkedTime += Number(attendance.workingHours)
              }

              // Sum break time
              if (attendance.breakDuration) {
                totalBreakTime += attendance.breakDuration / 60 // Convert minutes to hours
              }

              // Sum overtime
              if (attendance.overtimeHours) {
                totalOvertimeAfter += Number(attendance.overtimeHours)
              }
            } else {
              // No attendance record - check if absent (unless on leave)
              if (!isApprovedLeave) {
                absents++
              }
            }
          } else {
            // Weekend or holiday
            offDays++

            // Check if present on holiday (holidays can have attendance if employee worked)
            if (isHolidayDate && attendance) {
              if (attendance.status === 'present' || attendance.checkIn || attendance.checkOut) {
                presentOnHoliday++
              }
            }
          }

          // Move to next day
          currentDate.setDate(currentDate.getDate() + 1)
        }

        // Calculate absent time (absent days * scheduled hours per day)
        const scheduledHoursPerDay = getScheduledHoursPerDay(employee.workingHoursPolicy)
        const absentTime = absents * scheduledHoursPerDay

        // Calculate short/excess time (difference between scheduled and actual)
        const shortExcessTime = totalScheduleTime - totalActualWorkedTime

        results.push({
          id: employee.id,
          employeeId: employee.employeeId,
          employeeName: employee.employeeName,
          department: employee.departmentId,
          departmentName: employee.department?.name,
          subDepartment: employee.subDepartmentId ?? undefined,
          subDepartmentName: employee.subDepartment?.name,
          designation: employee.designationId ?? undefined,
          designationName: employee.designation?.name,
          days: totalDays,
          scheduleDays,
          offDays,
          present,
          presentOnHoliday,
          leaves,
          absents,
          late,
          halfDay,
          shortDays,
          scheduleTime: formatHours(totalScheduleTime),
          actualWorkedTime: formatHours(totalActualWorkedTime),
          breakTime: formatHours(totalBreakTime),
          absentTime: formatHours(absentTime),
          overtimeBeforeTime: '0h', // Not currently tracked separately
          overtimeAfterTime: formatHours(totalOvertimeAfter),
          shortExcessTime: formatHours(shortExcessTime),
        })
      }

      return { status: true, data: results }
    } catch (error: any) {
      return { status: false, message: error?.message || 'Failed to get attendance progress summary' }
    }
  }
}

