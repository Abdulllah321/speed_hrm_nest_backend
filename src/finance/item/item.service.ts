import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { PrismaService } from '../../database/prisma.service';
import { CreateItemDto, UpdateItemDto } from './dto/item.dto';

@Injectable()
export class ItemService {
  constructor(
    private prismaMaster: PrismaMasterService,
    private prisma: PrismaService,
  ) {}

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

  async findAll() {
    const items = await this.prisma.item.findMany({
      orderBy: { createdAt: 'desc' },
    });
    const enrichedItems = await this.enrichItems(items);
    return { status: true, data: enrichedItems };
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
    });

    if (!item) {
      return { status: false, message: `Item with ID ${id} not found` };
    }

    const enrichedItems = await this.enrichItems([item]);
    return { status: true, data: enrichedItems[0] };
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
    // uom removed

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
    ] = await Promise.all([
      brandIds.length
        ? this.prismaMaster.brand.findMany({
            where: { id: { in: brandIds as string[] } },
          })
        : [],
      divisionIds.length
        ? this.prismaMaster.division.findMany({
            where: { id: { in: divisionIds as string[] } },
          })
        : [],
      categoryIds.length
        ? this.prismaMaster.category.findMany({
            where: { id: { in: categoryIds as string[] } },
          })
        : [],
      subCategoryIds.length
        ? this.prismaMaster.category.findMany({
            where: { id: { in: subCategoryIds as string[] } },
          })
        : [],
      seasonIds.length
        ? this.prismaMaster.season.findMany({
            where: { id: { in: seasonIds as string[] } },
          })
        : [],
      genderIds.length
        ? this.prismaMaster.gender.findMany({
            where: { id: { in: genderIds as string[] } },
          })
        : [],
      sizeIds.length
        ? this.prismaMaster.size.findMany({
            where: { id: { in: sizeIds as string[] } },
          })
        : [],
      silhouetteIds.length
        ? this.prismaMaster.silhouette.findMany({
            where: { id: { in: silhouetteIds as string[] } },
          })
        : [],
      channelClassIds.length
        ? this.prismaMaster.channelClass.findMany({
            where: { id: { in: channelClassIds as string[] } },
          })
        : [],
      colorIds.length
        ? this.prismaMaster.color.findMany({
            where: { id: { in: colorIds as string[] } },
          })
        : [],
      itemClassIds.length
        ? this.prismaMaster.itemClass.findMany({
            where: { id: { in: itemClassIds as string[] } },
          })
        : [],
      itemSubclassIds.length
        ? this.prismaMaster.itemSubclass.findMany({
            where: { id: { in: itemSubclassIds as string[] } },
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
    }));
  }
}
