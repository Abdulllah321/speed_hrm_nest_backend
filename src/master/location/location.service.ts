import { Injectable } from '@nestjs/common';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { PrismaService } from '../../database/prisma.service';
import { runInBackground } from '../../common/utils/run-in-background.util';
import { MasterDeleteGuardService } from '../../common/services/master-delete-guard.service';

export function generateShortCode(name: string): string {
  if (!name) return 'LOC';
  return name
    .split(/[\s\-_]+/)
    .map((word) => word.replace(/[^a-zA-Z0-9]/g, ''))
    .filter((word) => word.length > 0)
    .map((word) => word[0].toUpperCase())
    .join('');
}

@Injectable()
export class LocationService {
  constructor(
    private readonly masterDeleteGuard: MasterDeleteGuardService,
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async listActive(onlyStockLocations?: boolean) {
    const where: any = {
      status: 'active',
      isDeleted: false,
    };
    if (onlyStockLocations) {
      where.isStockLocation = true;
    }
    const locations = await this.prisma.location.findMany({
      where,
      select: {
        id: true,
        name: true,
        code: true,
        shortCode: true,
        centerId: true,
        isStockLocation: true,
        locationBrands: {
          select: {
            brand: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    return locations.map((loc) => ({
      ...loc,
      brands: loc.locationBrands?.map((lb) => lb.brand) || [],
    }));
  }

  async list() {
    const items: any = await this.prisma.location.findMany({
      include: {
        pos: {
          select: {
            id: true,
            posId: true,
            name: true,
            status: true,
          },
        },
        locationBrands: {
          select: {
            brand: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      where: { isDeleted: false },
    });
    if (items?.length > 0) {
      for (const item of items) {
        if (item?.cityId) {
          const updatedItem = await this.prisma.city.findFirst({
            where: { id: item.cityId, isDeleted: false },
          });
          item.city = updatedItem;
        }
        item.brands = item.locationBrands?.map((lb: any) => lb.brand) || [];
      }
    }
    return { status: true, data: items };
  }

  async get(id: string) {
    const item: any = await this.prisma.location.findFirst({
      where: { id, isDeleted: false },
      include: {
        locationBrands: {
          select: {
            brand: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });
    if (item) {
      item.brands = item.locationBrands?.map((lb: any) => lb.brand) || [];
    }
    if (item?.cityId) {
      const updatedItem = await this.prisma.city.findFirst({
        where: { id: item.cityId, isDeleted: false },
      });
      item.city = updatedItem;
    }
    if (item?.warehouseId) {
      const warehouse = await this.prisma.warehouse.findFirst({
        where: { id: item.warehouseId, isDeleted: false },
        select: { id: true, name: true, code: true, type: true, isActive: true },
      });
      item.warehouse = warehouse;
    }
    if (!item) return { status: false, message: 'Location not found' };
    return { status: true, data: item };
  }

  async create(
    body: { name: string; code?: string; address?: string; cityId?: string; status?: string; companyId?: string; cashGLCode?: string; shortCode?: string; centerId?: string; isStockLocation?: boolean; brandIds?: string[] },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const created = await this.prisma.location.create({
        data: {
          name: body.name,
          code: body.code?.trim() || undefined,
          address: body.address || null,
          cityId: body.cityId?.trim() || null,
          companyId: body.companyId,
          status: body.status ?? 'active',
          createdById: ctx.userId,
          cashGLCode: body.cashGLCode || null,
          shortCode: body.shortCode?.trim() || generateShortCode(body.name),
          centerId: body.centerId?.trim() || null,
          isStockLocation: body.isStockLocation !== undefined ? body.isStockLocation : true,
          locationBrands: body.brandIds?.length
            ? {
                create: body.brandIds.map((brandId) => ({ brandId })),
              }
            : undefined,
        },
        include: {
          locationBrands: {
            select: { brand: { select: { id: true, name: true } } },
          },
        },
      });
      const responseData = {
        ...created,
        brands: created.locationBrands?.map((lb) => lb.brand) || [],
      };
      const response = { status: true, data: responseData };
      runInBackground(
        'Create Location',
        this.activityLogs.log({
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
        }),
      );
      return response;
    } catch (error: any) {
      runInBackground(
        'Create Location (Failure Log)',
        this.activityLogs.log({
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
        }),
      );
      return { status: false, message: 'Failed to create location' };
    }
  }

  async update(
    id: string,
    body: { name: string; code?: string; address?: string; cityId?: string; status?: string; companyId?: string; cashGLCode?: string; shortCode?: string; centerId?: string; isStockLocation?: boolean; brandIds?: string[] },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.location.findFirst({
        where: { id, isDeleted: false },
      });
      if (!existing) {
        return { status: false, message: 'Location not found' };
      }

      if (body.brandIds !== undefined) {
        await this.prisma.locationBrand.deleteMany({
          where: { locationId: id },
        });
        if (body.brandIds.length > 0) {
          await this.prisma.locationBrand.createMany({
            data: body.brandIds.map((brandId) => ({ locationId: id, brandId })),
          });
        }
      }

      const updated = await this.prisma.location.update({
        where: { id },
        data: {
          name: body.name ?? existing.name,
          code:
            body.code !== undefined && body.code?.trim()
              ? body.code.trim()
              : existing.code,
          address:
            body.address !== undefined ? body.address : existing.address,
          cityId:
            body.cityId !== undefined
              ? body.cityId?.trim() || null
              : existing.cityId,
          companyId: body.companyId ?? existing.companyId,
          status: body.status ?? existing.status ?? 'active',
          cashGLCode: body.cashGLCode !== undefined ? body.cashGLCode : existing.cashGLCode,
          shortCode:
            body.shortCode !== undefined
              ? body.shortCode?.trim() || generateShortCode(body.name ?? existing.name ?? '')
              : existing.shortCode,
          centerId:
            body.centerId !== undefined
              ? (body.centerId?.trim() || null)
              : existing.centerId,
          isStockLocation:
            body.isStockLocation !== undefined ? body.isStockLocation : existing.isStockLocation,
        },
        include: {
          locationBrands: {
            select: { brand: { select: { id: true, name: true } } },
          },
        },
      });
      const responseData = {
        ...updated,
        brands: updated.locationBrands?.map((lb) => lb.brand) || [],
      };
      const response = { status: true, data: responseData };
      runInBackground(
        'Update Location',
        this.activityLogs.log({
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
        }),
      );
      return response;
    } catch (error: any) {
      runInBackground(
        'Update Location (Failure Log)',
        this.activityLogs.log({
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
        }),
      );
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to update location',
      };
    }
  }

  async updateOtherInfo(
    id: string,
    body: {
      phone?: string;
      latitude?: number;
      longitude?: number;
      geoFenceEnabled?: boolean;
      geoFenceRadius?: number;
      ipWhitelist?: string;
      ipWhitelistEnabled?: boolean;
      fbrBposId?: string;
      fbrBearerToken?: string;
      fbrNtn?: string;
      fbrSellerName?: string;
      fbrEnabled?: boolean;
    },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.location.findFirst({
        where: { id, isDeleted: false },
      });
      if (!existing) {
        return { status: false, message: 'Location not found' };
      }
      
      const updated = await this.prisma.location.update({
        where: { id },
        data: {
          phone: body.phone !== undefined ? body.phone : existing.phone,
          latitude: body.latitude !== undefined ? body.latitude : existing.latitude,
          longitude: body.longitude !== undefined ? body.longitude : existing.longitude,
          geoFenceEnabled: body.geoFenceEnabled !== undefined ? body.geoFenceEnabled : existing.geoFenceEnabled,
          geoFenceRadius: body.geoFenceRadius !== undefined ? body.geoFenceRadius : existing.geoFenceRadius,
          ipWhitelist: body.ipWhitelist !== undefined ? body.ipWhitelist : existing.ipWhitelist,
          ipWhitelistEnabled: body.ipWhitelistEnabled !== undefined ? body.ipWhitelistEnabled : existing.ipWhitelistEnabled,
          fbrBposId: body.fbrBposId !== undefined ? body.fbrBposId : existing.fbrBposId,
          fbrBearerToken: body.fbrBearerToken !== undefined ? body.fbrBearerToken : existing.fbrBearerToken,
          fbrNtn: body.fbrNtn !== undefined ? body.fbrNtn : existing.fbrNtn,
          fbrSellerName: body.fbrSellerName !== undefined ? body.fbrSellerName : existing.fbrSellerName,
          fbrEnabled: body.fbrEnabled !== undefined ? body.fbrEnabled : existing.fbrEnabled,
        },
      });

      const response = { status: true, data: updated };
      runInBackground(
        'Update Location Other Info',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'locations',
          entity: 'Location',
          entityId: id,
          description: `Updated other info for location ${updated.name}`,
          oldValues: JSON.stringify(existing),
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );
      return response;
    } catch (error: any) {
      runInBackground(
        'Update Location Other Info (Failure Log)',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'locations',
          entity: 'Location',
          entityId: id,
          description: 'Failed to update other info for location',
          errorMessage: error?.message,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );
      return {
        status: false,
        message: error instanceof Error ? error.message : 'Failed to update location other info',
      };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const deleteBlocked = await this.masterDeleteGuard.checkBlocked(this.prisma, 'location', id);
      if (deleteBlocked) return { status: false, message: deleteBlocked };

      const existing = await this.prisma.location.findFirst({
        where: { id,
            isDeleted: false
        },
      });
      const removed = await this.prisma.location.update({
        where: { id },
          data: { isDeleted: true, deletedAt: new Date() }
    });
      const response = { status: true, data: removed };
      runInBackground(
        'Delete Location',
        this.activityLogs.log({
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
        }),
      );
      return response;
    } catch (error: any) {
      runInBackground(
        'Delete Location (Failure Log)',
        this.activityLogs.log({
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
        }),
      );
      return { status: false, message: 'Failed to delete location' };
    }
  }

  async createBulk(
    items: {
      name: string;
      code?: string;
      address?: string;
      cityId?: string;
      status?: string;
      cashGLCode?: string;
      shortCode?: string;
      centerId?: string;
    }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length)
      return { status: false, message: 'No locations to create' };
    try {
      const result = await this.prisma.location.createMany({
        data: items.map((i) => ({
          name: i.name,
          code: i.code?.trim() || undefined,
          address: i.address || null,
          cityId: i.cityId?.trim() || null,
          status: i.status ?? 'active',
          createdById: ctx.userId,
          cashGLCode: i.cashGLCode || null,
          shortCode: i.shortCode?.trim() || generateShortCode(i.name),
          centerId: i.centerId?.trim() || null,
        })),
        skipDuplicates: true,
      });
      const response = { status: true, message: 'Locations created', data: result };
      runInBackground(
        'Bulk Create Locations',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'locations',
          entity: 'Location',
          description: `Bulk created locations (${result.count})`,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );
      return response;
    } catch (error: any) {
      runInBackground(
        'Bulk Create Locations (Failure Log)',
        this.activityLogs.log({
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
        }),
      );
      return { status: false, message: 'Failed to create locations' };
    }
  }

  async updateBulk(
    items: {
      id: string;
      name: string;
      code?: string;
      address?: string;
      cityId?: string;
      status?: string;
      cashGLCode?: string;
      shortCode?: string;
      centerId?: string;
      isStockLocation?: boolean;
      brandIds?: string[];
    }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length)
      return { status: false, message: 'No locations to update' };
    try {
      for (const i of items) {
        const existing = await this.prisma.location.findFirst({
          where: { id: i.id, isDeleted: false },
        });

        if (i.brandIds !== undefined) {
          await this.prisma.locationBrand.deleteMany({
            where: { locationId: i.id },
          });
          if (i.brandIds.length > 0) {
            await this.prisma.locationBrand.createMany({
              data: i.brandIds.map((brandId) => ({ locationId: i.id, brandId })),
            });
          }
        }

        await this.prisma.location.update({
          where: { id: i.id },
          data: {
            name: i.name ?? existing?.name,
            code:
              i.code !== undefined && i.code?.trim()
                ? i.code.trim()
                : existing?.code,
            address: i.address !== undefined ? i.address : existing?.address,
            cityId:
              i.cityId !== undefined
                ? i.cityId?.trim() || null
                : existing?.cityId,
            status: i.status ?? existing?.status ?? 'active',
            cashGLCode: i.cashGLCode !== undefined ? i.cashGLCode : existing?.cashGLCode,
            shortCode:
              i.shortCode !== undefined
                ? i.shortCode?.trim() || generateShortCode(i.name ?? existing?.name ?? '')
                : existing?.shortCode,
            centerId:
              i.centerId !== undefined
                ? (i.centerId?.trim() || null)
                : existing?.centerId,
            isStockLocation:
              i.isStockLocation !== undefined ? i.isStockLocation : existing?.isStockLocation,
          },
        });
      }
      const response = { status: true, message: 'Locations updated' };
      runInBackground(
        'Bulk Update Locations',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'locations',
          entity: 'Location',
          description: `Bulk updated locations (${items.length})`,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );
      return response;
    } catch (error: any) {
      runInBackground(
        'Bulk Update Locations (Failure Log)',
        this.activityLogs.log({
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
        }),
      );
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
      for (const guardId of ids) {
        const deleteBlocked = await this.masterDeleteGuard.checkBlocked(this.prisma, 'location', guardId);
        if (deleteBlocked) return { status: false, message: deleteBlocked };
      }

      const existing = await this.prisma.location.findMany({
        where: { id: { in: ids },
            isDeleted: false
        },
      });
      const result = await this.prisma.location.updateMany({
        where: { id: { in: ids } },
          data: { isDeleted: true, deletedAt: new Date() }
    });
      const response = { status: true, message: 'Locations deleted', data: result };
      runInBackground(
        'Bulk Delete Locations',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'locations',
          entity: 'Location',
          description: `Bulk deleted locations (${result.count})`,
          oldValues: JSON.stringify(existing),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );
      return response;
    } catch (error: any) {
      runInBackground(
        'Bulk Delete Locations (Failure Log)',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'locations',
          entity: 'Location',
          description: 'Failed to bulk delete locations',
          errorMessage: error?.message,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );
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
            isDeleted: false
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

  /// Toggle the online/offline status for an outlet.
  async updateOnlineStatus(
    id: string,
    isOnline: boolean,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.location.findFirst({
        where: { id, isDeleted: false },
      });
      if (!existing) return { status: false, message: 'Location not found' };

      const updated = await this.prisma.location.update({
        where: { id },
        data: {
          isOnline,
          lastOnlineAt: isOnline ? new Date() : existing.lastOnlineAt,
        },
      });

      const response = { status: true, data: updated };
      runInBackground(
        'Update Location Online Status',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'locations',
          entity: 'Location',
          entityId: id,
          description: `Marked location ${existing.name} as ${isOnline ? 'online' : 'offline'}`,
          oldValues: JSON.stringify({ isOnline: existing.isOnline }),
          newValues: JSON.stringify({ isOnline }),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );
      return response;
    } catch (error: any) {
      return {
        status: false,
        message: error?.message || 'Failed to update online status',
      };
    }
  }
}
