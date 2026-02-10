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
                status: 'AVAILABLE'
            },
            _sum: {
                quantity: true
            }
        });

        return {
            itemId,
            warehouseId,
            totalQuantity: inventory[0]?._sum?.quantity || 0
        };
    }

    async getDetailedStock(itemId: string): Promise<InventoryItem[]> {
        return this.prisma.inventoryItem.findMany({
            where: { itemId },
            include: {
                location: {
                    include: { warehouse: true }
                }
            }
        });
    }

    async findSpecificBatch(itemId: string, batchNumber: string): Promise<InventoryItem[]> {
        return this.prisma.inventoryItem.findMany({
            where: { itemId, batchNumber }
        });
    }
}
