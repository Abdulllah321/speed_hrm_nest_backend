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

  async getDetailedStock(itemId: string): Promise<any[]> {
    const items = await this.prisma.inventoryItem.findMany({
      where: { itemId, status: 'AVAILABLE' },
    });

    const enriched = await Promise.all(
      items.map(async (item) => {
        const warehouse = await this.prisma.warehouse.findUnique({
          where: { id: item.warehouseId },
          select: { id: true, name: true },
        });

        let locationData: any = {};
        if (item.locationId) {
          // Check Master Location (Shop/Outlet)
          const masterLoc = await this.prisma.location.findUnique({
            where: { id: item.locationId },
            select: { id: true, name: true },
          });
          if (masterLoc) locationData = masterLoc;
        }

        return {
          ...item,
          quantity: Number(item.quantity),
          location: {
            ...locationData,
            warehouse: warehouse,
          },
        };
      }),
    );

    return enriched;
  }

  async findSpecificBatch(
    itemId: string,
  ): Promise<InventoryItem[]> {
    return this.prisma.inventoryItem.findMany({
      where: { itemId },
    });
  }

  async searchInventory(query: string = '', warehouseId?: string) {
    console.log('Search called with:', { query, warehouseId });
    
    if (!warehouseId) {
      throw new Error('Warehouse ID is required for stock search');
    }

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

    console.log('Found items:', items.length);

    const itemIds = items.map((i) => i.id);

    // Get warehouse stock (locationId = null means warehouse stock)
    const warehouseStock = await this.prisma.inventoryItem.groupBy({
      by: ['itemId'],
      where: {
        itemId: { in: itemIds },
        status: 'AVAILABLE',
        warehouseId: warehouseId,
        locationId: null, // Only warehouse stock (no outlet locations)
      },
      _sum: {
        quantity: true,
      },
    });

    console.log('Warehouse stock results:', warehouseStock);

    const stockMap = new Map(
      warehouseStock.map((a) => [a.itemId, Number(a._sum.quantity) || 0]),
    );

    const result = items.map((item) => ({
      ...item,
      totalQuantity: stockMap.get(item.id) || 0,
    }));

    console.log('Final result:', result);
    return result;
  }
}
