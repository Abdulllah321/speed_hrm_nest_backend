import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ActivityLogsService } from '../activity-logs/activity-logs.service'

@Injectable()
export class BranchService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) { }

  async list() {
    const items = await this.prisma.branch.findMany({ orderBy: { createdAt: 'desc' } })
    return { status: true, data: items }
  }

  async get(id: string) {
    const item = await this.prisma.branch.findUnique({ where: { id } })
    if (!item) return { status: false, message: 'Branch not found' }
    return { status: true, data: item }
  }

  async create(body: { name: string; address?: string; cityId?: string; status?: string }, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const created = await this.prisma.branch.create({
        data: {
          name: body.name,
          address: body.address || null,
          cityId: body.cityId?.trim() || null,
          status: body.status ?? 'active',
          createdById: ctx.userId,
        },
      })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'branches',
        entity: 'Branch',
        entityId: created.id,
        description: `Created branch ${created.name}`,
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
        module: 'branches',
        entity: 'Branch',
        description: 'Failed to create branch',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to create branch' }
    }
  }

  async update(id: string, body: { name: string; address?: string; cityId?: string; status?: string }, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.branch.findUnique({ where: { id } })
      const updated = await this.prisma.branch.update({
        where: { id },
        data: {
          name: body.name ?? existing?.name,
          address: body.address !== undefined ? body.address : existing?.address,
          cityId: body.cityId !== undefined ? (body.cityId?.trim() || null) : existing?.cityId,
          status: body.status ?? existing?.status ?? 'active',
        },
      })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'branches',
        entity: 'Branch',
        entityId: id,
        description: `Updated branch ${updated.name}`,
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
        module: 'branches',
        entity: 'Branch',
        entityId: id,
        description: 'Failed to update branch',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: error instanceof Error ? error.message : 'Failed to update branch' }
    }
  }

  async remove(id: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.branch.findUnique({ where: { id } })
      const removed = await this.prisma.branch.delete({ where: { id } })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'branches',
        entity: 'Branch',
        entityId: id,
        description: `Deleted branch ${existing?.name}`,
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
        module: 'branches',
        entity: 'Branch',
        entityId: id,
        description: 'Failed to delete branch',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to delete branch' }
    }
  }

  async createBulk(
    items: { name: string; address?: string; cityId?: string; status?: string }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length) return { status: false, message: 'No branches to create' }
    try {
      const result = await this.prisma.branch.createMany({
        data: items.map((i) => ({
          name: i.name,
          address: i.address || null,
          cityId: i.cityId?.trim() || null,
          status: i.status ?? 'active',
          createdById: ctx.userId,
        })),
        skipDuplicates: true,
      })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'branches',
        entity: 'Branch',
        description: `Bulk created branches (${result.count})`,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })
      return { status: true, message: 'Branches created', data: result }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'branches',
        entity: 'Branch',
        description: 'Failed to bulk create branches',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to create branches' }
    }
  }

  async updateBulk(
    items: { id: string; name: string; address?: string; cityId?: string; status?: string }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length) return { status: false, message: 'No branches to update' }
    try {
      for (const i of items) {
        const existing = await this.prisma.branch.findUnique({ where: { id: i.id } })
        await this.prisma.branch.update({
          where: { id: i.id },
          data: {
            name: i.name ?? existing?.name,
            address: i.address !== undefined ? i.address : existing?.address,
            cityId: i.cityId !== undefined ? (i.cityId?.trim() || null) : existing?.cityId,
            status: i.status ?? existing?.status ?? 'active',
          },
        })
      }
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'branches',
        entity: 'Branch',
        description: `Bulk updated branches (${items.length})`,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })
      return { status: true, message: 'Branches updated' }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'branches',
        entity: 'Branch',
        description: 'Failed to bulk update branches',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to update branches' }
    }
  }

  async removeBulk(ids: string[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!ids?.length) return { status: false, message: 'No branches to delete' }
    try {
      const existing = await this.prisma.branch.findMany({ where: { id: { in: ids } } })
      const result = await this.prisma.branch.deleteMany({ where: { id: { in: ids } } })
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'branches',
        entity: 'Branch',
        description: `Bulk deleted branches (${result.count})`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      })
      return { status: true, message: 'Branches deleted', data: result }
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'branches',
        entity: 'Branch',
        description: 'Failed to bulk delete branches',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to delete branches' }
    }
  }
}
