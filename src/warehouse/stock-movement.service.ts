import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockMovement, InventoryItem, MovementType } from '@prisma/client';
import { StockLedgerService } from './stock-ledger/stock-ledger.service';

interface CreateStockMovementDto {
  itemId: string;
  fromWarehouseId?: string;  // Source warehouse (optional for outlet-to-warehouse)
  fromLocationId?: string;   // Source outlet location (for returns)
  toLocationId?: string;     // Destination outlet location (optional for returns)
  toWarehouseId?: string;    // Destination warehouse (for returns)
  quantity: number;
  type: 'INBOUND' | 'OUTBOUND' | 'TRANSFER' | 'RETURN_TRANSFER' | 'ADJUSTMENT';
  referenceType?: string;
  referenceId?: string;
  notes?: string;
  userId?: string;
}

@Injectable()
export class StockMovementService {
  constructor(
    private prisma: PrismaService,
    private stockLedgerService: StockLedgerService
  ) { }

  private async getCurrentItemRate(tx: any, itemId: string): Promise<number> {
    const item = await tx.item.findUnique({
      where: { id: itemId },
      select: { unitCost: true },
    });
    return Number(item?.unitCost || 0);
  }

  async executeMovement(dto: CreateStockMovementDto) {
    // Validate that locations exist before processing
    if (dto.toLocationId) {
      const toLocation = await this.prisma.location.findUnique({
        where: { id: dto.toLocationId }
      });
      if (!toLocation) {
        throw new BadRequestException(`Destination location ${dto.toLocationId} not found`);
      }
    }

    if (dto.fromLocationId) {
      const fromLocation = await this.prisma.location.findUnique({
        where: { id: dto.fromLocationId }
      });
      if (!fromLocation) {
        throw new BadRequestException(`Source location ${dto.fromLocationId} not found`);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Create Stock Movement Log
      const movement = await tx.stockMovement.create({
        data: {
          movementNo: `MV-${Date.now()}`,
          itemId: dto.itemId,
          fromLocationId: dto.fromLocationId || null,
          toLocationId: dto.toLocationId || null,
          quantity: dto.quantity,
          type: dto.type,
          referenceType: dto.referenceType,
          referenceId: dto.referenceId,
          notes: dto.notes,
          createdById: dto.userId,
        },
      });

      if (dto.type === 'TRANSFER') {
        // Normal Transfer: Warehouse → Outlet
        await this.executeWarehouseToOutletTransfer(dto, tx, movement.id);
      } else if (dto.type === 'RETURN_TRANSFER') {
        // Return Transfer: Outlet → Warehouse
        await this.executeOutletToWarehouseTransfer(dto, tx, movement.id);
      }

      return movement;
    });
  }

  private async executeWarehouseToOutletTransfer(dto: CreateStockMovementDto, tx: any, movementId: string) {
    const transferRate = await this.getCurrentItemRate(tx, dto.itemId);

    // 2. WAREHOUSE SIDE - Decrease Stock
    const sourceItem = await tx.inventoryItem.findFirst({
      where: {
        warehouseId: dto.fromWarehouseId,
        locationId: null, // Warehouse stock (no location)
        itemId: dto.itemId,
        status: 'AVAILABLE',
      },
    });

    if (sourceItem) {
      await tx.inventoryItem.update({
        where: { id: sourceItem.id },
        data: { quantity: { decrement: dto.quantity } },
      });

      // Warehouse Ledger Entry (OUTBOUND)
      await this.stockLedgerService.createEntry({
        itemId: dto.itemId,
        warehouseId: dto.fromWarehouseId!,
        qty: -dto.quantity,
        movementType: MovementType.OUTBOUND,
        referenceType: dto.referenceType || 'STOCK_MOVEMENT',
        referenceId: movementId,
        rate: transferRate,
      }, tx);
    } else {
      throw new BadRequestException(`Insufficient warehouse stock for item ${dto.itemId}`);
    }

    // 3. OUTLET SIDE - Increase Stock
    if (dto.toLocationId) {
      const destItem = await tx.inventoryItem.findFirst({
        where: {
          locationId: dto.toLocationId,
          itemId: dto.itemId,
          status: 'AVAILABLE',
        },
      });

      if (destItem) {
        // Update existing stock at outlet
        await tx.inventoryItem.update({
          where: { id: destItem.id },
          data: { quantity: { increment: dto.quantity } },
        });
      } else {
        // Create new stock entry at outlet
        await tx.inventoryItem.create({
          data: {
            warehouseId: dto.fromWarehouseId!,
            locationId: dto.toLocationId,
            itemId: dto.itemId,
            quantity: dto.quantity,
            status: 'AVAILABLE',
          },
        });
      }

      // Outlet Ledger Entry (INBOUND)
      await this.stockLedgerService.createEntry({
        itemId: dto.itemId,
        warehouseId: dto.fromWarehouseId!,
        locationId: dto.toLocationId,
        qty: dto.quantity,
        movementType: MovementType.INBOUND,
        referenceType: dto.referenceType || 'STOCK_MOVEMENT',
        referenceId: movementId,
        rate: transferRate,
      }, tx);
    }
  }

  private async executeOutletToWarehouseTransfer(dto: CreateStockMovementDto, tx: any, movementId: string) {
    const transferRate = await this.getCurrentItemRate(tx, dto.itemId);

    // 1. OUTLET SIDE - Decrease Stock
    const sourceItem = await tx.inventoryItem.findFirst({
      where: {
        locationId: dto.fromLocationId,
        itemId: dto.itemId,
        status: 'AVAILABLE',
      },
    });

    if (sourceItem) {
      await tx.inventoryItem.update({
        where: { id: sourceItem.id },
        data: { quantity: { decrement: dto.quantity } },
      });

      // Outlet Ledger Entry (OUTBOUND)
      await this.stockLedgerService.createEntry({
        itemId: dto.itemId,
        warehouseId: dto.toWarehouseId!,
        locationId: dto.fromLocationId!,
        qty: -dto.quantity,
        movementType: MovementType.OUTBOUND,
        referenceType: dto.referenceType || 'RETURN_MOVEMENT',
        referenceId: movementId,
        rate: transferRate,
      }, tx);
    } else {
      throw new BadRequestException(`Insufficient outlet stock for item ${dto.itemId}`);
    }

    // 2. WAREHOUSE SIDE - Increase Stock
    const destItem = await tx.inventoryItem.findFirst({
      where: {
        warehouseId: dto.toWarehouseId,
        locationId: null, // Warehouse stock
        itemId: dto.itemId,
        status: 'AVAILABLE',
      },
    });

    if (destItem) {
      // Update existing warehouse stock
      await tx.inventoryItem.update({
        where: { id: destItem.id },
        data: { quantity: { increment: dto.quantity } },
      });
    } else {
      // Create new warehouse stock entry
      await tx.inventoryItem.create({
        data: {
          warehouseId: dto.toWarehouseId!,
          locationId: null, // NULL = warehouse stock
          itemId: dto.itemId,
          quantity: dto.quantity,
          status: 'AVAILABLE',
        },
      });
    }

    // Warehouse Ledger Entry (INBOUND)
    await this.stockLedgerService.createEntry({
      itemId: dto.itemId,
      warehouseId: dto.toWarehouseId!,
      qty: dto.quantity,
      movementType: MovementType.INBOUND,
      referenceType: dto.referenceType || 'RETURN_MOVEMENT',
      referenceId: movementId,
      rate: transferRate,
    }, tx);
  }
}
