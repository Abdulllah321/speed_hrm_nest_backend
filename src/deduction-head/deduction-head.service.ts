import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';

@Injectable()
export class DeductionHeadService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list() {
    const items = await this.prisma.deductionHead.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { status: true, data: items };
  }

  async get(id: string) {
    const item = await this.prisma.deductionHead.findUnique({ where: { id } });
    if (!item) return { status: false, message: 'Deduction head not found' };
    return { status: true, data: item };
  }

  async create(
    name: string,
    status: string | undefined,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const created = await this.prisma.deductionHead.create({
        data: { name, status: status || 'active', createdById: ctx.userId },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'deduction-heads',
        entity: 'DeductionHead',
        entityId: created.id,
        description: `Created deduction head ${name}`,
        newValues: JSON.stringify({ name, status: status || 'active' }),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, data: created };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'deduction-heads',
        entity: 'DeductionHead',
        description: 'Failed to create deduction head',
        errorMessage: error?.message,
        newValues: JSON.stringify({ name, status: status || 'active' }),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to create deduction head' };
    }
  }

  async createBulk(
    items: { name: string; status?: string }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length) return { status: false, message: 'No items to create' };
    try {
      const result = await this.prisma.deductionHead.createMany({
        data: items.map((item) => ({
          name: item.name,
          status: item.status || 'active',
          createdById: ctx.userId,
        })),
        skipDuplicates: true,
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'deduction-heads',
        entity: 'DeductionHead',
        description: `Bulk created deduction heads (${result.count})`,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, message: 'Deduction heads created' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'deduction-heads',
        entity: 'DeductionHead',
        description: 'Failed bulk create deduction heads',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to create deduction heads' };
    }
  }

  async update(
    id: string,
    name: string,
    status: string | undefined,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.deductionHead.findUnique({
        where: { id },
      });
      const updateData: { name: string; status?: string } = { name };
      if (status !== undefined) updateData.status = status;
      const updated = await this.prisma.deductionHead.update({
        where: { id },
        data: updateData,
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'deduction-heads',
        entity: 'DeductionHead',
        entityId: id,
        description: `Updated deduction head ${name}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(updateData),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, data: updated };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'deduction-heads',
        entity: 'DeductionHead',
        entityId: id,
        description: 'Failed to update deduction head',
        errorMessage: error?.message,
        newValues: JSON.stringify({ name, status }),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to update deduction head' };
    }
  }

  async updateBulk(
    items: { id: string; name: string; status?: string }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length) return { status: false, message: 'No items to update' };
    try {
      for (const item of items) {
        const updateData: { name: string; status?: string } = {
          name: item.name,
        };
        if (item.status !== undefined) updateData.status = item.status;
        await this.prisma.deductionHead.update({
          where: { id: item.id },
          data: updateData,
        });
      }
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'deduction-heads',
        entity: 'DeductionHead',
        description: `Bulk updated deduction heads (${items.length})`,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, message: 'Deduction heads updated' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'deduction-heads',
        entity: 'DeductionHead',
        description: 'Failed bulk update deduction heads',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to update deduction heads' };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.deductionHead.findUnique({
        where: { id },
      });
      const removed = await this.prisma.deductionHead.delete({ where: { id } });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'deduction-heads',
        entity: 'DeductionHead',
        entityId: id,
        description: `Deleted deduction head ${existing?.name}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, data: removed };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'deduction-heads',
        entity: 'DeductionHead',
        entityId: id,
        description: 'Failed to delete deduction head',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to delete deduction head' };
    }
  }

  async removeBulk(
    ids: string[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!ids?.length) return { status: false, message: 'No items to delete' };
    try {
      const removed = await this.prisma.deductionHead.deleteMany({
        where: { id: { in: ids } },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'deduction-heads',
        entity: 'DeductionHead',
        description: `Bulk deleted deduction heads (${removed.count})`,
        oldValues: JSON.stringify(ids),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, message: 'Deduction heads deleted' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'deduction-heads',
        entity: 'DeductionHead',
        description: 'Failed bulk delete deduction heads',
        errorMessage: error?.message,
        oldValues: JSON.stringify(ids),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to delete deduction heads' };
    }
  }
}
