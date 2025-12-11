import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ActivityLogsService } from '../activity-logs/activity-logs.service'

@Injectable()
export class LoanTypeService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list() {
    const items = await this.prisma.loanType.findMany({ orderBy: { createdAt: 'desc' } })
    return { status: true, data: items }
  }

  async get(id: string) {
    const item = await this.prisma.loanType.findUnique({ where: { id } })
    if (!item) return { status: false, message: 'Loan type not found' }
    return { status: true, data: item }
  }

  async create(body: { name: string; status?: string }, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const created = await this.prisma.loanType.create({ data: { name: body.name, status: body.status ?? 'active', createdById: ctx.userId } })
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'loan-types',
          entity: 'LoanType',
          entityId: created.id,
          description: `Created loan type ${created.name}`,
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
          module: 'loan-types',
          entity: 'LoanType',
          description: 'Failed to create loan type',
          errorMessage: error?.message,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to create loan type' }
    }
  }

  async update(id: string, body: { name: string; status?: string }, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.loanType.findUnique({ where: { id } })
      const updated = await this.prisma.loanType.update({ where: { id }, data: { name: body.name ?? existing?.name, status: body.status ?? existing?.status ?? 'active' } })
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'loan-types',
          entity: 'LoanType',
          entityId: id,
          description: `Updated loan type ${updated.name}`,
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
          module: 'loan-types',
          entity: 'LoanType',
          entityId: id,
          description: 'Failed to update loan type',
          errorMessage: error?.message,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to update loan type' }
    }
  }

  async remove(id: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.loanType.findUnique({ where: { id } })
      const removed = await this.prisma.loanType.delete({ where: { id } })
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'loan-types',
          entity: 'LoanType',
          entityId: id,
          description: `Deleted loan type ${existing?.name}`,
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
          module: 'loan-types',
          entity: 'LoanType',
          entityId: id,
          description: 'Failed to delete loan type',
          errorMessage: error?.message,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to delete loan type' }
    }
  }

  async createBulk(items: { name: string; status?: string }[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!items?.length) return { status: false, message: 'No loan types to create' }
    try {
      const result = await this.prisma.loanType.createMany({ data: items.map(i => ({ name: i.name, status: i.status ?? 'active', createdById: ctx.userId })), skipDuplicates: true })
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'loan-types',
          entity: 'LoanType',
          description: `Bulk created loan types (${result.count})`,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })
      return { status: true, message: 'Loan types created', data: result }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'loan-types',
          entity: 'LoanType',
          description: 'Failed to bulk create loan types',
          errorMessage: error?.message,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to create loan types' }
    }
  }

  async updateBulk(items: { id: string; name: string; status?: string }[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!items?.length) return { status: false, message: 'No loan types to update' }
    try {
      for (const i of items) {
        const existing = await this.prisma.loanType.findUnique({ where: { id: i.id } })
        await this.prisma.loanType.update({ where: { id: i.id }, data: { name: i.name ?? existing?.name, status: i.status ?? existing?.status ?? 'active' } })
      }
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'loan-types',
          entity: 'LoanType',
          description: `Bulk updated loan types (${items.length})`,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })
      return { status: true, message: 'Loan types updated' }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'loan-types',
          entity: 'LoanType',
          description: 'Failed to bulk update loan types',
          errorMessage: error?.message,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to update loan types' }
    }
  }

  async removeBulk(ids: string[], ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (!ids?.length) return { status: false, message: 'No loan types to delete' }
    try {
      const existing = await this.prisma.loanType.findMany({ where: { id: { in: ids } } })
      const result = await this.prisma.loanType.deleteMany({ where: { id: { in: ids } } })
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'loan-types',
          entity: 'LoanType',
          description: `Bulk deleted loan types (${result.count})`,
          oldValues: JSON.stringify(existing),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
      })
      return { status: true, message: 'Loan types deleted', data: result }
    } catch (error: any) {
      await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'loan-types',
          entity: 'LoanType',
          description: 'Failed to bulk delete loan types',
          errorMessage: error?.message,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
      })
      return { status: false, message: 'Failed to delete loan types' }
    }
  }
}
