import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ActivityLogsService } from '../activity-logs/activity-logs.service'

@Injectable()
export class EobiService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) { }

  async list() {
    const items = await this.prisma.eOBI.findMany({ orderBy: { createdAt: 'desc' } })
    return { status: true, data: items }
  }

  async get(id: string) {
    const item = await this.prisma.eOBI.findUnique({ where: { id } })
    if (!item) return { status: false, message: 'EOBI not found' }
    return { status: true, data: item }
  }

  async create(
    body: { name: string; amount: number; yearMonth: string; status?: string },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const created = await this.prisma.eOBI.create({
        data: {
          name: body.name,
          amount: body.amount as any,
          yearMonth: body.yearMonth,
          status: body.status ?? 'active',
          createdById: ctx.userId,
        }
      })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'eobis',
        entity: 'EOBI',
        entityId: created.id,
        description: `Created EOBI ${created.name}`,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })
      return { status: true, data: created, message: 'Created successfully' }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'eobis',
        entity: 'EOBI',
        description: 'Failed to create EOBI',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to create EOBI' }
    }
  }

  async createBulk(
    items: { name: string; amount: number; yearMonth: string; status?: string }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length) return { status: false, message: 'No items to create' }
    try {
      const res = await this.prisma.eOBI.createMany({
        data: items.map((i) => ({
          name: i.name,
          amount: i.amount as any,
          yearMonth: i.yearMonth,
          status: i.status ?? 'active',
          createdById: ctx.userId,
        })),
        skipDuplicates: true,
      })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'eobis',
        entity: 'EOBI',
        description: `Bulk created ${res.count} EOBIs`,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })
      return { status: true, message: 'Created successfully' }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'eobis',
        entity: 'EOBI',
        description: 'Failed bulk create EOBIs',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to create EOBIs' }
    }
  }

  async update(
    id: string,
    body: { name?: string; amount?: number; yearMonth?: string; status?: string },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.eOBI.findUnique({ where: { id } })
      if (!existing) return { status: false, message: 'EOBI not found' }
      const updated = await this.prisma.eOBI.update({
        where: { id },
        data: {
          name: body.name ?? existing.name,
          amount: (body.amount ?? (existing as any).amount) as any,
          yearMonth: body.yearMonth ?? existing.yearMonth,
          status: body.status ?? existing.status,
        },
      })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'eobis',
        entity: 'EOBI',
        entityId: id,
        description: `Updated EOBI ${updated.name}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })
      return { status: true, data: updated, message: 'Updated successfully' }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'eobis',
        entity: 'EOBI',
        entityId: id,
        description: 'Failed to update EOBI',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to update EOBI' }
    }
  }

  async remove(id: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.eOBI.findUnique({ where: { id } })
      if (!existing) return { status: false, message: 'EOBI not found' }
      await this.prisma.eOBI.delete({ where: { id } })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'eobis',
        entity: 'EOBI',
        entityId: id,
        description: `Deleted EOBI ${existing.name}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })
      return { status: true, message: 'Deleted successfully' }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'eobis',
        entity: 'EOBI',
        entityId: id,
        description: 'Failed to delete EOBI',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to delete EOBI' }
    }
  }

  async removeBulk(ids: string[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!ids?.length) return { status: false, message: 'No items to delete' }
    try {
      await this.prisma.eOBI.deleteMany({ where: { id: { in: ids } } })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'eobis',
        entity: 'EOBI',
        description: `Bulk deleted ${ids.length} EOBIs`,
        oldValues: JSON.stringify(ids),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })
      return { status: true, message: 'Deleted successfully' }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'eobis',
        entity: 'EOBI',
        description: 'Failed bulk delete EOBIs',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to delete EOBIs' }
    }
  }

  async updateBulk(
    items: { id: string; name: string; amount: number; yearMonth: string; status?: string }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length) return { status: false, message: 'No items to update' }
    try {
      for (const i of items) {
        await this.prisma.eOBI.update({
          where: { id: i.id },
          data: {
            name: i.name,
            amount: i.amount as any,
            yearMonth: i.yearMonth,
            status: i.status ?? 'active',
          },
        })
      }
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'eobis',
        entity: 'EOBI',
        description: `Bulk updated ${items.length} EOBIs`,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })
      return { status: true, message: 'Updated successfully' }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'eobis',
        entity: 'EOBI',
        description: 'Failed bulk update EOBIs',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to update EOBIs' }
    }
  }
}
