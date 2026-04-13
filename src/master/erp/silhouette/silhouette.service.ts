import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../../../prisma/prisma.service';
import { ActivityLogsService } from '../../../activity-logs/activity-logs.service';
import { PrismaMasterService } from '../../../database/prisma-master.service';
import {
  CreateSilhouetteDto,
  UpdateSilhouetteDto,
  BulkUpdateSilhouetteItemDto,
} from './dto/silhouette.dto';

@Injectable()
export class SilhouetteService {
  constructor(
    private prisma: PrismaService,
    private prismaMaster: PrismaMasterService,
    private activityLogs: ActivityLogsService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async getAllSilhouettes() {
    const cacheKey = 'silhouettes_all';
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      return { status: true, data: cachedData };
    }

    const silhouettes = await this.prisma.silhouette.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const userIds = [
      ...new Set(silhouettes.map((s) => s.createdById).filter(Boolean)),
    ];
    const users = await this.prismaMaster.user.findMany({
      where: { id: { in: userIds as string[] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const data = silhouettes.map((silhouette) => {
      const creator = silhouette.createdById
        ? userMap.get(silhouette.createdById)
        : null;
      return {
        ...silhouette,
        createdBy: creator
          ? `${creator.firstName} ${creator.lastName || ''}`.trim()
          : null,
      };
    });

    await this.cacheManager.set(cacheKey, data, 3600000);
    return { status: true, data };
  }

  async getSilhouetteById(id: string) {
    const silhouette = await this.prisma.silhouette.findUnique({
      where: { id },
    });
    if (!silhouette) return { status: false, message: 'Silhouette not found' };

    let createdBy: string | null = null;
    if (silhouette.createdById) {
      const user = await this.prismaMaster.user.findUnique({
        where: { id: silhouette.createdById },
        select: { firstName: true, lastName: true },
      });
      if (user) createdBy = `${user.firstName} ${user.lastName || ''}`.trim();
    }

    return { status: true, data: { ...silhouette, createdBy } };
  }

  async createSilhouettes(items: CreateSilhouetteDto[], createdById: string) {
    try {
      const silhouettes = await this.prisma.silhouette.createMany({
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
        module: 'silhouettes',
        entity: 'Silhouette',
        description: `Created silhouettes (${silhouettes.count})`,
        newValues: JSON.stringify(items),
        status: 'success',
      });
      await this.cacheManager.del('silhouettes_all');
      return {
        status: true,
        data: silhouettes,
        message: 'Silhouettes created successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async updateSilhouette(
    id: string,
    dto: UpdateSilhouetteDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.silhouette.findUnique({
        where: { id },
      });
      const silhouette = await this.prisma.silhouette.update({
        where: { id },
        data: { name: dto.name, status: dto.status },
      });

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'update',
        module: 'silhouettes',
        entity: 'Silhouette',
        entityId: id,
        description: `Updated silhouette ${silhouette.name}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(dto),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('silhouettes_all');
      return {
        status: true,
        data: silhouette,
        message: 'Silhouette updated successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async updateSilhouettes(
    dtos: BulkUpdateSilhouetteItemDto[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const validDtos = dtos.filter((d) => d.id && d.id.trim().length > 0);
      const updated: any[] = [];
      for (const dto of validDtos) {
        updated.push(
          await this.prisma.silhouette.update({
            where: { id: dto.id },
            data: { name: dto.name, status: dto.status },
          }),
        );
      }

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'update',
        module: 'silhouettes',
        entity: 'Silhouette',
        description: `Bulk updated silhouettes (${updated.length})`,
        newValues: JSON.stringify(dtos),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('silhouettes_all');
      return {
        status: true,
        data: updated,
        message: 'Silhouettes updated successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async deleteSilhouettes(
    ids: string[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const result = await this.prisma.silhouette.deleteMany({
        where: { id: { in: ids } },
      });
      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'delete',
        module: 'silhouettes',
        entity: 'Silhouette',
        description: `Bulk deleted silhouettes (${result.count})`,
        oldValues: JSON.stringify(ids),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('silhouettes_all');
      return {
        status: true,
        data: result,
        message: 'Silhouettes deleted successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async deleteSilhouette(
    id: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.silhouette.findUnique({
        where: { id },
      });
      const result = await this.prisma.silhouette.delete({
        where: { id },
      });

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'delete',
        module: 'silhouettes',
        entity: 'Silhouette',
        entityId: id,
        description: `Deleted silhouette ${existing?.name}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('silhouettes_all');
      return {
        status: true,
        data: result,
        message: 'Silhouette deleted successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }
}
