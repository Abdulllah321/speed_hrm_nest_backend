import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { Holiday } from '@prisma/client'

@Injectable()
export class HolidayService {
  constructor(private prisma: PrismaService) {}

  async list() {
    const items = await this.prisma.holiday.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return { status: true, data: items }
  }

  async get(id: string) {
    const item = await this.prisma.holiday.findUnique({ where: { id } })
    if (!item) return { status: false, message: 'Holiday not found' }
    return { status: true, data: item }
  }

  async create(
    body: { name: string; dateFrom: string; dateTo: string; status?: string },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string }
  ) {
    try {
      if (!body.dateFrom || !body.dateTo) {
        return { status: false, message: 'Both start date and end date are required' }
      }

      const dateFrom = new Date(body.dateFrom)
      const dateTo = new Date(body.dateTo)

      if (dateFrom > dateTo) {
        return { status: false, message: 'Start date must be before or equal to end date' }
      }

      const created = await this.prisma.holiday.create({
        data: {
          name: body.name,
          dateFrom,
          dateTo,
          status: body.status ?? 'active',
          createdById: ctx.userId,
        },
      })

      await this.prisma.activityLog.create({
        data: {
          userId: ctx.userId,
          action: 'create',
          module: 'holidays',
          entity: 'Holiday',
          entityId: created.id,
          description: `Created holiday ${created.name} from ${dateFrom.toLocaleDateString()} to ${dateTo.toLocaleDateString()}`,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        },
      })

      return { status: true, data: created }
    } catch (error: any) {
      await this.prisma.activityLog.create({
        data: {
          userId: ctx.userId,
          action: 'create',
          module: 'holidays',
          entity: 'Holiday',
          description: 'Failed to create holiday',
          errorMessage: error?.message,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        },
      })

      if (error?.code === 'P2002') {
        return { status: false, message: 'A holiday with this name already exists' }
      }

      return { status: false, message: 'Failed to create holiday' }
    }
  }

  async update(
    id: string,
    body: { name?: string; dateFrom?: string; dateTo?: string; status?: string },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string }
  ) {
    try {
      const existing = await this.prisma.holiday.findUnique({ where: { id } })
      if (!existing) {
        return { status: false, message: 'Holiday not found' }
      }

      const updateData: any = {}
      if (body.name !== undefined) updateData.name = body.name
      if (body.status !== undefined) updateData.status = body.status

      if (body.dateFrom !== undefined) {
        updateData.dateFrom = new Date(body.dateFrom)
      }
      if (body.dateTo !== undefined) {
        updateData.dateTo = new Date(body.dateTo)
      }

      // Validate date range if both dates are being updated
      if (body.dateFrom !== undefined && body.dateTo !== undefined) {
        const dateFrom = new Date(body.dateFrom)
        const dateTo = new Date(body.dateTo)
        if (dateFrom > dateTo) {
          return { status: false, message: 'Start date must be before or equal to end date' }
        }
      } else if (body.dateFrom !== undefined) {
        const dateFrom = new Date(body.dateFrom)
        if (dateFrom > existing.dateTo) {
          return { status: false, message: 'Start date must be before or equal to end date' }
        }
      } else if (body.dateTo !== undefined) {
        const dateTo = new Date(body.dateTo)
        if (existing.dateFrom > dateTo) {
          return { status: false, message: 'Start date must be before or equal to end date' }
        }
      }

      const updated = await this.prisma.holiday.update({
        where: { id },
        data: updateData,
      })

      await this.prisma.activityLog.create({
        data: {
          userId: ctx.userId,
          action: 'update',
          module: 'holidays',
          entity: 'Holiday',
          entityId: id,
          description: `Updated holiday ${updated.name}`,
          oldValues: JSON.stringify(existing),
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        },
      })

      return { status: true, data: updated }
    } catch (error: any) {
      await this.prisma.activityLog.create({
        data: {
          userId: ctx.userId,
          action: 'update',
          module: 'holidays',
          entity: 'Holiday',
          entityId: id,
          description: 'Failed to update holiday',
          errorMessage: error?.message,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        },
      })

      if (error?.code === 'P2002') {
        return { status: false, message: 'A holiday with this name already exists' }
      }

      return { status: false, message: 'Failed to update holiday' }
    }
  }

  async remove(id: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.holiday.findUnique({ where: { id } })
      if (!existing) {
        return { status: false, message: 'Holiday not found' }
      }

      const removed = await this.prisma.holiday.delete({ where: { id } })

      await this.prisma.activityLog.create({
        data: {
          userId: ctx.userId,
          action: 'delete',
          module: 'holidays',
          entity: 'Holiday',
          entityId: id,
          description: `Deleted holiday ${existing.name}`,
          oldValues: JSON.stringify(existing),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        },
      })

      return { status: true, data: removed }
    } catch (error: any) {
      await this.prisma.activityLog.create({
        data: {
          userId: ctx.userId,
          action: 'delete',
          module: 'holidays',
          entity: 'Holiday',
          entityId: id,
          description: 'Failed to delete holiday',
          errorMessage: error?.message,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        },
      })

      return { status: false, message: 'Failed to delete holiday' }
    }
  }

  async createBulk(
    items: { name: string; dateFrom: string; dateTo: string; status?: string }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string }
  ) {
    if (!items?.length) return { status: false, message: 'No holidays to create' }

    try {
      const createdHolidays: Holiday[] = []

      for (const item of items) {
        if (!item.dateFrom || !item.dateTo) {
          continue
        }

        const dateFrom = new Date(item.dateFrom)
        const dateTo = new Date(item.dateTo)

        if (dateFrom > dateTo) {
          continue
        }

        const holiday = await this.prisma.holiday.create({
          data: {
            name: item.name,
            dateFrom,
            dateTo,
            status: item.status ?? 'active',
            createdById: ctx.userId,
          },
        })

        createdHolidays.push(holiday)
      }

      await this.prisma.activityLog.create({
        data: {
          userId: ctx.userId,
          action: 'create',
          module: 'holidays',
          entity: 'Holiday',
          description: `Bulk created holidays (${createdHolidays.length})`,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        },
      })

      return { status: true, message: 'Holidays created', data: createdHolidays }
    } catch (error: any) {
      await this.prisma.activityLog.create({
        data: {
          userId: ctx.userId,
          action: 'create',
          module: 'holidays',
          entity: 'Holiday',
          description: 'Failed to bulk create holidays',
          errorMessage: error?.message,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        },
      })

      return { status: false, message: 'Failed to create holidays' }
    }
  }

  async updateBulk(
    items: { id: string; name?: string; dateFrom?: string; dateTo?: string; status?: string }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string }
  ) {
    if (!items?.length) return { status: false, message: 'No holidays to update' }

    try {
      for (const item of items) {
        const existing = await this.prisma.holiday.findUnique({ where: { id: item.id } })
        if (!existing) continue

        const updateData: any = {}
        if (item.name !== undefined) updateData.name = item.name
        if (item.status !== undefined) updateData.status = item.status

        if (item.dateFrom !== undefined) {
          updateData.dateFrom = new Date(item.dateFrom)
        }
        if (item.dateTo !== undefined) {
          updateData.dateTo = new Date(item.dateTo)
        }

        // Validate date range
        const dateFrom = updateData.dateFrom || existing.dateFrom
        const dateTo = updateData.dateTo || existing.dateTo
        if (dateFrom > dateTo) {
          continue
        }

        await this.prisma.holiday.update({
          where: { id: item.id },
          data: updateData,
        })
      }

      await this.prisma.activityLog.create({
        data: {
          userId: ctx.userId,
          action: 'update',
          module: 'holidays',
          entity: 'Holiday',
          description: `Bulk updated holidays (${items.length})`,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        },
      })

      return { status: true, message: 'Holidays updated' }
    } catch (error: any) {
      await this.prisma.activityLog.create({
        data: {
          userId: ctx.userId,
          action: 'update',
          module: 'holidays',
          entity: 'Holiday',
          description: 'Failed to bulk update holidays',
          errorMessage: error?.message,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        },
      })

      return { status: false, message: 'Failed to update holidays' }
    }
  }

  async removeBulk(ids: string[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!ids?.length) return { status: false, message: 'No holidays to delete' }

    try {
      const existing = await this.prisma.holiday.findMany({ where: { id: { in: ids } } })
      const result = await this.prisma.holiday.deleteMany({ where: { id: { in: ids } } })

      await this.prisma.activityLog.create({
        data: {
          userId: ctx.userId,
          action: 'delete',
          module: 'holidays',
          entity: 'Holiday',
          description: `Bulk deleted holidays (${result.count})`,
          oldValues: JSON.stringify(existing),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        },
      })

      return { status: true, message: 'Holidays deleted', data: result }
    } catch (error: any) {
      await this.prisma.activityLog.create({
        data: {
          userId: ctx.userId,
          action: 'delete',
          module: 'holidays',
          entity: 'Holiday',
          description: 'Failed to bulk delete holidays',
          errorMessage: error?.message,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        },
      })

      return { status: false, message: 'Failed to delete holidays' }
    }
  }
}
