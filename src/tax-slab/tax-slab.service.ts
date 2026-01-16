import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';

@Injectable()
export class TaxSlabService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list() {
    const items = await this.prisma.taxSlab.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { status: true, data: items };
  }

  async get(id: string) {
    const item = await this.prisma.taxSlab.findUnique({ where: { id } });
    if (!item) return { status: false, message: 'Tax slab not found' };
    return { status: true, data: item };
  }

  async create(
    body: {
      name: string;
      minAmount: number;
      maxAmount: number;
      rate: number;
      status?: string;
    },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const created = await this.prisma.taxSlab.create({
        data: {
          name: body.name,
          minAmount: body.minAmount as any,
          maxAmount: body.maxAmount as any,
          rate: body.rate as any,
          status: body.status ?? 'active',
          createdById: ctx.userId,
        },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'tax-slabs',
        entity: 'TaxSlab',
        entityId: created.id,
        description: `Created tax slab ${created.name}`,
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
        module: 'tax-slabs',
        entity: 'TaxSlab',
        description: 'Failed to create tax slab',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to create tax slab' };
    }
  }

  async createBulk(
    items: {
      name: string;
      minAmount: number;
      maxAmount: number;
      rate: number;
      status?: string;
    }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length) return { status: false, message: 'No items to create' };
    try {
      const res = await this.prisma.taxSlab.createMany({
        data: items.map((i) => ({
          name: i.name,
          minAmount: i.minAmount as any,
          maxAmount: i.maxAmount as any,
          rate: i.rate as any,
          status: i.status ?? 'active',
          createdById: ctx.userId,
        })),
        skipDuplicates: true,
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'tax-slabs',
        entity: 'TaxSlab',
        description: `Bulk created ${res.count} tax slabs`,
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
        module: 'tax-slabs',
        entity: 'TaxSlab',
        description: 'Failed bulk create tax slabs',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to create tax slabs' };
    }
  }

  async update(
    id: string,
    body: {
      name?: string;
      minAmount?: number;
      maxAmount?: number;
      rate?: number;
      status?: string;
    },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.taxSlab.findUnique({ where: { id } });
      if (!existing) return { status: false, message: 'Tax slab not found' };
      const updated = await this.prisma.taxSlab.update({
        where: { id },
        data: {
          name: body.name ?? existing.name,
          minAmount: (body.minAmount ?? (existing as any).minAmount) as any,
          maxAmount: (body.maxAmount ?? (existing as any).maxAmount) as any,
          rate: (body.rate ?? (existing as any).rate) as any,
          status: body.status ?? existing.status,
        },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'tax-slabs',
        entity: 'TaxSlab',
        entityId: id,
        description: `Updated tax slab ${updated.name}`,
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
        module: 'tax-slabs',
        entity: 'TaxSlab',
        entityId: id,
        description: 'Failed to update tax slab',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to update tax slab' };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.taxSlab.findUnique({ where: { id } });
      if (!existing) return { status: false, message: 'Tax slab not found' };
      await this.prisma.taxSlab.delete({ where: { id } });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'tax-slabs',
        entity: 'TaxSlab',
        entityId: id,
        description: `Deleted tax slab ${existing.name}`,
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
        module: 'tax-slabs',
        entity: 'TaxSlab',
        entityId: id,
        description: 'Failed to delete tax slab',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to delete tax slab' };
    }
  }

  async removeBulk(
    ids: string[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    const result = {
      success: [] as string[],
      failed: [] as { id: string; reason: string }[],
    };

    for (const id of ids) {
      try {
        const existing = await this.prisma.taxSlab.findUnique({
          where: { id },
        });

        if (!existing) {
          result.failed.push({ id, reason: 'Tax slab not found' });

          await this.activityLogs.log({
            userId: ctx.userId,
            action: 'delete',
            module: 'tax-slabs',
            entity: 'TaxSlab',
            entityId: id,
            description: 'Tax slab not found',
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            status: 'failure',
          });

          continue;
        }

        await this.prisma.taxSlab.delete({ where: { id } });

        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'tax-slabs',
          entity: 'TaxSlab',
          entityId: id,
          description: `Deleted tax slab ${existing.name}`,
          oldValues: JSON.stringify(existing),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        });

        result.success.push(id);
      } catch (error: any) {
        result.failed.push({ id, reason: error?.message ?? 'Unknown error' });

        await this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'tax-slabs',
          entity: 'TaxSlab',
          entityId: id,
          description: 'Failed to delete tax slab',
          errorMessage: error?.message,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        });
      }
    }

    return {
      status: result.failed.length === 0,
      message:
        result.failed.length === 0
          ? 'All tax slabs deleted successfully'
          : 'Some tax slabs failed to delete',
      ...result,
    };
  }

  async updateBulk(
    items: {
      id: string;
      name: string;
      minAmount: number;
      maxAmount: number;
      rate: number;
      status?: string;
    }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length) return { status: false, message: 'No items to update' };
    try {
      for (const i of items) {
        await this.prisma.taxSlab.update({
          where: { id: i.id },
          data: {
            name: i.name,
            minAmount: i.minAmount as any,
            maxAmount: i.maxAmount as any,
            rate: i.rate as any,
            status: i.status ?? 'active',
          },
        });
      }
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'tax-slabs',
        entity: 'TaxSlab',
        description: `Bulk updated ${items.length} tax slabs`,
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
        module: 'tax-slabs',
        entity: 'TaxSlab',
        description: 'Failed bulk update tax slabs',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to update tax slabs' };
    }
  }
}
