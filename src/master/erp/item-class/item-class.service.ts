import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ActivityLogsService } from '../../../activity-logs/activity-logs.service';
import { PrismaMasterService } from '../../../database/prisma-master.service';
import { PrismaService } from '../../../database/prisma.service';

import {
  CreateItemClassDto,
  UpdateItemClassDto,
  BulkUpdateItemClassItemDto,
} from './dto/item-class.dto';

@Injectable()
export class ItemClassService {
  constructor(
    private prisma: PrismaService,    private prismaMaster: PrismaMasterService,

    private activityLogs: ActivityLogsService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async getAll() {
    const cacheKey = 'item_classes_all';
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      return { status: true, data: cachedData };
    }

    const classes = await this.prisma.itemClass.findMany({
      include: {
        subclasses: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const userIds = [
      ...new Set(classes.map((c) => c.createdById).filter(Boolean)),
    ];
    const users = await this.prismaMaster.user.findMany({
      where: { id: { in: userIds as string[] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const data = classes.map((itemClass) => {
      const creator = itemClass.createdById
        ? userMap.get(itemClass.createdById)
        : null;
      return {
        ...itemClass,
        createdBy: creator
          ? `${creator.firstName} ${creator.lastName || ''}`.trim()
          : null,
        subclassesCount: itemClass.subclasses.length,
      };
    });

    await this.cacheManager.set(cacheKey, data, 3600000); // 1 hour TTL
    return { status: true, data };
  }

  async getById(id: string) {
    const itemClass = await this.prisma.itemClass.findUnique({
      where: { id },
      include: { subclasses: true },
    });
    if (!itemClass) return { status: false, message: 'Item Class not found' };

    let createdBy: string | null = null;
    if (itemClass.createdById) {
      const user = await this.prismaMaster.user.findUnique({
        where: { id: itemClass.createdById },
        select: { firstName: true, lastName: true },
      });
      if (user) createdBy = `${user.firstName} ${user.lastName || ''}`.trim();
    }

    return { status: true, data: { ...itemClass, createdBy } };
  }

  async createMany(items: CreateItemClassDto[], createdById: string) {
    try {
      const result = await this.prisma.itemClass.createMany({
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
        module: 'item-classes',
        entity: 'ItemClass',
        description: `Created item classes (${result.count})`,
        newValues: JSON.stringify(items),
        status: 'success',
      });
      await this.cacheManager.del('item_classes_all');
      return {
        status: true,
        data: result,
        message: 'Item classes created successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async update(
    id: string,
    dto: UpdateItemClassDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.itemClass.findUnique({
        where: { id },
      });
      if (!existing) return { status: false, message: 'Item Class not found' };

      const itemClass = await this.prisma.itemClass.update({
        where: { id },
        data: { name: dto.name, status: dto.status },
      });

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'update',
        module: 'item-classes',
        entity: 'ItemClass',
        entityId: id,
        description: `Updated item class ${itemClass.name}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(dto),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('item_classes_all');
      return {
        status: true,
        data: itemClass,
        message: 'Item class updated successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async updateMany(
    dtos: BulkUpdateItemClassItemDto[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const updated: any[] = [];
      for (const dto of dtos) {
        updated.push(
          await this.prisma.itemClass.update({
            where: { id: dto.id },
            data: { name: dto.name, status: dto.status },
          }),
        );
      }

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'update',
        module: 'item-classes',
        entity: 'ItemClass',
        description: `Bulk updated item classes (${updated.length})`,
        newValues: JSON.stringify(dtos),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('item_classes_all');
      return {
        status: true,
        data: updated,
        message: 'Item classes updated successfully',
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
      const result = await this.prisma.itemClass.deleteMany({
        where: { id: { in: ids } },
      });
      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'delete',
        module: 'item-classes',
        entity: 'ItemClass',
        description: `Bulk deleted item classes (${result.count})`,
        oldValues: JSON.stringify(ids),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('item_classes_all');
      return {
        status: true,
        data: result,
        message: 'Item classes deleted successfully',
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
      const existing = await this.prisma.itemClass.findUnique({
        where: { id },
      });
      const result = await this.prisma.itemClass.delete({
        where: { id },
      });

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'delete',
        module: 'item-classes',
        entity: 'ItemClass',
        entityId: id,
        description: `Deleted item class ${existing?.name}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('item_classes_all');
      return {
        status: true,
        data: result,
        message: 'Item class deleted successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }
}
