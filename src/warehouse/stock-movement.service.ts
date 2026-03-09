import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockMovement, InventoryItem, MovementType } from '@prisma/client';
import { StockLedgerService } from './stock-ledger/stock-ledger.service';

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
  constructor(
    private prisma: PrismaService,
    private stockLedgerService: StockLedgerService
  ) { }

  async executeMovement(dto: CreateStockMovementDto) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Create Stock Movement Log
      const movement = await tx.stockMovement.create({
        data: {
          movementNo: `MV-${Date.now()}`,
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

      // 2. Handle Source (DECREASE)
      if (dto.fromLocationId) {
        // Update Inventory Item
        const sourceItem = await tx.inventoryItem.findFirst({
          where: {
            locationId: dto.fromLocationId,
            itemId: dto.itemId,
            batchNumber: dto.batchNumber,
            serialNumber: dto.serialNumber,
            status: 'AVAILABLE',
          },
        });

        if (sourceItem) {
          await tx.inventoryItem.update({
            where: { id: sourceItem.id },
            data: { quantity: { decrement: dto.quantity } },
          });
        }

        // Update Ledger
        const location = await tx.warehouseLocation.findUnique({ where: { id: dto.fromLocationId } });
        if (location) {
          await this.stockLedgerService.createEntry({
            itemId: dto.itemId,
            warehouseId: location.warehouseId,
            locationId: dto.fromLocationId,
            qty: -dto.quantity,
            movementType: MovementType.OUTBOUND,
            referenceType: dto.referenceType || 'STOCK_MOVEMENT',
            referenceId: movement.id,
          }, tx);
        }
      } else {
        // Moving from "Central Pool" (location null)
        // We still need to create a ledger entry if we know the warehouse.
        // For now, if location is null, we might not know the warehouse from the DTO.
        // Usually, internal transfers are in the same warehouse.
        if (dto.toLocationId) {
          const destLoc = await tx.warehouseLocation.findUnique({ where: { id: dto.toLocationId } });
          if (destLoc) {
            await this.stockLedgerService.createEntry({
              itemId: dto.itemId,
              warehouseId: destLoc.warehouseId,
              locationId: undefined, // Central Pool
              qty: -dto.quantity,
              movementType: MovementType.OUTBOUND,
              referenceType: dto.referenceType || 'STOCK_MOVEMENT',
              referenceId: movement.id,
            }, tx);
          }
        }
      }

      // 3. Handle Destination (INCREASE)
      if (dto.toLocationId) {
        const destLocation = await tx.warehouseLocation.findUnique({
          where: { id: dto.toLocationId },
        });
        if (!destLocation) throw new BadRequestException('Destination location not found');

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

        // Update Ledger
        await this.stockLedgerService.createEntry({
          itemId: dto.itemId,
          warehouseId: destLocation.warehouseId,
          locationId: dto.toLocationId,
          qty: dto.quantity,
          movementType: MovementType.INBOUND,
          referenceType: dto.referenceType || 'STOCK_MOVEMENT',
          referenceId: movement.id,
        }, tx);
      }

      return movement;
    });
  }
}
