import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';

@Injectable()
export class BonusTypeService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list() {
    const items = await this.prisma.bonusType.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { status: true, data: items };
  }

  async get(id: string) {
    const item = await this.prisma.bonusType.findUnique({ where: { id } });
    if (!item) return { status: false, message: 'Bonus type not found' };
    return { status: true, data: item };
  }

  async create(
    body: {
      name: string;
      calculationType?: string;
      amount?: number;
      percentage?: number;
      status?: string;
    },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const created = await this.prisma.bonusType.create({
        data: {
          name: body.name,
          calculationType: body.calculationType ?? 'Amount',
          amount: body.amount ? Number(body.amount) : null,
          percentage: body.percentage ? Number(body.percentage) : null,
          status: body.status ?? 'active',
          createdById: ctx.userId,
        },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'bonus-types',
        entity: 'BonusType',
        entityId: created.id,
        description: `Created bonus type ${created.name}`,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, data: created };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'bonus-types',
        entity: 'BonusType',
        description: 'Failed to create bonus type',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to create bonus type' };
    }
  }

  async createBulk(
    items: {
      name: string;
      calculationType?: string;
      amount?: number;
      percentage?: number;
      status?: string;
    }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length) return { status: false, message: 'No items to create' };
    try {
      const res = await this.prisma.bonusType.createMany({
        data: items.map((i) => ({
          name: i.name,
          calculationType: i.calculationType ?? 'Amount',
          amount: i.amount ? Number(i.amount) : null,
          percentage: i.percentage ? Number(i.percentage) : null,
          status: i.status ?? 'active',
          createdById: ctx.userId,
        })),
        skipDuplicates: true,
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'bonus-types',
        entity: 'BonusType',
        description: `Bulk created ${res.count} bonus types`,
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
        module: 'bonus-types',
        entity: 'BonusType',
        description: 'Failed bulk create bonus types',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to create bonus types' };
    }
  }

  async update(
    id: string,
    body: {
      name?: string;
      calculationType?: string;
      amount?: number;
      percentage?: number;
      status?: string;
    },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.bonusType.findUnique({
        where: { id },
      });
      if (!existing) return { status: false, message: 'Bonus type not found' };
      const updated = await this.prisma.bonusType.update({
        where: { id },
        data: {
          name: body.name ?? existing.name,
          calculationType: body.calculationType ?? existing.calculationType,
          amount:
            body.amount !== undefined
              ? body.amount
                ? Number(body.amount)
                : null
              : existing.amount,
          percentage:
            body.percentage !== undefined
              ? body.percentage
                ? Number(body.percentage)
                : null
              : existing.percentage,
          status: body.status ?? existing.status,
        },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'bonus-types',
        entity: 'BonusType',
        entityId: id,
        description: `Updated bonus type ${updated.name}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, data: updated };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'bonus-types',
        entity: 'BonusType',
        entityId: id,
        description: 'Failed to update bonus type',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to update bonus type' };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.bonusType.findUnique({
        where: { id },
      });
      if (!existing) return { status: false, message: 'Bonus type not found' };
      await this.prisma.bonusType.delete({ where: { id } });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'bonus-types',
        entity: 'BonusType',
        entityId: id,
        description: `Deleted bonus type ${existing.name}`,
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
        module: 'bonus-types',
        entity: 'BonusType',
        entityId: id,
        description: 'Failed to delete bonus type',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to delete bonus type' };
    }
  }

  async updateBulk(
    items: {
      id: string;
      name: string;
      calculationType?: string;
      amount?: number;
      percentage?: number;
      status?: string;
    }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length) return { status: false, message: 'No items to update' };
    try {
      for (const i of items) {
        await this.prisma.bonusType.update({
          where: { id: i.id },
          data: {
            name: i.name,
            calculationType: i.calculationType ?? 'Amount',
            amount: i.amount ? Number(i.amount) : null,
            percentage: i.percentage ? Number(i.percentage) : null,
            status: i.status ?? 'active',
          },
        });
      }
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'bonus-types',
        entity: 'BonusType',
        description: `Bulk updated ${items.length} bonus types`,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, message: 'Updated successfully' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'bonus-types',
        entity: 'BonusType',
        description: 'Failed bulk update bonus types',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to update bonus types' };
    }
  }

  async removeBulk(
    ids: string[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!ids?.length) return { status: false, message: 'No items to delete' };
    try {
      await this.prisma.bonusType.deleteMany({ where: { id: { in: ids } } });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'bonus-types',
        entity: 'BonusType',
        description: `Bulk deleted ${ids.length} bonus types`,
        oldValues: JSON.stringify(ids),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, message: 'Deleted successfully' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'bonus-types',
        entity: 'BonusType',
        description: 'Failed bulk delete bonus types',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to delete bonus types' };
    }
  }
}
