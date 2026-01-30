import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';

@Injectable()
export class BankService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list() {
    const items = await this.prisma.bank.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { status: true, data: items };
  }

  async get(id: string) {
    const item = await this.prisma.bank.findUnique({ where: { id } });
    if (!item) return { status: false, message: 'Bank not found' };
    return { status: true, data: item };
  }

  async create(
    body: {
      name: string;
      code?: string;
      accountNumberPrefix?: string;
      status?: string;
    },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const created = await this.prisma.bank.create({
        data: {
          name: body.name,
          code: body.code || null,
          accountNumberPrefix: body.accountNumberPrefix || null,
          status: body.status ?? 'active',
          createdById: ctx.userId,
        },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'banks',
        entity: 'Bank',
        entityId: created.id,
        description: `Created bank ${created.name}`,
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
        module: 'banks',
        entity: 'Bank',
        description: 'Failed to create bank',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to create bank' };
    }
  }

  async createBulk(
    items: {
      name: string;
      code?: string;
      accountNumberPrefix?: string;
      status?: string;
    }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length) return { status: false, message: 'No items to create' };
    try {
      const res = await this.prisma.bank.createMany({
        data: items.map((i) => ({
          name: i.name,
          code: i.code || null,
          accountNumberPrefix: i.accountNumberPrefix || null,
          status: i.status ?? 'active',
          createdById: ctx.userId,
        })),
        skipDuplicates: true,
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'banks',
        entity: 'Bank',
        description: `Bulk created ${res.count} banks`,
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
        module: 'banks',
        entity: 'Bank',
        description: 'Failed bulk create banks',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to create banks' };
    }
  }

  async update(
    id: string,
    body: {
      name?: string;
      code?: string;
      accountNumberPrefix?: string;
      status?: string;
    },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.bank.findUnique({
        where: { id },
      });
      if (!existing) return { status: false, message: 'Bank not found' };
      const updated = await this.prisma.bank.update({
        where: { id },
        data: {
          name: body.name ?? existing.name,
          code: body.code !== undefined ? body.code || null : existing.code,
          accountNumberPrefix:
            body.accountNumberPrefix !== undefined
              ? body.accountNumberPrefix || null
              : existing.accountNumberPrefix,
          status: body.status ?? existing.status,
          updatedById: ctx.userId,
        },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'banks',
        entity: 'Bank',
        entityId: id,
        description: `Updated bank ${updated.name}`,
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
        module: 'banks',
        entity: 'Bank',
        entityId: id,
        description: 'Failed to update bank',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to update bank' };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.bank.findUnique({
        where: { id },
      });
      if (!existing) return { status: false, message: 'Bank not found' };
      await this.prisma.bank.delete({ where: { id } });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'banks',
        entity: 'Bank',
        entityId: id,
        description: `Deleted bank ${existing.name}`,
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
        module: 'banks',
        entity: 'Bank',
        entityId: id,
        description: 'Failed to delete bank',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to delete bank' };
    }
  }

  async updateBulk(
    items: {
      id: string;
      name: string;
      code?: string;
      accountNumberPrefix?: string;
      status?: string;
    }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length) return { status: false, message: 'No items to update' };
    try {
      for (const i of items) {
        await this.prisma.bank.update({
          where: { id: i.id },
          data: {
            name: i.name,
            code: i.code || null,
            accountNumberPrefix: i.accountNumberPrefix || null,
            status: i.status ?? 'active',
            updatedById: ctx.userId,
          },
        });
      }
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'banks',
        entity: 'Bank',
        description: `Bulk updated ${items.length} banks`,
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
        module: 'banks',
        entity: 'Bank',
        description: 'Failed bulk update banks',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to update banks' };
    }
  }

  async removeBulk(
    ids: string[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!ids?.length) return { status: false, message: 'No items to delete' };
    try {
      await this.prisma.bank.deleteMany({ where: { id: { in: ids } } });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'banks',
        entity: 'Bank',
        description: `Bulk deleted ${ids.length} banks`,
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
        module: 'banks',
        entity: 'Bank',
        description: 'Failed bulk delete banks',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to delete banks' };
    }
  }
}
