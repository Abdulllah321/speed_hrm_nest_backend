import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { PrismaMasterService } from '../../database/prisma-master.service';
import {
  CreateChannelClassDto,
  UpdateChannelClassDto,
  BulkUpdateChannelClassItemDto,
} from './dto/channel-class.dto';

@Injectable()
export class ChannelClassService {
  constructor(
    private prisma: PrismaService,
private prismaMaster: PrismaMasterService,    private activityLogs: ActivityLogsService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async getAllChannelClasses() {
    const cacheKey = 'channel_classes_all';
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      return { status: true, data: cachedData };
    }

    const channelClasses = await this.prisma.channelClass.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const userIds = [
      ...new Set(channelClasses.map((s) => s.createdById).filter(Boolean)),
    ];
    const users = await this.prismaMaster.user.findMany({
      where: { id: { in: userIds as string[] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const data = channelClasses.map((item) => {
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

  async getChannelClassById(id: string) {
    const item = await this.prisma.channelClass.findUnique({
      where: { id },
    });
    if (!item) return { status: false, message: 'Channel Class not found' };

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

  async createChannelClasses(
    items: CreateChannelClassDto[],
    createdById: string,
  ) {
    try {
      const result = await this.prisma.channelClass.createMany({
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
        module: 'channel-classes',
        entity: 'ChannelClass',
        description: `Created channel classes (${result.count})`,
        newValues: JSON.stringify(items),
        status: 'success',
      });
      await this.cacheManager.del('channel_classes_all');
      return {
        status: true,
        data: result,
        message: 'Channel Classes created successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async updateChannelClass(
    id: string,
    dto: UpdateChannelClassDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.channelClass.findUnique({
        where: { id },
      });
      const result = await this.prisma.channelClass.update({
        where: { id },
        data: { name: dto.name, status: dto.status },
      });

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'update',
        module: 'channel-classes',
        entity: 'ChannelClass',
        entityId: id,
        description: `Updated channel class ${result.name}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(dto),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('channel_classes_all');
      return {
        status: true,
        data: result,
        message: 'Channel Class updated successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async updateChannelClasses(
    dtos: BulkUpdateChannelClassItemDto[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const updated: any[] = [];
      for (const dto of dtos) {
        updated.push(
          await this.prisma.channelClass.update({
            where: { id: dto.id },
            data: { name: dto.name, status: dto.status },
          }),
        );
      }

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'update',
        module: 'channel-classes',
        entity: 'ChannelClass',
        description: `Bulk updated channel classes (${updated.length})`,
        newValues: JSON.stringify(dtos),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('channel_classes_all');
      return {
        status: true,
        data: updated,
        message: 'Channel Classes updated successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async deleteChannelClasses(
    ids: string[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const result = await this.prisma.channelClass.deleteMany({
        where: { id: { in: ids } },
      });
      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'delete',
        module: 'channel-classes',
        entity: 'ChannelClass',
        description: `Bulk deleted channel classes (${result.count})`,
        oldValues: JSON.stringify(ids),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('channel_classes_all');
      return {
        status: true,
        data: result,
        message: 'Channel Classes deleted successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async deleteChannelClass(
    id: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.channelClass.findUnique({
        where: { id },
      });
      const result = await this.prisma.channelClass.delete({
        where: { id },
      });

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'delete',
        module: 'channel-classes',
        entity: 'ChannelClass',
        entityId: id,
        description: `Deleted channel class ${existing?.name}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('channel_classes_all');
      return {
        status: true,
        data: result,
        message: 'Channel Class deleted successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }
}
