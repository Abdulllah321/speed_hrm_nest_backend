import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ActivityLogsService } from '../activity-logs/activity-logs.service'

@Injectable()
export class WorkingHoursPolicyService {
  constructor(
    private prisma: PrismaService,
    private activityLogsService: ActivityLogsService
  ) {}

  async list() {
    const items = await this.prisma.workingHoursPolicy.findMany({ orderBy: { createdAt: 'desc' } })
    return { status: true, data: items }
  }

  async get(id: string) {
    const item = await this.prisma.workingHoursPolicy.findUnique({ where: { id } })
    if (!item) return { status: false, message: 'Policy not found' }
    return { status: true, data: item }
  }

  async create(body: any, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      // If setting as default, unset all other policies first
      if (body.isDefault) {
        await this.prisma.workingHoursPolicy.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        })
      }

      const created = await this.prisma.workingHoursPolicy.create({
        data: {
          name: body.name,
          startWorkingHours: body.startWorkingHours,
          endWorkingHours: body.endWorkingHours,
          shortDayMins: body.shortDayMins ?? null,
          startBreakTime: body.startBreakTime ?? null,
          endBreakTime: body.endBreakTime ?? null,
          halfDayStartTime: body.halfDayStartTime ?? null,
          lateStartTime: body.lateStartTime ?? null,
          lateDeductionType: body.lateDeductionType ?? null,
          applyDeductionAfterLates: body.applyDeductionAfterLates ?? null,
          lateDeductionPercent: body.lateDeductionPercent ?? null,
          halfDayDeductionType: body.halfDayDeductionType ?? null,
          applyDeductionAfterHalfDays: body.applyDeductionAfterHalfDays ?? null,
          halfDayDeductionAmount: body.halfDayDeductionAmount ?? null,
          shortDayDeductionType: body.shortDayDeductionType ?? null,
          applyDeductionAfterShortDays: body.applyDeductionAfterShortDays ?? null,
          shortDayDeductionAmount: body.shortDayDeductionAmount ?? null,
          overtimeRate: body.overtimeRate ?? null,
          gazzetedOvertimeRate: body.gazzetedOvertimeRate ?? null,
          dayOverrides: body.dayOverrides ?? null,
          status: body.status ?? 'active',
          isDefault: body.isDefault ?? false,
          createdById: ctx.userId,
        },
      })

      await this.activityLogsService.log({
          userId: ctx.userId,
          action: 'create',
        module: 'working_hours_policies',
          entity: 'WorkingHoursPolicy',
          entityId: created.id,
          description: `Created working hours policy ${created.name}`,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })

      return { status: true, data: created }
    } catch (error: any) {
      await this.activityLogsService.log({
          userId: ctx.userId,
          action: 'create',
        module: 'working_hours_policies',
          entity: 'WorkingHoursPolicy',
          description: 'Failed to create working hours policy',
          errorMessage: error?.message,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to create working hours policy' }
    }
  }

  async update(id: string, body: any, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.workingHoursPolicy.findUnique({ where: { id } })
      if (!existing) {
        return { status: false, message: 'Working hours policy not found' }
      }

      // If setting as default, unset all other policies first
      if (body.isDefault === true && !existing.isDefault) {
        await this.prisma.workingHoursPolicy.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        })
      }

      const updated = await this.prisma.workingHoursPolicy.update({
        where: { id },
        data: {
          name: body.name ?? existing.name,
          startWorkingHours: body.startWorkingHours ?? existing.startWorkingHours,
          endWorkingHours: body.endWorkingHours ?? existing.endWorkingHours,
          shortDayMins: body.shortDayMins !== undefined ? body.shortDayMins : existing.shortDayMins,
          startBreakTime: body.startBreakTime !== undefined ? body.startBreakTime : existing.startBreakTime,
          endBreakTime: body.endBreakTime !== undefined ? body.endBreakTime : existing.endBreakTime,
          halfDayStartTime: body.halfDayStartTime !== undefined ? body.halfDayStartTime : existing.halfDayStartTime,
          lateStartTime: body.lateStartTime !== undefined ? body.lateStartTime : existing.lateStartTime,
          lateDeductionType: body.lateDeductionType !== undefined ? body.lateDeductionType : existing.lateDeductionType,
          applyDeductionAfterLates: body.applyDeductionAfterLates !== undefined ? body.applyDeductionAfterLates : existing.applyDeductionAfterLates,
          lateDeductionPercent: body.lateDeductionPercent !== undefined ? body.lateDeductionPercent : existing.lateDeductionPercent,
          halfDayDeductionType: body.halfDayDeductionType !== undefined ? body.halfDayDeductionType : existing.halfDayDeductionType,
          applyDeductionAfterHalfDays: body.applyDeductionAfterHalfDays !== undefined ? body.applyDeductionAfterHalfDays : existing.applyDeductionAfterHalfDays,
          halfDayDeductionAmount: body.halfDayDeductionAmount !== undefined ? body.halfDayDeductionAmount : existing.halfDayDeductionAmount,
          shortDayDeductionType: body.shortDayDeductionType !== undefined ? body.shortDayDeductionType : existing.shortDayDeductionType,
          applyDeductionAfterShortDays: body.applyDeductionAfterShortDays !== undefined ? body.applyDeductionAfterShortDays : existing.applyDeductionAfterShortDays,
          shortDayDeductionAmount: body.shortDayDeductionAmount !== undefined ? body.shortDayDeductionAmount : existing.shortDayDeductionAmount,
          overtimeRate: body.overtimeRate !== undefined ? body.overtimeRate : existing.overtimeRate,
          gazzetedOvertimeRate: body.gazzetedOvertimeRate !== undefined ? body.gazzetedOvertimeRate : existing.gazzetedOvertimeRate,
          dayOverrides: body.dayOverrides !== undefined ? body.dayOverrides : existing.dayOverrides,
          status: body.status ?? existing.status,
          isDefault: body.isDefault !== undefined ? body.isDefault : existing.isDefault,
        },
      })

      await this.activityLogsService.log({
          userId: ctx.userId,
          action: 'update',
        module: 'working_hours_policies',
          entity: 'WorkingHoursPolicy',
          entityId: id,
          description: `Updated working hours policy ${updated.name}`,
          oldValues: JSON.stringify(existing),
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })

      return { status: true, data: updated }
    } catch (error: any) {
      await this.activityLogsService.log({
          userId: ctx.userId,
          action: 'update',
        module: 'working_hours_policies',
          entity: 'WorkingHoursPolicy',
          entityId: id,
          description: 'Failed to update working hours policy',
          errorMessage: error?.message,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to update working hours policy' }
    }
  }

  async remove(id: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.workingHoursPolicy.findUnique({ where: { id } })
      const removed = await this.prisma.workingHoursPolicy.delete({ where: { id } })

      await this.activityLogsService.log({
          userId: ctx.userId,
          action: 'delete',
        module: 'working_hours_policies',
          entity: 'WorkingHoursPolicy',
          entityId: id,
          description: `Deleted working hours policy ${existing?.name}`,
          oldValues: JSON.stringify(existing),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })

      return { status: true, data: removed }
    } catch (error: any) {
      await this.activityLogsService.log({
          userId: ctx.userId,
          action: 'delete',
        module: 'working_hours_policies',
          entity: 'WorkingHoursPolicy',
          entityId: id,
          description: 'Failed to delete working hours policy',
          errorMessage: error?.message,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to delete working hours policy' }
    }
  }

  async setAsDefault(id: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.workingHoursPolicy.findUnique({ where: { id } })
      if (!existing) {
        return { status: false, message: 'Working hours policy not found' }
      }

      // Unset all other policies as default
      await this.prisma.workingHoursPolicy.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      })

      // Set this policy as default
      const updated = await this.prisma.workingHoursPolicy.update({
        where: { id },
        data: { isDefault: true },
      })

      await this.activityLogsService.log({
        userId: ctx.userId,
        action: 'update',
        module: 'working_hours_policies',
        entity: 'WorkingHoursPolicy',
        entityId: id,
        description: `Set working hours policy ${updated.name} as default`,
        oldValues: JSON.stringify({ isDefault: existing.isDefault }),
        newValues: JSON.stringify({ isDefault: true }),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })

      return { status: true, data: updated }
    } catch (error: any) {
      await this.activityLogsService.log({
        userId: ctx.userId,
        action: 'update',
        module: 'working_hours_policies',
        entity: 'WorkingHoursPolicy',
        entityId: id,
        description: 'Failed to set working hours policy as default',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: error?.message || 'Failed to set working hours policy as default' }
    }
  }
}
