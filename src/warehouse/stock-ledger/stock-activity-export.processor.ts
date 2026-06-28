import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { MovementType } from '@prisma/client';

export interface StockActivityExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  locationId: string;
  startDate?: string;
  endDate?: string;
}

const GROUP_COLORS: Record<string, string> = {
  General: '1E293B',
  'Transfer IN': '065F46',
  'Transfer OUT': '991B1B',
  Movements: '5B21B6',
  Balances: '1E3A8A',
};

const COLUMNS = [
  { header: 'SKU / Variant Info', key: 'sku', width: 28, group: 'General' },
  { header: 'Color', key: 'color', width: 14, group: 'General', align: 'center' as const },
  { header: 'Size', key: 'size', width: 10, group: 'General', align: 'center' as const },
  { header: 'BF (Opening)', key: 'bf', width: 14, group: 'General', align: 'right' as const },
  { header: 'Wh IN', key: 'fromWarehouse', width: 12, group: 'Transfer IN', align: 'right' as const },
  { header: 'Out IN', key: 'fromOutlet', width: 12, group: 'Transfer IN', align: 'right' as const },
  { header: 'Total IN', key: 'totalTrfIn', width: 14, group: 'Transfer IN', align: 'right' as const },
  { header: 'Wh OUT', key: 'toWarehouse', width: 12, group: 'Transfer OUT', align: 'right' as const },
  { header: 'Out OUT', key: 'toOutlet', width: 12, group: 'Transfer OUT', align: 'right' as const },
  { header: 'Total OUT', key: 'totalTrfOut', width: 14, group: 'Transfer OUT', align: 'right' as const },
  { header: 'Exchg', key: 'exchg', width: 12, group: 'Movements', align: 'right' as const },
  { header: 'Refund', key: 'refund', width: 12, group: 'Movements', align: 'right' as const },
  { header: 'Claim', key: 'claim', width: 12, group: 'Movements', align: 'right' as const },
  { header: 'Sales', key: 'sales', width: 12, group: 'Movements', align: 'right' as const },
  { header: 'Adj', key: 'adj', width: 12, group: 'Movements', align: 'right' as const },
  { header: 'Available', key: 'availableStock', width: 14, group: 'Balances', align: 'right' as const },
  { header: 'Transit', key: 'transit', width: 12, group: 'Balances', align: 'right' as const },
  { header: 'Balance', key: 'balance', width: 16, group: 'Balances', align: 'right' as const },
];

@Processor('stock-activity-export')
export class StockActivityExportProcessor {
  private readonly logger = new Logger(StockActivityExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
  ) {}

  @Process()
  async handleExport(job: Job<StockActivityExportJobData>): Promise<void> {
    const { jobId, userId, tenantId, tenantDbUrl, locationId, startDate: startStr, endDate: endStr } = job.data;
    this.logger.log(`[StockActivityExport ${jobId}] Starting for user ${userId}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);
    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const filePath = path.join(exportDir, `export-${jobId}.xlsx`);

    try {
      await job.progress(5);

      const location = await prisma.location.findUnique({
        where: { id: locationId },
        select: { name: true },
      });
      const locationName = location?.name || 'Store';

      const now = new Date();
      const startDate = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate = endStr ? new Date(endStr) : new Date(now);

      await job.progress(10);

      // Fetch items and ledgers matching previous calculations
      const inventoryItems = await prisma.inventoryItem.findMany({
        where: { locationId, status: 'AVAILABLE' },
        select: { itemId: true },
      });

      const ledgerItems = await prisma.stockLedger.findMany({
        where: { locationId },
        select: { itemId: true },
        distinct: ['itemId'],
      });

      const uniqueItemIds = [...new Set([
        ...inventoryItems.map(i => i.itemId),
        ...ledgerItems.map(l => l.itemId),
      ])];

      if (uniqueItemIds.length === 0) {
        await this.writeEmptyWorkbook(filePath);
        await job.progress(100);
        return;
      }

      await job.progress(20);

      const items = await prisma.item.findMany({
        where: { id: { in: uniqueItemIds } },
        include: {
          color: true,
          size: true,
          gender: true,
          category: true,
          division: true,
          brand: true,
        },
      });

      await job.progress(40);

      const matchedItemIds = items.map(i => i.id);

      const bfGroup = await prisma.stockLedger.groupBy({
        by: ['itemId'],
        where: {
          locationId,
          itemId: { in: matchedItemIds },
          createdAt: { lt: startDate },
        },
        _sum: { qty: true },
      });

      const bfMap = new Map<string, number>();
      for (const row of bfGroup) {
        bfMap.set(row.itemId, Number(row._sum.qty || 0));
      }

      const ledgerEntries = await prisma.stockLedger.findMany({
        where: {
          locationId,
          itemId: { in: matchedItemIds },
          createdAt: { gte: startDate, lte: endDate },
        },
        select: {
          itemId: true,
          qty: true,
          referenceType: true,
          movementType: true,
        },
      });

      const transitItems = await prisma.transferRequestItem.findMany({
        where: {
          itemId: { in: matchedItemIds },
          transferRequest: {
            toLocationId: locationId,
            status: { in: ['PENDING', 'SOURCE_APPROVED'] },
            transferType: { in: ['WAREHOUSE_TO_OUTLET', 'OUTLET_TO_OUTLET'] },
          },
        },
        select: {
          itemId: true,
          quantity: true,
        },
      });

      const transitMap = new Map<string, number>();
      for (const row of transitItems) {
        const qty = Number(row.quantity || 0);
        transitMap.set(row.itemId, (transitMap.get(row.itemId) || 0) + qty);
      }

      await job.progress(60);

      const itemMetricsMap = new Map<string, {
        fromWarehouse: number;
        fromOutlet: number;
        toWarehouse: number;
        toOutlet: number;
        exchg: number;
        refund: number;
        claim: number;
        sales: number;
        adj: number;
      }>();

      for (const entry of ledgerEntries) {
        const itemId = entry.itemId;
        let m = itemMetricsMap.get(itemId);
        if (!m) {
          m = {
            fromWarehouse: 0, fromOutlet: 0, toWarehouse: 0, toOutlet: 0,
            exchg: 0, refund: 0, claim: 0, sales: 0, adj: 0,
          };
          itemMetricsMap.set(itemId, m);
        }

        const qty = Number(entry.qty || 0);
        const ref = entry.referenceType || '';
        const mov = entry.movementType;

        if (mov === MovementType.ADJUSTMENT) {
          m.adj += qty;
        } else if (qty > 0) {
          if (ref === 'TRANSFER_REQUEST') {
            m.fromWarehouse += qty;
          } else if (ref === 'OUTLET_TRANSFER_IN') {
            m.fromOutlet += qty;
          } else if (['POS_RETURN', 'POS_EXCHANGE_IN'].includes(ref)) {
            m.exchg += qty;
          } else if (['POS_REFUND', 'POS_VOID'].includes(ref)) {
            m.refund += qty;
          } else if (ref === 'POS_CLAIM_APPROVED') {
            m.claim += qty;
          } else {
            m.adj += qty;
          }
        } else if (qty < 0) {
          const absQty = Math.abs(qty);
          if (['RETURN_REQUEST', 'CLAIM_RETURN', 'CLAIM_TO_PLM', 'CLAIM_RETURN_REQUEST'].includes(ref)) {
            m.toWarehouse += absQty;
          } else if (ref === 'OUTLET_TRANSFER_OUT') {
            m.toOutlet += absQty;
          } else if (['POS_SALE', 'POS_EXCHANGE_OUT'].includes(ref)) {
            m.sales += absQty;
          } else {
            m.adj += qty;
          }
        }
      }

      // Build hierarchical grouping:
      // Gender -> Category -> Division -> Brand -> SKU (Article) -> Variants
      const root: any[] = [];
      const getOrInsert = (arr: any[], keyField: string, keyValue: string, creator: () => any) => {
        let val = arr.find(x => x[keyField] === keyValue);
        if (!val) {
          val = creator();
          arr.push(val);
        }
        return val;
      };

      const createEmptyTotals = () => ({
        bf: 0, fromWarehouse: 0, fromOutlet: 0, totalTrfIn: 0,
        toWarehouse: 0, toOutlet: 0, totalTrfOut: 0, exchg: 0,
        refund: 0, claim: 0, sales: 0, adj: 0, availableStock: 0,
        transit: 0, balance: 0,
      });

      const addTotals = (target: any, source: any) => {
        target.bf += source.bf;
        target.fromWarehouse += source.fromWarehouse;
        target.fromOutlet += source.fromOutlet;
        target.totalTrfIn += source.totalTrfIn;
        target.toWarehouse += source.toWarehouse;
        target.toOutlet += source.toOutlet;
        target.totalTrfOut += source.totalTrfOut;
        target.exchg += source.exchg;
        target.refund += source.refund;
        target.claim += source.claim;
        target.sales += source.sales;
        target.adj += source.adj;
        target.availableStock += source.availableStock;
        target.transit += source.transit;
        target.balance += source.balance;
      };

      for (const item of items) {
        const genderName = item.gender?.name || 'No Gender';
        const categoryName = item.category?.name || 'No Category';
        const divisionName = item.division?.name || 'No Division';
        const brandName = item.brand?.name || 'No Brand';
        const sku = item.sku;
        const articleName = item.description || 'Unknown Article';

        const bf = bfMap.get(item.id) || 0;
        const transit = transitMap.get(item.id) || 0;
        const m = itemMetricsMap.get(item.id) || {
          fromWarehouse: 0, fromOutlet: 0, toWarehouse: 0, toOutlet: 0,
          exchg: 0, refund: 0, claim: 0, sales: 0, adj: 0,
        };

        const totalTrfIn = m.fromWarehouse + m.fromOutlet;
        const totalTrfOut = m.toWarehouse + m.toOutlet;
        const availableStock = bf + totalTrfIn - totalTrfOut + m.exchg + m.refund + m.claim - m.sales + m.adj;
        const balance = availableStock + transit;

        const variant = {
          itemId: item.id,
          color: item.color?.name || 'Default',
          size: item.size?.name || 'Default',
          bf,
          fromWarehouse: m.fromWarehouse,
          fromOutlet: m.fromOutlet,
          totalTrfIn,
          toWarehouse: m.toWarehouse,
          toOutlet: m.toOutlet,
          totalTrfOut,
          exchg: m.exchg,
          refund: m.refund,
          claim: m.claim,
          sales: m.sales,
          adj: m.adj,
          availableStock,
          transit,
          balance,
        };

        const genderNode = getOrInsert(root, 'gender', genderName, () => ({ gender: genderName, categories: [], totals: createEmptyTotals() }));
        const categoryNode = getOrInsert(genderNode.categories, 'category', categoryName, () => ({ category: categoryName, divisions: [], totals: createEmptyTotals() }));
        const divisionNode = getOrInsert(categoryNode.divisions, 'division', divisionName, () => ({ division: divisionName, brands: [], totals: createEmptyTotals() }));
        const brandNode = getOrInsert(divisionNode.brands, 'brand', brandName, () => ({ brand: brandName, articles: [], totals: createEmptyTotals() }));
        const articleNode = getOrInsert(brandNode.articles, 'sku', sku, () => ({
          sku,
          articleName,
          totals: createEmptyTotals(),
          variants: [],
        }));

        articleNode.variants.push(variant);
        addTotals(articleNode.totals, variant);
      }

      // Compute aggregates recursively
      for (const g of root) {
        for (const c of g.categories) {
          for (const d of c.divisions) {
            for (const b of d.brands) {
              for (const a of b.articles) {
                addTotals(b.totals, a.totals);
              }
              addTotals(d.totals, b.totals);
            }
            addTotals(c.totals, d.totals);
          }
          addTotals(g.totals, c.totals);
        }
      }

      await job.progress(80);

      // Initialize Streaming excel writer
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        filename: filePath,
        useStyles: true,
        useSharedStrings: false,
      });

      const ws = workbook.addWorksheet('Stock Activity Report', {
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
        views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }],
      });

      ws.columns = COLUMNS.map(c => ({ key: c.key, width: c.width }));

      // Write Row 1: Merged Group Headers
      const groups: Record<string, { start: number; end: number }> = {};
      COLUMNS.forEach((col, idx) => {
        const n = idx + 1;
        if (!groups[col.group]) groups[col.group] = { start: n, end: n };
        else groups[col.group].end = n;
      });

      const groupRow = ws.getRow(1);
      COLUMNS.forEach((col, idx) => {
        const cell = groupRow.getCell(idx + 1);
        const { start } = groups[col.group];
        if (idx + 1 === start) cell.value = col.group.toUpperCase();
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${GROUP_COLORS[col.group] ?? '1E293B'}` } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        };
      });
      groupRow.height = 22;
      groupRow.commit();

      // Write Row 2: Columns Header labels
      const headerRow = ws.getRow(2);
      COLUMNS.forEach((col, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = col.header;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
        cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          bottom: { style: 'medium', color: { argb: 'FF1E293B' } },
          right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        };
      });
      headerRow.height = 22;
      headerRow.commit();

      const borderThin = {
        top: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
      };

      const rightAlign = { horizontal: 'right' as const, vertical: 'middle' as const };
      const leftAlign = { horizontal: 'left' as const, vertical: 'middle' as const };
      const centerAlign = { horizontal: 'center' as const, vertical: 'middle' as const };

      // Helper to style subtotal/group header rows
      const styleHeaderRow = (row: ExcelJS.Row, bgHex: string, bold: boolean, size = 9) => {
        row.eachCell((cell, colNum) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${bgHex}` } };
          cell.font = { bold, size, color: { argb: 'FF1E293B' } };
          cell.border = borderThin;
          cell.alignment = colNum <= 3 ? leftAlign : rightAlign;
        });
        row.height = 20;
        row.commit();
      };

      // Write hierarchical data sequentially
      for (const g of root) {
        // GENDER HEADER ROW
        const gRow = ws.addRow({ sku: `GENDER: ${g.gender.toUpperCase()}` });
        styleHeaderRow(gRow, 'E2E8F0', true, 10);

        for (const c of g.categories) {
          // CATEGORY HEADER ROW
          const cRow = ws.addRow({ sku: `  CATEGORY: ${c.category.toUpperCase()}` });
          styleHeaderRow(cRow, 'F1F5F9', true, 9.5);

          for (const d of c.divisions) {
            // DIVISION HEADER ROW
            const dRow = ws.addRow({ sku: `    DIVISION: ${d.division.toUpperCase()}` });
            styleHeaderRow(dRow, 'F8FAFC', true, 9);

            for (const b of d.brands) {
              // BRAND HEADER ROW
              const bRow = ws.addRow({ sku: `      BRAND: ${b.brand.toUpperCase()}` });
              styleHeaderRow(bRow, 'FAFAFA', true, 9);

              for (const a of b.articles) {
                // ARTICLE HEADER ROW (contains SKU totals)
                const aRow = ws.addRow({
                  sku: `        SKU: ${a.sku} (${a.articleName})`,
                  color: 'ALL COLORS',
                  size: 'ALL SIZES',
                  bf: a.totals.bf,
                  fromWarehouse: a.totals.fromWarehouse,
                  fromOutlet: a.totals.fromOutlet,
                  totalTrfIn: a.totals.totalTrfIn,
                  toWarehouse: a.totals.toWarehouse,
                  toOutlet: a.totals.toOutlet,
                  totalTrfOut: a.totals.totalTrfOut,
                  exchg: a.totals.exchg,
                  refund: a.totals.refund,
                  claim: a.totals.claim,
                  sales: a.totals.sales,
                  adj: a.totals.adj,
                  availableStock: a.totals.availableStock,
                  transit: a.totals.transit,
                  balance: a.totals.balance,
                });
                styleHeaderRow(aRow, 'F1F5F9', true, 9);

                // VARIANT DETAILS ROWS
                for (const v of a.variants) {
                  const vRow = ws.addRow({
                    sku: '          Variant Item',
                    color: v.color,
                    size: v.size,
                    bf: v.bf,
                    fromWarehouse: v.fromWarehouse,
                    fromOutlet: v.fromOutlet,
                    totalTrfIn: v.totalTrfIn,
                    toWarehouse: v.toWarehouse,
                    toOutlet: v.toOutlet,
                    totalTrfOut: v.totalTrfOut,
                    exchg: v.exchg,
                    refund: v.refund,
                    claim: v.claim,
                    sales: v.sales,
                    adj: v.adj,
                    availableStock: v.availableStock,
                    transit: v.transit,
                    balance: v.balance,
                  });

                  vRow.eachCell((cell, colNum) => {
                    cell.font = { size: 9, color: { argb: 'FF475569' } };
                    cell.border = borderThin;
                    cell.alignment = colNum === 2 || colNum === 3 ? centerAlign : (colNum === 1 ? leftAlign : rightAlign);
                  });
                  vRow.height = 18;
                  vRow.commit();
                }

                // Subtotal for Article (Visual Spacer)
                const spacer = ws.addRow({});
                spacer.height = 4;
                spacer.commit();
              }

              // Brand Subtotal Footer
              const bFoot = ws.addRow({
                sku: `      TOTAL FOR BRAND: ${b.brand.toUpperCase()}`,
                bf: b.totals.bf,
                fromWarehouse: b.totals.fromWarehouse,
                fromOutlet: b.totals.fromOutlet,
                totalTrfIn: b.totals.totalTrfIn,
                toWarehouse: b.totals.toWarehouse,
                toOutlet: b.totals.toOutlet,
                totalTrfOut: b.totals.totalTrfOut,
                exchg: b.totals.exchg,
                refund: b.totals.refund,
                claim: b.totals.claim,
                sales: b.totals.sales,
                adj: b.totals.adj,
                availableStock: b.totals.availableStock,
                transit: b.totals.transit,
                balance: b.totals.balance,
              });
              styleHeaderRow(bFoot, 'E2E8F0', true, 9);
            }
          }
        }
      }

      await workbook.commit();
      await job.progress(95);

      // Record size in ExportHistory and set status to COMPLETED
      const stats = fs.statSync(filePath);
      await prisma.exportHistory.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          fileSize: stats.size,
          completedAt: new Date(),
        },
      });

      // Notify User via Socket notification
      await this.notificationsService.create({
        userId,
        title: 'Stock Activity Export Ready',
        message: `Your Stock Activity report for outlet ${locationName} has been processed successfully.`,
        category: 'export',
        priority: 'high',
        actionType: 'stock-activity-export.ready',
        actionPayload: JSON.stringify({ jobId }),
      });

      await job.progress(100);
      this.logger.log(`[StockActivityExport ${jobId}] Finished processing successfully`);
    } catch (err) {
      this.logger.error(`[StockActivityExport ${jobId}] Failed: ${err.message}`, err.stack);
      try {
        await prisma.exportHistory.update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
          },
        });
      } catch (dbErr) {
        this.logger.warn(`Could not update export job status to FAILED in database: ${dbErr.message}`);
      }
      throw err;
    }
  }

  private async writeEmptyWorkbook(filePath: string): Promise<void> {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: filePath,
      useStyles: true,
      useSharedStrings: false,
    });
    const ws = workbook.addWorksheet('Stock Activity Report');
    const r = ws.addRow({ A: 'No data matches filters' });
    r.commit();
    await workbook.commit();
  }
}
