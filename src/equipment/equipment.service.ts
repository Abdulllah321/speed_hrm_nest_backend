import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';

@Injectable()
export class EquipmentService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list() {
    const items = await this.prisma.equipment.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { status: true, data: items };
  }

  async get(id: string) {
    const item = await this.prisma.equipment.findUnique({ where: { id } });
    if (!item) return { status: false, message: 'Equipment not found' };
    return { status: true, data: item };
  }

  async create(
    body: { name: string; status?: string },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const created = await this.prisma.equipment.create({
        data: {
          name: body.name,
          status: body.status ?? 'active',
          createdById: ctx.userId,
        },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'equipments',
        entity: 'Equipment',
        entityId: created.id,
        description: `Created equipment ${created.name}`,
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
        module: 'equipments',
        entity: 'Equipment',
        description: 'Failed to create equipment',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to create equipment' };
    }
  }

  async update(
    id: string,
    body: { name: string; status?: string },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.equipment.findUnique({
        where: { id },
      });
      const updated = await this.prisma.equipment.update({
        where: { id },
        data: {
          name: body.name ?? existing?.name,
          status: body.status ?? existing?.status ?? 'active',
        },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'equipments',
        entity: 'Equipment',
        entityId: id,
        description: `Updated equipment ${updated.name}`,
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
        module: 'equipments',
        entity: 'Equipment',
        entityId: id,
        description: 'Failed to update equipment',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to update equipment' };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.equipment.findUnique({
        where: { id },
      });
      const removed = await this.prisma.equipment.delete({ where: { id } });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'equipments',
        entity: 'Equipment',
        entityId: id,
        description: `Deleted equipment ${existing?.name}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, data: removed, message: 'Deleted successfully' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'equipments',
        entity: 'Equipment',
        entityId: id,
        description: 'Failed to delete equipment',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to delete equipment' };
    }
  }

  async createBulk(
    items: { name: string; status?: string }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length)
      return { status: false, message: 'No equipments to create' };
    try {
      const result = await this.prisma.equipment.createMany({
        data: items.map((i) => ({
          name: i.name,
          status: i.status ?? 'active',
          createdById: ctx.userId,
        })),
        skipDuplicates: true,
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'equipments',
        entity: 'Equipment',
        description: `Bulk created equipments (${result.count})`,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, message: 'Equipments created', data: result };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'equipments',
        entity: 'Equipment',
        description: 'Failed to bulk create equipments',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to create equipments' };
    }
  }

  async updateBulk(
    items: { id: string; name: string; status?: string }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length)
      return { status: false, message: 'No equipments to update' };
    try {
      for (const i of items) {
        const existing = await this.prisma.equipment.findUnique({
          where: { id: i.id },
        });
        await this.prisma.equipment.update({
          where: { id: i.id },
          data: {
            name: i.name ?? existing?.name,
            status: i.status ?? existing?.status ?? 'active',
          },
        });
      }
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'equipments',
        entity: 'Equipment',
        description: `Bulk updated equipments (${items.length})`,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, message: 'Equipments updated' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'equipments',
        entity: 'Equipment',
        description: 'Failed to bulk update equipments',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to update equipments' };
    }
  }

  async removeBulk(
    ids: string[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!ids?.length)
      return { status: false, message: 'No equipments to delete' };
    try {
      const existing = await this.prisma.equipment.findMany({
        where: { id: { in: ids } },
      });
      const result = await this.prisma.equipment.deleteMany({
        where: { id: { in: ids } },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'equipments',
        entity: 'Equipment',
        description: `Bulk deleted equipments (${result.count})`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, message: 'Equipments deleted', data: result };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'equipments',
        entity: 'Equipment',
        description: 'Failed to bulk delete equipments',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to delete equipments' };
    }
  }
}
