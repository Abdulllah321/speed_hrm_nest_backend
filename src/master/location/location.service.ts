import { Injectable } from '@nestjs/common';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class LocationService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async listActive() {
    return this.prisma.location.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        name: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async list() {
    const items: any = await this.prisma.location.findMany({
      include: {
        pos: {
          select: {
            id: true,
            posId: true,
            name: true,
            status: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
    });
    if (items?.length > 0) {
      for (const item of items) {
        if (item?.cityId) {
          const updatedItem = await this.prisma.city.findUnique({
            where: { id: item.cityId },
          });
          item.city = updatedItem;
        }
      }
    }
    return { status: true, data: items };
  }

  async get(id: string) {
    const item: any = await this.prisma.location.findUnique({
      where: { id },
    });
    if (item?.cityId) {
      const updatedItem = await this.prisma.city.findUnique({
        where: { id: item.cityId },
      });
      item.city = updatedItem;
    }
    if (!item) return { status: false, message: 'Location not found' };
    return { status: true, data: item };
  }

  async create(
    body: { name: string; address?: string; cityId?: string; status?: string; companyId?: string },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const created = await this.prisma.location.create({
        data: {
          name: body.name,
          address: body.address || null,
          cityId: body.cityId?.trim() || null,
          companyId: body.companyId,
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
    body: { name: string; address?: string; cityId?: string; status?: string; companyId?: string },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.location.findUnique({
        where: { id },
      });
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
          companyId: body.companyId ?? existing?.companyId,
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
      const existing = await this.prisma.location.findUnique({
        where: { id },
      });
      const removed = await this.prisma.location.delete({
        where: { id },
      });
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

  /**
   * Find the nearest location based on latitude and longitude using Haversine formula
   */
  async findNearestLocation(latitude: number, longitude: number) {
    try {
      const locations = await this.prisma.location.findMany({
        where: {
          status: 'active',
          latitude: { not: null },
          longitude: { not: null },
        },
        select: {
          id: true,
          name: true,
          address: true,
          latitude: true,
          longitude: true,
        },
      });

      if (locations.length === 0) {
        return { status: false, message: 'No locations with coordinates found' };
      }

      // Haversine formula to calculate distance
      const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
        const R = 6371; // Earth's radius in kilometers
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
      };

      // Calculate distances and find nearest
      let nearestLocation = locations[0];
      let minDistance = calculateDistance(
        latitude,
        longitude,
        Number(locations[0].latitude),
        Number(locations[0].longitude)
      );

      for (let i = 1; i < locations.length; i++) {
        const distance = calculateDistance(
          latitude,
          longitude,
          Number(locations[i].latitude),
          Number(locations[i].longitude)
        );
        if (distance < minDistance) {
          minDistance = distance;
          nearestLocation = locations[i];
        }
      }

      return {
        status: true,
        data: {
          ...nearestLocation,
          distance: Math.round(minDistance * 100) / 100, // Round to 2 decimal places
        },
      };
    } catch (error: any) {
      return {
        status: false,
        message: error?.message || 'Failed to find nearest location',
      };
    }
  }
}
