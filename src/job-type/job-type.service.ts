import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ActivityLogsService } from '../activity-logs/activity-logs.service'

@Injectable()
export class JobTypeService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list() {
    const items = await this.prisma.jobType.findMany({ orderBy: { createdAt: 'desc' } })
    return { status: true, data: items }
  }

  async get(id: string) {
    const item = await this.prisma.jobType.findUnique({ where: { id } })
    if (!item) return { status: false, message: 'Job type not found' }
    return { status: true, data: item }
  }

  async create(name: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const created = await this.prisma.jobType.create({ data: { name, status: 'active', createdById: ctx.userId } })
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'job-types',
          entity: 'JobType',
          entityId: created.id,
          description: `Created job type ${name}`,
          newValues: JSON.stringify({ name }),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })
      return { status: true, data: created, message: 'Job type created successfully' }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'job-types',
          entity: 'JobType',
          description: 'Failed to create job type',
          errorMessage: error?.message,
          newValues: JSON.stringify({ name }),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to create job type', data: null }
    }
  }

  async createBulk(names: string[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!names?.length) return { status: false, message: 'No items to create' }
    try {
      const result = await this.prisma.jobType.createMany({
        data: names.map((n) => ({ name: n, status: 'active', createdById: ctx.userId })),
        skipDuplicates: true,
      })
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'job-types',
          entity: 'JobType',
          description: `Bulk created job types (${result.count})`,
          newValues: JSON.stringify(names),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })
      return { status: true, data: result, message: 'Job types created successfully' }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'job-types',
          entity: 'JobType',
          description: 'Failed bulk create job types',
          errorMessage: error?.message,
          newValues: JSON.stringify(names),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to create job types', data: null }
    }
  }

  async update(id: string, name: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.jobType.findUnique({ where: { id } })
      const updated = await this.prisma.jobType.update({ where: { id }, data: { name } })
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'job-types',
          entity: 'JobType',
          entityId: id,
          description: `Updated job type ${name}`,
          oldValues: JSON.stringify(existing),
          newValues: JSON.stringify({ name }),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })
      return { status: true, data: updated, message: 'Job type updated successfully' }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'job-types',
          entity: 'JobType',
          entityId: id,
          description: 'Failed to update job type',
          errorMessage: error?.message,
          newValues: JSON.stringify({ name }),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to update job type', data: null }
    }
  }

  async updateBulk(items: { id: string; name: string }[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!items?.length) return { status: false, message: 'No items to update' }
    try {
      for (const item of items) {
        await this.prisma.jobType.update({ where: { id: item.id }, data: { name: item.name } })
      }
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'job-types',
          entity: 'JobType',
          description: `Bulk updated job types (${items.length})`,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })
      return { status: true, data: items, message: 'Job types updated successfully' }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'job-types',
          entity: 'JobType',
          description: 'Failed bulk update job types',
          errorMessage: error?.message,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to update job types', data: null }
    }
  }

  async remove(id: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.jobType.findUnique({ where: { id } })
      const removed = await this.prisma.jobType.delete({ where: { id } })
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'job-types',
          entity: 'JobType',
          entityId: id,
          description: `Deleted job type ${existing?.name}`,
          oldValues: JSON.stringify(existing),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })
      return { status: true, data: removed, message: 'Job type deleted successfully' }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'job-types',
          entity: 'JobType',
          entityId: id,
          description: 'Failed to delete job type',
          errorMessage: error?.message,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to delete job type', data: null }
    }
  }

  async removeBulk(ids: string[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!ids?.length) return { status: false, message: 'No items to delete' }
    try {
      const removed = await this.prisma.jobType.deleteMany({ where: { id: { in: ids } } })
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'job-types',
          entity: 'JobType',
          description: `Bulk deleted job types (${removed.count})`,
          oldValues: JSON.stringify(ids),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })
      return { status: true, data: ids, message: 'Job types deleted successfully' }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'job-types',
          entity: 'JobType',
          description: 'Failed bulk delete job types',
          errorMessage: error?.message,
          oldValues: JSON.stringify(ids),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to delete job types', data: null }
    }
  }
}
