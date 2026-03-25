import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../../../prisma/prisma.service';
import { ActivityLogsService } from '../../../activity-logs/activity-logs.service';
import { PrismaMasterService } from '../../../database/prisma-master.service';
import {
  CreateGenderDto,
  UpdateGenderDto,
  BulkUpdateGenderItemDto,
} from './dto/gender.dto';

@Injectable()
export class GenderService {
  constructor(
    private prisma: PrismaService,
    private prismaMaster: PrismaMasterService,
    private activityLogs: ActivityLogsService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async getAllGenders() {
    const cacheKey = 'genders_all';
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      return { status: true, data: cachedData };
    }

    const genders = await this.prisma.gender.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const userIds = [
      ...new Set(genders.map((g) => g.createdById).filter(Boolean)),
    ];
    const users = await this.prismaMaster.user.findMany({
      where: { id: { in: userIds as string[] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const data = genders.map((gender) => {
      const creator = gender.createdById
        ? userMap.get(gender.createdById)
        : null;
      return {
        ...gender,
        createdBy: creator
          ? `${creator.firstName} ${creator.lastName || ''}`.trim()
          : null,
      };
    });

    await this.cacheManager.set(cacheKey, data, 3600000);
    return { status: true, data };
  }

  async getGenderById(id: string) {
    const gender = await this.prisma.gender.findUnique({
      where: { id },
    });
    if (!gender) return { status: false, message: 'Gender not found' };

    let createdBy: string | null = null;
    if (gender.createdById) {
      const user = await this.prismaMaster.user.findUnique({
        where: { id: gender.createdById },
        select: { firstName: true, lastName: true },
      });
      if (user) createdBy = `${user.firstName} ${user.lastName || ''}`.trim();
    }

    return { status: true, data: { ...gender, createdBy } };
  }

  async createGenders(items: CreateGenderDto[], createdById: string) {
    try {
      const genders = await this.prisma.gender.createMany({
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
        module: 'genders',
        entity: 'Gender',
        description: `Created genders (${genders.count})`,
        newValues: JSON.stringify(items),
        status: 'success',
      });
      await this.cacheManager.del('genders_all');
      return {
        status: true,
        data: genders,
        message: 'Genders created successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async updateGender(
    id: string,
    dto: UpdateGenderDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.gender.findUnique({
        where: { id },
      });
      const gender = await this.prisma.gender.update({
        where: { id },
        data: { name: dto.name, status: dto.status },
      });

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'update',
        module: 'genders',
        entity: 'Gender',
        entityId: id,
        description: `Updated gender ${gender.name}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(dto),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('genders_all');
      return {
        status: true,
        data: gender,
        message: 'Gender updated successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async updateGenders(
    dtos: BulkUpdateGenderItemDto[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const validDtos = dtos.filter((d) => d.id && d.id.trim().length > 0);
      const updated: any[] = [];
      for (const dto of validDtos) {
        updated.push(
          await this.prisma.gender.update({
            where: { id: dto.id },
            data: { name: dto.name, status: dto.status },
          }),
        );
      }

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'update',
        module: 'genders',
        entity: 'Gender',
        description: `Bulk updated genders (${updated.length})`,
        newValues: JSON.stringify(dtos),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('genders_all');
      return {
        status: true,
        data: updated,
        message: 'Genders updated successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async deleteGenders(
    ids: string[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const result = await this.prisma.gender.deleteMany({
        where: { id: { in: ids } },
      });
      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'delete',
        module: 'genders',
        entity: 'Gender',
        description: `Bulk deleted genders (${result.count})`,
        oldValues: JSON.stringify(ids),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('genders_all');
      return {
        status: true,
        data: result,
        message: 'Genders deleted successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async deleteGender(
    id: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.gender.findUnique({
        where: { id },
      });
      const result = await this.prisma.gender.delete({ where: { id } });

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'delete',
        module: 'genders',
        entity: 'Gender',
        entityId: id,
        description: `Deleted gender ${existing?.name}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('genders_all');
      return {
        status: true,
        data: result,
        message: 'Gender deleted successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }
}
