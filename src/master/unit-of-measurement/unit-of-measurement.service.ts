import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { PrismaMasterService } from '../../database/prisma-master.service';
import {
  CreateUnitOfMeasurementDto,
  UpdateUnitOfMeasurementDto,
  BulkUpdateUnitOfMeasurementItemDto,
} from './dto/unit-of-measurement.dto';
import { runInBackground } from '../../common/utils/run-in-background.util';

@Injectable()
export class UnitOfMeasurementService {
  constructor(
    private prisma: PrismaService,
    private prismaMaster: PrismaMasterService,
    private activityLogs: ActivityLogsService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async getAll() {
    const cacheKey = 'units_of_measurement_all';
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      return { status: true, data: cachedData };
    }

    const units = await this.prisma.unitOfMeasurement.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const userIds = [
      ...new Set(units.map((u) => u.createdById).filter(Boolean)),
    ];
    const users = await this.prismaMaster.user.findMany({
      where: { id: { in: userIds as string[] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const data = units.map((unit) => {
      const creator = unit.createdById ? userMap.get(unit.createdById) : null;
      return {
        ...unit,
        createdBy: creator
          ? `${creator.firstName} ${creator.lastName || ''}`.trim()
          : null,
      };
    });

    await this.cacheManager.set(cacheKey, data, 3600000); // 1 hour TTL
    return { status: true, data };
  }

  async getById(id: string) {
    const unit = await this.prisma.unitOfMeasurement.findUnique({
      where: { id },
    });
    if (!unit) return { status: false, message: 'Unit of measurement not found' };

    let createdBy: string | null = null;
    if (unit.createdById) {
      const user = await this.prismaMaster.user.findUnique({
        where: { id: unit.createdById },
        select: { firstName: true, lastName: true },
      });
      if (user) createdBy = `${user.firstName} ${user.lastName || ''}`.trim();
    }

    return { status: true, data: { ...unit, createdBy } };
  }

  async createBulk(items: CreateUnitOfMeasurementDto[], createdById: string) {
    try {
      const units = await this.prisma.unitOfMeasurement.createMany({
        data: items.map((item) => ({
          name: item.name,
          abbreviation: item.abbreviation,
          status: item.status || 'active',
          createdById,
        })),
        skipDuplicates: true,
      });

      runInBackground(
        `Created units of measurement (${units.count})`,
        this.activityLogs.log({
          userId: createdById,
          action: 'create',
          module: 'units-of-measurement',
          entity: 'UnitOfMeasurement',
          description: `Created units of measurement (${units.count})`,
          newValues: JSON.stringify(items),
          status: 'success',
        }),
      );
      await this.cacheManager.del('units_of_measurement_all');
      return {
        status: true,
        data: units,
        message: 'Units of measurement created successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async update(
    id: string,
    dto: UpdateUnitOfMeasurementDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.unitOfMeasurement.findUnique({
        where: { id },
      });
      if (!existing) return { status: false, message: 'Unit of measurement not found' };

      const unit = await this.prisma.unitOfMeasurement.update({
        where: { id },
        data: { 
          name: dto.name, 
          abbreviation: dto.abbreviation,
          status: dto.status 
        },
      });

      runInBackground(
        `Updated unit of measurement ${unit.name}`,
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'units-of-measurement',
          entity: 'UnitOfMeasurement',
          entityId: id,
          description: `Updated unit of measurement ${unit.name}`,
          oldValues: JSON.stringify(existing),
          newValues: JSON.stringify(dto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );
      await this.cacheManager.del('units_of_measurement_all');
      return {
        status: true,
        data: unit,
        message: 'Unit of measurement updated successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async updateBulk(
    dtos: BulkUpdateUnitOfMeasurementItemDto[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const validDtos = dtos.filter((d) => d.id && d.id.trim().length > 0);
      const updated: any[] = [];
      for (const dto of validDtos) {
        updated.push(
          await this.prisma.unitOfMeasurement.update({
            where: { id: dto.id },
            data: { 
              name: dto.name, 
              abbreviation: dto.abbreviation,
              status: dto.status 
            },
          }),
        );
      }

      runInBackground(
        `Bulk updated units of measurement (${updated.length})`,
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'units-of-measurement',
          entity: 'UnitOfMeasurement',
          description: `Bulk updated units of measurement (${updated.length})`,
          newValues: JSON.stringify(dtos),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );
      await this.cacheManager.del('units_of_measurement_all');
      return {
        status: true,
        data: updated,
        message: 'Units of measurement updated successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async deleteBulk(
    ids: string[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const result = await this.prisma.unitOfMeasurement.deleteMany({
        where: { id: { in: ids } },
      });
      runInBackground(
        `Bulk deleted units of measurement (${result.count})`,
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'units-of-measurement',
          entity: 'UnitOfMeasurement',
          description: `Bulk deleted units of measurement (${result.count})`,
          oldValues: JSON.stringify(ids),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );
      await this.cacheManager.del('units_of_measurement_all');
      return {
        status: true,
        data: result,
        message: 'Units of measurement deleted successfully',
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
      const existing = await this.prisma.unitOfMeasurement.findUnique({
        where: { id },
      });
      if (!existing) return { status: false, message: 'Unit of measurement not found' };

      const result = await this.prisma.unitOfMeasurement.delete({ where: { id } });

      runInBackground(
        `Deleted unit of measurement ${existing.name}`,
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'units-of-measurement',
          entity: 'UnitOfMeasurement',
          entityId: id,
          description: `Deleted unit of measurement ${existing.name}`,
          oldValues: JSON.stringify(existing),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );
      await this.cacheManager.del('units_of_measurement_all');
      return {
        status: true,
        data: result,
        message: 'Unit of measurement deleted successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }
}
