import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ActivityLogsService } from '../../../activity-logs/activity-logs.service';
import { PrismaMasterService } from '../../../database/prisma-master.service';
import { PrismaService } from '../../../database/prisma.service';

import {
  CreateOldSeasonDto,
  UpdateOldSeasonDto,
  BulkUpdateOldSeasonItemDto,
} from './dto/old-season.dto';

@Injectable()
export class OldSeasonService {
  constructor(
    private prisma: PrismaService,    private prismaMaster: PrismaMasterService,
    
    private activityLogs: ActivityLogsService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async getAll() {
    const cacheKey = 'old_seasons_all';
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      return { status: true, data: cachedData };
    }

    const oldSeasons = await this.prisma.oldSeason.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const userIds = [
      ...new Set(oldSeasons.map((s) => s.createdById).filter(Boolean)),
    ];
    const users = await this.prismaMaster.user.findMany({
      where: { id: { in: userIds as string[] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const data = oldSeasons.map((season) => {
      const creator = season.createdById
        ? userMap.get(season.createdById)
        : null;
      return {
        ...season,
        createdBy: creator
          ? `${creator.firstName} ${creator.lastName || ''}`.trim()
          : null,
      };
    });

    await this.cacheManager.set(cacheKey, data, 3600000);
    return { status: true, data };
  }

  async getById(id: string) {
    const season = await this.prisma.oldSeason.findUnique({
      where: { id },
    });
    if (!season) return { status: false, message: 'Old Season not found' };

    let createdBy: string | null = null;
    if (season.createdById) {
      const user = await this.prismaMaster.user.findUnique({
        where: { id: season.createdById },
        select: { firstName: true, lastName: true },
      });
      if (user) createdBy = `${user.firstName} ${user.lastName || ''}`.trim();
    }

    return { status: true, data: { ...season, createdBy } };
  }

  async createMany(items: CreateOldSeasonDto[], createdById: string) {
    try {
      const result = await this.prisma.oldSeason.createMany({
        data: items.map((item) => ({
          name: item.name,
          status: item.status || 'active',
          createdById,
        })),
        skipDuplicates: true,
      });

      await this.activityLogs.log({
        userId: createdById,
        action: 'create',
        module: 'old-seasons',
        entity: 'OldSeason',
        description: `Created old seasons (${result.count})`,
        newValues: JSON.stringify(items),
        status: 'success',
      });
      await this.cacheManager.del('old_seasons_all');
      return {
        status: true,
        data: result,
        message: 'Old seasons created successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async update(
    id: string,
    dto: UpdateOldSeasonDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.oldSeason.findUnique({
        where: { id },
      });
      if (!existing) return { status: false, message: 'Old Season not found' };

      const updated = await this.prisma.oldSeason.update({
        where: { id },
        data: { name: dto.name, status: dto.status },
      });

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'update',
        module: 'old-seasons',
        entity: 'OldSeason',
        entityId: id,
        description: `Updated old season ${updated.name}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(dto),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('old_seasons_all');
      return {
        status: true,
        data: updated,
        message: 'Old season updated successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async updateMany(
    dtos: BulkUpdateOldSeasonItemDto[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const updated: any[] = [];
      for (const dto of dtos) {
        updated.push(
          await this.prisma.oldSeason.update({
            where: { id: dto.id },
            data: { name: dto.name, status: dto.status },
          }),
        );
      }

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'update',
        module: 'old-seasons',
        entity: 'OldSeason',
        description: `Bulk updated old seasons (${updated.length})`,
        newValues: JSON.stringify(dtos),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('old_seasons_all');
      return {
        status: true,
        data: updated,
        message: 'Old seasons updated successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async deleteMany(
    ids: string[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const result = await this.prisma.oldSeason.deleteMany({
        where: { id: { in: ids } },
      });
      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'delete',
        module: 'old-seasons',
        entity: 'OldSeason',
        description: `Bulk deleted old seasons (${result.count})`,
        oldValues: JSON.stringify(ids),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('old_seasons_all');
      return {
        status: true,
        data: result,
        message: 'Old seasons deleted successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async delete(
    id: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.oldSeason.findUnique({
        where: { id },
      });
      const result = await this.prisma.oldSeason.delete({
        where: { id },
      });

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'delete',
        module: 'old-seasons',
        entity: 'OldSeason',
        entityId: id,
        description: `Deleted old season ${existing?.name}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('old_seasons_all');
      return {
        status: true,
        data: result,
        message: 'Old season deleted successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }
}
