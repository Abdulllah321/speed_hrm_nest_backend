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
      last && /^""d{6}$/.test(last.itemId) ? parseInt(last.itemId, 10) : 0;
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
          hsCode: { not: null },
        },
        distinct: ['hsCode'],
        select: {
          hsCode: true,
        },
      });
      return { status: true, data: result.map((i) => i.hsCode) };
    } catch (error: any) {
      return { status: false, message: error.message };
    }
  }
}
