import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { Decimal } from '@prisma/client/runtime/client';
import { runInBackground } from '../common/utils/run-in-background.util';

@Injectable()
export class AttendanceService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) { }

  async list(filters?: {
    employeeId?: string;
    dateFrom?: Date;
    dateTo?: Date;
    status?: string;
  }) {
    const where: any = {};
    if (filters?.employeeId) where.employeeId = filters.employeeId;
    if (filters?.dateFrom || filters?.dateTo) {
      where.date = {};
      if (filters.dateFrom) where.date.gte = filters.dateFrom;
      if (filters.dateTo) where.date.lte = filters.dateTo;
    }
    if (filters?.status) where.status = filters.status;

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
    });
    return { status: true, data: attendances };
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
    });
    if (!attendance) return { status: false, message: 'Attendance not found' };
    return { status: true, data: attendance };
  }

  /**
   * Calculate overtime hours based on WorkingHoursPolicy
   */
  private async calculateOvertime(
    employeeId: string,
    date: Date,
    checkIn: Date,
    checkOut: Date,
  ): Promise<{
    workingHours: Decimal;
    overtimeHours: Decimal;
    lateMinutes: number;
    earlyLeaveMinutes: number;
    breakDuration: number;
  }> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { workingHoursPolicyId: true },
    });

    // First, check for date-based policy assignment
    const dateStart = new Date(date);
    dateStart.setHours(0, 0, 0, 0);
    const dateEnd = new Date(date);
    dateEnd.setHours(23, 59, 59, 999);

    const policyAssignment =
      await this.prisma.workingHoursPolicyAssignment.findFirst({
        where: {
          employeeId,
          startDate: { lte: dateEnd },
          endDate: { gte: dateStart },
        },
        orderBy: { createdAt: 'desc' }, // Most recent assignment takes precedence
      });

    // Use assigned policy if exists, otherwise fall back to employee's default policy
    let policy: any = null;

    if (policyAssignment?.workingHoursPolicyId) {
      policy = await this.prisma.workingHoursPolicy.findUnique({
        where: { id: policyAssignment.workingHoursPolicyId },
      });
    }

    if (!policy && employee?.workingHoursPolicyId) {
      policy = await this.prisma.workingHoursPolicy.findUnique({
        where: { id: employee.workingHoursPolicyId },
      });
    }

    if (!policy) {
      // Default calculation if no policy
      const hours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60);
      return {
        workingHours: new Decimal(hours),
        overtimeHours: new Decimal(0),
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        breakDuration: 0,
      };
    }

    // Get day name (monday, tuesday, etc.)
    const dayNames = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];
    const dayName = dayNames[date.getDay()];

    // Check for day override
    let startTime = policy.startWorkingHours;
    let endTime = policy.endWorkingHours;
    let startBreak = policy.startBreakTime;
    let endBreak = policy.endBreakTime;
    let expectedHours =
      this.parseTimeToHours(endTime) - this.parseTimeToHours(startTime);
    let isDayOff = false;

    // If it's a weekend, default to 0 expected hours (unless overridden)
    if (dayName === 'saturday' || dayName === 'sunday') {
      expectedHours = 0;
      isDayOff = true;
    }

    if (policy.dayOverrides && typeof policy.dayOverrides === 'object') {
      const overrides = policy.dayOverrides as any;
      if (overrides[dayName]?.enabled) {
        // If override is enabled for this day, it might be a working day now
        isDayOff = false;
        const override = overrides[dayName];
        if (override.overrideHours) {
          startTime = override.startTime || startTime;
          endTime = override.endTime || endTime;
          expectedHours =
            this.parseTimeToHours(endTime) - this.parseTimeToHours(startTime);
        }
        if (
          override.overrideBreak &&
          override.startBreakTime &&
          override.endBreakTime
        ) {
          startBreak = override.startBreakTime;
          endBreak = override.endBreakTime;
        }
      }
    }

    // Parse times
    const checkInHours = this.parseTimeToHours(this.formatTime(checkIn));
    const checkOutHours = this.parseTimeToHours(this.formatTime(checkOut));
    const startHours = this.parseTimeToHours(startTime);
    const endHours = this.parseTimeToHours(endTime);
    const breakStartHours = startBreak
      ? this.parseTimeToHours(startBreak)
      : null;
    const breakEndHours = endBreak ? this.parseTimeToHours(endBreak) : null;

    // Calculate break duration
    let breakDuration = 0;
    if (breakStartHours !== null && breakEndHours !== null) {
      breakDuration = Math.max(0, breakEndHours - breakStartHours) * 60; // in minutes
    }

    // Calculate late minutes
    const lateMinutes = isDayOff
      ? 0
      : Math.max(0, (checkInHours - startHours) * 60);

    // Calculate early leave minutes
    const earlyLeaveMinutes = isDayOff
      ? 0
      : Math.max(0, (endHours - checkOutHours) * 60);

    // Calculate total working hours (excluding break)
    const totalHours = checkOutHours - checkInHours - breakDuration / 60;
    const workingHours = new Decimal(Math.max(0, totalHours));

    // Calculate overtime (hours worked beyond expected hours)
    const overtimeHours = new Decimal(Math.max(0, totalHours - expectedHours));

    return {
      workingHours,
      overtimeHours,
      lateMinutes: Math.round(lateMinutes),
      earlyLeaveMinutes: Math.round(earlyLeaveMinutes),
      breakDuration: Math.round(breakDuration),
    };
  }

  /**
   * Parse time string (HH:mm) to decimal hours
   */
  private parseTimeToHours(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours + minutes / 60;
  }

  /**
   * Format Date to HH:mm string
   */
  private formatTime(date: Date): string {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  async create(
    body: {
      employeeId: string;
      date: string | Date;
      checkIn?: string | Date | null;
      checkOut?: string | Date | null;
      status?: string;
      isRemote?: boolean;
      location?: string;
      latitude?: number;
      longitude?: number;
      notes?: string;
    },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      // Add 12 hours before normalizing to preserve the intended calendar day
      const date = new Date(new Date(body.date).getTime() + 12 * 60 * 60 * 1000);
      date.setUTCHours(0, 0, 0, 0); // Normalize to start of day in UTC

      const checkIn = body.checkIn ? new Date(body.checkIn) : null;
      const checkOut = body.checkOut ? new Date(body.checkOut) : null;

      // Check if attendance already exists
      const existing = await this.prisma.attendance.findUnique({
        where: {
          employeeId_date: {
            employeeId: body.employeeId,
            date: date,
          },
        },
      });

      if (existing) {
        return {
          status: false,
          message: 'Attendance record already exists for this date',
        };
      }

      // --- Joining date validation ---
      const empInfo = await this.prisma.employee.findUnique({
        where: { id: body.employeeId },
        select: { joiningDate: true, employeeName: true },
      });
      if (empInfo?.joiningDate) {
        // Use UTC components to avoid server-local timezone shifts (setHours(0) shifts to previous day in UTC if server is in positive TZ)
        const jd = new Date(empInfo.joiningDate);
        const joiningDateStr = `${jd.getUTCFullYear()}-${String(jd.getUTCMonth() + 1).padStart(2, '0')}-${String(jd.getUTCDate()).padStart(2, '0')}`;
        
        const rawDate = new Date(body.date);
        const targetDateStr = `${rawDate.getUTCFullYear()}-${String(rawDate.getUTCMonth() + 1).padStart(2, '0')}-${String(rawDate.getUTCDate()).padStart(2, '0')}`;

        if (targetDateStr < joiningDateStr) {
          await this.activityLogs.log({
            userId: ctx.userId,
            action: 'create',
            module: 'attendances',
            entity: 'Attendance',
            description: `Blocked: Attendance before joining date for ${empInfo.employeeName} on ${date.toISOString().split('T')[0]}`,
            status: 'failure',
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          });
          return {
            status: false,
            message: 'Attendance cannot be marked before employee joining date.',
          };
        }
      }

      let workingHours: Decimal | null = null;
      let overtimeHours: Decimal | null = null;
      let lateMinutes: number | null = null;
      let earlyLeaveMinutes: number | null = null;
      let breakDuration: number | null = null;

      // Calculate hours if both check-in and check-out are provided
      if (checkIn && checkOut) {
        const calculated = await this.calculateOvertime(
          body.employeeId,
          date,
          checkIn,
          checkOut,
        );
        workingHours = calculated.workingHours;
        overtimeHours = calculated.overtimeHours;
        lateMinutes = calculated.lateMinutes;
        earlyLeaveMinutes = calculated.earlyLeaveMinutes;
        breakDuration = calculated.breakDuration;
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
      });

      const response = { status: true, data: created };
      runInBackground(
        'Create Attendance',
        this.activityLogs.log({
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
        }),
      );

      // Apply sandwich rule if status is absent
      const status = body.status || 'present';
      await this.applySandwichRule(body.employeeId, date, status, ctx);

      return { status: true, data: created };
    } catch (error: any) {
      runInBackground(
        'Create Attendance (Failure Log)',
        this.activityLogs.log({
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
        }),
      );
      return {
        status: false,
        message: error?.message || 'Failed to create attendance record',
      };
    }
  }

  /**
   * Create attendance records for a date range
   */
  async createForDateRange(
    body: {
      employeeId: string;
      fromDate: string | Date;
      toDate: string | Date;
      checkIn?: string;
      checkOut?: string;
      status?: string;
      isRemote?: boolean;
      location?: string;
      latitude?: number;
      longitude?: number;
      notes?: string;
    },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      // Add 12 hours before normalizing to preserve the intended calendar day 
      // (prevents April 30th 19:00 UTC from becoming April 30th 00:00 UTC instead of May 1st)
      const fromDate = new Date(new Date(body.fromDate).getTime() + 12 * 60 * 60 * 1000);
      const toDate = new Date(new Date(body.toDate).getTime() + 12 * 60 * 60 * 1000);
      
      fromDate.setUTCHours(0, 0, 0, 0);
      toDate.setUTCHours(23, 59, 59, 999);

      const results: any[] = [];
      const errors: Array<{ date: string; error: string }> = [];

      // Fetch all active holidays
      const holidays = await this.prisma.holiday.findMany({
        where: { status: 'active' },
      });

      // Fetch approved leaves for this employee in the range
      const approvedLeaves = await this.prisma.leaveApplication.findMany({
        where: {
          employeeId: body.employeeId,
          status: 'approved',
          fromDate: { lte: toDate },
          toDate: { gte: fromDate },
        },
      });

      // --- Joining date clamp ---
      const empForRange = await this.prisma.employee.findUnique({
        where: { id: body.employeeId },
        select: { joiningDate: true },
      });
      if (empForRange?.joiningDate) {
        const jd = new Date(empForRange.joiningDate);
        const joiningDateStr = `${jd.getUTCFullYear()}-${String(jd.getUTCMonth() + 1).padStart(2, '0')}-${String(jd.getUTCDate()).padStart(2, '0')}`;
        
        const rawFromDate = new Date(body.fromDate);
        const fromDateStr = `${rawFromDate.getUTCFullYear()}-${String(rawFromDate.getUTCMonth() + 1).padStart(2, '0')}-${String(rawFromDate.getUTCDate()).padStart(2, '0')}`;
        
        const rawToDate = new Date(body.toDate);
        const toDateStr = `${rawToDate.getUTCFullYear()}-${String(rawToDate.getUTCMonth() + 1).padStart(2, '0')}-${String(rawToDate.getUTCDate()).padStart(2, '0')}`;

        if (toDateStr < joiningDateStr) {
          return {
            status: false,
            message: 'Entire date range is before employee joining date.',
          };
        }
        if (fromDateStr < joiningDateStr) {
          const jdObj = new Date(empForRange.joiningDate);
          fromDate.setUTCFullYear(jdObj.getUTCFullYear(), jdObj.getUTCMonth(), jdObj.getUTCDate());
          fromDate.setUTCHours(0, 0, 0, 0);
        }
      }

      // Iterate through each day in the range
      const currentDate = new Date(fromDate);
      while (currentDate <= toDate) {
        const dateStr = currentDate.toISOString().split('T')[0];
        
        // 1. Determine status for the day
        let currentStatus = body.status || 'present';
        let isSpecialDay = false;

        // Check for Approved Leave
        const hasLeave = approvedLeaves.some(leave => {
          const leaveStart = new Date(leave.fromDate);
          const leaveEnd = new Date(leave.toDate);
          leaveStart.setUTCHours(0, 0, 0, 0);
          leaveEnd.setUTCHours(23, 59, 59, 999);
          const checkDate = new Date(currentDate);
          checkDate.setUTCHours(0, 0, 0, 0);
          return checkDate >= leaveStart && checkDate <= leaveEnd;
        });

        if (hasLeave) {
          currentStatus = 'leave';
          isSpecialDay = true;
        }

        // Check for Holiday (if not already leave)
        if (!isSpecialDay) {
          const isHoliday = holidays.some((holiday) => {
            const holidayStart = new Date(new Date(holiday.dateFrom).getTime() + 12 * 60 * 60 * 1000).toISOString().split('T')[0];
            const holidayEnd = new Date(new Date(holiday.dateTo).getTime() + 12 * 60 * 60 * 1000).toISOString().split('T')[0];
            const checkDate = new Date(currentDate.getTime() + 12 * 60 * 60 * 1000).toISOString().split('T')[0];

            return checkDate >= holidayStart && checkDate <= holidayEnd;
          });

          if (isHoliday) {
            currentStatus = 'holiday';
            isSpecialDay = true;
          }
        }

        // Check for Weekend (if not already leave or holiday)
        if (!isSpecialDay) {
          if (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
            currentStatus = 'weekend';
            isSpecialDay = true;
          }
        }

        const checkInDateTime = body.checkIn && !isSpecialDay
          ? new Date(`${dateStr}T${body.checkIn}`)
          : null;
        const checkOutDateTime = body.checkOut && !isSpecialDay
          ? new Date(`${dateStr}T${body.checkOut}`)
          : null;

        try {
          // If record exists, update it; otherwise create it
          const existing = await this.prisma.attendance.findUnique({
            where: {
              employeeId_date: {
                employeeId: body.employeeId,
                date: new Date(currentDate), // Use a new Date object to avoid reference issues
              },
            },
          });

          let result;
          if (existing) {
            result = await this.update(existing.id, {
              status: currentStatus,
              checkIn: checkInDateTime,
              checkOut: checkOutDateTime,
              isRemote: body.isRemote,
              location: body.location,
              latitude: body.latitude,
              longitude: body.longitude,
              notes: body.notes,
            }, ctx);
          } else {
            result = await this.create(
              {
                employeeId: body.employeeId,
                date: new Date(currentDate),
                checkIn: checkInDateTime,
                checkOut: checkOutDateTime,
                status: currentStatus,
                isRemote: body.isRemote,
                location: body.location,
                latitude: body.latitude,
                longitude: body.longitude,
                notes: body.notes,
              },
              ctx,
            );
          }

          if (result.status) {
            results.push((result as any).data);
          } else {
            errors.push({ date: dateStr, error: (result as any).message });
          }
        } catch (error: any) {
          errors.push({ date: dateStr, error: error.message });
        }

        // Move to next day (UTC-safe)
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
      }

      runInBackground(
        'Create Attendance Date Range',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'attendances',
          entity: 'Attendance',
          description: `Created attendance records for date range ${fromDate.toISOString().split('T')[0]} to ${toDate.toISOString().split('T')[0]}`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: errors.length === 0 ? 'success' : 'failure',
        }),
      );
      // ✅ APPLY SANDWICH RULES AFTER ALL RECORDS ARE CREATED
      console.log('🎯 [BULK CREATE] Applying sandwich rules for date range...');
      if (body.status === 'absent') {
        // Find all Fridays and Mondays in the created records
        const createdDates = results.map(r => new Date(r.date));
        const fridays = createdDates.filter(d => d.getDay() === 5);
        const mondays = createdDates.filter(d => d.getDay() === 1);
        
        console.log(`🎯 [BULK CREATE] Found ${fridays.length} Fridays and ${mondays.length} Mondays`);
        
        // Apply sandwich rule for each Friday-Monday pair
        for (const friday of fridays) {
          const monday = new Date(friday);
          monday.setDate(monday.getDate() + 3);
          
          // Check if this Monday is in our created records
          const mondayExists = mondays.some(m => 
            m.getFullYear() === monday.getFullYear() &&
            m.getMonth() === monday.getMonth() &&
            m.getDate() === monday.getDate()
          );
          
          if (mondayExists) {
            console.log(`🎯 [BULK CREATE] Applying sandwich rule for Friday ${friday.toISOString().split('T')[0]}`);
            await this.markWeekendAsAbsent(body.employeeId, friday, ctx);
          }
        }
      }

      return {
        status: errors.length === 0,
        data: results,
        errors: errors.length > 0 ? errors : undefined,
        message:
          errors.length > 0
            ? `${results.length} records created, ${errors.length} failed`
            : `${results.length} records created successfully`,
      };
    } catch (error: any) {
      return {
        status: false,
        message: error?.message || 'Failed to create attendance records',
      };
    }
  }

  /**
   * Apply sandwich rule: If Friday and Monday are absent, mark weekend (Sat, Sun) as absent too
   * Also handles removal: If Friday or Monday changes from absent to present, remove sandwich rule from weekend
   * IMPORTANT: Do NOT apply sandwich rule if Friday or Monday has an approved leave
   */
  private async applySandwichRule(
    employeeId: string,
    date: Date,
    status: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    console.log('🔍 [SANDWICH RULE] Called for:', { employeeId, date: date.toISOString(), status });
    
    const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, 5 = Friday, 6 = Saturday
    console.log('🔍 [SANDWICH RULE] Day of week:', dayOfWeek, '(0=Sun, 1=Mon, 5=Fri)');

    // Check if it's Friday (5) or Monday (1)
    if (dayOfWeek === 5) {
      console.log('✅ [SANDWICH RULE] This is Friday - checking Monday...');
      // Friday
      const monday = new Date(date);
      monday.setUTCDate(monday.getUTCDate() + 3); // Friday + 3 days = Monday
      monday.setUTCHours(0, 0, 0, 0);

      const mondayAttendance = await this.prisma.attendance.findUnique({
        where: {
          employeeId_date: {
            employeeId,
            date: monday,
          },
        },
      });

      console.log('🔍 [SANDWICH RULE] Monday attendance:', mondayAttendance ? `Status: ${mondayAttendance.status}` : 'Not found');

      if (status === 'absent' && mondayAttendance && mondayAttendance.status === 'absent') {
        console.log('✅ [SANDWICH RULE] Both Friday and Monday are absent - checking leaves...');
        // Check if Friday or Monday has approved leave - if yes, don't apply sandwich rule
        const hasApprovedLeave = await this.hasApprovedLeaveOnDates(employeeId, date, monday);
        console.log('🔍 [SANDWICH RULE] Has approved leave:', hasApprovedLeave);
        
        if (!hasApprovedLeave) {
          console.log('🎯 [SANDWICH RULE] Applying sandwich rule - marking weekend as absent!');
          // Both Friday and Monday are absent and no approved leave, mark Saturday and Sunday as absent
          await this.markWeekendAsAbsent(employeeId, date, ctx);
        } else {
          console.log('⏭️ [SANDWICH RULE] Skipping - approved leave found');
        }
      } else if (status !== 'absent') {
        console.log('🗑️ [SANDWICH RULE] Friday is not absent - removing sandwich rule');
        // Friday is no longer absent, remove sandwich rule from weekend if it was applied
        await this.removeWeekendSandwichRule(employeeId, date, ctx);
      } else {
        console.log('⏭️ [SANDWICH RULE] Skipping - Monday is not absent or not found');
      }
    } else if (dayOfWeek === 1) {
      console.log('✅ [SANDWICH RULE] This is Monday - checking Friday...');
      // Monday
      const friday = new Date(date);
      friday.setUTCDate(friday.getUTCDate() - 3); // Monday - 3 days = Friday
      friday.setUTCHours(0, 0, 0, 0);

      const fridayAttendance = await this.prisma.attendance.findUnique({
        where: {
          employeeId_date: {
            employeeId,
            date: friday,
          },
        },
      });

      console.log('🔍 [SANDWICH RULE] Friday attendance:', fridayAttendance ? `Status: ${fridayAttendance.status}` : 'Not found');

      if (status === 'absent' && fridayAttendance && fridayAttendance.status === 'absent') {
        console.log('✅ [SANDWICH RULE] Both Friday and Monday are absent - checking leaves...');
        // Check if Friday or Monday has approved leave - if yes, don't apply sandwich rule
        const hasApprovedLeave = await this.hasApprovedLeaveOnDates(employeeId, friday, date);
        console.log('🔍 [SANDWICH RULE] Has approved leave:', hasApprovedLeave);
        
        if (!hasApprovedLeave) {
          console.log('🎯 [SANDWICH RULE] Applying sandwich rule - marking weekend as absent!');
          // Both Friday and Monday are absent and no approved leave, mark Saturday and Sunday as absent
          await this.markWeekendAsAbsent(employeeId, friday, ctx);
        } else {
          console.log('⏭️ [SANDWICH RULE] Skipping - approved leave found');
        }
      } else if (status !== 'absent') {
        console.log('🗑️ [SANDWICH RULE] Monday is not absent - removing sandwich rule');
        // Monday is no longer absent, remove sandwich rule from weekend if it was applied
        await this.removeWeekendSandwichRule(employeeId, friday, ctx);
      } else {
        console.log('⏭️ [SANDWICH RULE] Skipping - Friday is not absent or not found');
      }
    } else {
      console.log('⏭️ [SANDWICH RULE] Not Friday or Monday - skipping');
    }
    
    // RETROACTIVE CHECK: If we're marking any day as absent, check if it completes a Friday-Monday pair
    // This handles cases where Friday was marked absent first, then Monday later (or vice versa)
    if (status === 'absent') {
      console.log('🔄 [SANDWICH RULE] Running retroactive check...');
      await this.checkAndApplyRetroactiveSandwich(employeeId, date, ctx);
    }
  }

  /**
   * Retroactively check if marking this day as absent completes a Friday-Monday absent pair
   * This ensures sandwich rule is applied even if Friday and Monday were marked absent at different times
   */
  private async checkAndApplyRetroactiveSandwich(
    employeeId: string,
    date: Date,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    const dayOfWeek = date.getDay();
    
    // If this is Friday, check if the following Monday is already absent
    if (dayOfWeek === 5) {
      const monday = new Date(date);
      monday.setUTCDate(monday.getUTCDate() + 3);
      monday.setUTCHours(0, 0, 0, 0);
      
      const mondayAttendance = await this.prisma.attendance.findUnique({
        where: { employeeId_date: { employeeId, date: monday } },
      });
      
      if (mondayAttendance && mondayAttendance.status === 'absent') {
        const hasApprovedLeave = await this.hasApprovedLeaveOnDates(employeeId, date, monday);
        if (!hasApprovedLeave) {
          await this.markWeekendAsAbsent(employeeId, date, ctx);
        }
      }
    }
    
    // If this is Monday, check if the previous Friday is already absent
    if (dayOfWeek === 1) {
      const friday = new Date(date);
      friday.setUTCDate(friday.getUTCDate() - 3);
      friday.setUTCHours(0, 0, 0, 0);
      
      const fridayAttendance = await this.prisma.attendance.findUnique({
        where: { employeeId_date: { employeeId, date: friday } },
      });
      
      if (fridayAttendance && fridayAttendance.status === 'absent') {
        const hasApprovedLeave = await this.hasApprovedLeaveOnDates(employeeId, friday, date);
        if (!hasApprovedLeave) {
          await this.markWeekendAsAbsent(employeeId, friday, ctx);
        }
      }
    }
  }

  /**
   * Check if employee has approved leave on Friday or Monday
   * Returns true if there's an approved leave covering either date
   */
  private async hasApprovedLeaveOnDates(
    employeeId: string,
    friday: Date,
    monday: Date,
  ): Promise<boolean> {
    const approvedLeaves = await this.prisma.leaveApplication.findMany({
      where: {
        employeeId,
        status: 'approved',
        fromDate: { lte: monday },
        toDate: { gte: friday },
      },
    });

    return approvedLeaves.length > 0;
  }

  /**
   * Mark Saturday and Sunday as absent (sandwich days)
   */
  private async markWeekendAsAbsent(
    employeeId: string,
    fridayDate: Date,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    const saturday = new Date(fridayDate);
    saturday.setUTCDate(saturday.getUTCDate() + 1);
    saturday.setUTCHours(0, 0, 0, 0);

    const sunday = new Date(fridayDate);
    sunday.setUTCDate(sunday.getUTCDate() + 2);
    sunday.setUTCHours(0, 0, 0, 0);

    const weekendDates = [saturday, sunday];

    for (const date of weekendDates) {
      const existing = await this.prisma.attendance.findUnique({
        where: {
          employeeId_date: {
            employeeId,
            date,
          },
        },
      });

      if (existing) {
        // Update existing record to absent
        await this.prisma.attendance.update({
          where: { id: existing.id },
          data: {
            status: 'absent',
            notes: existing.notes
              ? `${existing.notes} | Sandwich rule applied`
              : 'Sandwich rule applied - absent due to Friday and Monday absence',
            updatedById: ctx.userId,
          },
        });
      } else {
        // Create new absent record
        await this.prisma.attendance.create({
          data: {
            employeeId,
            date,
            status: 'absent',
            notes: 'Sandwich rule applied - absent due to Friday and Monday absence',
            createdById: ctx.userId,
          },
        });
      }
    }
  }

  /**
   * Remove sandwich rule from weekend if Friday or Monday is no longer absent
   */
  private async removeWeekendSandwichRule(
    employeeId: string,
    fridayDate: Date,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    const saturday = new Date(fridayDate);
    saturday.setUTCDate(saturday.getUTCDate() + 1);
    saturday.setUTCHours(0, 0, 0, 0);

    const sunday = new Date(fridayDate);
    sunday.setUTCDate(sunday.getUTCDate() + 2);
    sunday.setUTCHours(0, 0, 0, 0);

    const weekendDates = [saturday, sunday];

    for (const date of weekendDates) {
      const existing = await this.prisma.attendance.findUnique({
        where: {
          employeeId_date: {
            employeeId,
            date,
          },
        },
      });

      // Only remove if it was created by sandwich rule
      if (existing && existing.notes?.includes('Sandwich rule applied')) {
        await this.prisma.attendance.delete({
          where: { id: existing.id },
        });
      }
    }
  }

  async update(
    id: string,
    body: {
      checkIn?: string | Date | null;
      checkOut?: string | Date | null;
      status?: string;
      isRemote?: boolean;
      location?: string;
      latitude?: number;
      longitude?: number;
      notes?: string;
    },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.attendance.findUnique({
        where: { id },
        include: { employee: { select: { joiningDate: true, employeeName: true } } },
      });
      if (!existing) {
        return { status: false, message: 'Attendance not found' };
      }

      // --- Joining date validation ---
      if (existing.employee?.joiningDate) {
        const jd = new Date(existing.employee.joiningDate);
        const joiningDateStr = `${jd.getUTCFullYear()}-${String(jd.getUTCMonth() + 1).padStart(2, '0')}-${String(jd.getUTCDate()).padStart(2, '0')}`;
        
        const dateObj = new Date(existing.date);
        const targetDateStr = `${dateObj.getUTCFullYear()}-${String(dateObj.getUTCMonth() + 1).padStart(2, '0')}-${String(dateObj.getUTCDate()).padStart(2, '0')}`;

        if (targetDateStr < joiningDateStr) {
          return {
            status: false,
            message: 'Attendance cannot be modified before employee joining date.',
          };
        }
      }

      const updateData: any = {};
      if (body.checkIn !== undefined)
        updateData.checkIn = body.checkIn ? new Date(body.checkIn) : null;
      if (body.checkOut !== undefined)
        updateData.checkOut = body.checkOut ? new Date(body.checkOut) : null;
      if (body.status !== undefined) updateData.status = body.status;
      if (body.isRemote !== undefined) updateData.isRemote = body.isRemote;
      if (body.location !== undefined)
        updateData.location = body.location || null;
      if (body.latitude !== undefined)
        updateData.latitude = body.latitude ? new Decimal(body.latitude) : null;
      if (body.longitude !== undefined)
        updateData.longitude = body.longitude
          ? new Decimal(body.longitude)
          : null;
      if (body.notes !== undefined) updateData.notes = body.notes || null;
      updateData.updatedById = ctx.userId;

      // Recalculate hours if check-in or check-out changed
      if (
        (body.checkIn !== undefined || body.checkOut !== undefined) &&
        updateData.checkIn &&
        updateData.checkOut
      ) {
        const calculated = await this.calculateOvertime(
          existing.employeeId,
          existing.date,
          updateData.checkIn,
          updateData.checkOut,
        );
        updateData.workingHours = calculated.workingHours;
        updateData.overtimeHours = calculated.overtimeHours;
        updateData.lateMinutes = calculated.lateMinutes;
        updateData.earlyLeaveMinutes = calculated.earlyLeaveMinutes;
        updateData.breakDuration = calculated.breakDuration;
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
      });

      // Apply sandwich rule if status changed to absent
      if (body.status !== undefined) {
        await this.applySandwichRule(
          existing.employeeId,
          existing.date,
          body.status,
          ctx,
        );
      }

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
      });

      return {
        status: true,
        message: 'Attendance updated successfully',
        data: updated,
      };
    } catch (error: any) {
      runInBackground(
        'Update Attendance (Failure Log)',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'attendances',
          entity: 'Attendance',
          description: 'Failed to update attendance record',
          errorMessage: error?.message,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );
      return {
        status: false,
        message: error?.message || 'Failed to update attendance record',
      };
    }
  }

  async delete(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
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
      });

      if (!existing) {
        return { status: false, message: 'Attendance not found' };
      }

      await this.prisma.attendance.delete({ where: { id } });

      const response = { status: true, message: 'Attendance deleted successfully' };
      runInBackground(
        'Delete Attendance',
        this.activityLogs.log({
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
        }),
      );

      return response;
    } catch (error: any) {
      runInBackground(
        'Delete Attendance (Failure Log)',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'attendances',
          entity: 'Attendance',
          description: 'Failed to delete attendance record',
          errorMessage: error?.message,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );
      return {
        status: false,
        message: error?.message || 'Failed to delete attendance record',
      };
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
      const fs = await import('fs');
      const path = await import('path');

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        throw new Error('File not found');
      }

      // Detect file type from extension
      const fileExtension = path.extname(filePath).toLowerCase();
      let records: Array<Record<string, string>>;

      if (fileExtension === '.xlsx' || fileExtension === '.xls') {
        // Parse Excel file
        try {
          const XLSX = await import('xlsx');

          // Read file buffer
          const fileBuffer = fs.readFileSync(filePath);

          // Parse workbook from buffer
          const workbook = XLSX.read(fileBuffer, { type: 'buffer' });

          // Get first sheet
          const sheetName = workbook.SheetNames[0];
          if (!sheetName) {
            throw new Error('Excel file has no sheets');
          }

          const worksheet = workbook.Sheets[sheetName];

          // Convert to array of arrays (first row is headers)
          const excelData = XLSX.utils.sheet_to_json(worksheet, {
            header: 1,
            defval: '', // Default value for empty cells
            raw: false, // Convert all values to strings
          }) as any[][];

          // Validate we got data
          if (!excelData || excelData.length === 0) {
            throw new Error('Excel file is empty');
          }

          // Convert array of arrays to array of objects (first row is headers)
          const headers = excelData[0] as string[];
          if (!headers || headers.length === 0) {
            throw new Error('Excel file has no header row');
          }

          records = excelData
            .slice(1)
            .map((row: any[]) => {
              const obj: Record<string, string> = {};
              headers.forEach((header, index) => {
                // Include all columns - extra columns like "Total No Of Employees" will be ignored when processing
                if (header && String(header).trim().length > 0) {
                  obj[String(header).trim()] = row[index]
                    ? String(row[index]).trim()
                    : '';
                }
              });
              return obj;
            })
            .filter((row: Record<string, string>) => {
              // Filter out completely empty rows
              const hasData = Object.values(row).some(
                (val) => val && String(val).trim().length > 0,
              );
              if (!hasData) return false;

              // Check for required fields (ID and DATE) - case insensitive
              const rowKeys = Object.keys(row).map((k) =>
                k.toLowerCase().trim(),
              );
              const hasId =
                rowKeys.some((k) =>
                  ['id', 'employeeid', 'employee_id', 'employee id'].includes(
                    k,
                  ),
                ) &&
                Object.entries(row).some(([key, val]) => {
                  const lowerKey = key.toLowerCase().trim();
                  return (
                    ['id', 'employeeid', 'employee_id', 'employee id'].includes(
                      lowerKey,
                    ) &&
                    val &&
                    String(val).trim().length > 0
                  );
                });
              const hasDate =
                rowKeys.includes('date') &&
                Object.entries(row).some(([key, val]) => {
                  return (
                    key.toLowerCase().trim() === 'date' &&
                    val &&
                    String(val).trim().length > 0
                  );
                });

              return hasId && hasDate;
            });
        } catch (error: any) {
          throw new Error(`Failed to parse Excel file: ${error.message}`);
        }
      } else {
        // Parse CSV file
        const { parse } = await import('csv-parse/sync');

        // Read file and validate it's a text file
        let fileContent: string;
        try {
          fileContent = fs.readFileSync(filePath, 'utf-8');
        } catch (error: any) {
          throw new Error(
            'Invalid file format. The file appears to be corrupted or not a valid CSV file.',
          );
        }

        // Validate file content is not empty
        if (!fileContent || fileContent.trim().length === 0) {
          throw new Error('The CSV file is empty');
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
          }) as any[][];

          if (!rawData || rawData.length === 0) {
            throw new Error('CSV file has no data');
          }

          // First row contains headers
          const headers = rawData[0].map((h: any) => String(h || '').trim());
          if (headers.length === 0) {
            throw new Error('CSV file has no headers');
          }

          // Convert to array of objects, handling rows with fewer columns
          const parsedRecords: Array<Record<string, string>> = [];
          for (let i = 1; i < rawData.length; i++) {
            const row = rawData[i];
            // Skip completely empty rows
            if (
              !row ||
              row.length === 0 ||
              !row.some((cell: any) => cell && String(cell).trim().length > 0)
            ) {
              continue;
            }

            const obj: Record<string, string> = {};
            // Map row values to headers, handling cases where row has fewer columns
            headers.forEach((header, index) => {
              if (header && header.trim().length > 0) {
                obj[header] = row[index] ? String(row[index]).trim() : '';
              }
            });
            parsedRecords.push(obj);
          }

          // Filter records to only include those with required fields
          // Extra columns like "Total No Of Employees" are automatically ignored
          records = parsedRecords
            .filter((row: Record<string, string>) => {
              // Filter out completely empty rows
              const hasData = Object.values(row).some(
                (val) => val && String(val).trim().length > 0,
              );
              if (!hasData) return false;

              // Check for required fields (ID and DATE) - case insensitive
              const rowKeys = Object.keys(row).map((k) =>
                k.toLowerCase().trim(),
              );
              const hasId =
                rowKeys.some((k) =>
                  ['id', 'employeeid', 'employee_id', 'employee id'].includes(
                    k,
                  ),
                ) &&
                Object.entries(row).some(([key, val]) => {
                  const lowerKey = key.toLowerCase().trim();
                  return (
                    ['id', 'employeeid', 'employee_id', 'employee id'].includes(
                      lowerKey,
                    ) &&
                    val &&
                    String(val).trim().length > 0
                  );
                });
              const hasDate =
                rowKeys.includes('date') &&
                Object.entries(row).some(([key, val]) => {
                  return (
                    key.toLowerCase().trim() === 'date' &&
                    val &&
                    String(val).trim().length > 0
                  );
                });

              return hasId && hasDate;
            })
            .map((row: Record<string, string>) => {
              // Create a clean record - extra columns are automatically ignored when we access specific fields
              const cleanRow: Record<string, string> = {};
              Object.keys(row).forEach((key) => {
                if (row[key] !== undefined && row[key] !== null) {
                  cleanRow[key] = String(row[key]).trim();
                }
              });
              return cleanRow;
            });
        } catch (parseError: any) {
          throw new Error(`Invalid CSV format: ${parseError.message}`);
        }
      }

      // Validate we got records
      if (!records || records.length === 0) {
        throw new Error(
          'No valid records found in file. Please check the file format.',
        );
      }

      const results: any[] = [];
      const errors: Array<{ row: Record<string, string>; error: string }> = [];

      // Preload all employees (avoid N+1 queries in loop)
      const allEmps = await this.prisma.employee.findMany({
        select: { id: true, employeeId: true, joiningDate: true },
      });
      const employeeByCodeMap = new Map(
        allEmps.map((e) => [String(e.employeeId), e]),
      );

      for (const record of records) {
        try {
          // Find employee by employeeId - support multiple column name formats
          const employeeIdValue =
            record.ID ||
            record.id ||
            record.EmployeeID ||
            record.employeeId ||
            record['Employee ID'] ||
            record['ID'];

          const employee = employeeByCodeMap.get(String(employeeIdValue));

          if (!employee) {
            errors.push({
              row: record,
              error: `Employee not found: ${employeeIdValue}`,
            });
            continue;
          }

          // Parse date - support multiple column name formats
          const dateValue = record.DATE || record.Date || record.date;
          const date = new Date(dateValue);
          if (isNaN(date.getTime())) {
            errors.push({
              row: record,
              error: `Invalid date format: ${dateValue}`,
            });
            continue;
          }
          const targetDateStr = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
          date.setHours(0, 0, 0, 0);

          // Joining date guard
          if (employee.joiningDate) {
            const jd = new Date(employee.joiningDate);
            const joiningDateStr = `${jd.getUTCFullYear()}-${String(jd.getUTCMonth() + 1).padStart(2, '0')}-${String(jd.getUTCDate()).padStart(2, '0')}`;
            if (targetDateStr < joiningDateStr) {
              errors.push({
                row: record,
                error: `Date ${dateValue} is before employee joining date`,
              });
              continue;
            }
          }

          // Helper function to convert 12-hour time (HH:MM:SS AM/PM) to 24-hour format (HH:MM:SS)
          const convertTo24Hour = (timeStr: string): string => {
            if (!timeStr || !timeStr.trim()) return timeStr;

            const trimmed = timeStr.trim().toUpperCase();
            // Check if already in 24-hour format (no AM/PM)
            if (!trimmed.includes('AM') && !trimmed.includes('PM')) {
              return trimmed;
            }

            // Extract time and AM/PM - handle formats like "9:45:00 AM" or "7:43:00 PM"
            // Pattern: (hours):(minutes):(optional seconds) (AM/PM)
            const match = trimmed.match(
              /(""d{1,2}):(""d{2})(?::(""d{2}))?""s*(AM|PM)/,
            );
            if (!match) return timeStr; // Return original if can't parse

            let hours = parseInt(match[1], 10);
            const minutes = match[2];
            const seconds = match[3] || '00';
            const ampm = match[4];

            // Convert to 24-hour format
            if (ampm === 'PM' && hours !== 12) {
              hours += 12;
            } else if (ampm === 'AM' && hours === 12) {
              hours = 0;
            }

            // Format as HH:MM:SS
            return `${hours.toString().padStart(2, '0')}:${minutes}:${seconds}`;
          };

          // Get date string in YYYY-MM-DD format
          const dateStr = date.toISOString().split('T')[0];

          // Parse check-in and check-out times - support multiple column name formats
          const checkInValue =
            record.CLOCK_IN ||
            record.clock_in ||
            record.ClockIn ||
            record.CheckIn ||
            record.checkIn ||
            record['Check In'] ||
            record['CLOCK_IN'] ||
            record['Clock In'];
          const checkIn =
            checkInValue && checkInValue.trim()
              ? (() => {
                const time24 = convertTo24Hour(checkInValue);
                const dateTimeStr = `${dateStr}T${time24}`;
                const parsed = new Date(dateTimeStr);
                return isNaN(parsed.getTime()) ? undefined : parsed;
              })()
              : undefined;

          const checkOutValue =
            record.CLOCK_OUT ||
            record.clock_out ||
            record.ClockOut ||
            record.CheckOut ||
            record.checkOut ||
            record['Check Out'] ||
            record['CLOCK_OUT'] ||
            record['Clock Out'];
          const checkOut =
            checkOutValue && checkOutValue.trim()
              ? (() => {
                const time24 = convertTo24Hour(checkOutValue);
                const dateTimeStr = `${dateStr}T${time24}`;
                const parsed = new Date(dateTimeStr);
                return isNaN(parsed.getTime()) ? undefined : parsed;
              })()
              : undefined;
          // Check if this date is a public holiday
          const holiday = await this.prisma.holiday.findFirst({
            where: {
              dateFrom: { lte: date },
              dateTo: { gte: date },
              status: 'active',
            },
          });

          // Check for date-based policy assignment first
          const dateStart = new Date(date);
          dateStart.setHours(0, 0, 0, 0);
          const dateEnd = new Date(date);
          dateEnd.setHours(23, 59, 59, 999);

          const policyAssignment =
            await this.prisma.workingHoursPolicyAssignment.findFirst({
              where: {
                employeeId: employee.id,
                startDate: { lte: dateEnd },
                endDate: { gte: dateStart },
              },
              orderBy: { createdAt: 'desc' },
            });

          // Get employee's default working hours policy
          const employeeWithPolicy = await this.prisma.employee.findUnique({
            where: { id: employee.id },
            select: { workingHoursPolicyId: true },
          });

          // Use assigned policy if exists, otherwise use default
          let policy: any = null;

          if (policyAssignment?.workingHoursPolicyId) {
            policy = await this.prisma.workingHoursPolicy.findUnique({
              where: { id: policyAssignment.workingHoursPolicyId },
            });
          }

          if (!policy && employeeWithPolicy?.workingHoursPolicyId) {
            policy = await this.prisma.workingHoursPolicy.findUnique({
              where: { id: employeeWithPolicy.workingHoursPolicyId },
            });
          }

          let isWeeklyOff = false;
          if (policy) {
            // Check dayOverrides for weekly off days (dayType === 'off')
            if (
              policy.dayOverrides &&
              typeof policy.dayOverrides === 'object'
            ) {
              const dayNames = [
                'sunday',
                'monday',
                'tuesday',
                'wednesday',
                'thursday',
                'friday',
                'saturday',
              ];
              const dayName = dayNames[date.getDay()];
              const overrides = policy.dayOverrides as Record<string, any>;
              const dayConfig = overrides[dayName];
              if (dayConfig && dayConfig.dayType === 'off') {
                isWeeklyOff = true;
              }
            }
          }

          // Determine status: if it's holiday/weekly off with attendance, mark as overtime/present-on-holiday
          let status = record.Status || record.status || 'present';
          const isOnHolidayOrOff = !!holiday || isWeeklyOff;

          // Calculate working hours if check-in and check-out exist
          let workingHours: Decimal | null = null;
          let overtimeHours: Decimal | null = null;
          let lateMinutes: number | null = null;
          let earlyLeaveMinutes: number | null = null;
          let breakDuration: number | null = null;

          if (checkIn && checkOut) {
            const calculated = await this.calculateOvertime(
              employee.id,
              date,
              checkIn,
              checkOut,
            );
            workingHours = calculated.workingHours;
            lateMinutes = calculated.lateMinutes;
            earlyLeaveMinutes = calculated.earlyLeaveMinutes;
            breakDuration = calculated.breakDuration;

            // If on holiday/weekly off, all hours are overtime
            if (isOnHolidayOrOff) {
              overtimeHours = workingHours;
              status = 'present'; // They worked on their off day
            } else {
              overtimeHours = calculated.overtimeHours;
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
              isRemote:
                record.IsRemote === 'true' ||
                record.isRemote === 'true' ||
                false,
              location: record.Location || record.location || null,
              latitude:
                record.Latitude || record.latitude
                  ? new Decimal(parseFloat(record.Latitude || record.latitude))
                  : null,
              longitude:
                record.Longitude || record.longitude
                  ? new Decimal(
                    parseFloat(record.Longitude || record.longitude),
                  )
                  : null,
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
              isRemote:
                record.IsRemote === 'true' ||
                record.isRemote === 'true' ||
                false,
              location: record.Location || record.location || null,
              latitude:
                record.Latitude || record.latitude
                  ? new Decimal(parseFloat(record.Latitude || record.latitude))
                  : null,
              longitude:
                record.Longitude || record.longitude
                  ? new Decimal(
                    parseFloat(record.Longitude || record.longitude),
                  )
                  : null,
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
          });

          results.push(upserted);
        } catch (error: any) {
          errors.push({ row: record, error: error.message });
        }
      }

      runInBackground(
        'Bulk Upload Attendance',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'bulk_upload',
          module: 'attendances',
          entity: 'Attendance',
          description: `Bulk uploaded ${results.length} attendance records from CSV`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: errors.length === 0 ? 'success' : 'failure',
        }),
      );

      return {
        status: errors.length === 0,
        data: results,
        errors: errors.length > 0 ? errors : undefined,
        message:
          errors.length > 0
            ? `${results.length} records imported, ${errors.length} failed`
            : `${results.length} records imported successfully`,
      };
    } catch (error: any) {
      runInBackground(
        'Bulk Upload Attendance (Failure Log)',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'bulk_upload',
          module: 'attendances',
          entity: 'Attendance',
          description: 'Failed to bulk upload attendance records',
          errorMessage: error?.message,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );
      return {
        status: false,
        message: error?.message || 'Failed to process CSV file',
      };
    }
  }

  /**
   * Get attendance progress summary for employees
   * Calculates comprehensive attendance statistics for the given date range
   */
  async getProgressSummary(filters?: {
    employeeId?: string;
    departmentId?: string;
    subDepartmentId?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }) {
    try {
      // Build employee filter
      const employeeWhere: any = {};
      if (filters?.employeeId) {
        // Handle multiple employee IDs (comma-separated)
        const employeeIds = filters.employeeId
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean);
        if (employeeIds.length === 1) {
          employeeWhere.id = employeeIds[0];
        } else if (employeeIds.length > 1) {
          employeeWhere.id = { in: employeeIds };
        }
      }
      if (filters?.departmentId)
        employeeWhere.departmentId = filters.departmentId;
      if (filters?.subDepartmentId)
        employeeWhere.subDepartmentId = filters.subDepartmentId;

      // Get employees (Tenant data only)
      const rawEmployees = await this.prisma.employee.findMany({
        where: employeeWhere,
      });

      // Fetch Master Data
      const deptIds = [
        ...new Set(rawEmployees.map((e) => e.departmentId).filter(Boolean)),
      ] as string[];
      const subDeptIds = [
        ...new Set(rawEmployees.map((e) => e.subDepartmentId).filter(Boolean)),
      ] as string[];
      const desgIds = [
        ...new Set(rawEmployees.map((e) => e.designationId).filter(Boolean)),
      ] as string[];
      const policyIds = [
        ...new Set(
          rawEmployees.map((e) => e.workingHoursPolicyId).filter(Boolean),
        ),
      ] as string[];

      const [departments, subDepartments, designations, policies] =
        await Promise.all([
          this.prisma.department.findMany({
            where: { id: { in: deptIds } },
            select: { id: true, name: true },
          }),
          this.prisma.subDepartment.findMany({
            where: { id: { in: subDeptIds } },
            select: { id: true, name: true },
          }),
          this.prisma.designation.findMany({
            where: { id: { in: desgIds } },
            select: { id: true, name: true },
          }),
          this.prisma.workingHoursPolicy.findMany({
            where: { id: { in: policyIds } },
          }),
        ]);

      const deptMap = new Map(departments.map((d) => [d.id, d]));
      const subDeptMap = new Map(subDepartments.map((d) => [d.id, d]));
      const desgMap = new Map(designations.map((d) => [d.id, d]));
      const policyMap = new Map(policies.map((p) => [p.id, p]));

      const employees = rawEmployees.map((e) => ({
        ...e,
        department: e.departmentId ? deptMap.get(e.departmentId) : null,
        subDepartment: e.subDepartmentId
          ? subDeptMap.get(e.subDepartmentId)
          : null,
        designation: e.designationId ? desgMap.get(e.designationId) : null,
        workingHoursPolicy: e.workingHoursPolicyId
          ? policyMap.get(e.workingHoursPolicyId)
          : null,
      }));

      // Get holidays for the date range
      const dateFrom =
        filters?.dateFrom ||
        new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const dateTo = filters?.dateTo || new Date();

      // Normalize dates to start of day
      const startDate = new Date(dateFrom);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);

      // Get all holidays (they're stored normalized to year 2000, so we check if they fall in the month/day range)
      const allHolidays = await this.prisma.holiday.findMany({
        where: { status: 'active' },
      });

      // Helper to check if a date is a holiday
      const isHoliday = (date: Date): boolean => {
        const month = date.getMonth() + 1;
        const day = date.getDate();
        return allHolidays.some((holiday) => {
          const holidayFrom = new Date(holiday.dateFrom);
          const holidayTo = new Date(holiday.dateTo);
          const holidayMonthFrom = holidayFrom.getMonth() + 1;
          const holidayDayFrom = holidayFrom.getDate();
          const holidayMonthTo = holidayTo.getMonth() + 1;
          const holidayDayTo = holidayTo.getDate();

          // Check if date falls within holiday range
          if (holidayMonthFrom === holidayMonthTo) {
            return (
              month === holidayMonthFrom &&
              day >= holidayDayFrom &&
              day <= holidayDayTo
            );
          } else {
            // Holiday spans across months
            return (
              (month === holidayMonthFrom && day >= holidayDayFrom) ||
              (month === holidayMonthTo && day <= holidayDayTo)
            );
          }
        });
      };

      // Helper to check if a date is a weekend
      const isWeekend = (date: Date): boolean => {
        const day = date.getDay();
        return day === 0 || day === 6; // Sunday or Saturday
      };

      // Helper to calculate scheduled hours per day based on working hours policy
      const getScheduledHoursPerDay = (policy: any): number => {
        if (!policy) return 8; // Default 8 hours
        const start = policy.startWorkingHours || '09:00';
        const end = policy.endWorkingHours || '17:00';
        const [startHour, startMin] = start.split(':').map(Number);
        const [endHour, endMin] = end.split(':').map(Number);
        const startTime = startHour + startMin / 60;
        const endTime = endHour + endMin / 60;
        let hours = endTime - startTime;
        // Subtract break time if configured
        if (policy.startBreakTime && policy.endBreakTime) {
          const [breakStartHour, breakStartMin] = policy.startBreakTime
            .split(':')
            .map(Number);
          const [breakEndHour, breakEndMin] = policy.endBreakTime
            .split(':')
            .map(Number);
          const breakStart = breakStartHour + breakStartMin / 60;
          const breakEnd = breakEndHour + breakEndMin / 60;
          hours -= breakEnd - breakStart;
        }
        return Math.max(0, hours);
      };

      // Helper to format hours as "Xh" or "Xh Ym"
      const formatHours = (hours: number): string => {
        if (hours === 0) return '0h';
        const wholeHours = Math.floor(hours);
        const minutes = Math.round((hours - wholeHours) * 60);
        if (minutes === 0) return `${wholeHours}h`;
        return `${wholeHours}h ${minutes}m`;
      };

      const results: Array<{
        id: string;
        employeeId: string;
        employeeName: string;
        department: string;
        departmentName?: string;
        subDepartment?: string;
        subDepartmentName?: string;
        designation?: string;
        designationName?: string;
        days: number;
        scheduleDays: number;
        offDays: number;
        present: number;
        presentOnHoliday: number;
        leaves: number;
        absents: number;
        late: number;
        halfDay: number;
        shortDays: number;
        scheduleTime: string;
        actualWorkedTime: string;
        breakTime: string;
        absentTime: string;
        overtimeBeforeTime: string;
        overtimeAfterTime: string;
        shortExcessTime: string;
      }> = [];

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
        });

        // Get approved leave applications for this employee in the date range
        // Leave applications overlap if: (fromDate <= endDate) AND (toDate >= startDate)
        const leaveApplications = await this.prisma.leaveApplication.findMany({
          where: {
            employeeId: employee.id,
            status: 'approved',
            fromDate: { lte: endDate },
            toDate: { gte: startDate },
          },
        });

        // Create a map of leave applications by date
        const leaveMap = new Map<string, (typeof leaveApplications)[0]>();
        leaveApplications.forEach((leave) => {
          const leaveStart = new Date(leave.fromDate);
          leaveStart.setHours(0, 0, 0, 0);
          const leaveEnd = new Date(leave.toDate);
          leaveEnd.setHours(23, 59, 59, 999);
          const currentLeaveDate = new Date(leaveStart);
          while (currentLeaveDate <= leaveEnd) {
            const dateKey = currentLeaveDate.toISOString().split('T')[0];
            if (currentLeaveDate >= startDate && currentLeaveDate <= endDate) {
              leaveMap.set(dateKey, leave);
            }
            currentLeaveDate.setDate(currentLeaveDate.getDate() + 1);
          }
        });

        // Calculate date range statistics
        // Normalize both to start of day for accurate day counting
        const startMidnight = new Date(startDate);
        startMidnight.setHours(0, 0, 0, 0);
        const endMidnight = new Date(endDate);
        endMidnight.setHours(0, 0, 0, 0);
        const totalDays =
          Math.round(
            (endMidnight.getTime() - startMidnight.getTime()) /
            (1000 * 60 * 60 * 24),
          ) + 1;
        let scheduleDays = 0;
        let offDays = 0;
        let present = 0;
        let presentOnHoliday = 0;
        let leaves = 0;
        let absents = 0;
        let late = 0;
        let halfDay = 0;
        let shortDays = 0;
        let totalScheduleTime = 0;
        let totalActualWorkedTime = 0;
        let totalBreakTime = 0;
        let totalOvertimeAfter = 0;

        // Create a map of attendance by date for quick lookup
        // Normalize date to YYYY-MM-DD format for comparison
        const attendanceMap = new Map<string, (typeof attendances)[0]>();
        attendances.forEach((att) => {
          const attDate = new Date(att.date);
          attDate.setHours(0, 0, 0, 0);
          const dateKey = attDate.toISOString().split('T')[0];
          attendanceMap.set(dateKey, att);
        });

        // Iterate through each day in the range
        const currentDate = new Date(startDate);
        while (currentDate <= endDate) {
          const dateKey = currentDate.toISOString().split('T')[0];
          const attendance = attendanceMap.get(dateKey);
          const leaveApplication = leaveMap.get(dateKey);
          const isHolidayDate = isHoliday(currentDate);
          const isWeekendDate = isWeekend(currentDate);

          // Check if this is a scheduled working day (not weekend and not holiday)
          if (!isWeekendDate && !isHolidayDate) {
            scheduleDays++;
            const scheduledHours = getScheduledHoursPerDay(
              employee.workingHoursPolicy,
            );
            totalScheduleTime += scheduledHours;

            // Check for approved leave application FIRST
            // This ensures we count the leave even if they are marked Present
            let isApprovedLeave = false;
            const isPresentOnLeave =
              attendance &&
              (attendance.status === 'present' ||
                attendance.status === 'late' ||
                attendance.status === 'half-day' ||
                attendance.status === 'short-day');

            if (leaveApplication) {
              leaves++;
              isApprovedLeave = true;

              // Only deduct from schedule if they actully took the leave (i.e., were not present)
              if (!isPresentOnLeave) {
                totalScheduleTime -= scheduledHours;
                scheduleDays--; // Don't count leave days as scheduled
              }
            }

            if (attendance) {
              // Handle different attendance statuses according to schema
              const status = attendance.status.toLowerCase();

              if (status === 'present') {
                present++;
                // Count late if has lateMinutes > 0
                if (attendance.lateMinutes && attendance.lateMinutes > 0) {
                  late++;
                }
              } else if (status === 'late') {
                present++; // Late is still considered present
                late++;
              } else if (status === 'absent') {
                if (!isApprovedLeave) {
                  absents++;
                }
              } else if (status === 'half-day' || status === 'halfday') {
                halfDay++;
                present++; // Half day is partially present
                // Count late if applicable
                if (attendance.lateMinutes && attendance.lateMinutes > 0) {
                  late++;
                }
              } else if (status === 'short-day' || status === 'shortday') {
                shortDays++;
                present++; // Short day is still present
                // Count late if applicable
                if (attendance.lateMinutes && attendance.lateMinutes > 0) {
                  late++;
                }
              } else if (status === 'on-leave' || status === 'onleave') {
                // Only count if not already counted as approved leave
                if (!isApprovedLeave) {
                  leaves++;
                  // Adjust scheduled time for leave days
                  totalScheduleTime -= scheduledHours;
                  scheduleDays--; // Don't count leave days as scheduled
                }
              } else if (status === 'holiday') {
                // Holiday status - treat as off day but check if present
                offDays++;
                if (attendance.checkIn || attendance.checkOut) {
                  presentOnHoliday++;
                }

                // Revert the schedule addition at the top if it turns out to be a holiday status
                // But wait, if it was !isHolidayDate, how can status be holiday?
                // Edge case: Master list says it's workday, but attendance says holiday (override?)
                // For now, let's treat it consistent with logic above: remove from schedule
                scheduleDays--;
                totalScheduleTime -= scheduledHours;
                continue;
              }

              // Sum working hours (only if checkIn and checkOut exist AND not absent)
              // We explicitly ignore working hours for 'absent' status to prevent calculation errors
              if (attendance.workingHours && status !== 'absent') {
                totalActualWorkedTime += Number(attendance.workingHours);
              }

              // Sum break time
              if (attendance.breakDuration) {
                totalBreakTime += attendance.breakDuration / 60; // Convert minutes to hours
              }

              // Sum overtime
              if (attendance.overtimeHours) {
                totalOvertimeAfter += Number(attendance.overtimeHours);
              }
            } else {
              // No attendance record - check if absent (unless on leave)
              if (!isApprovedLeave) {
                absents++;
              }
            }
          } else {
            // Weekend or holiday
            offDays++;

            // Check if present on holiday (holidays can have attendance if employee worked)
            if (isHolidayDate && attendance) {
              if (
                attendance.status === 'present' ||
                attendance.checkIn ||
                attendance.checkOut
              ) {
                presentOnHoliday++;
              }
            }
          }

          // Move to next day
          currentDate.setDate(currentDate.getDate() + 1);
        }

        // Calculate absent time (absent days * scheduled hours per day)
        const scheduledHoursPerDay = getScheduledHoursPerDay(
          employee.workingHoursPolicy,
        );
        const absentTime = absents * scheduledHoursPerDay;

        // Calculate short/excess time (difference between scheduled and actual)
        const shortExcessTime = totalScheduleTime - totalActualWorkedTime;

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
        });
      }

      return { status: true, data: results };
    } catch (error: any) {
      return {
        status: false,
        message: error?.message || 'Failed to get attendance progress summary',
      };
    }
  }

  /**
   * Apply sandwich rules to all Friday-Monday absent pairs
   * This is a utility method to retroactively fix missing sandwich absences
   */
  async applySandwichRulesToAll(params: {
    dateFrom?: Date;
    dateTo?: Date;
    employeeId?: string;
    userId?: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    try {
      const { dateFrom, dateTo, employeeId, userId, ipAddress, userAgent } = params;

      // Build where clause for finding Friday absences
      const whereClause: any = {
        status: 'absent',
      };

      if (employeeId) {
        whereClause.employeeId = employeeId;
      }

      if (dateFrom || dateTo) {
        whereClause.date = {};
        if (dateFrom) whereClause.date.gte = dateFrom;
        if (dateTo) whereClause.date.lte = dateTo;
      }

      // Find all Friday absences
      const fridayAbsences = await this.prisma.attendance.findMany({
        where: whereClause,
      });

      let appliedCount = 0;
      let skippedCount = 0;

      for (const friday of fridayAbsences) {
        const dayOfWeek = friday.date.getDay();
        
        // Only process Fridays
        if (dayOfWeek !== 5) continue;

        // Check if Monday is also absent
        const monday = new Date(friday.date);
        monday.setDate(monday.getDate() + 3);
        monday.setHours(0, 0, 0, 0);

        const mondayAttendance = await this.prisma.attendance.findUnique({
          where: {
            employeeId_date: {
              employeeId: friday.employeeId,
              date: monday,
            },
          },
        });

        if (!mondayAttendance || mondayAttendance.status !== 'absent') {
          skippedCount++;
          continue;
        }

        // Check for approved leaves
        const hasApprovedLeave = await this.hasApprovedLeaveOnDates(
          friday.employeeId,
          friday.date,
          monday,
        );

        if (hasApprovedLeave) {
          skippedCount++;
          continue;
        }

        // Apply sandwich rule
        await this.markWeekendAsAbsent(friday.employeeId, friday.date, {
          userId,
          ipAddress,
          userAgent,
        });

        appliedCount++;
      }

      return {
        status: true,
        message: `Sandwich rules applied successfully`,
        data: {
          appliedCount,
          skippedCount,
          totalProcessed: fridayAbsences.length,
        },
      };
    } catch (error: any) {
      return {
        status: false,
        message: error?.message || 'Failed to apply sandwich rules',
      };
    }
  }
}
