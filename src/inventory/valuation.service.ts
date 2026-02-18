import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ValuationService {
  private readonly logger = new Logger(ValuationService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Records an inventory transaction and updates the item's Weighted Average Cost (WAC).
   * This method should be called within a Prisma transaction.
   */
  async recordTransaction(
    tx: any, // Prisma Transaction Client
    data: {
      itemId: string;
      quantity: Decimal | number;
      unitCost: Decimal | number;
      type: 'PURCHASE' | 'SALE' | 'ADJUSTMENT' | 'TRANSFER' | 'RETURN';
      documentType?: string;
      documentId?: string;
      notes?: string;
      userId?: string;
    },
  ) {
    const {
      itemId,
      quantity,
      unitCost,
      type,
      documentType,
      documentId,
      notes,
      userId,
    } = data;
    const qty = new Decimal(quantity);
    const cost = new Decimal(unitCost);

    // 1. Get current item settings (or create default)
    let itemSetting = await tx.tenantItemSetting.findUnique({
      where: { itemId },
    });

    if (!itemSetting) {
      itemSetting = await tx.tenantItemSetting.create({
        data: { itemId, averageCost: 0 },
      });
    }

    const currentAvgCost = itemSetting.averageCost
      ? new Decimal(itemSetting.averageCost)
      : new Decimal(0);

    // We need the CURRENT total quantity to calculate the new WAC.
    // For simplicity in this logical layer, we can sum the ledger or query the physical inventory.
    // Here, we'll assume the `InventoryTransaction` ledger is the source of truth for *financial* quantity.
    // Optimally, we store a running balance on `TenantItemSetting` or `InventoryTransaction`.

    // Let's get the last transaction's balance to avoid summing everything
    const lastTx = await tx.inventoryTransaction.findFirst({
      where: { itemId },
      orderBy: { transactionDate: 'desc' },
    });

    const currentQtyDetails = lastTx?.quantityBalance ?? new Decimal(0);
    const currentValueDetails = lastTx?.valueBalance ?? new Decimal(0);

    let newAvgCost = currentAvgCost;
    const newQtyBalance = currentQtyDetails.plus(qty);
    let newValueBalance = currentValueDetails.plus(qty.mul(cost));

    // 2. Calculate Weighted Average Cost (Only on INBOUND/POSITIVE value changes)
    if (type === 'PURCHASE' || (type === 'ADJUSTMENT' && qty.isPositive())) {
      // Formula: ((CurrentQty * CurrentAvg) + (NewQty * NewCost)) / (CurrentQty + NewQty)
      // Note: We use the *Value Balance* which is (Qty * Cost)

      const totalNewValue = currentValueDetails.plus(qty.mul(cost));
      const totalNewQty = currentQtyDetails.plus(qty);

      if (!totalNewQty.isZero()) {
        newAvgCost = totalNewValue.div(totalNewQty);
      }
    } else {
      // For OUTBOUND (Sale), the cost is the Current Average Cost.
      // We do NOT update the Average Cost on sales, we just consume value.
      newValueBalance = currentValueDetails.plus(qty.mul(currentAvgCost)); // qty is negative here
    }

    // 3. Update Item Settings
    await tx.tenantItemSetting.update({
      where: { itemId },
      data: { averageCost: newAvgCost },
    });

    // 4. Create Ledger Entry
    const transaction = await tx.inventoryTransaction.create({
      data: {
        itemId,
        type,
        documentType,
        documentId,
        quantity: qty,
        unitCost: type === 'PURCHASE' ? cost : currentAvgCost, // Sales use moving average
        totalValue: qty.mul(type === 'PURCHASE' ? cost : currentAvgCost),
        quantityBalance: newQtyBalance,
        valueBalance: newValueBalance,
        notes,
        createdById: userId,
      },
    });

    this.logger.log(
      `Recorded ${type} for Item ${itemId}: Qty ${qty}, Cost ${cost}, New WAC ${newAvgCost}`,
    );
    return transaction;
  }

  /**
   * Get the current valuation of an item
   */
  async getItemValuation(itemId: string) {
    const setting = await this.prisma.tenantItemSetting.findUnique({
      where: { itemId },
    });
    return {
      itemId,
      valuationMethod: setting?.valuationMethod ?? 'WEIGHTED_AVG',
      averageCost: setting?.averageCost ?? 0,
    };
  }
}
