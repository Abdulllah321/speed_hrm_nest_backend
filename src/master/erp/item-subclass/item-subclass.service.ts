import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ActivityLogsService } from '../../../activity-logs/activity-logs.service';
import { PrismaMasterService } from '../../../database/prisma-master.service';
import { PrismaService } from '../../../database/prisma.service';

import {
  CreateItemSubclassDto,
  UpdateItemSubclassDto,
  BulkUpdateItemSubclassItemDto,
} from './dto/item-subclass.dto';

@Injectable()
export class ItemSubclassService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,    private prismaMaster: PrismaMasterService,
    
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async getAll() {
    const cacheKey = 'item_subclasses_all';
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      return { status: true, data: cachedData };
    }

    const subclasses = await this.prisma.itemSubclass.findMany({
      include: {
        itemClass: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const userIds = [
      ...new Set(subclasses.map((s) => s.createdById).filter(Boolean)),
    ];
    const users = await this.prismaMaster.user.findMany({
      where: { id: { in: userIds as string[] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const data = subclasses.map((subclass) => {
      const creator = subclass.createdById
        ? userMap.get(subclass.createdById)
        : null;
      return {
        ...subclass,
        itemClassName: subclass.itemClass.name,
        createdBy: creator
          ? `${creator.firstName} ${creator.lastName || ''}`.trim()
          : null,
      };
    });

    await this.cacheManager.set(cacheKey, data, 3600000); // 1 hour TTL
    return { status: true, data };
  }

  async getById(id: string) {
    const subclass = await this.prisma.itemSubclass.findUnique({
      where: { id },
      include: { itemClass: true },
    });
    if (!subclass) return { status: false, message: 'Item Subclass not found' };

    let createdBy: string | null = null;
    if (subclass.createdById) {
      const user = await this.prismaMaster.user.findUnique({
        where: { id: subclass.createdById },
        select: { firstName: true, lastName: true },
      });
      if (user) createdBy = `${user.firstName} ${user.lastName || ''}`.trim();
    }

    return { status: true, data: { ...subclass, createdBy } };
  }

  async getByClass(itemClassId: string) {
    const subclasses = await this.prisma.itemSubclass.findMany({
      where: { itemClassId },
      include: { itemClass: true },
      orderBy: { createdAt: 'desc' },
    });
    return { status: true, data: subclasses };
  }

  async createMany(items: CreateItemSubclassDto[], createdById: string) {
    try {
      const result = await this.prisma.itemSubclass.createMany({
        data: items.map((item) => ({
          name: item.name,
          itemClassId: item.itemClassId,
          status: item.status || 'active',
          createdById,
        })),
        skipDuplicates: true,
      });

      await this.activityLogs.log({
        userId: createdById,
        action: 'create',
        module: 'item-subclasses',
        entity: 'ItemSubclass',
        description: `Created item subclasses (${result.count})`,
        newValues: JSON.stringify(items),
        status: 'success',
      });
      await this.cacheManager.del('item_subclasses_all');
      await this.cacheManager.del('item_classes_all');
      return {
        status: true,
        data: result,
        message: 'Item subclasses created successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async update(
    id: string,
    dto: UpdateItemSubclassDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.itemSubclass.findUnique({
        where: { id },
      });
      if (!existing)
        return { status: false, message: 'Item Subclass not found' };

      const subclass = await this.prisma.itemSubclass.update({
        where: { id },
        data: {
          name: dto.name,
          itemClassId: dto.itemClassId,
          status: dto.status,
        },
      });

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'update',
        module: 'item-subclasses',
        entity: 'ItemSubclass',
        entityId: id,
        description: `Updated item subclass ${subclass.name}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(dto),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('item_subclasses_all');
      await this.cacheManager.del('item_classes_all');
      return {
        status: true,
        data: subclass,
        message: 'Item subclass updated successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async updateMany(
    dtos: BulkUpdateItemSubclassItemDto[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const updated: any[] = [];
      for (const dto of dtos) {
        updated.push(
          await this.prisma.itemSubclass.update({
            where: { id: dto.id },
            data: {
              name: dto.name,
              itemClassId: dto.itemClassId,
              status: dto.status,
            },
          }),
        );
      }

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'update',
        module: 'item-subclasses',
        entity: 'ItemSubclass',
        description: `Bulk updated item subclasses (${updated.length})`,
        newValues: JSON.stringify(dtos),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('item_subclasses_all');
      await this.cacheManager.del('item_classes_all');
      return {
        status: true,
        data: updated,
        message: 'Item subclasses updated successfully',
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
      const result = await this.prisma.itemSubclass.deleteMany({
        where: { id: { in: ids } },
      });
      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'delete',
        module: 'item-subclasses',
        entity: 'ItemSubclass',
        description: `Bulk deleted item subclasses (${result.count})`,
        oldValues: JSON.stringify(ids),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('item_subclasses_all');
      await this.cacheManager.del('item_classes_all');
      return {
        status: true,
        data: result,
        message: 'Item subclasses deleted successfully',
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
      const existing = await this.prisma.itemSubclass.findUnique({
        where: { id },
      });
      const result = await this.prisma.itemSubclass.delete({
        where: { id },
      });

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'delete',
        module: 'item-subclasses',
        entity: 'ItemSubclass',
        entityId: id,
        description: `Deleted item subclass ${existing?.name}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('item_subclasses_all');
      await this.cacheManager.del('item_classes_all');
      return {
        status: true,
        data: result,
        message: 'Item subclass deleted successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }
}
