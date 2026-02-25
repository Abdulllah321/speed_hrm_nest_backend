import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { PrismaMasterService } from '../../database/prisma-master.service';

@Injectable()
export class AllocationService {
  constructor(
    private prisma: PrismaService,
    private prismaMaster: PrismaMasterService,
    private activityLogs: ActivityLogsService,
  ) {}

  async create(
    name: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const created = await this.prisma.allocation.create({
        data: {
          name,
          createdById: ctx.userId,
        },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'allocations',
        entity: 'Allocation',
        entityId: created.id,
        description: `Created allocation ${name}`,
        newValues: JSON.stringify({ name }),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return {
        status: true,
        data: created,
        message: 'Allocation created successfully',
      };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'allocations',
        entity: 'Allocation',
        description: 'Failed to create allocation',
        errorMessage: error?.message,
        newValues: JSON.stringify({ name }),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return {
        status: false,
        message: 'Failed to create allocation',
        data: null,
      };
    }
  }

  async createBulk(
    names: string[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!names?.length) return { status: false, message: 'No items to create' };
    try {
      const result = await this.prisma.allocation.createMany({
        data: names.map((name) => ({
          name,
          createdById: ctx.userId,
        })),
        skipDuplicates: true,
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'allocations',
        entity: 'Allocation',
        description: `Bulk created allocations (${result.count})`,
        newValues: JSON.stringify(names),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return {
        status: true,
        data: result,
        message: 'Allocations created successfully',
      };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'allocations',
        entity: 'Allocation',
        description: 'Failed bulk create allocations',
        errorMessage: error?.message,
        newValues: JSON.stringify(names),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return {
        status: false,
        message: 'Failed to create allocations',
        data: null,
      };
    }
  }

  async list() {
    try {
      const items = await this.prisma.allocation.findMany({
        orderBy: { createdAt: 'desc' },
      });

      if (items.length === 0) {
        return { status: true, data: [] };
      }

      // Fetch users for createdBy manually since relation might not be in schema
      const createdByIds = [
        ...new Set(items.map((i) => i.createdById).filter(Boolean) as string[]),
      ];
      const users = await this.prismaMaster.user.findMany({
        where: { id: { in: createdByIds } },
        select: { id: true, firstName: true, lastName: true },
      });

      const userMap = new Map(users.map((u) => [u.id, u]));

      const mappedData = items.map((item) => ({
        ...item,
        createdBy: item.createdById ? userMap.get(item.createdById) : null,
      }));

      return { status: true, data: mappedData };
    } catch (error: any) {
      return { status: false, message: 'Failed to list allocations', data: [] };
    }
  }

  async get(id: string) {
    try {
      const allocation = await this.prisma.allocation.findUnique({
        where: { id },
      });

      if (!allocation) {
        return { status: false, message: `Allocation with ID ${id} not found` };
      }

      let createdBy: { firstName: string; lastName: string } | null = null;
      if (allocation.createdById) {
        createdBy = await this.prismaMaster.user.findUnique({
          where: { id: allocation.createdById },
          select: { firstName: true, lastName: true },
        });
      }

      return {
        status: true,
        data: {
          ...allocation,
          createdBy,
        },
      };
    } catch (error: any) {
      return {
        status: false,
        message: error?.message || 'Failed to get allocation',
      };
    }
  }

  async update(
    id: string,
    name: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.allocation.findUnique({
        where: { id },
      });
      if (!existing) return { status: false, message: 'Allocation not found' };

      const updated = await this.prisma.allocation.update({
        where: { id },
        data: { name },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'allocations',
        entity: 'Allocation',
        entityId: id,
        description: `Updated allocation ${name}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify({ name }),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return {
        status: true,
        data: updated,
        message: 'Allocation updated successfully',
      };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'allocations',
        entity: 'Allocation',
        entityId: id,
        description: 'Failed to update allocation',
        errorMessage: error?.message,
        newValues: JSON.stringify({ name }),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return {
        status: false,
        message: 'Failed to update allocation',
        data: null,
      };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.allocation.findUnique({
        where: { id },
      });
      if (!existing) return { status: false, message: 'Allocation not found' };

      const removed = await this.prisma.allocation.delete({
        where: { id },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'allocations',
        entity: 'Allocation',
        entityId: id,
        description: `Deleted allocation ${existing?.name}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return {
        status: true,
        data: removed,
        message: 'Allocation deleted successfully',
      };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'allocations',
        entity: 'Allocation',
        entityId: id,
        description: 'Failed to delete allocation',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return {
        status: false,
        message: 'Failed to delete allocation',
        data: null,
      };
    }
  }

  async removeBulk(
    ids: string[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!ids?.length) return { status: false, message: 'No items to delete' };
    try {
      const result = await this.prisma.allocation.deleteMany({
        where: {
          id: { in: ids },
        },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'allocations',
        entity: 'Allocation',
        description: `Bulk deleted allocations (${result.count})`,
        oldValues: JSON.stringify(ids),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return {
        status: true,
        data: ids,
        message: 'Allocations deleted successfully',
      };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'allocations',
        entity: 'Allocation',
        description: 'Failed bulk delete allocations',
        errorMessage: error?.message,
        oldValues: JSON.stringify(ids),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return {
        status: false,
        message: 'Failed to delete allocations',
        data: null,
      };
    }
  }

  async updateBulk(
    items: { id: string; name: string }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length) return { status: false, message: 'No items to update' };
    try {
      for (const item of items) {
        await this.prisma.allocation.update({
          where: { id: item.id },
          data: { name: item.name },
        });
      }
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'allocations',
        entity: 'Allocation',
        description: `Bulk updated allocations (${items.length})`,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return {
        status: true,
        data: items,
        message: 'Allocations updated successfully',
      };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'allocations',
        entity: 'Allocation',
        description: 'Failed bulk update allocations',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return {
        status: false,
        message: 'Failed to update allocations',
        data: null,
      };
    }
  }
}
