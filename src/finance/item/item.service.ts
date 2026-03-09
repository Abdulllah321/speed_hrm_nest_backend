import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { PrismaService } from '../../database/prisma.service';
import { CreateItemDto, UpdateItemDto } from './dto/item.dto';

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
  ) {
    const skip = (page - 1) * limit;

    // ── Allowed sortable columns (direct item fields) ──────────────────
    const directSortFields = new Set([
      'itemId',
      'sku',
      'unitPrice',
      'isActive',
      'createdAt',
      'updatedAt',
      'description',
      'barCode',
      'hsCode',
    ]);

    // Relational sort fields need special handling
    const relationalSortFields: Record<string, string> = {
      brand: 'brandId',
      category: 'categoryId',
      division: 'divisionId',
    };

    // ── Build WHERE clause ─────────────────────────────────────────────
    let where: any = {};

    if (search) {
      const searchTerm = search.trim();

      where.OR = [
        { itemId: { contains: searchTerm, mode: 'insensitive' } },
        { sku: { contains: searchTerm, mode: 'insensitive' } },
        { description: { contains: searchTerm, mode: 'insensitive' } },
        { barCode: { contains: searchTerm, mode: 'insensitive' } },
        { brand: { name: { contains: searchTerm, mode: 'insensitive' } } },
        { category: { name: { contains: searchTerm, mode: 'insensitive' } } },
        { division: { name: { contains: searchTerm, mode: 'insensitive' } } },
      ];
    }

    // ── Build ORDER BY clause ──────────────────────────────────────────
    const direction = sortOrder === 'asc' ? 'asc' : 'desc';
    let orderBy: any;

    if (directSortFields.has(sortBy)) {
      orderBy = { [sortBy]: direction };
    } else if (relationalSortFields[sortBy]) {
      // Sort by the FK id as a fallback (true relational sort needs raw SQL)
      orderBy = { [relationalSortFields[sortBy]]: direction };
    } else {
      orderBy = { createdAt: 'desc' };
    }

    // ── Query ──────────────────────────────────────────────────────────
    const [items, total] = await Promise.all([
      this.prisma.item.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: includeMasterData,
      }),
      this.prisma.item.count({ where }),
    ]);

    return {
      status: true,
      data: items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
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
