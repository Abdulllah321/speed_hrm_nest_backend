import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockMovement, InventoryItem, MovementType } from '@prisma/client';
import { StockLedgerService } from './stock-ledger/stock-ledger.service';

import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { runInBackground } from '../common/utils/run-in-background.util';
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
    private stockLedgerService: StockLedgerService,
    private activityLogs: ActivityLogsService,
  ) { }

  private async getCurrentItemRate(tx: any, itemId: string): Promise<number> {
    const item = await tx.item.findUnique({
      where: { id: itemId },
      select: { unitCost: true },
    });
    return Number(item?.unitCost || 0);
  }

  async executeMovement(dto: CreateStockMovementDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
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

      return await this.prisma.$transaction(async (tx) => {
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

        runInBackground(
          'Execute Stock Movement',
          this.activityLogs.log({
            userId: ctx?.userId,
            action: 'create',
            module: 'warehouse',
            entity: 'StockMovement',
            entityId: movement.id,
            description: `Executed stock movement ${movement.movementNo} of type ${dto.type}`,
            newValues: JSON.stringify(dto),
            ipAddress: ctx?.ipAddress,
            userAgent: ctx?.userAgent,
            status: 'success',
          }),
        );

        return movement;
      });
    } catch (error: any) {
      runInBackground(
        'Execute Stock Movement (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'warehouse',
          entity: 'StockMovement',
          description: `Failed to execute stock movement for item ${dto.itemId}`,
          errorMessage: error?.message,
          newValues: JSON.stringify(dto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  private async executeWarehouseToOutletTransfer(dto: CreateStockMovementDto, tx: any, movementId: string) {
    if (!dto.fromWarehouseId || !dto.toLocationId) {
      throw new BadRequestException('fromWarehouseId and toLocationId required for normal transfers');
    }

    const itemRate = await this.getCurrentItemRate(tx, dto.itemId);

    // 1. Decrease Stock in Warehouse (Ledger + Logic)
    await this.stockLedgerService.createEntry({
      itemId: dto.itemId,
      warehouseId: dto.fromWarehouseId,
      qty: -dto.quantity,
      movementType: MovementType.OUTBOUND,
      referenceType: 'TRANSFER_REQUEST',
      referenceId: dto.referenceId || movementId,
      rate: itemRate,
    }, tx);

    // 2. Increase Stock in Outlet (Location-specific InventoryItem)
    const existingStock = await tx.inventoryItem.findFirst({
      where: {
        itemId: dto.itemId,
        locationId: dto.toLocationId,
        warehouseId: dto.fromWarehouseId,
        status: 'AVAILABLE'
      }
    });

    if (existingStock) {
      await tx.inventoryItem.update({
        where: { id: existingStock.id },
        data: { quantity: { increment: dto.quantity } }
      });
    } else {
      await tx.inventoryItem.create({
        data: {
          itemId: dto.itemId,
          warehouseId: dto.fromWarehouseId,
          locationId: dto.toLocationId,
          quantity: dto.quantity,
          status: 'AVAILABLE'
        }
      });
    }

    // 3. Write INBOUND ledger entry for the outlet so POS stock lookup reflects the transfer
    await this.stockLedgerService.createEntry({
      itemId: dto.itemId,
      warehouseId: dto.fromWarehouseId,
      locationId: dto.toLocationId,
      qty: dto.quantity,
      movementType: MovementType.INBOUND,
      referenceType: 'TRANSFER_REQUEST',
      referenceId: dto.referenceId || movementId,
      rate: itemRate,
    }, tx);
  }

  private async executeOutletToWarehouseTransfer(dto: CreateStockMovementDto, tx: any, movementId: string) {
    if (!dto.fromLocationId || !dto.toWarehouseId) {
      throw new BadRequestException('fromLocationId and toWarehouseId required for return transfers');
    }

    const itemRate = await this.getCurrentItemRate(tx, dto.itemId);

    // 1. Decrease Stock in Outlet (Location-specific InventoryItem)
    const outletStock = await tx.inventoryItem.findFirst({
      where: {
        itemId: dto.itemId,
        locationId: dto.fromLocationId,
        status: 'AVAILABLE'
      }
    });

    if (!outletStock || Number(outletStock.quantity) < dto.quantity) {
      throw new BadRequestException(`Insufficient stock at outlet for item ${dto.itemId}. Current: ${outletStock?.quantity || 0}`);
    }

    await tx.inventoryItem.update({
      where: { id: outletStock.id },
      data: { quantity: { decrement: dto.quantity } }
    });

    // 2. Increase Stock in Warehouse (Ledger + Logic)
    await this.stockLedgerService.createEntry({
      itemId: dto.itemId,
      warehouseId: dto.toWarehouseId,
      qty: dto.quantity,
      movementType: MovementType.INBOUND,
      referenceType: 'RETURN_REQUEST',
      referenceId: dto.referenceId || movementId,
      rate: itemRate,
    }, tx);
  }

  async getMovements(itemId?: string) {
    return this.prisma.stockMovement.findMany({
      where: { itemId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
