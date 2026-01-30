import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';

@Injectable()
export class CityService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
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
      where: { stateId },
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
      await this.activityLogs.log({
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
      });
      await this.cacheManager.del('cities_all');
      await this.cacheManager.del(`cities_state_${body.stateId}`);
      return { status: true, data: created };
    } catch (error: any) {
      await this.activityLogs.log({
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
      });

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
      const existing = await this.prisma.city.findUnique({ where: { id } });
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
      await this.activityLogs.log({
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
      });
      await this.cacheManager.del('cities_all');
      if (existing.stateId)
        await this.cacheManager.del(`cities_state_${existing.stateId}`);
      if (body.stateId && body.stateId !== existing.stateId)
        await this.cacheManager.del(`cities_state_${body.stateId}`);
      return { status: true, data: updated };
    } catch (error: any) {
      await this.activityLogs.log({
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
      });

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
      const existing = await this.prisma.city.findUnique({ where: { id } });
      if (!existing) {
        return { status: false, message: 'City not found' };
      }

      const removed = await this.prisma.city.delete({ where: { id } });
      await this.activityLogs.log({
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
      });
      await this.cacheManager.del('cities_all');
      if (existing.stateId)
        await this.cacheManager.del(`cities_state_${existing.stateId}`);
      return { status: true, data: removed };
    } catch (error: any) {
      await this.activityLogs.log({
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
      });
      return { status: false, message: 'Failed to delete city' };
    }
  }

  async removeBulk(
    ids: string[],
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (!ids?.length) return { status: false, message: 'No cities to delete' };
    try {
      const existing = await this.prisma.city.findMany({
        where: { id: { in: ids } },
      });
      const result = await this.prisma.city.deleteMany({
        where: { id: { in: ids } },
      });
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'delete',
        module: 'cities',
        entity: 'City',
        description: `Bulk deleted cities (${result.count})`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('cities_all');
      // Invalidate related states from the existing records
      const stateIds = new Set(existing.map((c) => c.stateId));
      for (const sid of stateIds) {
        if (sid) await this.cacheManager.del(`cities_state_${sid}`);
      }
      return { status: true, message: 'Cities deleted', data: result };
    } catch (error: any) {
      await this.activityLogs.log({
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
      });
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
      await this.activityLogs.log({
        userId: ctx.userId,
        action: 'create',
        module: 'cities',
        entity: 'City',
        description: `Bulk created cities (${result.count})`,
        newValues: JSON.stringify(items),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('cities_all');
      const stateIds = new Set(items.map((i) => i.stateId));
      for (const sid of stateIds) {
        if (sid) await this.cacheManager.del(`cities_state_${sid}`);
      }
      return { status: true, message: 'Cities created', data: result };
    } catch (error: any) {
      await this.activityLogs.log({
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
      });
      return { status: false, message: 'Failed to create cities' };
    }
  }
}
