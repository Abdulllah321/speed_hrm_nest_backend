import { Injectable } from '@nestjs/common';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { PrismaService } from '../../database/prisma.service';
import { runInBackground } from '../../common/utils/run-in-background.util';


@Injectable()
export class TaxSlabService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list() {
    const items = await this.prisma.taxSlab.findMany({
      orderBy: { createdAt: 'desc' },
        where: { isDeleted: false }
    });
    return { status: true, data: items };
  }

  async get(id: string) {
    const item = await this.prisma.taxSlab.findFirst({ where: { id,
        isDeleted: false
    } });
    if (!item) return { status: false, message: 'Tax slab not found' };
    return { status: true, data: item };
  }

  async create(
    body: {
      name: string;
      minAmount: number;
      maxAmount: number;
      rate: number;
      fixedAmount?: number;
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
          fixedAmount: (body.fixedAmount ?? 0) as any,
          status: body.status ?? 'active',
          createdById: ctx.userId,
        },
      });

      runInBackground(
        `Created tax slab ${created.name}`,
        this.activityLogs.log({
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
        }),
      );

      return { status: true, data: created, message: 'Tax slab created successfully' };
    } catch (error: any) {
      runInBackground(
        'Failed to create tax slab',
        this.activityLogs.log({
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
        }),
      );
      return { status: false, message: 'Failed to create tax slab' };
    }
  }

  async createBulk(
    items: {
      name: string;
      minAmount: number;
      maxAmount: number;
      rate: number;
      fixedAmount?: number;
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
          fixedAmount: (i.fixedAmount ?? 0) as any,
          status: i.status ?? 'active',
          createdById: ctx.userId,
        })),
        skipDuplicates: true,
      });

      runInBackground(
        `Bulk created ${res.count} tax slabs`,
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'tax-slabs',
          entity: 'TaxSlab',
          description: `Bulk created ${res.count} tax slabs`,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );

      return { status: true, data: res, message: 'Tax slabs created successfully' };
    } catch (error: any) {
      runInBackground(
        'Failed bulk create tax slabs',
        this.activityLogs.log({
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
        }),
      );
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
      fixedAmount?: number;
      status?: string;
    },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.taxSlab.findFirst({
        where: { id,
            isDeleted: false
        },
      });
      if (!existing) return { status: false, message: 'Tax slab not found' };

      const updated = await this.prisma.taxSlab.update({
        where: { id },
        data: {
          name: body.name ?? existing.name,
          minAmount: (body.minAmount ?? (existing as any).minAmount) as any,
          maxAmount: (body.maxAmount ?? (existing as any).maxAmount) as any,
          rate: (body.rate ?? (existing as any).rate) as any,
          fixedAmount: (body.fixedAmount !== undefined ? body.fixedAmount : (existing as any).fixedAmount ?? 0) as any,
          status: body.status ?? existing.status,
        },
      });

      runInBackground(
        `Updated tax slab ${updated.name}`,
        this.activityLogs.log({
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
        }),
      );

      return { status: true, data: updated, message: 'Tax slab updated successfully' };
    } catch (error: any) {
      runInBackground(
        'Failed to update tax slab',
        this.activityLogs.log({
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
        }),
      );
      return { status: false, message: 'Failed to update tax slab' };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.taxSlab.findFirst({
        where: { id,
            isDeleted: false
        },
      });
      if (!existing) return { status: false, message: 'Tax slab not found' };

      await this.prisma.taxSlab.update({ where: { id },
          data: { isDeleted: true, deletedAt: new Date() }
    });

      runInBackground(
        `Deleted tax slab ${existing.name}`,
        this.activityLogs.log({
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
        }),
      );

      return { status: true, message: 'Tax slab deleted successfully' };
    } catch (error: any) {
      runInBackground(
        'Failed to delete tax slab',
        this.activityLogs.log({
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
        }),
      );
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
        const existing = await this.prisma.taxSlab.findFirst({
          where: { id,
              isDeleted: false
        },
        });

        if (!existing) {
          result.failed.push({ id, reason: 'Tax slab not found' });
          continue;
        }

        await this.prisma.taxSlab.update({ where: { id },
            data: { isDeleted: true, deletedAt: new Date() }
        });

        runInBackground(
          `Deleted tax slab ${existing.name}`,
          this.activityLogs.log({
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
          }),
        );

        result.success.push(id);
      } catch (error: any) {
        result.failed.push({ id, reason: error?.message ?? 'Unknown error' });

        runInBackground(
          'Failed to delete tax slab (Failure Log)',
          this.activityLogs.log({
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
          }),
        );
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
      fixedAmount?: number;
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
            fixedAmount: (i.fixedAmount ?? 0) as any,
            status: i.status ?? 'active',
          },
        });
      }

      runInBackground(
        `Bulk updated ${items.length} tax slabs`,
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'tax-slabs',
          entity: 'TaxSlab',
          description: `Bulk updated ${items.length} tax slabs`,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );

      return { status: true, message: 'Tax slabs updated successfully' };
    } catch (error: any) {
      runInBackground(
        'Failed bulk update tax slabs',
        this.activityLogs.log({
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
        }),
      );
      return { status: false, message: 'Failed to update tax slabs' };
    }
  }
}
