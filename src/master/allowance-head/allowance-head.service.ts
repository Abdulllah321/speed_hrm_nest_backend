import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';

@Injectable()
export class AllowanceHeadService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list() {
    const items = await this.prisma.allowanceHead.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { status: true, data: items };
  }

  async get(id: string) {
    const item = await this.prisma.allowanceHead.findUnique({ where: { id } });
    if (!item) return { status: false, message: 'Allowance head not found' };
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
      const created = await this.prisma.allowanceHead.create({
        data: {
          name: body.name,
          calculationType: body.calculationType ?? 'Amount',
          amount: body.amount ? Number(body.amount) : null,
          percentage: body.percentage ? Number(body.percentage) : null,
          status: body.status || 'active',
          createdById: ctx.userId,
        },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'allowance-heads',
        entity: 'AllowanceHead',
        entityId: created.id,
        description: `Created allowance head ${body.name}`,
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
        module: 'allowance-heads',
        entity: 'AllowanceHead',
        description: 'Failed to create allowance head',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to create allowance head' };
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
      const result = await this.prisma.allowanceHead.createMany({
        data: items.map((item) => ({
          name: item.name,
          calculationType: item.calculationType ?? 'Amount',
          amount: item.amount ? Number(item.amount) : null,
          percentage: item.percentage ? Number(item.percentage) : null,
          status: item.status || 'active',
          createdById: ctx.userId,
        })),
        skipDuplicates: true,
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'allowance-heads',
        entity: 'AllowanceHead',
        description: `Bulk created allowance heads (${result.count})`,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, message: 'Allowance heads created' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'allowance-heads',
        entity: 'AllowanceHead',
        description: 'Failed bulk create allowance heads',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to create allowance heads' };
    }
  }

  async update(
    id: string,
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
      const existing = await this.prisma.allowanceHead.findUnique({
        where: { id },
      });
      const updateData: {
        name: string;
        calculationType?: string;
        amount?: number | null;
        percentage?: number | null;
        status?: string;
      } = { name: body.name };
      if (body.calculationType !== undefined)
        updateData.calculationType = body.calculationType;
      if (body.amount !== undefined)
        updateData.amount = body.amount ? Number(body.amount) : null;
      if (body.percentage !== undefined)
        updateData.percentage = body.percentage
          ? Number(body.percentage)
          : null;
      if (body.status !== undefined) updateData.status = body.status;
      const updated = await this.prisma.allowanceHead.update({
        where: { id },
        data: updateData,
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'allowance-heads',
        entity: 'AllowanceHead',
        entityId: id,
        description: `Updated allowance head ${body.name}`,
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
        module: 'allowance-heads',
        entity: 'AllowanceHead',
        entityId: id,
        description: 'Failed to update allowance head',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to update allowance head' };
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
      for (const item of items) {
        const updateData: {
          name: string;
          calculationType?: string;
          amount?: number | null;
          percentage?: number | null;
          status?: string;
        } = { name: item.name };
        if (item.calculationType !== undefined)
          updateData.calculationType = item.calculationType;
        if (item.amount !== undefined)
          updateData.amount = item.amount ? Number(item.amount) : null;
        if (item.percentage !== undefined)
          updateData.percentage = item.percentage
            ? Number(item.percentage)
            : null;
        if (item.status !== undefined) updateData.status = item.status;
        await this.prisma.allowanceHead.update({
          where: { id: item.id },
          data: updateData,
        });
      }
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'allowance-heads',
        entity: 'AllowanceHead',
        description: `Bulk updated allowance heads (${items.length})`,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, message: 'Allowance heads updated' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'allowance-heads',
        entity: 'AllowanceHead',
        description: 'Failed bulk update allowance heads',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to update allowance heads' };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.allowanceHead.findUnique({
        where: { id },
      });
      const removed = await this.prisma.allowanceHead.delete({ where: { id } });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'allowance-heads',
        entity: 'AllowanceHead',
        entityId: id,
        description: `Deleted allowance head ${existing?.name}`,
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
        module: 'allowance-heads',
        entity: 'AllowanceHead',
        entityId: id,
        description: 'Failed to delete allowance head',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to delete allowance head' };
    }
  }

  async removeBulk(
    ids: string[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!ids?.length) return { status: false, message: 'No items to delete' };
    try {
      const removed = await this.prisma.allowanceHead.deleteMany({
        where: { id: { in: ids } },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'allowance-heads',
        entity: 'AllowanceHead',
        description: `Bulk deleted allowance heads (${removed.count})`,
        oldValues: JSON.stringify(ids),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, message: 'Allowance heads deleted' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'allowance-heads',
        entity: 'AllowanceHead',
        description: 'Failed bulk delete allowance heads',
        errorMessage: error?.message,
        oldValues: JSON.stringify(ids),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to delete allowance heads' };
    }
  }
}
