import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateItemDto, UpdateItemDto, BulkDiscountDto, RollbackCampaignDto, BulkSalePriceDto } from './dto/item.dto';

import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';
const includeMasterData = {
  brand: true,
  division: true,
  category: true,
  subCategory: true,
  season: true,
  gender: true,
  size: true,
  silhouette: true,
  channelClass: true,
  color: true,
  itemClass: true,
  itemSubclass: true,
};

@Injectable()
export class ItemService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) { }

  async create(createItemDto: CreateItemDto) {
    try {
      const nextId = await this.generateNextItemId();
      const data = await this.prisma.item.create({
        data: {
          ...createItemDto,
          itemId: nextId,
        },
      });
      return { status: true, data, message: 'Item created successfully' };
    } catch (error: any) {
      return { status: false, message: error.message };
    }
  }

  private async generateNextItemId(): Promise<string> {
    const last = await this.prisma.item.findFirst({
      orderBy: { itemId: 'desc' },
      select: { itemId: true },
    });
    const lastNum =
      last && /^\d{6}$/.test(last.itemId) ? parseInt(last.itemId, 10) : 0;
    const next = lastNum + 1;
    if (next > 999999) {
      throw new Error('Item ID sequence exceeded maximum 999999');
    }
    return String(next).padStart(6, '0');
  }

  async nextItemId() {
    try {
      const nextId = await this.generateNextItemId();
      return { status: true, data: { nextId } };
    } catch (error: any) {
      return { status: false, message: error.message };
    }
  }

  async findOne(id: string) {
    const item = await this.prisma.item.findUnique({
      where: { id },
      include: includeMasterData,
    });

    if (!item) {
      return { status: false, message: `Item with ID ${id} not found` };
    }

    return { status: true, data: item };
  }

  async findByCode(code: string) {
    const item = await this.prisma.item.findUnique({
      where: { itemId: code },
    });

    if (!item) {
      return { status: false, message: `Item with code ${code} not found` };
    }

    const enrichedItems = await this.enrichItems([item]);
    return { status: true, data: enrichedItems[0] };
  }

  async findAll(
    page: number = 1,
    limit: number = 50,
    search?: string,
    sortBy: string = 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc',
    filters?: {
      brandIds?: string[];
      categoryIds?: string[];
      silhouetteIds?: string[];
      genderIds?: string[];
    },
  ) {
    const skip = (page - 1) * limit;

    // ── Allowed sortable columns (direct item fields) ──────────────────
    const directSortFields = new Set([
      'itemId', 'sku', 'unitPrice', 'isActive', 'createdAt',
      'updatedAt', 'description', 'barCode', 'hsCode',
    ]);

    const relationalSortFields: Record<string, string> = {
      brand: 'brandId',
      category: 'categoryId',
      division: 'divisionId',
    };

    // ── Build WHERE clause ─────────────────────────────────────────────
    const andClauses: any[] = [];

    // Text search
    if (search) {
      const searchTerm = search.trim();
      andClauses.push({
        OR: [
          { itemId: { contains: searchTerm, mode: 'insensitive' } },
          { sku: { contains: searchTerm, mode: 'insensitive' } },
          { description: { contains: searchTerm, mode: 'insensitive' } },
          { barCode: { contains: searchTerm, mode: 'insensitive' } },
          { brand: { name: { contains: searchTerm, mode: 'insensitive' } } },
          { category: { name: { contains: searchTerm, mode: 'insensitive' } } },
          { division: { name: { contains: searchTerm, mode: 'insensitive' } } },
        ],
      });
    }

    // Attribute filters — each is an AND condition (item must match ALL selected filters)
    if (filters?.brandIds?.length) {
      andClauses.push({ brandId: { in: filters.brandIds } });
    }
    if (filters?.categoryIds?.length) {
      andClauses.push({ categoryId: { in: filters.categoryIds } });
    }
    if (filters?.silhouetteIds?.length) {
      andClauses.push({ silhouetteId: { in: filters.silhouetteIds } });
    }
    if (filters?.genderIds?.length) {
      andClauses.push({ genderId: { in: filters.genderIds } });
    }

    const where: any = andClauses.length > 0 ? { AND: andClauses } : {};

    // ── Build ORDER BY clause ──────────────────────────────────────────
    const direction = sortOrder === 'asc' ? 'asc' : 'desc';
    let orderBy: any;

    if (directSortFields.has(sortBy)) {
      orderBy = { [sortBy]: direction };
    } else if (relationalSortFields[sortBy]) {
      orderBy = { [relationalSortFields[sortBy]]: direction };
    } else {
      orderBy = { createdAt: 'desc' };
    }

    // ── Query ──────────────────────────────────────────────────────────
    const [items, total] = await Promise.all([
      this.prisma.item.findMany({ where, skip, take: limit, orderBy, include: includeMasterData }),
      this.prisma.item.count({ where }),
    ]);

    return {
      status: true,
      data: items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async update(id: string, updateItemDto: UpdateItemDto) {
    try {
      const findResult = await this.prisma.item.findUnique({ where: { id } });
      if (!findResult)
        return { status: false, message: `Item with ID ${id} not found` };

      const data = await this.prisma.item.update({
        where: { id },
        data: updateItemDto,
      });
      return { status: true, data, message: 'Item updated successfully' };
    } catch (error: any) {
      return { status: false, message: error.message };
    }
  }

  async remove(id: string) {
    try {
      const findResult = await this.prisma.item.findUnique({ where: { id } });
      if (!findResult)
        return { status: false, message: `Item with ID ${id} not found` };

      await this.prisma.item.delete({
        where: { id },
      });
      return { status: true, message: 'Item deleted successfully' };
    } catch (error: any) {
      return { status: false, message: error.message };
    }
  }

  async getUniqueHsCodes() {
    try {
      const result = await this.prisma.item.findMany({
        where: {
          hsCodeId: { not: null },
        },
        distinct: ['hsCodeId'],
        select: {
          hsCodeId: true,
        },
      });
      return { status: true, data: result.map((i) => i.hsCodeId) };
    } catch (error: any) {
      return { status: false, message: error.message };
    }
  }

  async bulkDiscount(dto: BulkDiscountDto) {
    try {
      if (!dto.itemIds || dto.itemIds.length === 0) {
        return { status: false, message: 'No item IDs provided' };
      }

      // ── 1. Fetch current discount state for snapshot ───────────────────
      const currentItems = await this.prisma.item.findMany({
        where: { id: { in: dto.itemIds } },
        select: {
          id: true,
          discountRate: true,
          discountAmount: true,
          discountStartDate: true,
          discountEndDate: true,
        },
      });

      const snapshotMap = new Map(currentItems.map((i) => [i.id, i]));

      // ── 2. Build shared item update payload ────────────────────────────
      const sharedData: any = dto.clearDiscount
        ? {
            discountRate: 0,
            discountAmount: 0,
            discountStartDate: null,
            discountEndDate: null,
          }
        : {
            ...(dto.discountRate !== undefined && { discountRate: dto.discountRate }),
            ...(dto.discountAmount !== undefined && { discountAmount: dto.discountAmount }),
            ...(dto.discountStartDate !== undefined && { discountStartDate: dto.discountStartDate }),
            ...(dto.discountEndDate !== undefined && { discountEndDate: dto.discountEndDate }),
          };

      // ── 3. Build per-item override map ─────────────────────────────────
      const overrideMap = new Map<string, { discountRate?: number; discountAmount?: number }>();
      if (!dto.clearDiscount && dto.overrides?.length) {
        for (const ov of dto.overrides) {
          overrideMap.set(ov.id, {
            ...(ov.discountRate !== undefined && { discountRate: ov.discountRate }),
            ...(ov.discountAmount !== undefined && { discountAmount: ov.discountAmount }),
          });
        }
      }

      // ── 4. Apply item updates + persist campaign atomically ───────────
      const overriddenIds = new Set(overrideMap.keys());
      const bulkIds = dto.itemIds.filter((id) => !overriddenIds.has(id));
      const overriddenItemIds = dto.itemIds.filter((id) => overriddenIds.has(id));
      const discountType = dto.clearDiscount ? 'clear' : dto.discountRate !== undefined ? 'percent' : 'fixed';

      const campaign = await this.prisma.$transaction(async (tx) => {
        // Fast path: single updateMany for items with no override
        if (bulkIds.length > 0) {
          await tx.item.updateMany({
            where: { id: { in: bulkIds } },
            data: sharedData,
          });
        }

        // Individual updates only for items with overrides
        for (const id of overriddenItemIds) {
          const override = overrideMap.get(id)!;
          await tx.item.update({
            where: { id },
            data: { ...sharedData, ...override },
          });
        }

        // Persist campaign record with items + locations
        return tx.discountCampaign.create({
          data: {
            name: dto.campaignName,
            discountType,
            discountRate: dto.discountRate ?? 0,
            discountAmount: dto.discountAmount ?? 0,
            startDate: dto.discountStartDate ?? null,
            endDate: dto.discountEndDate ?? null,
            notes: dto.notes ?? null,
            clearMode: dto.clearDiscount ?? false,
            itemCount: dto.itemIds.length,
            appliedById: dto.appliedById ?? null,
            items: {
              create: dto.itemIds.map((itemId) => {
                const snap = snapshotMap.get(itemId);
                const ov = overrideMap.get(itemId);
                return {
                  itemId,
                  overrideRate: ov?.discountRate ?? null,
                  overrideAmount: ov?.discountAmount ?? null,
                  prevDiscountRate: snap?.discountRate ?? null,
                  prevDiscountAmount: snap?.discountAmount ?? null,
                  prevStartDate: snap?.discountStartDate ?? null,
                  prevEndDate: snap?.discountEndDate ?? null,
                };
              }),
            },
            ...(dto.locationIds?.length
              ? {
                  locations: {
                    create: dto.locationIds.map((locationId, idx) => ({
                      locationId,
                      locationName: dto.locationNames?.[idx] ?? null,
                    })),
                  },
                }
              : {}),
          },
          include: { locations: true },
        });
      });

      return {
        status: true,
        message: `Discount applied to ${dto.itemIds.length} item${dto.itemIds.length !== 1 ? 's' : ''} successfully`,
        data: {
          updatedCount: dto.itemIds.length,
          campaignId: campaign.id,
          locationCount: campaign.locations.length,
        },
      };
    } catch (error: any) {
      return { status: false, message: error.message };
    }
  }

  async rollbackCampaign(dto: RollbackCampaignDto) {
    try {
      const campaign = await this.prisma.discountCampaign.findUnique({
        where: { id: dto.campaignId },
        include: { items: true },
      });

      if (!campaign) {
        return { status: false, message: `Campaign ${dto.campaignId} not found` };
      }

      if (!campaign.items.length) {
        return { status: false, message: 'No snapshot data available for rollback' };
      }

      // Restore each item to its pre-campaign discount state, then delete campaign — atomically
      await this.prisma.$transaction(async (tx) => {
        await Promise.all(
          campaign.items.map((ci) =>
            tx.item.update({
              where: { id: ci.itemId },
              data: {
                discountRate: ci.prevDiscountRate ?? 0,
                discountAmount: ci.prevDiscountAmount ?? 0,
                discountStartDate: ci.prevStartDate ?? null,
                discountEndDate: ci.prevEndDate ?? null,
              },
            }),
          ),
        );
        await tx.discountCampaign.delete({ where: { id: dto.campaignId } });
      });

      return {
        status: true,
        message: `Rolled back "${campaign.name}" — ${campaign.items.length} items restored`,
        data: { restoredCount: campaign.items.length },
      };
    } catch (error: any) {
      return { status: false, message: error.message };
    }
  }

  // ── Bulk Sale Price Update ─────────────────────────────────────────────────

  async bulkSalePrice(dto: BulkSalePriceDto) {
    try {
      if (!dto.itemIds || dto.itemIds.length === 0) {
        return { status: false, message: 'No item IDs provided' };
      }
      if (dto.unitPrice === undefined && (!dto.overrides || dto.overrides.length === 0)) {
        return { status: false, message: 'Provide a unitPrice or per-item overrides' };
      }

      // Build override map for O(1) lookup
      const overrideMap = new Map<string, number>();
      for (const ov of dto.overrides ?? []) {
        overrideMap.set(ov.id, ov.unitPrice);
      }

      const overriddenIds = new Set(overrideMap.keys());
      const bulkIds = dto.itemIds.filter((id) => !overriddenIds.has(id));
      const overriddenItemIds = dto.itemIds.filter((id) => overriddenIds.has(id));

      await this.prisma.$transaction(async (tx) => {
        // Single updateMany for items with no override
        if (bulkIds.length > 0 && dto.unitPrice !== undefined) {
          await tx.item.updateMany({
            where: { id: { in: bulkIds } },
            data: { unitPrice: dto.unitPrice },
          });
        }

        // Individual updates only for items with overrides
        for (const id of overriddenItemIds) {
          await tx.item.update({
            where: { id },
            data: { unitPrice: overrideMap.get(id)! },
          });
        }
      });

      return {
        status: true,
        message: `Unit price updated for ${dto.itemIds.length} item${dto.itemIds.length !== 1 ? 's' : ''} successfully`,
        data: { updatedCount: dto.itemIds.length },
      };
    } catch (error: any) {
      return { status: false, message: error.message };
    }
  }

  async getCampaigns(page = 1, limit = 20) {
    try {
      const skip = (page - 1) * limit;
      const [campaigns, total] = await Promise.all([
        this.prisma.discountCampaign.findMany({
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            locations: true,
            _count: { select: { items: true } },
          },
        }),
        this.prisma.discountCampaign.count(),
      ]);
      return {
        status: true,
        data: campaigns,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    } catch (error: any) {
      return { status: false, message: error.message };
    }
  }

  async getCampaign(id: string) {
    try {
      const campaign = await this.prisma.discountCampaign.findUnique({
        where: { id },
        include: {
          locations: true,
          items: {
            include: {
              item: {
                select: {
                  id: true,
                  itemId: true,
                  sku: true,
                  description: true,
                  unitPrice: true,
                  discountRate: true,
                  discountAmount: true,
                  brand: { select: { name: true } },
                  category: { select: { name: true } },
                },
              },
            },
          },
        },
      });
      if (!campaign) return { status: false, message: 'Campaign not found' };
      return { status: true, data: campaign };
    } catch (error: any) {
      return { status: false, message: error.message };
    }
  }
  private async enrichItems(items: any[]) {
    if (!items.length) return [];

    const brandIds = [...new Set(items.map((i) => i.brandId).filter(Boolean))];
    const divisionIds = [
      ...new Set(items.map((i) => i.divisionId).filter(Boolean)),
    ];
    const categoryIds = [
      ...new Set(items.map((i) => i.categoryId).filter(Boolean)),
    ];
    const subCategoryIds = [
      ...new Set(items.map((i) => i.subCategoryId).filter(Boolean)),
    ];
    const seasonIds = [
      ...new Set(items.map((i) => i.seasonId).filter(Boolean)),
    ];
    const genderIds = [
      ...new Set(items.map((i) => i.genderId).filter(Boolean)),
    ];
    const sizeIds = [...new Set(items.map((i) => i.sizeId).filter(Boolean))];
    const silhouetteIds = [
      ...new Set(items.map((i) => i.silhouetteId).filter(Boolean)),
    ];
    const channelClassIds = [
      ...new Set(items.map((i) => i.channelClassId).filter(Boolean)),
    ];
    const colorIds = [...new Set(items.map((i) => i.colorId).filter(Boolean))];
    const itemClassIds = [
      ...new Set(items.map((i) => i.itemClassId).filter(Boolean)),
    ];
    const itemSubclassIds = [
      ...new Set(items.map((i) => i.itemSubclassId).filter(Boolean)),
    ];
    const hsCodeIds = [
      ...new Set(items.map((i) => i.hsCodeId).filter(Boolean)),
    ];


    const [
      brands,
      divisions,
      categories,
      subCategories,
      seasons,
      genders,
      sizes,
      silhouettes,
      channelClasses,
      colors,
      itemClasses,
      itemSubclasses,
      hsCodes,
    ]: [
        any[],
        any[],
        any[],
        any[],
        any[],
        any[],
        any[],
        any[],
        any[],
        any[],
        any[],
        any[],
        any[],
      ] = await Promise.all([
        brandIds.length
          ? this.prisma.brand.findMany({
            where: { id: { in: brandIds as string[] } },
          })
          : [],
        divisionIds.length
          ? this.prisma.division.findMany({
            where: { id: { in: divisionIds as string[] } },
          })
          : [],
        categoryIds.length
          ? this.prisma.category.findMany({
            where: { id: { in: categoryIds as string[] } },
          })
          : [],
        subCategoryIds.length
          ? this.prisma.category.findMany({
            where: { id: { in: subCategoryIds as string[] } },
          })
          : [],
        seasonIds.length
          ? this.prisma.season.findMany({
            where: { id: { in: seasonIds as string[] } },
          })
          : [],
        genderIds.length
          ? this.prisma.gender.findMany({
            where: { id: { in: genderIds as string[] } },
          })
          : [],
        sizeIds.length
          ? this.prisma.size.findMany({
            where: { id: { in: sizeIds as string[] } },
          })
          : [],
        silhouetteIds.length
          ? this.prisma.silhouette.findMany({
            where: { id: { in: silhouetteIds as string[] } },
          })
          : [],
        channelClassIds.length
          ? this.prisma.channelClass.findMany({
            where: { id: { in: channelClassIds as string[] } },
          })
          : [],
        colorIds.length
          ? this.prisma.color.findMany({
            where: { id: { in: colorIds as string[] } },
          })
          : [],
        itemClassIds.length
          ? this.prisma.itemClass.findMany({
            where: { id: { in: itemClassIds as string[] } },
          })
          : [],
        itemSubclassIds.length
          ? this.prisma.itemSubclass.findMany({
            where: { id: { in: itemSubclassIds as string[] } },
          })
          : [],
        hsCodeIds.length
          ? this.prisma.hsCode.findMany({
            where: { id: { in: hsCodeIds as string[] } },
          })
          : [],

      ]);

    return items.map((item) => ({
      ...item,
      brand: brands.find((x) => x.id === item.brandId) || null,
      division: divisions.find((x) => x.id === item.divisionId) || null,
      category: categories.find((x) => x.id === item.categoryId) || null,
      subCategory:
        subCategories.find((x) => x.id === item.subCategoryId) || null,
      season: seasons.find((x) => x.id === item.seasonId) || null,
      gender: genders.find((x) => x.id === item.genderId) || null,
      size: sizes.find((x) => x.id === item.sizeId) || null,
      silhouette: silhouettes.find((x) => x.id === item.silhouetteId) || null,
      channelClass:
        channelClasses.find((x) => x.id === item.channelClassId) || null,
      color: colors.find((x) => x.id === item.colorId) || null,
      itemClass: itemClasses.find((x) => x.id === item.itemClassId) || null,
      itemSubclass:
        itemSubclasses.find((x) => x.id === item.itemSubclassId) || null,
      hsCode: hsCodes.find((x) => x.id === item.hsCodeId) || null,

    }));
  }
}
