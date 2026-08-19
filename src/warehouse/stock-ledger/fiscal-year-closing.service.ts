import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MovementType } from '@prisma/client';

@Injectable()
export class FiscalYearClosingService {
  private readonly logger = new Logger(FiscalYearClosingService.name);

  /**
   * Finds the latest Fiscal Year Opening Snapshot date prior to or on beforeDate.
   * Standard queries scan only from this snapshot date onwards, ignoring prior years.
   */
  async findLatestFiscalOpeningSnapshotDate(
    prisma: PrismaService | any,
    beforeDate?: Date,
  ): Promise<Date | null> {
    const targetDate = beforeDate || new Date();
    const currentYear = targetDate.getFullYear();
    const month = targetDate.getMonth(); // 0-indexed, 6 = July
    const fyStartYear = month >= 6 ? currentYear : currentYear - 1;
    const fiscalYearStart = new Date(fyStartYear, 6, 1); // July 1st 00:00:00

    try {
      const latestSnapshot = await prisma.stockLedger.findFirst({
        where: {
          OR: [
            { movementType: MovementType.OPENING_BALANCE },
            { referenceType: { in: ['FISCAL_YEAR_OPENING', 'OPENING_BALANCE', 'BULK_STOCK_UPLOAD'] } },
          ],
          createdAt: { gte: fiscalYearStart, lte: targetDate },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });

      if (latestSnapshot?.createdAt) {
        // Return 00:00:00 of the snapshot day
        const snapshotDate = new Date(latestSnapshot.createdAt);
        snapshotDate.setHours(0, 0, 0, 0);
        return snapshotDate;
      }
    } catch (err: any) {
      this.logger.warn(`Failed to resolve latest fiscal opening snapshot: ${err.message}`);
    }

    return fiscalYearStart;
  }

  /**
   * Executes Year-End Inventory Roll-Forward & Fiscal Closing.
   * Calculates closing quantities and weighted average costs as of closingDate (e.g. June 30),
   * then creates new OPENING_BALANCE records on nextDay (July 1st 00:00:00).
   */
  async executeYearEndClose(
    prisma: PrismaService | any,
    opts: {
      fiscalYearName: string;
      closingDate: Date;
      userId?: string;
      companyId?: string;
      skipLedgerEntries?: boolean;
    },
  ): Promise<{ success: boolean; openingRecordsCount: number; message: string }> {
    const { fiscalYearName, closingDate, userId, companyId, skipLedgerEntries } = opts;
    this.logger.log(`Starting Fiscal Year Close for ${fiscalYearName} (skipLedgerEntries=${!!skipLedgerEntries})`);

    let openingRecordsCount = 0;

    // Determine July 1st 00:00:00 opening timestamp
    const openingDate = new Date(closingDate);
    openingDate.setDate(openingDate.getDate() + 1);
    openingDate.setHours(0, 0, 0, 0);

    if (!skipLedgerEntries) {
      // Fetch all items with ledger history up to closingDate
      const ledgerItems = await prisma.stockLedger.findMany({
        where: { createdAt: { lte: closingDate } },
        select: { itemId: true, warehouseId: true, locationId: true },
        distinct: ['itemId', 'warehouseId', 'locationId'],
      });

      if (ledgerItems.length > 0) {
        const uniqueItemIds: string[] = Array.from(new Set(ledgerItems.map((i: any) => String(i.itemId))));
        const CHUNK_SIZE = 1000;
        const itemChunks: string[][] = [];
        for (let i = 0; i < uniqueItemIds.length; i += CHUNK_SIZE) {
          itemChunks.push(uniqueItemIds.slice(i, i + CHUNK_SIZE));
        }

        const openingEntriesToCreate: any[] = [];
        for (const chunk of itemChunks) {
          const [sumResults, latestCosts] = await Promise.all([
            prisma.stockLedger.groupBy({
              by: ['itemId', 'warehouseId', 'locationId'],
              where: {
                itemId: { in: chunk },
                createdAt: { lte: closingDate },
              },
              _sum: { qty: true },
            }),
            prisma.stockLedger.findMany({
              where: {
                itemId: { in: chunk },
                createdAt: { lte: closingDate },
                OR: [
                  { unitCost: { gt: 0 } },
                  { rate: { gt: 0 } },
                ],
              },
              select: { itemId: true, unitCost: true, rate: true, createdAt: true },
              orderBy: { createdAt: 'desc' },
            }),
          ]);

          const costMap = new Map<string, number>();
          for (const entry of latestCosts) {
            if (!costMap.has(entry.itemId)) {
              const cost = Number(entry.unitCost ?? entry.rate ?? 0);
              if (cost > 0) costMap.set(entry.itemId, cost);
            }
          }

          for (const row of sumResults) {
            const qty = Number(row._sum?.qty || 0);
            if (qty !== 0) {
              const unitCost = costMap.get(row.itemId) || 0;
              openingEntriesToCreate.push({
                itemId: row.itemId,
                warehouseId: row.warehouseId,
                locationId: row.locationId || null,
                qty,
                unitCost,
                rate: unitCost,
                movementType: MovementType.OPENING_BALANCE,
                referenceType: 'FISCAL_YEAR_OPENING',
                referenceId: fiscalYearName,
                createdAt: openingDate,
              });
            }
          }
        }

        if (openingEntriesToCreate.length > 0) {
          const BATCH_SIZE = 1000;
          for (let i = 0; i < openingEntriesToCreate.length; i += BATCH_SIZE) {
            const batch = openingEntriesToCreate.slice(i, i + BATCH_SIZE);
            await prisma.stockLedger.createMany({
              data: batch,
            });
          }
        }
        openingRecordsCount = openingEntriesToCreate.length;
      }
    }

    // Mark Fiscal Period as Closed in database
    try {
      const existingPeriod = await prisma.fiscalPeriod.findFirst({
        where: { name: fiscalYearName },
      });

      if (existingPeriod) {
        await prisma.fiscalPeriod.update({
          where: { id: existingPeriod.id },
          data: {
            isClosed: true,
            closedAt: new Date(),
            closedByUserId: userId,
          },
        });
      } else {
        await prisma.fiscalPeriod.create({
          data: {
            companyId,
            name: fiscalYearName,
            startDate: new Date(closingDate.getFullYear() - 1, 6, 1),
            endDate: closingDate,
            isClosed: true,
            closedAt: new Date(),
            closedByUserId: userId,
          },
        });
      }
    } catch (err: any) {
      this.logger.warn(`Could not update FiscalPeriod table: ${err.message}`);
    }

    this.logger.log(`Fiscal Year Close ${fiscalYearName} completed successfully. Created ${openingRecordsCount} opening balance records for ${openingDate.toISOString()}`);

    return {
      success: true,
      openingRecordsCount,
      message: `Fiscal Year ${fiscalYearName} closed successfully. Created ${openingRecordsCount} opening balance snapshot records for July 1st.`,
    };
  }

  /**
   * Scans existing bulk upload / opening balance entries and registers the initial FiscalPeriod
   */
  async backfillInitialFiscalPeriod(
    prisma: PrismaService | any,
    userId?: string,
  ): Promise<{ success: boolean; message: string; snapshotDate?: Date }> {
    const earliestOpening = await prisma.stockLedger.findFirst({
      where: {
        OR: [
          { movementType: MovementType.OPENING_BALANCE },
          { referenceType: { in: ['FISCAL_YEAR_OPENING', 'OPENING_BALANCE', 'BULK_STOCK_UPLOAD'] } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });

    if (!earliestOpening?.createdAt) {
      return { success: false, message: 'No opening balance records found in stock ledgers to backfill.' };
    }

    const snapshotDate = new Date(earliestOpening.createdAt);
    snapshotDate.setHours(0, 0, 0, 0);

    const year = snapshotDate.getFullYear();
    const month = snapshotDate.getMonth();
    const fyYear = month >= 6 ? year : year - 1;
    const fyName = `FY_${fyYear}_${fyYear + 1}`;

    const existing = await prisma.fiscalPeriod.findFirst({
      where: { name: fyName },
    });

    if (!existing) {
      await prisma.fiscalPeriod.create({
        data: {
          name: fyName,
          startDate: new Date(fyYear, 6, 1),
          endDate: new Date(fyYear + 1, 5, 30, 23, 59, 59),
          isClosed: false,
          closedByUserId: userId,
        },
      });
    }

    return {
      success: true,
      message: `Initial fiscal period ${fyName} backfilled successfully from existing opening entries on ${snapshotDate.toISOString().split('T')[0]}.`,
      snapshotDate,
    };
  }

  /**
   * Directly adjusts opening balance quantities and unit costs in StockLedger and InventoryItem
   * for specified barcodes in a warehouse.
   */
  async adjustOpeningBalances(
    prisma: PrismaService | any,
    opts: {
      warehouseCode?: string;
      warehouseId?: string;
      adjustments: Array<{
        barCode: string;
        deductQty: number;
        newUnitCost: number;
      }>;
    },
  ): Promise<{ success: boolean; updatedCount: number; message: string; details: any[] }> {
    const { warehouseCode = 'C40001', warehouseId: explicitWhId, adjustments } = opts;

    // 1. Resolve Warehouse
    let warehouseId = explicitWhId;
    if (!warehouseId && warehouseCode) {
      const wh = await prisma.warehouse.findFirst({
        where: {
          OR: [{ code: warehouseCode }, { name: warehouseCode }],
          isDeleted: false,
        },
        select: { id: true, code: true, name: true },
      });
      if (wh) warehouseId = wh.id;
    }

    if (!warehouseId) {
      return { success: false, updatedCount: 0, message: `Warehouse "${warehouseCode}" not found.`, details: [] };
    }

    // 2. Resolve items by barcode / itemId
    const barCodes = adjustments.map(a => a.barCode);
    const items = await prisma.item.findMany({
      where: {
        OR: [
          { barCode: { in: barCodes } },
          { itemId: { in: barCodes } },
        ],
      },
      select: { id: true, barCode: true, itemId: true, description: true },
    });

    const itemMap = new Map<string, any>();
    for (const item of items) {
      if (item.barCode) itemMap.set(item.barCode, item);
      if (item.itemId) itemMap.set(item.itemId, item);
    }

    let updatedCount = 0;
    const details: any[] = [];

    for (const adj of adjustments) {
      const item = itemMap.get(adj.barCode);
      if (!item) {
        details.push({ barCode: adj.barCode, status: 'SKIPPED', reason: 'Barcode not found in Item master' });
        continue;
      }

      // Find opening balance ledger entries for this item & warehouse
      const ledgerEntries = await prisma.stockLedger.findMany({
        where: {
          itemId: item.id,
          warehouseId,
          OR: [
            { movementType: MovementType.OPENING_BALANCE },
            { referenceType: { in: ['OPENING_BALANCE', 'BULK_STOCK_UPLOAD', 'FISCAL_YEAR_OPENING'] } },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });

      if (ledgerEntries.length > 0) {
        // Update the primary opening balance ledger entry
        const primaryLedger = ledgerEntries[0];
        const currentQty = Number(primaryLedger.qty || 0);
        const newQty = Math.max(0, currentQty - adj.deductQty);

        await prisma.stockLedger.update({
          where: { id: primaryLedger.id },
          data: {
            qty: newQty,
            unitCost: adj.newUnitCost,
            rate: adj.newUnitCost,
          },
        });

        // Update active InventoryItem qty balance
        const invItems = await prisma.inventoryItem.findMany({
          where: { itemId: item.id, warehouseId },
        });

        for (const inv of invItems) {
          const newInvQty = Math.max(0, Number(inv.qty || 0) - adj.deductQty);
          await prisma.inventoryItem.update({
            where: { id: inv.id },
            data: { qty: newInvQty },
          });
        }

        updatedCount++;
        details.push({
          barCode: adj.barCode,
          itemId: item.id,
          oldQty: currentQty,
          newQty,
          deducted: adj.deductQty,
          newUnitCost: adj.newUnitCost,
          status: 'SUCCESS',
        });
      } else {
        details.push({
          barCode: adj.barCode,
          itemId: item.id,
          status: 'SKIPPED',
          reason: 'No existing opening ledger entry found to adjust',
        });
      }
    }

    return {
      success: true,
      updatedCount,
      message: `Successfully adjusted opening balances and unit costs for ${updatedCount} barcodes in warehouse ${warehouseCode}.`,
      details,
    };
  }
}
