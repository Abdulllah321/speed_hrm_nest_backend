import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';

@Injectable()
export class LocationService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async list() {
    const items = await this.prisma.location.findMany({
      include: { city: true },
      orderBy: { createdAt: 'desc' },
    });
    return { status: true, data: items };
  }

  async get(id: string) {
    const item = await this.prisma.location.findUnique({
      where: { id },
      include: { city: true },
    });
    if (!item) return { status: false, message: 'Location not found' };
    return { status: true, data: item };
  }

  async create(
    body: { name: string; address?: string; cityId?: string; status?: string },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const created = await this.prisma.location.create({
        data: {
          name: body.name,
          address: body.address || null,
          cityId: body.cityId?.trim() || null,
          status: body.status ?? 'active',
          createdById: ctx.userId,
        },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'locations',
        entity: 'Location',
        entityId: created.id,
        description: `Created location ${created.name}`,
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
        module: 'locations',
        entity: 'Location',
        description: 'Failed to create location',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to create location' };
    }
  }

  async update(
    id: string,
    body: { name: string; address?: string; cityId?: string; status?: string },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.location.findUnique({ where: { id } });
      const updated = await this.prisma.location.update({
        where: { id },
        data: {
          name: body.name ?? existing?.name,
          address:
            body.address !== undefined ? body.address : existing?.address,
          cityId:
            body.cityId !== undefined
              ? body.cityId?.trim() || null
              : existing?.cityId,
          status: body.status ?? existing?.status ?? 'active',
        },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'locations',
        entity: 'Location',
        entityId: id,
        description: `Updated location ${updated.name}`,
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
        module: 'locations',
        entity: 'Location',
        entityId: id,
        description: 'Failed to update location',
        errorMessage: error?.message,
        newValues: JSON.stringify(body),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to update location',
      };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.location.findUnique({ where: { id } });
      const removed = await this.prisma.location.delete({ where: { id } });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'locations',
        entity: 'Location',
        entityId: id,
        description: `Deleted location ${existing?.name}`,
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
        module: 'locations',
        entity: 'Location',
        entityId: id,
        description: 'Failed to delete location',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to delete location' };
    }
  }

  async createBulk(
    items: {
      name: string;
      address?: string;
      cityId?: string;
      status?: string;
    }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length)
      return { status: false, message: 'No locations to create' };
    try {
      const result = await this.prisma.location.createMany({
        data: items.map((i) => ({
          name: i.name,
          address: i.address || null,
          cityId: i.cityId?.trim() || null,
          status: i.status ?? 'active',
          createdById: ctx.userId,
        })),
        skipDuplicates: true,
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'locations',
        entity: 'Location',
        description: `Bulk created locations (${result.count})`,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, message: 'Locations created', data: result };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'locations',
        entity: 'Location',
        description: 'Failed to bulk create locations',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to create locations' };
    }
  }

  async updateBulk(
    items: {
      id: string;
      name: string;
      address?: string;
      cityId?: string;
      status?: string;
    }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length)
      return { status: false, message: 'No locations to update' };
    try {
      for (const i of items) {
        const existing = await this.prisma.location.findUnique({
          where: { id: i.id },
        });
        await this.prisma.location.update({
          where: { id: i.id },
          data: {
            name: i.name ?? existing?.name,
            address: i.address !== undefined ? i.address : existing?.address,
            cityId:
              i.cityId !== undefined
                ? i.cityId?.trim() || null
                : existing?.cityId,
            status: i.status ?? existing?.status ?? 'active',
          },
        });
      }
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'locations',
        entity: 'Location',
        description: `Bulk updated locations (${items.length})`,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, message: 'Locations updated' };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'update',
        module: 'locations',
        entity: 'Location',
        description: 'Failed to bulk update locations',
        errorMessage: error?.message,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to update locations' };
    }
  }

  async removeBulk(
    ids: string[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!ids?.length)
      return { status: false, message: 'No locations to delete' };
    try {
      const existing = await this.prisma.location.findMany({
        where: { id: { in: ids } },
      });
      const result = await this.prisma.location.deleteMany({
        where: { id: { in: ids } },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'locations',
        entity: 'Location',
        description: `Bulk deleted locations (${result.count})`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      return { status: true, message: 'Locations deleted', data: result };
    } catch (error: any) {
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'locations',
        entity: 'Location',
        description: 'Failed to bulk delete locations',
        errorMessage: error?.message,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'failure',
      });
      return { status: false, message: 'Failed to delete locations' };
    }
  }
}
