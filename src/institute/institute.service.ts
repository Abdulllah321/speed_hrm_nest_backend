import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ActivityLogsService } from '../activity-logs/activity-logs.service'

@Injectable()
export class InstituteService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list() {
    const items = await this.prisma.institute.findMany({ orderBy: { createdAt: 'desc' } })
    return { status: true, data: items }
  }

  async get(id: string) {
    const item = await this.prisma.institute.findUnique({ where: { id } })
    if (!item) return { status: false, message: 'Institute not found' }
    return { status: true, data: item }
  }

  async create(body: { name: string; status?: string }, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const created = await this.prisma.institute.create({ data: { name: body.name, status: body.status ?? 'active', createdById: ctx.userId } })
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'institutes',
          entity: 'Institute',
          entityId: created.id,
          description: `Created institute ${created.name}`,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })
      return { status: true, data: created, message: 'Institute created successfully' }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'institutes',
          entity: 'Institute',
          description: 'Failed to create institute',
          errorMessage: error?.message,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to create institute', data: null }
    }
  }

  async update(id: string, body: { name: string; status?: string }, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.institute.findUnique({ where: { id } })
      const updated = await this.prisma.institute.update({ where: { id }, data: { name: body.name ?? existing?.name, status: body.status ?? existing?.status ?? 'active' } })
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'institutes',
          entity: 'Institute',
          entityId: id,
          description: `Updated institute ${updated.name}`,
          oldValues: JSON.stringify(existing),
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })
      return { status: true, data: updated, message: 'Institute updated successfully' }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'institutes',
          entity: 'Institute',
          entityId: id,
          description: 'Failed to update institute',
          errorMessage: error?.message,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to update institute', data: null }
    }
  }

  async remove(id: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.institute.findUnique({ where: { id } })
      const removed = await this.prisma.institute.delete({ where: { id } })
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'institutes',
          entity: 'Institute',
          entityId: id,
          description: `Deleted institute ${existing?.name}`,
          oldValues: JSON.stringify(existing),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })
      return { status: true, data: removed, message: 'Institute deleted successfully' }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'institutes',
          entity: 'Institute',
          entityId: id,
          description: 'Failed to delete institute',
          errorMessage: error?.message,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to delete institute', data: null }
    }
  }

  async createBulk(items: { name: string; status?: string }[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!items?.length) return { status: false, message: 'No institutes to create' }
    const data = items.map((i) => ({ name: i.name, status: i.status ?? 'active', createdById: ctx.userId }))
    try {
      const result = await this.prisma.institute.createMany({ data, skipDuplicates: true })
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'institutes',
          entity: 'Institute',
          description: `Created institutes (${result.count})`,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })
      return { status: true, data: result, message: 'Institutes created successfully' }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'institutes',
          entity: 'Institute',
          description: 'Failed to create institutes',
          errorMessage: error?.message,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to create institutes', data: null }
    }
  }

  async seed(ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    const seedItems = [
      'University of Karachi',
      'NED University of Engineering and Technology',
      'Aga Khan University',
      'Dow University of Health Sciences',
      'Quaid-e-Azam University',
      'University of the Punjab',
      'National University of Sciences and Technology',
    ]
    let created = 0
    let skipped = 0
    for (const name of seedItems) {
      try {
        await this.prisma.institute.create({ data: { name, status: 'active', createdById: ctx.userId } })
        created++
      } catch {
        skipped++
      }
    }
    await this.activityLogs.log({
      userId: ctx.userId,
      action: 'seed',
      module: 'institutes',
      entity: 'Institute',
      description: `Seeded institutes: created=${created}, skipped=${skipped}. Total: ${seedItems.length}`,
      newValues: JSON.stringify({ total: seedItems.length, created, skipped }),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      status: 'success',
    })
    return { status: true, data: { total: seedItems.length, created, skipped }, message: 'Institutes seeded successfully' }
  }
}
