import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../../../prisma/prisma.service';
import { ActivityLogsService } from '../../../activity-logs/activity-logs.service';
import { PrismaMasterService } from '../../../database/prisma-master.service';
import {
  CreateBrandDto,
  UpdateBrandDto,
  BulkUpdateBrandItemDto,
} from './dto/brand.dto';
import { CreateDivisionDto, UpdateDivisionDto } from './dto/division.dto';

@Injectable()
export class BrandService {
  constructor(
    private prisma: PrismaService,
    private prismaMaster: PrismaMasterService,
    private activityLogs: ActivityLogsService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  // --- BRAND LOGIC ---

  async getAllBrands() {
    const cacheKey = 'brands_all';
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      return { status: true, data: cachedData };
    }

    const brands = await this.prisma.brand.findMany({
      include: {
        divisions: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const userIds = [
      ...new Set(brands.map((b) => b.createdById).filter(Boolean)),
    ];
    const users = await this.prismaMaster.user.findMany({
      where: { id: { in: userIds as string[] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const data = brands.map((brand) => {
      const creator = brand.createdById ? userMap.get(brand.createdById) : null;
      return {
        ...brand,
        createdBy: creator
          ? `${creator.firstName} ${creator.lastName || ''}`.trim()
          : null,
        divisionsCount: brand.divisions.length,
      };
    });

    await this.cacheManager.set(cacheKey, data, 3600000); // 1 hour TTL
    return { status: true, data };
  }

  async getBrandById(id: string) {
    const brand = await this.prisma.brand.findUnique({
      where: { id },
      include: { divisions: true },
    });
    if (!brand) return { status: false, message: 'Brand not found' };

    let createdBy: string | null = null;
    if (brand.createdById) {
      const user = await this.prismaMaster.user.findUnique({
        where: { id: brand.createdById },
        select: { firstName: true, lastName: true },
      });
      if (user) createdBy = `${user.firstName} ${user.lastName || ''}`.trim();
    }

    return { status: true, data: { ...brand, createdBy } };
  }

  async createBrands(items: CreateBrandDto[], createdById: string) {
    try {
      const brands = await this.prisma.brand.createMany({
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
        module: 'brands',
        entity: 'Brand',
        description: `Created brands (${brands.count})`,
        newValues: JSON.stringify(items),
        status: 'success',
      });
      await this.cacheManager.del('brands_all');
      return {
        status: true,
        data: brands,
        message: 'Brands created successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async updateBrand(
    id: string,
    dto: UpdateBrandDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.brand.findUnique({
        where: { id },
      });
      const brand = await this.prisma.brand.update({
        where: { id },
        data: { name: dto.name, status: dto.status },
      });

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'update',
        module: 'brands',
        entity: 'Brand',
        entityId: id,
        description: `Updated brand ${brand.name}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(dto),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('brands_all');
      return {
        status: true,
        data: brand,
        message: 'Brand updated successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async updateBrands(
    dtos: BulkUpdateBrandItemDto[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const validDtos = dtos.filter((d) => d.id && d.id.trim().length > 0);
      const updated: any[] = [];
      for (const dto of validDtos) {
        updated.push(
          await this.prisma.brand.update({
            where: { id: dto.id },
            data: { name: dto.name, status: dto.status },
          }),
        );
      }

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'update',
        module: 'brands',
        entity: 'Brand',
        description: `Bulk updated brands (${updated.length})`,
        newValues: JSON.stringify(dtos),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('brands_all');
      return {
        status: true,
        data: updated,
        message: 'Brands updated successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async deleteBrands(
    ids: string[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const result = await this.prisma.brand.deleteMany({
        where: { id: { in: ids } },
      });
      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'delete',
        module: 'brands',
        entity: 'Brand',
        description: `Bulk deleted brands (${result.count})`,
        oldValues: JSON.stringify(ids),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('brands_all');
      return {
        status: true,
        data: result,
        message: 'Brands deleted successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async deleteBrand(
    id: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.brand.findUnique({
        where: { id },
      });
      const result = await this.prisma.brand.delete({ where: { id } });

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'delete',
        module: 'brands',
        entity: 'Brand',
        entityId: id,
        description: `Deleted brand ${existing?.name}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('brands_all');
      return {
        status: true,
        data: result,
        message: 'Brand deleted successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  // --- DIVISION LOGIC ---

  async getAllDivisions() {
    const cacheKey = 'divisions_all';
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      return { status: true, data: cachedData };
    }

    const divisions = await this.prisma.division.findMany({
      include: {
        brand: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const userIds = [
      ...new Set(divisions.map((d) => d.createdById).filter(Boolean)),
    ];
    const users = await this.prismaMaster.user.findMany({
      where: { id: { in: userIds as string[] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const data = divisions.map((div) => {
      const creator = div.createdById ? userMap.get(div.createdById) : null;
      return {
        ...div,
        brandName: div.brand.name,
        createdBy: creator
          ? `${creator.firstName} ${creator.lastName || ''}`.trim()
          : null,
      };
    });

    await this.cacheManager.set(cacheKey, data, 3600000);
    return { status: true, data };
  }

  async getDivisionsByBrand(brandId: string) {
    const divisions = await this.prisma.division.findMany({
      where: { brandId },
      include: { brand: true },
      orderBy: { createdAt: 'desc' },
    });

    // Simplify response for lists
    return { status: true, data: divisions };
  }

  async createDivisions(items: CreateDivisionDto[], createdById: string) {
    try {
      const divisions = await this.prisma.division.createMany({
        data: items.map((item) => ({
          name: item.name,
          brandId: item.brandId,
          createdById,
        })),
        skipDuplicates: true,
      });

      await this.activityLogs.log({
        userId: createdById,
        action: 'create',
        module: 'divisions',
        entity: 'Division',
        description: `Created divisions (${divisions.count})`,
        newValues: JSON.stringify(items),
        status: 'success',
      });
      // Invalidate both caches
      await this.cacheManager.del('divisions_all');
      await this.cacheManager.del('brands_all');

      return {
        status: true,
        data: divisions,
        message: 'Divisions created successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async updateDivisions(
    dtos: UpdateDivisionDto[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const validDtos = dtos.filter((d) => d.id && d.id.trim().length > 0);
      const updated: any[] = [];
      for (const dto of validDtos) {
        updated.push(
          await this.prisma.division.update({
            where: { id: dto.id },
            data: { name: dto.name, brandId: dto.brandId },
          }),
        );
      }

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'update',
        module: 'divisions',
        entity: 'Division',
        description: `Bulk updated divisions (${updated.length})`,
        newValues: JSON.stringify(dtos),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('divisions_all');
      await this.cacheManager.del('brands_all');
      return {
        status: true,
        data: updated,
        message: 'Divisions updated successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async updateDivision(
    id: string,
    dto: UpdateDivisionDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.division.findUnique({
        where: { id },
      });
      const division = await this.prisma.division.update({
        where: { id },
        data: { name: dto.name, brandId: dto.brandId },
      });

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'update',
        module: 'divisions',
        entity: 'Division',
        entityId: id,
        description: `Updated division ${division.name}`,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(dto),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('divisions_all');
      await this.cacheManager.del('brands_all');
      return {
        status: true,
        data: division,
        message: 'Division updated successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async deleteDivisions(
    ids: string[],
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const result = await this.prisma.division.deleteMany({
        where: { id: { in: ids } },
      });
      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'delete',
        module: 'divisions',
        entity: 'Division',
        description: `Bulk deleted divisions (${result.count})`,
        oldValues: JSON.stringify(ids),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('divisions_all');
      await this.cacheManager.del('brands_all');
      return {
        status: true,
        data: result,
        message: 'Divisions deleted successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async deleteDivision(
    id: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.prisma.division.findUnique({
        where: { id },
      });
      const result = await this.prisma.division.delete({ where: { id } });

      await this.activityLogs.log({
        userId: ctx?.userId,
        action: 'delete',
        module: 'divisions',
        entity: 'Division',
        entityId: id,
        description: `Deleted division ${existing?.name}`,
        oldValues: JSON.stringify(existing),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      });
      await this.cacheManager.del('divisions_all');
      await this.cacheManager.del('brands_all');
      return {
        status: true,
        data: result,
        message: 'Division deleted successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }
}
