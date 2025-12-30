import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ActivityLogsService } from '../activity-logs/activity-logs.service'

@Injectable()
export class LeaveTypeService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) { }

  async list() {
    const items = await this.prisma.leaveType.findMany({ orderBy: { createdAt: 'desc' } })
    return { status: true, data: items }
  }

  async get(id: string) {
    const item = await this.prisma.leaveType.findUnique({ where: { id } })
    if (!item) return { status: false, message: 'Leave type not found' }
    return { status: true, data: item }
  }

  async create(body: { name: string; status?: string }, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const created = await this.prisma.leaveType.create({ data: { name: body.name, status: body.status ?? 'active', createdById: ctx.userId } })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'leave-types',
        entity: 'LeaveType',
        entityId: created.id,
        description: `Created leave type ${created.name}`,
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
        module: 'leave-types',
        entity: 'LeaveType',
        description: 'Failed to create leave type',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to create leave type' }
    }
  }

  async update(id: string, body: { name: string; status?: string }, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.leaveType.findUnique({ where: { id } })
      const updated = await this.prisma.leaveType.update({ where: { id }, data: { name: body.name ?? existing?.name, status: body.status ?? existing?.status ?? 'active' } })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'leave-types',
        entity: 'LeaveType',
        entityId: id,
        description: `Updated leave type ${updated.name}`,
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
        module: 'leave-types',
        entity: 'LeaveType',
        entityId: id,
        description: 'Failed to update leave type',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to update leave type' }
    }
  }

  async remove(id: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.leaveType.findUnique({ where: { id } })
      const removed = await this.prisma.leaveType.delete({ where: { id } })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'leave-types',
        entity: 'LeaveType',
        entityId: id,
        description: `Deleted leave type ${existing?.name}`,
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
        module: 'leave-types',
        entity: 'LeaveType',
        entityId: id,
        description: 'Failed to delete leave type',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to delete leave type' }
    }
  }

  async createBulk(items: { name: string; status?: string }[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!items?.length) return { status: false, message: 'No leave types to create' }
    try {
      const result = await this.prisma.leaveType.createMany({ data: items.map(i => ({ name: i.name, status: i.status ?? 'active', createdById: ctx.userId })), skipDuplicates: true })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'leave-types',
        entity: 'LeaveType',
        description: `Bulk created leave types (${result.count})`,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })
      return { status: true, message: 'Leave types created', data: result }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'leave-types',
        entity: 'LeaveType',
        description: 'Failed to bulk create leave types',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to create leave types' }
    }
  }

  async updateBulk(items: { id: string; name: string; status?: string }[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!items?.length) return { status: false, message: 'No leave types to update' }
    try {
      for (const i of items) {
        const existing = await this.prisma.leaveType.findUnique({ where: { id: i.id } })
        await this.prisma.leaveType.update({ where: { id: i.id }, data: { name: i.name ?? existing?.name, status: i.status ?? existing?.status ?? 'active' } })
      }
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'leave-types',
        entity: 'LeaveType',
        description: `Bulk updated leave types (${items.length})`,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })
      return { status: true, message: 'Leave types updated' }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'leave-types',
        entity: 'LeaveType',
        description: 'Failed to bulk update leave types',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to update leave types' }
    }
  }

  async removeBulk(ids: string[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!ids?.length) return { status: false, message: 'No leave types to delete' }
    try {
      const existing = await this.prisma.leaveType.findMany({ where: { id: { in: ids } } })
      const result = await this.prisma.leaveType.deleteMany({ where: { id: { in: ids } } })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'leave-types',
        entity: 'LeaveType',
        description: `Bulk deleted leave types (${result.count})`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })
      return { status: true, message: 'Leave types deleted', data: result }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'leave-types',
        entity: 'LeaveType',
        description: 'Failed to bulk delete leave types',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to delete leave types' }
    }
  }
}
