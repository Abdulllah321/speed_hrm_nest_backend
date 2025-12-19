import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ActivityLogsService } from '../activity-logs/activity-logs.service'

@Injectable()
export class AllowanceHeadService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list() {
    const items = await this.prisma.allowanceHead.findMany({ orderBy: { createdAt: 'desc' } })
    return { status: true, data: items }
  }

  async get(id: string) {
    const item = await this.prisma.allowanceHead.findUnique({ where: { id } })
    if (!item) return { status: false, message: 'Allowance head not found' }
    return { status: true, data: item }
  }

  async create(name: string, status: string | undefined, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const created = await this.prisma.allowanceHead.create({ 
        data: { name, status: status || 'active', createdById: ctx.userId } 
      })
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'allowance-heads',
          entity: 'AllowanceHead',
          entityId: created.id,
          description: `Created allowance head ${name}`,
          newValues: JSON.stringify({ name, status: status || 'active' }),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })
      return { status: true, data: created }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'allowance-heads',
          entity: 'AllowanceHead',
          description: 'Failed to create allowance head',
          errorMessage: error?.message,
          newValues: JSON.stringify({ name, status: status || 'active' }),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to create allowance head' }
    }
  }

  async createBulk(items: { name: string; status?: string }[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!items?.length) return { status: false, message: 'No items to create' }
    try {
      const result = await this.prisma.allowanceHead.createMany({
        data: items.map((item) => ({ 
          name: item.name, 
          status: item.status || 'active', 
          createdById: ctx.userId 
        })),
        skipDuplicates: true,
      })
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'allowance-heads',
          entity: 'AllowanceHead',
          description: `Bulk created allowance heads (${result.count})`,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })
      return { status: true, message: 'Allowance heads created' }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'allowance-heads',
          entity: 'AllowanceHead',
          description: 'Failed bulk create allowance heads',
          errorMessage: error?.message,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to create allowance heads' }
    }
  }

  async update(id: string, name: string, status: string | undefined, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.allowanceHead.findUnique({ where: { id } })
      const updateData: { name: string; status?: string } = { name }
      if (status !== undefined) updateData.status = status
      const updated = await this.prisma.allowanceHead.update({ where: { id }, data: updateData })
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'allowance-heads',
          entity: 'AllowanceHead',
          entityId: id,
          description: `Updated allowance head ${name}`,
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
          module: 'allowance-heads',
          entity: 'AllowanceHead',
          entityId: id,
          description: 'Failed to update allowance head',
          errorMessage: error?.message,
          newValues: JSON.stringify({ name, status }),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to update allowance head' }
    }
  }

  async updateBulk(items: { id: string; name: string; status?: string }[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!items?.length) return { status: false, message: 'No items to update' }
    try {
      for (const item of items) {
        const updateData: { name: string; status?: string } = { name: item.name }
        if (item.status !== undefined) updateData.status = item.status
        await this.prisma.allowanceHead.update({ where: { id: item.id }, data: updateData })
      }
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'allowance-heads',
          entity: 'AllowanceHead',
          description: `Bulk updated allowance heads (${items.length})`,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })
      return { status: true, message: 'Allowance heads updated' }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'allowance-heads',
          entity: 'AllowanceHead',
          description: 'Failed bulk update allowance heads',
          errorMessage: error?.message,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to update allowance heads' }
    }
  }

  async remove(id: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.allowanceHead.findUnique({ where: { id } })
      const removed = await this.prisma.allowanceHead.delete({ where: { id } })
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'allowance-heads',
          entity: 'AllowanceHead',
          entityId: id,
          description: `Deleted allowance head ${existing?.name}`,
          oldValues: JSON.stringify(existing),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })
      return { status: true, data: removed }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'allowance-heads',
          entity: 'AllowanceHead',
          entityId: id,
          description: 'Failed to delete allowance head',
          errorMessage: error?.message,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to delete allowance head' }
    }
  }

  async removeBulk(ids: string[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!ids?.length) return { status: false, message: 'No items to delete' }
    try {
      const removed = await this.prisma.allowanceHead.deleteMany({ where: { id: { in: ids } } })
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'allowance-heads',
          entity: 'AllowanceHead',
          description: `Bulk deleted allowance heads (${removed.count})`,
          oldValues: JSON.stringify(ids),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })
      return { status: true, message: 'Allowance heads deleted' }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'allowance-heads',
          entity: 'AllowanceHead',
          description: 'Failed bulk delete allowance heads',
          errorMessage: error?.message,
          oldValues: JSON.stringify(ids),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to delete allowance heads' }
    }
  }
}

