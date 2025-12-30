import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ActivityLogsService } from '../activity-logs/activity-logs.service'

@Injectable()
export class QualificationService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) { }

  async list() {
    const items = await this.prisma.qualification.findMany({ orderBy: { createdAt: 'desc' } })
    return { status: true, data: items }
  }

  async get(id: string) {
    const item = await this.prisma.qualification.findUnique({ where: { id } })
    if (!item) return { status: false, message: 'Qualification not found' }
    return { status: true, data: item }
  }

  async create(body: { name: string; status?: string }, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const created = await this.prisma.qualification.create({
        data: {
          name: body.name,
          status: body.status ?? 'active',
          createdById: ctx.userId,
        },
      })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'qualifications',
        entity: 'Qualification',
        entityId: created.id,
        description: `Created qualification ${created.name}`,
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
        module: 'qualifications',
        entity: 'Qualification',
        description: 'Failed to create qualification',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })

      if (error?.code === 'P2002') {
        return { status: false, message: 'A qualification with this name already exists' }
      }

      return { status: false, message: 'Failed to create qualification' }
    }
  }

  async createBulk(items: { name: string; status?: string }[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!items?.length) return { status: false, message: 'No items to create' }
    try {
      const result = await this.prisma.qualification.createMany({
        data: items.map(i => ({
          name: i.name,
          status: i.status ?? 'active',
          createdById: ctx.userId,
        })),
        skipDuplicates: true,
      })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'qualifications',
        entity: 'Qualification',
        description: `Bulk created qualifications (${result.count})`,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })
      return { status: true, message: 'Qualifications created', data: result }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'qualifications',
        entity: 'Qualification',
        description: 'Failed bulk create qualifications',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to create qualifications' }
    }
  }

  async update(id: string, body: { name?: string; status?: string }, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.qualification.findUnique({ where: { id } })
      if (!existing) {
        return { status: false, message: 'Qualification not found' }
      }

      const updated = await this.prisma.qualification.update({
        where: { id },
        data: {
          name: body.name ?? existing.name,
          status: body.status ?? existing.status,
        },
      })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'qualifications',
        entity: 'Qualification',
        entityId: id,
        description: `Updated qualification ${updated.name}`,
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
        module: 'qualifications',
        entity: 'Qualification',
        entityId: id,
        description: 'Failed to update qualification',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })

      if (error?.code === 'P2002') {
        return { status: false, message: 'A qualification with this name already exists' }
      }

      return { status: false, message: 'Failed to update qualification' }
    }
  }

  async remove(id: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.qualification.findUnique({ where: { id } })
      if (!existing) {
        return { status: false, message: 'Qualification not found' }
      }

      const removed = await this.prisma.qualification.delete({ where: { id } })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'qualifications',
        entity: 'Qualification',
        entityId: id,
        description: `Deleted qualification ${existing.name}`,
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
        module: 'qualifications',
        entity: 'Qualification',
        entityId: id,
        description: 'Failed to delete qualification',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to delete qualification' }
    }
  }

  async removeBulk(ids: string[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!ids?.length) return { status: false, message: 'No qualifications to delete' }
    try {
      const existing = await this.prisma.qualification.findMany({ where: { id: { in: ids } } })
      const result = await this.prisma.qualification.deleteMany({ where: { id: { in: ids } } })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'qualifications',
        entity: 'Qualification',
        description: `Bulk deleted qualifications (${result.count})`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })
      return { status: true, message: 'Qualifications deleted', data: result }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'qualifications',
        entity: 'Qualification',
        description: 'Failed to bulk delete qualifications',
        errorMessage: error?.message,
        oldValues: JSON.stringify(ids),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to delete qualifications' }
    }
  }
}
