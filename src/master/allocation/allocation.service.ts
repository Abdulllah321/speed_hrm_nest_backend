import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';

@Injectable()
export class AllocationService {
  constructor(
    private prisma: PrismaService,
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
    const items = await this.prisma.allocation.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });
    return { status: true, data: items };
  }

  async get(id: string) {
    const allocation = await this.prisma.allocation.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!allocation) {
      return { status: false, message: `Allocation with ID ${id} not found` };
    }

    return { status: true, data: allocation };
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
