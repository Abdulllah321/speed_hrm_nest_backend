import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { runInBackground } from '../../common/utils/run-in-background.util';
import { MasterDeleteGuardService } from '../../common/services/master-delete-guard.service';

@Injectable()
export class CityService {
  constructor(
    private readonly masterDeleteGuard: MasterDeleteGuardService,
    private prisma: PrismaService,

    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private activityLogs: ActivityLogsService,
  ) {}

  async getAllCountries() {
    const cacheKey = 'countries_all';
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return { status: true, data: cached };

    const countries = await this.prisma.country.findMany({
      include: { cities: true },
      orderBy: { name: 'asc' },
    });
    await this.cacheManager.set(cacheKey, countries, 86400000); // 24h TTL
    return { status: true, data: countries };
  }

  async getStates() {
    const cacheKey = 'states_all';
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return { status: true, data: cached };

    const states = await this.prisma.state.findMany({
      orderBy: { name: 'asc' },
    });
    await this.cacheManager.set(cacheKey, states, 86400000); // 24h TTL
    return { status: true, data: states };
  }

  async getStatesByCountry(countryId: string) {
    const cacheKey = `states_country_${countryId}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return { status: true, data: cached };

    const states = await this.prisma.state.findMany({
      where: { countryId },
      orderBy: { name: 'asc' },
    });
    await this.cacheManager.set(cacheKey, states, 86400000);
    return { status: true, data: states };
  }

  async getCitiesByState(stateId: string) {
    const cacheKey = `cities_state_${stateId}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return { status: true, data: cached };

    const cities = await this.prisma.city.findMany({
      where: { stateId,
          isDeleted: false
    },
      orderBy: { name: 'asc' },
    });
    await this.cacheManager.set(cacheKey, cities, 3600000); // 1h
    return { status: true, data: cities };
  }

  async getCities() {
    const cacheKey = 'cities_all';
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return { status: true, data: cached };

    const cities = await this.prisma.city.findMany({
      include: { country: true, state: true },
      orderBy: { name: 'asc' },
        where: { isDeleted: false }
    });
    await this.cacheManager.set(cacheKey, cities, 3600000);
    return { status: true, data: cities };
  }

  async create(
    body: { name: string; countryId: string; stateId: string; status?: string },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const created = await this.prisma.city.create({
        data: {
          name: body.name,
          countryId: body.countryId,
          stateId: body.stateId,
          status: body.status ?? 'active',
          createdById: ctx.userId,
        },
      });
      const response = { status: true, data: created };
      runInBackground(
        'Create City',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'cities',
          entity: 'City',
          entityId: created.id,
          description: `Created city ${created.name}`,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
        this.cacheManager.del('cities_all'),
        this.cacheManager.del(`cities_state_${body.stateId}`),
      );
      return response;
    } catch (error: any) {
      runInBackground(
        'Create City (Failure Log)',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'cities',
          entity: 'City',
          description: 'Failed to create city',
          errorMessage: error?.message,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );

      if (error?.code === 'P2002') {
        return {
          status: false,
          message: 'A city with this name already exists in this state',
        };
      }

      return { status: false, message: 'Failed to create city' };
    }
  }

  async update(
    id: string,
    body: {
      name?: string;
      countryId?: string;
      stateId?: string;
      status?: string;
    },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.city.findFirst({
        where: { id,
            isDeleted: false
        },
      });
      if (!existing) {
        return { status: false, message: 'City not found' };
      }

      const updated = await this.prisma.city.update({
        where: { id },
        data: {
          name: body.name ?? existing.name,
          countryId: body.countryId ?? existing.countryId,
          stateId: body.stateId ?? existing.stateId,
          status: body.status ?? existing.status,
        },
      });
      const response = { status: true, data: updated };
      const cacheOps = [
        this.cacheManager.del('cities_all'),
      ];
      if (existing.stateId)
        cacheOps.push(this.cacheManager.del(`cities_state_${existing.stateId}`));
      if (body.stateId && body.stateId !== existing.stateId)
        cacheOps.push(this.cacheManager.del(`cities_state_${body.stateId}`));
      
      runInBackground(
        'Update City',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'cities',
          entity: 'City',
          entityId: id,
          description: `Updated city ${updated.name}`,
          oldValues: JSON.stringify(existing),
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
        ...cacheOps,
      );
      return response;
    } catch (error: any) {
      runInBackground(
        'Update City (Failure Log)',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'cities',
          entity: 'City',
          entityId: id,
          description: 'Failed to update city',
          errorMessage: error?.message,
          newValues: JSON.stringify(body),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );

      if (error?.code === 'P2002') {
        return {
          status: false,
          message: 'A city with this name already exists in this state',
        };
      }

      return { status: false, message: 'Failed to update city' };
    }
  }

  async remove(
    id: string,
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const deleteBlocked = await this.masterDeleteGuard.checkBlocked(this.prisma, 'city', id);
      if (deleteBlocked) return { status: false, message: deleteBlocked };

      const existing = await this.prisma.city.findFirst({
        where: { id,
            isDeleted: false
        },
      });
      if (!existing) {
        return { status: false, message: 'City not found' };
      }

      const removed = await this.prisma.city.update({ where: { id },
          data: { isDeleted: true, deletedAt: new Date() }
    });
      const response = { status: true, data: removed };
      const cacheOps = [this.cacheManager.del('cities_all')];
      if (existing.stateId)
        cacheOps.push(this.cacheManager.del(`cities_state_${existing.stateId}`));
      
      runInBackground(
        'Delete City',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'cities',
          entity: 'City',
          entityId: id,
          description: `Deleted city ${existing.name}`,
          oldValues: JSON.stringify(existing),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
        ...cacheOps,
      );
      return response;
    } catch (error: any) {
      runInBackground(
        'Delete City (Failure Log)',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'cities',
          entity: 'City',
          entityId: id,
          description: 'Failed to delete city',
          errorMessage: error?.message,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );
      return { status: false, message: 'Failed to delete city' };
    }
  }

  async removeBulk(
    ids: string[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!ids?.length) return { status: false, message: 'No cities to delete' };
    try {
      for (const guardId of ids) {
        const deleteBlocked = await this.masterDeleteGuard.checkBlocked(this.prisma, 'city', guardId);
        if (deleteBlocked) return { status: false, message: deleteBlocked };
      }

      const existing = await this.prisma.city.findMany({
        where: { id: { in: ids },
            isDeleted: false
        },
      });
      const result = await this.prisma.city.updateMany({
        where: { id: { in: ids } },
          data: { isDeleted: true, deletedAt: new Date() }
    });
      const response = { status: true, message: 'Cities deleted', data: result };
      const cacheOps = [this.cacheManager.del('cities_all')];
      // Invalidate related states from the existing records
      const stateIds = new Set(existing.map((c) => c.stateId));
      for (const sid of stateIds) {
        if (sid) cacheOps.push(this.cacheManager.del(`cities_state_${sid}`));
      }
      
      runInBackground(
        'Bulk Delete Cities',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'cities',
          entity: 'City',
          description: `Bulk deleted cities (${result.count})`,
          oldValues: JSON.stringify(existing),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
        ...cacheOps,
      );
      return response;
    } catch (error: any) {
      runInBackground(
        'Bulk Delete Cities (Failure Log)',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'cities',
          entity: 'City',
          description: 'Failed to bulk delete cities',
          errorMessage: error?.message,
          oldValues: JSON.stringify(ids),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );
      return { status: false, message: 'Failed to delete cities' };
    }
  }

  async createCitiesBulk(
    items: {
      name: string;
      countryId: string;
      stateId: string;
      status?: string;
    }[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!items?.length) return { status: false, message: 'No items to create' };
    try {
      const result = await this.prisma.city.createMany({
        data: items.map((i) => ({
          name: i.name,
          countryId: i.countryId,
          stateId: i.stateId,
          status: i.status ?? 'active',
          createdById: ctx.userId,
        })),
        skipDuplicates: true,
      });
      const response = { status: true, message: 'Cities created', data: result };
      const cacheOps = [this.cacheManager.del('cities_all')];
      const stateIds = new Set(items.map((i) => i.stateId));
      for (const sid of stateIds) {
        if (sid) cacheOps.push(this.cacheManager.del(`cities_state_${sid}`));
      }
      
      runInBackground(
        'Bulk Create Cities',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'cities',
          entity: 'City',
          description: `Bulk created cities (${result.count})`,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
        ...cacheOps,
      );
      return response;
    } catch (error: any) {
      runInBackground(
        'Bulk Create Cities (Failure Log)',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'cities',
          entity: 'City',
          description: 'Failed bulk create cities',
          errorMessage: error?.message,
          newValues: JSON.stringify(items),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );
      return { status: false, message: 'Failed to create cities' };
    }
  }
}
