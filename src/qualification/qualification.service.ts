import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class QualificationService {
  constructor(private prisma: PrismaService) {}

  async list() {
    const items = await this.prisma.qualification.findMany({ orderBy: { createdAt: 'desc' } })
    return { status: true, data: items }
  }

  async get(id: string) {
    const item = await this.prisma.qualification.findUnique({ where: { id } })
    if (!item) return { status: false, message: 'Qualification not found' }
    return { status: true, data: item }
  }

  async create(body: { instituteId?: string; instituteName: string; qualification: string; country: string; city: string }, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const created = await this.prisma.qualification.create({
        data: {
          instituteId: body.instituteId ?? null,
          instituteName: body.instituteName,
          qualification: body.qualification,
          country: body.country,
          city: body.city,
          status: 'active',
          createdById: ctx.userId,
        },
      })
      await this.prisma.activityLog.create({
        data: {
          userId: ctx.userId,
          action: 'create',
          module: 'qualifications',
          entity: 'Qualification',
          entityId: created.id,
          description: `Created qualification ${created.qualification}`,
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
          module: 'qualifications',
          entity: 'Qualification',
          description: 'Failed to create qualification',
          errorMessage: error?.message,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        },
      })
      return { status: false, message: 'Failed to create qualification' }
    }
  }

  async createBulk(items: { instituteId?: string; instituteName: string; qualification: string; country: string; city: string }[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!items?.length) return { status: false, message: 'No items to create' }
    try {
      const result = await this.prisma.qualification.createMany({
        data: items.map(i => ({
          instituteId: i.instituteId ?? null,
          instituteName: i.instituteName,
          qualification: i.qualification,
          country: i.country,
          city: i.city,
          status: 'active',
          createdById: ctx.userId,
        })),
        skipDuplicates: true,
      })
      await this.prisma.activityLog.create({
        data: {
          userId: ctx.userId,
          action: 'create',
          module: 'qualifications',
          entity: 'Qualification',
          description: `Bulk created qualifications (${result.count})`,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        },
      })
      return { status: true, message: 'Qualifications created', data: result }
    } catch (error: any) {
      await this.prisma.activityLog.create({
        data: {
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
        },
      })
      return { status: false, message: 'Failed to create qualifications' }
    }
  }

  async update(id: string, body: { instituteId?: string; instituteName: string; qualification: string; country: string; city: string; status?: string }, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.qualification.findUnique({ where: { id } })
      const updated = await this.prisma.qualification.update({
        where: { id },
        data: {
          instituteId: body.instituteId ?? existing?.instituteId ?? null,
          instituteName: body.instituteName ?? existing?.instituteName,
          qualification: body.qualification ?? existing?.qualification,
          country: body.country ?? existing?.country,
          city: body.city ?? existing?.city,
          status: body.status ?? existing?.status ?? 'active',
        },
      })
      await this.prisma.activityLog.create({
        data: {
          userId: ctx.userId,
          action: 'update',
          module: 'qualifications',
          entity: 'Qualification',
          entityId: id,
          description: `Updated qualification ${updated.qualification}`,
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
          module: 'qualifications',
          entity: 'Qualification',
          entityId: id,
          description: 'Failed to update qualification',
          errorMessage: error?.message,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        },
      })
      return { status: false, message: 'Failed to update qualification' }
    }
  }

  async remove(id: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.qualification.findUnique({ where: { id } })
      const removed = await this.prisma.qualification.delete({ where: { id } })
      await this.prisma.activityLog.create({
        data: {
          userId: ctx.userId,
          action: 'delete',
          module: 'qualifications',
          entity: 'Qualification',
          entityId: id,
          description: `Deleted qualification ${existing?.qualification}`,
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
          module: 'qualifications',
          entity: 'Qualification',
          entityId: id,
          description: 'Failed to delete qualification',
          errorMessage: error?.message,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        },
      })
      return { status: false, message: 'Failed to delete qualification' }
    }
  }
}
