import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockMovement, InventoryItem } from '@prisma/client';

interface CreateStockMovementDto {
  itemId: string;
  fromLocationId?: string;
  toLocationId?: string;
  quantity: number;
  type: 'INBOUND' | 'OUTBOUND' | 'TRANSFER' | 'ADJUSTMENT';
  referenceType?: string;
  referenceId?: string;
  batchNumber?: string;
  serialNumber?: string;
  expiryDate?: Date;
  notes?: string;
  userId?: string;
}

@Injectable()
export class StockMovementService {
  constructor(private prisma: PrismaService) {}

  async executeMovement(dto: CreateStockMovementDto) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Create Stock Movement Log
      const movement = await tx.stockMovement.create({
        data: {
          movementNo: `MV-${Date.now()}`, // Simple generation logic
          itemId: dto.itemId,
          fromLocationId: dto.fromLocationId,
          toLocationId: dto.toLocationId,
          quantity: dto.quantity,
          type: dto.type,
          referenceType: dto.referenceType,
          referenceId: dto.referenceId,
          batchNumber: dto.batchNumber,
          serialNumber: dto.serialNumber,
          expiryDate: dto.expiryDate,
          notes: dto.notes,
          createdById: dto.userId,
        },
      });

      // 2. Update Inventory - DECREASE Source
      if (dto.fromLocationId) {
        // Find existing inventory item at source
        // Note: For batch items, we match batchNumber. For general items, batchNumber is null.
        const sourceItem = await tx.inventoryItem.findFirst({
          where: {
            locationId: dto.fromLocationId,
            itemId: dto.itemId,
            batchNumber: dto.batchNumber,
            serialNumber: dto.serialNumber,
            status: 'AVAILABLE', // Assuming we move available stock
          },
        });

        if (!sourceItem || Number(sourceItem.quantity) < Number(dto.quantity)) {
          throw new BadRequestException(
            'Insufficient stock at source location',
          );
        }

        if (Number(sourceItem.quantity) === Number(dto.quantity)) {
          // Delete if zero? Or keep as 0? Usually keep as 0 or delete.
          // Let's decrement for now.
          await tx.inventoryItem.update({
            where: { id: sourceItem.id },
            data: { quantity: { decrement: dto.quantity } },
          });
          // Cleanup zero records could be a separate job or strictly managed
        } else {
          await tx.inventoryItem.update({
            where: { id: sourceItem.id },
            data: { quantity: { decrement: dto.quantity } },
          });
        }
      }

      // 3. Update Inventory - INCREASE Destination
      if (dto.toLocationId) {
        const destLocation = await tx.warehouseLocation.findUnique({
          where: { id: dto.toLocationId },
        });
        if (!destLocation)
          throw new BadRequestException('Destination location not found');

        // Check if item exists at destination
        const destItem = await tx.inventoryItem.findFirst({
          where: {
            locationId: dto.toLocationId,
            itemId: dto.itemId,
            batchNumber: dto.batchNumber,
            serialNumber: dto.serialNumber,
            status: 'AVAILABLE',
          },
        });

        if (destItem) {
          await tx.inventoryItem.update({
            where: { id: destItem.id },
            data: { quantity: { increment: dto.quantity } },
          });
        } else {
          await tx.inventoryItem.create({
            data: {
              warehouseId: destLocation.warehouseId,
              locationId: dto.toLocationId,
              itemId: dto.itemId,
              quantity: dto.quantity,
              batchNumber: dto.batchNumber,
              serialNumber: dto.serialNumber,
              expiryDate: dto.expiryDate,
              status: 'AVAILABLE',
            },
          });
        }
      }

      return movement;
    });
  }
}
