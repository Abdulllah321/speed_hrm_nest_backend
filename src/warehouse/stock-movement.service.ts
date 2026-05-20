import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockMovement, InventoryItem, MovementType } from '@prisma/client';
import { StockLedgerService } from './stock-ledger/stock-ledger.service';

import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { runInBackground } from '../common/utils/run-in-background.util';
interface CreateStockMovementDto {
  itemId: string;
  fromWarehouseId?: string;  // Source warehouse (for validation/ledger)
  fromLocationId?: string;   // Source outlet location (for returns)
  toLocationId?: string;     // Destination outlet location (optional for returns)
  toWarehouseId?: string;    // Destination warehouse (for returns)
  quantity: number;
  type: 'INBOUND' | 'OUTBOUND' | 'TRANSFER' | 'RETURN_TRANSFER' | 'ADJUSTMENT';
  referenceType?: string;
  referenceId?: string;
  notes?: string;
  userId?: string;
  transaction?: any;         // Optional: pass existing transaction to avoid nested transactions
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

      // If transaction is provided, use it; otherwise create a new one
      const executeInTransaction = async (tx: any) => {
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
            newValues: JSON.stringify({ ...dto, transaction: undefined }), // Exclude transaction object
            ipAddress: ctx?.ipAddress,
            userAgent: ctx?.userAgent,
            status: 'success',
          }),
        );

        return movement;
      };

      // Use provided transaction or create new one
      if (dto.transaction) {
        return await executeInTransaction(dto.transaction);
      } else {
        return await this.prisma.$transaction(executeInTransaction, {
          maxWait: 10000,
          timeout: 15000,
        });
      }
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
          newValues: JSON.stringify({ ...dto, transaction: undefined }), // Exclude transaction object
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

    console.log('🔄 [Stock Movement] Executing Outlet → Warehouse Transfer:', {
      itemId: dto.itemId,
      fromLocationId: dto.fromLocationId,
      toWarehouseId: dto.toWarehouseId,
      quantity: dto.quantity,
      referenceType: dto.referenceType
    });

    const itemRate = await this.getCurrentItemRate(tx, dto.itemId);
    const isClaimReturn = dto.referenceType === 'CLAIM_RETURN';
    const isClaimToPLM = dto.referenceType === 'CLAIM_TO_PLM';

    // ⚡ CLAIM RETURN: Skip POS inventory deduction (already deducted during sale)
    // ⚡ CLAIM_TO_PLM: Normal transfer (POS already has the item, now sending to PLM)
    if (!isClaimReturn && !isClaimToPLM) {
      console.log('📦 [Stock Movement] Regular Return: Deducting from POS inventory...');
      
      // 1. Decrease Stock in Outlet (Location-specific InventoryItem)
      const outletStock = await tx.inventoryItem.findFirst({
        where: {
          itemId: dto.itemId,
          locationId: dto.fromLocationId,
          status: 'AVAILABLE'
        }
      });

      console.log('📦 [Stock Movement] Outlet Stock Found:', {
        found: !!outletStock,
        currentQty: outletStock?.quantity,
        requestedQty: dto.quantity,
        warehouseId: outletStock?.warehouseId
      });

      if (!outletStock || Number(outletStock.quantity) < dto.quantity) {
        throw new BadRequestException(`Insufficient stock at outlet for item ${dto.itemId}. Current: ${outletStock?.quantity || 0}`);
      }

      await tx.inventoryItem.update({
        where: { id: outletStock.id },
        data: { quantity: { decrement: dto.quantity } }
      });

      console.log('✅ [Stock Movement] Outlet stock decreased');

      // 2. Create OUTBOUND ledger entry for outlet
      await this.stockLedgerService.createEntry({
        itemId: dto.itemId,
        warehouseId: outletStock.warehouseId || dto.toWarehouseId,
        locationId: dto.fromLocationId,
        qty: -dto.quantity,
        movementType: MovementType.OUTBOUND,
        referenceType: dto.referenceType || 'RETURN_REQUEST',
        referenceId: dto.referenceId || movementId,
        rate: itemRate,
      }, tx);

      console.log('✅ [Stock Movement] Outlet OUTBOUND ledger entry created');
    } else if (isClaimToPLM) {
      console.log('📤 [Stock Movement] CLAIM TO PLM: Normal transfer from POS to PLM warehouse...');
      
      // Normal transfer: Deduct from POS, Add to PLM
      const outletStock = await tx.inventoryItem.findFirst({
        where: {
          itemId: dto.itemId,
          locationId: dto.fromLocationId,
          status: 'AVAILABLE'
        }
      });

      console.log('📦 [Stock Movement] POS Stock Found:', {
        found: !!outletStock,
        currentQty: outletStock?.quantity,
        requestedQty: dto.quantity
      });

      if (!outletStock || Number(outletStock.quantity) < dto.quantity) {
        throw new BadRequestException(`Insufficient stock at POS for item ${dto.itemId}. Current: ${outletStock?.quantity || 0}`);
      }

      // Deduct from POS
      await tx.inventoryItem.update({
        where: { id: outletStock.id },
        data: { quantity: { decrement: dto.quantity } }
      });
      console.log('✅ [Stock Movement] POS stock decreased');

      // Create OUTBOUND ledger entry for POS
      await this.stockLedgerService.createEntry({
        itemId: dto.itemId,
        warehouseId: outletStock.warehouseId || dto.fromWarehouseId || dto.toWarehouseId,
        locationId: dto.fromLocationId,
        qty: -dto.quantity,
        movementType: MovementType.OUTBOUND,
        referenceType: 'CLAIM_TO_PLM',
        referenceId: dto.referenceId || movementId,
        rate: itemRate,
      }, tx);
      console.log('✅ [Stock Movement] POS OUTBOUND ledger entry created');
    } else {
      console.log('⚡ [Stock Movement] CLAIM RETURN: Skipping POS inventory deduction (already deducted during sale)');
      
      // Still create ledger entry for audit trail (but don't touch InventoryItem)
      // Use fromWarehouseId if provided, otherwise use toWarehouseId
      const ledgerWarehouseId = dto.fromWarehouseId || dto.toWarehouseId;
      
      await this.stockLedgerService.createEntry({
        itemId: dto.itemId,
        warehouseId: ledgerWarehouseId,
        locationId: dto.fromLocationId,
        qty: -dto.quantity,
        movementType: MovementType.OUTBOUND,
        referenceType: 'CLAIM_RETURN',
        referenceId: dto.referenceId || movementId,
        rate: itemRate,
      }, tx);

      console.log('✅ [Stock Movement] Claim return OUTBOUND ledger entry created (audit only)');
    }

    // 3. Increase Stock in Warehouse (InventoryItem + Ledger)
    // First, update or create warehouse-level inventory
    const warehouseStock = await tx.inventoryItem.findFirst({
      where: {
        itemId: dto.itemId,
        warehouseId: dto.toWarehouseId,
        locationId: null, // Warehouse-level stock (no specific location)
        status: 'AVAILABLE'
      }
    });

    console.log('🏢 [Stock Movement] Warehouse Stock Check:', {
      warehouseId: dto.toWarehouseId,
      found: !!warehouseStock,
      currentQty: warehouseStock?.quantity || 0,
      willAdd: dto.quantity
    });

    if (warehouseStock) {
      await tx.inventoryItem.update({
        where: { id: warehouseStock.id },
        data: { quantity: { increment: dto.quantity } }
      });
      console.log('✅ [Stock Movement] Warehouse stock updated (incremented)');
    } else {
      await tx.inventoryItem.create({
        data: {
          itemId: dto.itemId,
          warehouseId: dto.toWarehouseId,
          locationId: null, // Warehouse-level stock
          quantity: dto.quantity,
          status: 'AVAILABLE'
        }
      });
      console.log('✅ [Stock Movement] Warehouse stock created (new entry)');
    }

    // 4. Create INBOUND ledger entry for warehouse
    await this.stockLedgerService.createEntry({
      itemId: dto.itemId,
      warehouseId: dto.toWarehouseId,
      locationId: null, // Warehouse-level
      qty: dto.quantity,
      movementType: MovementType.INBOUND,
      referenceType: dto.referenceType || 'RETURN_REQUEST',
      referenceId: dto.referenceId || movementId,
      rate: itemRate,
    }, tx);

    console.log('✅ [Stock Movement] Warehouse INBOUND ledger entry created');
    console.log('🎉 [Stock Movement] Transfer Complete: Outlet → Warehouse');
  }

  async getMovements(itemId?: string) {
    return this.prisma.stockMovement.findMany({
      where: { itemId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
