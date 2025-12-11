import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ActivityLogsService } from '../activity-logs/activity-logs.service'

@Injectable()
export class DesignationService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list() {
    const items = await this.prisma.designation.findMany({ orderBy: { createdAt: 'desc' } })
    return { status: true, data: items }
  }

  async get(id: string) {
    const item = await this.prisma.designation.findUnique({ where: { id } })
    if (!item) return { status: false, message: 'Designation not found' }
    return { status: true, data: item }
  }

  async create(name: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const created = await this.prisma.designation.create({ data: { name, status: 'active', createdById: ctx.userId } })
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'designations',
          entity: 'Designation',
          entityId: created.id,
          description: `Created designation ${name}`,
          newValues: JSON.stringify({ name }),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })
      return { status: true, data: created }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'designations',
          entity: 'Designation',
          description: 'Failed to create designation',
          errorMessage: error?.message,
          newValues: JSON.stringify({ name }),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to create designation' }
    }
  }

  async createBulk(names: string[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!names?.length) return { status: false, message: 'No items to create' }
    try {
      const result = await this.prisma.designation.createMany({
        data: names.map((n) => ({ name: n, status: 'active', createdById: ctx.userId })),
        skipDuplicates: true,
      })
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'designations',
          entity: 'Designation',
          description: `Bulk created designations (${result.count})`,
          newValues: JSON.stringify(names),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })
      return { status: true, message: 'Designations created', data: result }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'designations',
          entity: 'Designation',
          description: 'Failed bulk create designations',
          errorMessage: error?.message,
          newValues: JSON.stringify(names),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to create designations' }
    }
  }

  async update(id: string, name: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.designation.findUnique({ where: { id } })
      const updated = await this.prisma.designation.update({ where: { id }, data: { name } })
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'designations',
          entity: 'Designation',
          entityId: id,
          description: `Updated designation ${name}`,
          oldValues: JSON.stringify(existing),
          newValues: JSON.stringify({ name }),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })
      return { status: true, data: updated }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'designations',
          entity: 'Designation',
          entityId: id,
          description: 'Failed to update designation',
          errorMessage: error?.message,
          newValues: JSON.stringify({ name }),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to update designation' }
    }
  }

  async updateBulk(items: { id: string; name: string }[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!items?.length) return { status: false, message: 'No items to update' }
    try {
      for (const item of items) {
        await this.prisma.designation.update({ where: { id: item.id }, data: { name: item.name } })
      }
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'designations',
          entity: 'Designation',
          description: `Bulk updated designations (${items.length})`,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })
      return { status: true, message: 'Designations updated' }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'designations',
          entity: 'Designation',
          description: 'Failed bulk update designations',
          errorMessage: error?.message,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to update designations' }
    }
  }

  async remove(id: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.designation.findUnique({ where: { id } })
      const removed = await this.prisma.designation.delete({ where: { id } })
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'designations',
          entity: 'Designation',
          entityId: id,
          description: `Deleted designation ${existing?.name}`,
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
          module: 'designations',
          entity: 'Designation',
          entityId: id,
          description: 'Failed to delete designation',
          errorMessage: error?.message,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to delete designation' }
    }
  }

  async removeBulk(ids: string[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!ids?.length) return { status: false, message: 'No items to delete' }
    try {
      const removed = await this.prisma.designation.deleteMany({ where: { id: { in: ids } } })
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'designations',
          entity: 'Designation',
          description: `Bulk deleted designations (${removed.count})`,
          oldValues: JSON.stringify(ids),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })
      return { status: true, message: 'Designations deleted' }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'designations',
          entity: 'Designation',
          description: 'Failed bulk delete designations',
          errorMessage: error?.message,
          oldValues: JSON.stringify(ids),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to delete designations' }
    }
  }
}
