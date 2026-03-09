import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryItem } from '@prisma/client';

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) { }

  async getStockLevel(itemId: string, warehouseId: string): Promise<any> {
    const inventory = await this.prisma.inventoryItem.groupBy({
      by: ['itemId'],
      where: {
        itemId,
        warehouseId,
        status: 'AVAILABLE',
      },
      _sum: {
        quantity: true,
      },
    });

    return {
      itemId,
      warehouseId,
      totalQuantity: inventory[0]?._sum?.quantity || 0,
    };
  }

  async getDetailedStock(itemId: string): Promise<InventoryItem[]> {
    return this.prisma.inventoryItem.findMany({
      where: { itemId },
      include: {
        location: {
          include: { warehouse: true },
        },
      },
    });
  }

  async findSpecificBatch(
    itemId: string,
    batchNumber: string,
  ): Promise<InventoryItem[]> {
    return this.prisma.inventoryItem.findMany({
      where: { itemId, batchNumber },
    });
  }

  async searchInventory(query: string = '') {
    const items = await this.prisma.item.findMany({
      where: {
        OR: [
          { sku: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ],
        isActive: true,
      },
      take: 50,
      select: {
        id: true,
        sku: true,
        description: true,
        unitPrice: true,
        imageUrl: true,
      },
    });

    const itemIds = items.map((i) => i.id);

    // Get aggregated stock for these items
    const stockAggregations = await this.prisma.inventoryItem.groupBy({
      by: ['itemId'],
      where: {
        itemId: { in: itemIds },
        status: 'AVAILABLE',
      },
      _sum: {
        quantity: true,
      },
    });

    const stockMap = new Map(
      stockAggregations.map((a) => [a.itemId, a._sum.quantity || 0]),
    );

    return items.map((item) => ({
      ...item,
      totalQuantity: stockMap.get(item.id) || 0,
    }));
  }
}
