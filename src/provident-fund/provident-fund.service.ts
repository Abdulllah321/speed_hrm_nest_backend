import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';

@Injectable()
export class ProvidentFundService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list() {
    const items = await this.prisma.providentFund.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { status: true, data: items };
  }

  async get(id: string) {
    const item = await this.prisma.providentFund.findUnique({ where: { id } });
    if (!item) return { status: false, message: 'Provident fund not found' };
    return { status: true, data: item };
  }

  async create(
    body: { name: string; percentage: number; status?: string },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const created = await this.prisma.providentFund.create({
        data: {
          name: body.name,
          percentage: body.percentage as any,
          status: body.status ?? 'active',
          createdById: ctx.userId,
        },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'provident-funds',
        entity: 'ProvidentFund',
        entityId: created.id,
        description: `Created provident fund ${created.name}`,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, data: created, message: 'Created successfully' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'provident-funds',
        entity: 'ProvidentFund',
        description: 'Failed to create provident fund',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to create provident fund' };
    }
  }

  async createBulk(
    items: { name: string; percentage: number; status?: string }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length) return { status: false, message: 'No items to create' };
    try {
      const res = await this.prisma.providentFund.createMany({
        data: items.map((i) => ({
          name: i.name,
          percentage: i.percentage as any,
          status: i.status ?? 'active',
          createdById: ctx.userId,
        })),
        skipDuplicates: true,
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'provident-funds',
        entity: 'ProvidentFund',
        description: `Bulk created ${res.count} provident funds`,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, message: 'Created successfully' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'provident-funds',
        entity: 'ProvidentFund',
        description: 'Failed bulk create provident funds',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to create provident funds' };
    }
  }

  async update(
    id: string,
    body: { name?: string; percentage?: number; status?: string },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.providentFund.findUnique({
        where: { id },
      });
      if (!existing)
        return { status: false, message: 'Provident fund not found' };
      const updated = await this.prisma.providentFund.update({
        where: { id },
        data: {
          name: body.name ?? existing.name,
          percentage: (body.percentage ?? (existing as any).percentage) as any,
          status: body.status ?? existing.status,
        },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'provident-funds',
        entity: 'ProvidentFund',
        entityId: id,
        description: `Updated provident fund ${updated.name}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, data: updated, message: 'Updated successfully' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'provident-funds',
        entity: 'ProvidentFund',
        entityId: id,
        description: 'Failed to update provident fund',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to update provident fund' };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.providentFund.findUnique({
        where: { id },
      });
      if (!existing)
        return { status: false, message: 'Provident fund not found' };
      await this.prisma.providentFund.delete({ where: { id } });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'provident-funds',
        entity: 'ProvidentFund',
        entityId: id,
        description: `Deleted provident fund ${existing.name}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, message: 'Deleted successfully' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'provident-funds',
        entity: 'ProvidentFund',
        entityId: id,
        description: 'Failed to delete provident fund',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to delete provident fund' };
    }
  }
}
