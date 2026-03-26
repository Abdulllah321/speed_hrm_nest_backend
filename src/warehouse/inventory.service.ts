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

  async searchInventory(query: string = '', warehouseId?: string, locationId?: string) {
    console.log('Search called with:', { query, warehouseId, locationId });
    
    if (!warehouseId && !locationId) {
      throw new Error('Warehouse ID or Location ID is required for stock search');
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

    const itemIds = items.map((i) => i.id);

    // Get stock from StockLedger (Accurate source for both Warehouse and Outlets)
    const stockEntries = await this.prisma.stockLedger.groupBy({
      by: ['itemId'],
      where: {
        itemId: { in: itemIds },
        ...(locationId ? { locationId } : { warehouseId, locationId: null }),
      },
      _sum: {
        qty: true,
      },
    });

    const stockMap = new Map(
      stockEntries.map((a) => [a.itemId, Number(a._sum.qty) || 0]),
    );

    const result = items.map((item) => ({
      ...item,
      totalQuantity: stockMap.get(item.id) || 0,
    }));

    return result;
  }
}
