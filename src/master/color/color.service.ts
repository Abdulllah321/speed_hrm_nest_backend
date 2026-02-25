import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { PrismaMasterService } from '../../database/prisma-master.service';
import {
  CreateColorDto,
  UpdateColorDto,
  BulkUpdateColorItemDto,
} from './dto/color.dto';

@Injectable()
export class ColorService {
  constructor(
    private prisma: PrismaService,
    private prismaMaster: PrismaMasterService,
    private activityLogs: ActivityLogsService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async getAllColors() {
    const cacheKey = 'colors_all';
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      return { status: true, data: cachedData };
    }

    const colors = await this.prisma.color.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const userIds = [
      ...new Set(colors.map((s) => s.createdById).filter(Boolean)),
    ];
    const users = await this.prismaMaster.user.findMany({
      where: { id: { in: userIds as string[] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const data = colors.map((item) => {
      const creator = item.createdById ? userMap.get(item.createdById) : null;
      return {
        ...item,
        createdBy: creator
          ? `${creator.firstName} ${creator.lastName || ''}`.trim()
          : null,
      };
    });

    await this.cacheManager.set(cacheKey, data, 3600000);
    return { status: true, data };
  }

  async getColorById(id: string) {
    const item = await this.prisma.color.findUnique({
      where: { id },
    });
    if (!item) return { status: false, message: 'Color not found' };

    let createdBy: string | null = null;
    if (item.createdById) {
      const user = await this.prismaMaster.user.findUnique({
        where: { id: item.createdById },
        select: { firstName: true, lastName: true },
      });
      if (user) createdBy = `${user.firstName} ${user.lastName || ''}`.trim();
    }

    return { status: true, data: { ...item, createdBy } };
  }

  async createColors(items: CreateColorDto[], createdById: string) {
    try {
      const result = await this.prisma.color.createMany({
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
        module: 'colors',
        entity: 'Color',
        description: `Created colors (${result.count})`,
        newValues: JSON.stringify(items),
        status: 'success',
      });
      await this.cacheManager.del('colors_all');
      return {
        status: true,
        data: result,
        message: 'Colors created successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async updateColor(
    id: string,
    dto: UpdateColorDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.color.findUnique({
        where: { id },
      });
      const result = await this.prisma.color.update({
        where: { id },
        data: { name: dto.name, status: dto.status },
      });

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'update',
        module: 'colors',
        entity: 'Color',
        entityId: id,
        description: `Updated color ${result.name}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(dto),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('colors_all');
      return {
        status: true,
        data: result,
        message: 'Color updated successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async updateColors(
    dtos: BulkUpdateColorItemDto[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const updated: any[] = [];
      for (const dto of dtos) {
        updated.push(
          await this.prisma.color.update({
            where: { id: dto.id },
            data: { name: dto.name, status: dto.status },
          }),
        );
      }

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'update',
        module: 'colors',
        entity: 'Color',
        description: `Bulk updated colors (${updated.length})`,
        newValues: JSON.stringify(dtos),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('colors_all');
      return {
        status: true,
        data: updated,
        message: 'Colors updated successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async deleteColors(
    ids: string[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const result = await this.prisma.color.deleteMany({
        where: { id: { in: ids } },
      });
      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'delete',
        module: 'colors',
        entity: 'Color',
        description: `Bulk deleted colors (${result.count})`,
        oldValues: JSON.stringify(ids),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('colors_all');
      return {
        status: true,
        data: result,
        message: 'Colors deleted successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async deleteColor(
    id: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.color.findUnique({
        where: { id },
      });
      const result = await this.prisma.color.delete({ where: { id } });

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'delete',
        module: 'colors',
        entity: 'Color',
        entityId: id,
        description: `Deleted color ${existing?.name}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('colors_all');
      return {
        status: true,
        data: result,
        message: 'Color deleted successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }
}
