import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../../../prisma/prisma.service';
import { ActivityLogsService } from '../../../activity-logs/activity-logs.service';
import { PrismaMasterService } from '../../../database/prisma-master.service';
import { runInBackground } from '../../../common/utils/run-in-background.util';
import {
  CreateSizeDto,
  UpdateSizeDto,
  BulkUpdateSizeItemDto,
} from './dto/size.dto';

@Injectable()
export class SizeService {
  constructor(
    private prisma: PrismaService,
    private prismaMaster: PrismaMasterService,

    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private activityLogs: ActivityLogsService,
  ) {}

  async getAllSizes() {
    const cacheKey = 'sizes_all';
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      return { status: true, data: cachedData };
    }

    const sizes = await this.prisma.size.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const userIds = [
      ...new Set(sizes.map((s) => s.createdById).filter(Boolean)),
    ];
    const users = await this.prismaMaster.user.findMany({
      where: { id: { in: userIds as string[] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const data = sizes.map((size) => {
      const creator = size.createdById ? userMap.get(size.createdById) : null;
      return {
        ...size,
        createdBy: creator
          ? `${creator.firstName} ${creator.lastName || ''}`.trim()
          : null,
      };
    });

    await this.cacheManager.set(cacheKey, data, 3600000);
    return { status: true, data };
  }

  async getSizeById(id: string) {
    const size = await this.prisma.size.findUnique({
      where: { id },
    });
    if (!size) return { status: false, message: 'Size not found' };

    let createdBy: string | null = null;
    if (size.createdById) {
      const user = await this.prismaMaster.user.findUnique({
        where: { id: size.createdById },
        select: { firstName: true, lastName: true },
      });
      if (user) createdBy = `${user.firstName} ${user.lastName || ''}`.trim();
    }

    return { status: true, data: { ...size, createdBy } };
  }

  async createSizes(items: CreateSizeDto[], createdById: string) {
    try {
      const sizes = await this.prisma.size.createMany({
        data: items.map((item) => ({
          name: item.name,
          status: item.status || 'active',
          createdById,
        })),
        skipDuplicates: true,
      });

      const response = {
        status: true,
        data: sizes,
        message: 'Sizes created successfully',
      };
      runInBackground(
        'Create Sizes',
        this.activityLogs.log({
          userId: createdById,
          action: 'create',
          module: 'sizes',
          entity: 'Size',
          description: `Created sizes (${sizes.count})`,
          newValues: JSON.stringify(items),
          status: 'success',
        }),
        this.cacheManager.del('sizes_all'),
      );
      return response;
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async updateSize(
    id: string,
    dto: UpdateSizeDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.size.findUnique({
        where: { id },
      });
      const size = await this.prisma.size.update({
        where: { id },
        data: { name: dto.name, status: dto.status },
      });

      const response = { status: true, data: size, message: 'Size updated successfully' };
      runInBackground(
        'Update Size',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sizes',
          entity: 'Size',
          entityId: id,
          description: `Updated size ${size.name}`,
          oldValues: JSON.stringify(existing),
          newValues: JSON.stringify(dto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
        this.cacheManager.del('sizes_all'),
      );
      return response;
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async updateSizes(
    dtos: BulkUpdateSizeItemDto[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const validDtos = dtos.filter((d) => d.id && d.id.trim().length > 0);
      const updated: any[] = [];
      for (const dto of validDtos) {
        updated.push(
          await this.prisma.size.update({
            where: { id: dto.id },
            data: { name: dto.name, status: dto.status },
          }),
        );
      }

      const response = {
        status: true,
        data: updated,
        message: 'Sizes updated successfully',
      };
      runInBackground(
        'Bulk Update Sizes',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sizes',
          entity: 'Size',
          description: `Bulk updated sizes (${updated.length})`,
          newValues: JSON.stringify(dtos),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
        this.cacheManager.del('sizes_all'),
      );
      return response;
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async deleteSizes(
    ids: string[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const result = await this.prisma.size.deleteMany({
        where: { id: { in: ids } },
      });
      const response = {
        status: true,
        data: result,
        message: 'Sizes deleted successfully',
      };
      runInBackground(
        'Bulk Delete Sizes',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'sizes',
          entity: 'Size',
          description: `Bulk deleted sizes (${result.count})`,
          oldValues: JSON.stringify(ids),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
        this.cacheManager.del('sizes_all'),
      );
      return response;
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async deleteSize(
    id: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.size.findUnique({
        where: { id },
      });
      const result = await this.prisma.size.delete({ where: { id } });

      const response = {
        status: true,
        data: result,
        message: 'Size deleted successfully',
      };
      runInBackground(
        'Delete Size',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'sizes',
          entity: 'Size',
          entityId: id,
          description: `Deleted size ${existing?.name}`,
          oldValues: JSON.stringify(existing),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
        this.cacheManager.del('sizes_all'),
      );
      return response;
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }
}
