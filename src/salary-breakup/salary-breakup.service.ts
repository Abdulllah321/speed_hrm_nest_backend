import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ActivityLogsService } from '../activity-logs/activity-logs.service'

@Injectable()
export class SalaryBreakupService {
  constructor(private prisma: PrismaService, private activityLogs: ActivityLogsService) {}

  async list() {
    const items = await this.prisma.salaryBreakup.findMany({ orderBy: { createdAt: 'desc' } })
    return { status: true, data: items }
  }

  async get(id: string) {
    const item = await this.prisma.salaryBreakup.findUnique({ where: { id } })
    if (!item) return { status: false, message: 'Salary breakup not found' }
    return { status: true, data: item }
  }

  async create(
    body: { name: string; details?: any; status?: string },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string }
  ) {
    try {
      const created = await this.prisma.salaryBreakup.create({
        data: {
          name: body.name,
          details: typeof body.details === 'string' ? body.details : JSON.stringify(body.details ?? null),
          status: body.status ?? 'active',
          createdById: ctx.userId,
        },
      })

      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'salary-breakups',
        entity: 'SalaryBreakup',
        entityId: created.id,
        description: `Created salary breakup ${created.name}`,
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
        module: 'salary-breakups',
        entity: 'SalaryBreakup',
        description: 'Failed to create salary breakup',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      })
      return { status: false, message: 'Failed to create salary breakup' }
    }
  }
}
