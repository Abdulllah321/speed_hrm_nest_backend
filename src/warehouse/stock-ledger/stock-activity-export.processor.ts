import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import * as puppeteer from 'puppeteer';
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
  format: 'xlsx' | 'pdf';
  summaryOnly?: boolean;
}

const GROUP_COLORS: Record<string, string> = {
  General: '1E293B',
  'Transfer IN': '065F46',
  'Transfer OUT': '991B1B',
  Movements: '5B21B6',
  Balances: '1E3A8A',
};

const COLUMNS = [
  { header: 'SKU / Variant Info', key: 'sku', width: 32, group: 'General' },
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
  ) {
    if (process.platform === 'linux') {
      try {
        const logger = new Logger('StockActivityExportProcessor');
        logger.log('Checking and installing Chromium dependencies on Linux host...');
        const { exec } = require('child_process');
        exec(
          'apt-get update && apt-get install -y libatk1.0-0 libatk-bridge2.0-0 libcups2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpangocairo-1.0-0 libasound2 libnss3 libxshmfence1 libgtk-3-0',
          (err: any) => {
            if (err) {
              logger.warn(`Could not install Chromium dependencies automatically: ${err.message}. If not running as root, please install them manually: apt-get install -y libatk1.0-0 libatk-bridge2.0-0 libcups2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpangocairo-1.0-0 libasound2 libnss3 libxshmfence1 libgtk-3-0`);
            } else {
              logger.log('Chromium dependencies verified/installed successfully.');
            }
          }
        );
      } catch (e: any) {
        this.logger.warn(`Error trying to run chromium dependencies installer: ${e.message}`);
      }
    }
  }

  @Process()
  async handleExport(job: Job<StockActivityExportJobData>): Promise<void> {
    const { jobId, userId, tenantId, tenantDbUrl, locationId, startDate: startStr, endDate: endStr, format, summaryOnly } = job.data;
    this.logger.log(`[StockActivityExport ${jobId}] Starting ${format.toUpperCase()} export for user ${userId}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);
    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const ext = format === 'pdf' ? 'pdf' : 'xlsx';
    const filePath = path.join(exportDir, `export-${jobId}.${ext}`);

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

      // Fetch inventory item ids
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
        if (format === 'xlsx') {
          await this.writeEmptyWorkbook(filePath);
        } else {
          await this.writeEmptyPdf(filePath, locationName, startDate, endDate);
        }
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

      await job.progress(45);

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
      // Division -> Brand -> Gender -> Category -> SKU (Article) -> Variants
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
        const divisionName = item.division?.name || 'No Division';
        const brandName = item.brand?.name || 'No Brand';
        const genderName = item.gender?.name || 'No Gender';
        const categoryName = item.category?.name || 'No Category';
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

        const divisionNode = getOrInsert(root, 'division', divisionName, () => ({ division: divisionName, brands: [], totals: createEmptyTotals() }));
        const brandNode = getOrInsert(divisionNode.brands, 'brand', brandName, () => ({ brand: brandName, genders: [], totals: createEmptyTotals() }));
        const genderNode = getOrInsert(brandNode.genders, 'gender', genderName, () => ({ gender: genderName, categories: [], totals: createEmptyTotals() }));
        const categoryNode = getOrInsert(genderNode.categories, 'category', categoryName, () => ({ category: categoryName, articles: [], totals: createEmptyTotals() }));
        const articleNode = getOrInsert(categoryNode.articles, 'sku', sku, () => ({
          sku,
          articleName,
          totals: createEmptyTotals(),
          variants: [],
        }));

        articleNode.variants.push(variant);
        addTotals(articleNode.totals, variant);
      }

      // Compute aggregates recursively & calculate grand totals
      const grandTotals = createEmptyTotals();
      for (const d of root) {
        for (const b of d.brands) {
          for (const g of b.genders) {
            for (const c of g.categories) {
              for (const a of c.articles) {
                addTotals(c.totals, a.totals);
              }
              addTotals(g.totals, c.totals);
            }
            addTotals(b.totals, g.totals);
          }
          addTotals(d.totals, b.totals);
        }
        addTotals(grandTotals, d.totals);
      }

      await job.progress(80);

      if (format === 'pdf') {
        const fromDateStr = startDate.toLocaleDateString();
        const toDateStr = endDate.toLocaleDateString();
        const html = this.buildPdfHtml(root, locationName, fromDateStr, toDateStr, grandTotals, !!summaryOnly);

        const browser = await puppeteer.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
          ],
        });

        try {
          const page = await browser.newPage();
          page.setDefaultTimeout(0);
          page.setDefaultNavigationTimeout(0);
          await page.setContent(html, { waitUntil: 'domcontentloaded' });

          const pdfBuffer = await page.pdf({
            format: 'A4',
            landscape: true,
            margin: { top: '15mm', bottom: '15mm', left: '10mm', right: '10mm' },
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate: '<div style="font-size: 7px; width: 100%; text-align: right; padding-right: 15mm; color: #94a3b8;">Innovative Network | Stock Activity Report</div>',
            footerTemplate: '<div style="font-size: 7px; width: 100%; text-align: center; color: #94a3b8;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
          });

          fs.writeFileSync(filePath, pdfBuffer);
        } finally {
          await browser.close();
        }
      } else {
        // XLSX Format Export
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

        // 1. Group Header bands
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

        // 2. Main Columns headers
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

        const styleHeaderRow = (row: ExcelJS.Row, bgHex: string, bold: boolean, size = 9, fgHex = '1E293B') => {
          for (let colNum = 1; colNum <= 18; colNum++) {
            const cell = row.getCell(colNum);
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${bgHex}` } };
            cell.font = { bold, size, color: { argb: `FF${fgHex}` } };
            cell.border = borderThin;
            cell.alignment = colNum <= 3 ? (colNum === 1 ? leftAlign : centerAlign) : rightAlign;
          }
          row.height = 20;
          row.commit();
        };

        // Write hierarchy data
        for (const d of root) {
          const dRow = ws.addRow({
            sku: `DIVISION: ${d.division.toUpperCase()}`,
            color: '',
            size: '',
            bf: d.totals.bf,
            fromWarehouse: d.totals.fromWarehouse,
            fromOutlet: d.totals.fromOutlet,
            totalTrfIn: d.totals.totalTrfIn,
            toWarehouse: d.totals.toWarehouse,
            toOutlet: d.totals.toOutlet,
            totalTrfOut: d.totals.totalTrfOut,
            exchg: d.totals.exchg,
            refund: d.totals.refund,
            claim: d.totals.claim,
            sales: d.totals.sales,
            adj: d.totals.adj,
            availableStock: d.totals.availableStock,
            transit: d.totals.transit,
            balance: d.totals.balance,
          });
          styleHeaderRow(dRow, '1E293B', true, 10, 'FFFFFF');

          for (const b of d.brands) {
            const bRow = ws.addRow({
              sku: `  BRAND: ${b.brand.toUpperCase()}`,
              color: '',
              size: '',
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
            styleHeaderRow(bRow, '334155', true, 9.5, 'FFFFFF');

            for (const g of b.genders) {
              const gRow = ws.addRow({
                sku: `    GENDER: ${g.gender.toUpperCase()}`,
                color: '',
                size: '',
                bf: g.totals.bf,
                fromWarehouse: g.totals.fromWarehouse,
                fromOutlet: g.totals.fromOutlet,
                totalTrfIn: g.totals.totalTrfIn,
                toWarehouse: g.totals.toWarehouse,
                toOutlet: g.totals.toOutlet,
                totalTrfOut: g.totals.totalTrfOut,
                exchg: g.totals.exchg,
                refund: g.totals.refund,
                claim: g.totals.claim,
                sales: g.totals.sales,
                adj: g.totals.adj,
                availableStock: g.totals.availableStock,
                transit: g.totals.transit,
                balance: g.totals.balance,
              });
              styleHeaderRow(gRow, '475569', true, 9, 'FFFFFF');

              for (const c of g.categories) {
                const cRow = ws.addRow({
                  sku: `      CATEGORY: ${c.category.toUpperCase()}`,
                  color: '',
                  size: '',
                  bf: c.totals.bf,
                  fromWarehouse: c.totals.fromWarehouse,
                  fromOutlet: c.totals.fromOutlet,
                  totalTrfIn: c.totals.totalTrfIn,
                  toWarehouse: c.totals.toWarehouse,
                  toOutlet: c.totals.toOutlet,
                  totalTrfOut: c.totals.totalTrfOut,
                  exchg: c.totals.exchg,
                  refund: c.totals.refund,
                  claim: c.totals.claim,
                  sales: c.totals.sales,
                  adj: c.totals.adj,
                  availableStock: c.totals.availableStock,
                  transit: c.totals.transit,
                  balance: c.totals.balance,
                });
                styleHeaderRow(cRow, '94A3B8', true, 9, 'FFFFFF');

                for (const a of c.articles) {
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

                  if (!summaryOnly) {
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
                  }
                }
              }
            }
          }
        }

        // Add GRAND TOTALS Row at bottom of Excel
        const totalRow = ws.addRow({
          sku: 'GRAND TOTAL',
          color: '',
          size: '',
          bf: grandTotals.bf,
          fromWarehouse: grandTotals.fromWarehouse,
          fromOutlet: grandTotals.fromOutlet,
          totalTrfIn: grandTotals.totalTrfIn,
          toWarehouse: grandTotals.toWarehouse,
          toOutlet: grandTotals.toOutlet,
          totalTrfOut: grandTotals.totalTrfOut,
          exchg: grandTotals.exchg,
          refund: grandTotals.refund,
          claim: grandTotals.claim,
          sales: grandTotals.sales,
          adj: grandTotals.adj,
          availableStock: grandTotals.availableStock,
          transit: grandTotals.transit,
          balance: grandTotals.balance,
        });

        totalRow.eachCell((cell, colNum) => {
          cell.font = { bold: true, size: 10, color: { argb: 'FF000000' } };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'double', color: { argb: 'FF000000' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
          cell.alignment = colNum <= 3 ? leftAlign : rightAlign;
        });
        totalRow.height = 24;
        totalRow.commit();

        await workbook.commit();
      }

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
        message: `Your Stock Activity ${format.toUpperCase()} report has been processed successfully.`,
        category: 'export',
        priority: 'high',
        actionType: 'stock-activity-export.ready',
        actionPayload: JSON.stringify({ jobId }),
      });

      await job.progress(100);
      this.logger.log(`[StockActivityExport ${jobId}] Finished processing ${format.toUpperCase()} successfully`);
    } catch (err) {
      this.logger.error(`[StockActivityExport ${jobId}] Failed: ${err.message}`, err.stack);
      try {
        await prisma.exportHistory.update({
          where: { id: jobId },
          data: { status: 'FAILED' },
        });
      } catch (dbErr) {
        this.logger.warn(`Could not update export job status to FAILED in database: ${dbErr.message}`);
      }
      throw err;
    }
  }

  private buildPdfHtml(
    data: any[],
    locationName: string,
    fromDateStr: string,
    toDateStr: string,
    grandTotals: any,
    summaryOnly: boolean,
  ): string {
    let rowsHtml = '';
    const formatVal = (val: number) => val === 0 ? '-' : val.toString();

    for (const d of data) {
      rowsHtml += `
        <tr class="division-row">
          <td colspan="3">DIVISION: ${d.division.toUpperCase()}</td>
          <td class="num">${formatVal(d.totals.bf)}</td>
          <td class="num">${formatVal(d.totals.fromWarehouse)}</td>
          <td class="num">${formatVal(d.totals.fromOutlet)}</td>
          <td class="num highlight-in">${formatVal(d.totals.totalTrfIn)}</td>
          <td class="num">${formatVal(d.totals.toWarehouse)}</td>
          <td class="num">${formatVal(d.totals.toOutlet)}</td>
          <td class="num highlight-out">${formatVal(d.totals.totalTrfOut)}</td>
          <td class="num">${formatVal(d.totals.exchg)}</td>
          <td class="num">${formatVal(d.totals.refund)}</td>
          <td class="num">${formatVal(d.totals.claim)}</td>
          <td class="num">${formatVal(d.totals.sales)}</td>
          <td class="num">${formatVal(d.totals.adj)}</td>
          <td class="num highlight-avail">${formatVal(d.totals.availableStock)}</td>
          <td class="num highlight-transit">${formatVal(d.totals.transit)}</td>
          <td class="num highlight-bal">${formatVal(d.totals.balance)}</td>
        </tr>
      `;

      for (const b of d.brands) {
        rowsHtml += `
          <tr class="brand-row">
            <td colspan="3">&nbsp;&nbsp;BRAND: ${b.brand.toUpperCase()}</td>
            <td class="num">${formatVal(b.totals.bf)}</td>
            <td class="num">${formatVal(b.totals.fromWarehouse)}</td>
            <td class="num">${formatVal(b.totals.fromOutlet)}</td>
            <td class="num highlight-in">${formatVal(b.totals.totalTrfIn)}</td>
            <td class="num">${formatVal(b.totals.toWarehouse)}</td>
            <td class="num">${formatVal(b.totals.toOutlet)}</td>
            <td class="num highlight-out">${formatVal(b.totals.totalTrfOut)}</td>
            <td class="num">${formatVal(b.totals.exchg)}</td>
            <td class="num">${formatVal(b.totals.refund)}</td>
            <td class="num">${formatVal(b.totals.claim)}</td>
            <td class="num">${formatVal(b.totals.sales)}</td>
            <td class="num">${formatVal(b.totals.adj)}</td>
            <td class="num highlight-avail">${formatVal(b.totals.availableStock)}</td>
            <td class="num highlight-transit">${formatVal(b.totals.transit)}</td>
            <td class="num highlight-bal">${formatVal(b.totals.balance)}</td>
          </tr>
        `;

        for (const g of b.genders) {
          rowsHtml += `
            <tr class="gender-row">
              <td colspan="3">&nbsp;&nbsp;&nbsp;&nbsp;GENDER: ${g.gender.toUpperCase()}</td>
              <td class="num">${formatVal(g.totals.bf)}</td>
              <td class="num">${formatVal(g.totals.fromWarehouse)}</td>
              <td class="num">${formatVal(g.totals.fromOutlet)}</td>
              <td class="num highlight-in">${formatVal(g.totals.totalTrfIn)}</td>
              <td class="num">${formatVal(g.totals.toWarehouse)}</td>
              <td class="num">${formatVal(g.totals.toOutlet)}</td>
              <td class="num highlight-out">${formatVal(g.totals.totalTrfOut)}</td>
              <td class="num">${formatVal(g.totals.exchg)}</td>
              <td class="num">${formatVal(g.totals.refund)}</td>
              <td class="num">${formatVal(g.totals.claim)}</td>
              <td class="num">${formatVal(g.totals.sales)}</td>
              <td class="num">${formatVal(g.totals.adj)}</td>
              <td class="num highlight-avail">${formatVal(g.totals.availableStock)}</td>
              <td class="num highlight-transit">${formatVal(g.totals.transit)}</td>
              <td class="num highlight-bal">${formatVal(g.totals.balance)}</td>
            </tr>
          `;

          for (const c of g.categories) {
            rowsHtml += `
              <tr class="category-row">
                <td colspan="3">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;CATEGORY: ${c.category.toUpperCase()}</td>
                <td class="num">${formatVal(c.totals.bf)}</td>
                <td class="num">${formatVal(c.totals.fromWarehouse)}</td>
                <td class="num">${formatVal(c.totals.fromOutlet)}</td>
                <td class="num highlight-in">${formatVal(c.totals.totalTrfIn)}</td>
                <td class="num">${formatVal(c.totals.toWarehouse)}</td>
                <td class="num">${formatVal(c.totals.toOutlet)}</td>
                <td class="num highlight-out">${formatVal(c.totals.totalTrfOut)}</td>
                <td class="num">${formatVal(c.totals.exchg)}</td>
                <td class="num">${formatVal(c.totals.refund)}</td>
                <td class="num">${formatVal(c.totals.claim)}</td>
                <td class="num">${formatVal(c.totals.sales)}</td>
                <td class="num">${formatVal(c.totals.adj)}</td>
                <td class="num highlight-avail">${formatVal(c.totals.availableStock)}</td>
                <td class="num highlight-transit">${formatVal(c.totals.transit)}</td>
                <td class="num highlight-bal">${formatVal(c.totals.balance)}</td>
              </tr>
            `;

            for (const a of c.articles) {
              rowsHtml += `
                <tr class="article-row">
                  <td>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;SKU: ${a.sku} (${a.articleName})</td>
                  <td class="center">ALL COLORS</td>
                  <td class="center">ALL SIZES</td>
                  <td class="num">${formatVal(a.totals.bf)}</td>
                  <td class="num">${formatVal(a.totals.fromWarehouse)}</td>
                  <td class="num">${formatVal(a.totals.fromOutlet)}</td>
                  <td class="num highlight-in">${formatVal(a.totals.totalTrfIn)}</td>
                  <td class="num">${formatVal(a.totals.toWarehouse)}</td>
                  <td class="num">${formatVal(a.totals.toOutlet)}</td>
                  <td class="num highlight-out">${formatVal(a.totals.totalTrfOut)}</td>
                  <td class="num">${formatVal(a.totals.exchg)}</td>
                  <td class="num">${formatVal(a.totals.refund)}</td>
                  <td class="num">${formatVal(a.totals.claim)}</td>
                  <td class="num">${formatVal(a.totals.sales)}</td>
                  <td class="num">${formatVal(a.totals.adj)}</td>
                  <td class="num highlight-avail">${formatVal(a.totals.availableStock)}</td>
                  <td class="num highlight-transit">${formatVal(a.totals.transit)}</td>
                  <td class="num highlight-bal">${formatVal(a.totals.balance)}</td>
                </tr>
              `;

              if (!summaryOnly) {
                for (const v of a.variants) {
                  rowsHtml += `
                    <tr class="variant-row">
                      <td class="indent">&mdash; Variant Item</td>
                      <td class="center">${v.color}</td>
                      <td class="center">${v.size}</td>
                      <td class="num">${formatVal(v.bf)}</td>
                      <td class="num">${formatVal(v.fromWarehouse)}</td>
                      <td class="num">${formatVal(v.fromOutlet)}</td>
                      <td class="num highlight-in">${formatVal(v.totalTrfIn)}</td>
                      <td class="num">${formatVal(v.toWarehouse)}</td>
                      <td class="num">${formatVal(v.toOutlet)}</td>
                      <td class="num highlight-out">${formatVal(v.totalTrfOut)}</td>
                      <td class="num">${formatVal(v.exchg)}</td>
                      <td class="num">${formatVal(v.refund)}</td>
                      <td class="num">${formatVal(v.claim)}</td>
                      <td class="num">${formatVal(v.sales)}</td>
                      <td class="num">${formatVal(v.adj)}</td>
                      <td class="num highlight-avail">${formatVal(v.availableStock)}</td>
                      <td class="num highlight-transit">${formatVal(v.transit)}</td>
                      <td class="num highlight-bal">${formatVal(v.balance)}</td>
                    </tr>
                  `;
                }
              }
            }
          }
        }
      }
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #1e293b;
            font-size: 7px;
            margin: 0;
            padding: 0;
            background: #ffffff;
          }
          .page-break {
            page-break-after: always;
            break-after: page;
          }
          .summary-page {
            padding: 40px;
            height: 100vh;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            justify-content: center;
          }
          .summary-header {
            border-bottom: 3px solid #1e3a8a;
            padding-bottom: 12px;
            margin-bottom: 24px;
          }
          .summary-header h1 {
            font-size: 24px;
            font-weight: 900;
            color: #1e3a8a;
            margin: 0;
            text-transform: uppercase;
          }
          .summary-header p {
            font-size: 11px;
            color: #64748b;
            margin: 4px 0 0 0;
            font-weight: 600;
          }
          .summary-grid {
            display: grid;
            grid-template-cols: repeat(4, 1fr);
            gap: 16px;
            margin-bottom: 32px;
          }
          .summary-card {
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 16px;
            background: #f8fafc;
            text-align: center;
          }
          .summary-card p {
            font-size: 8px;
            font-weight: 800;
            color: #64748b;
            text-transform: uppercase;
            margin: 0 0 8px 0;
          }
          .summary-card h3 {
            font-size: 20px;
            font-weight: 900;
            color: #0f172a;
            margin: 0;
          }
          .summary-card.in h3 { color: #047857; }
          .summary-card.out h3 { color: #b91c1c; }
          .summary-card.bal h3 { color: #1d4ed8; }

          /* Table view details */
          .header-block {
            border-bottom: 2px solid #0f172a;
            padding-bottom: 8px;
            margin-bottom: 12px;
          }
          .company-name {
            font-size: 14px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #0f172a;
          }
          .report-title {
            font-size: 11px;
            font-weight: 700;
            color: #475569;
            margin-top: 2px;
          }
          .meta-info {
            font-size: 8px;
            color: #64748b;
            margin-top: 4px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            page-break-inside: auto;
          }
          tr {
            page-break-inside: avoid;
            page-break-after: auto;
          }
          thead {
            display: table-header-group;
          }
          th {
            background-color: #334155;
            color: #ffffff;
            font-weight: 700;
            text-transform: uppercase;
            font-size: 6px;
            padding: 4px 3px;
            border: 1px solid #475569;
            text-align: center;
          }
          th.align-left {
            text-align: left;
          }
          td {
            padding: 3px 2px;
            border: 1px solid #e2e8f0;
            vertical-align: middle;
          }
          td.num {
            text-align: right;
          }
          td.center {
            text-align: center;
          }
          td.indent {
            color: #64748b;
            font-style: italic;
            padding-left: 10px;
          }
          
          /* Rows Styling */
          .division-row {
            background-color: #1e293b;
            font-weight: 800;
            font-size: 8px;
            color: #ffffff;
          }
          .brand-row {
            background-color: #334155;
            font-weight: 700;
            font-size: 7.5px;
            color: #ffffff;
          }
          .gender-row {
            background-color: #475569;
            font-weight: 700;
            font-size: 7px;
            color: #ffffff;
          }
          .category-row {
            background-color: #94a3b8;
            font-weight: 700;
            font-size: 7px;
            color: #ffffff;
          }
          .article-row {
            background-color: #f1f5f9;
            font-weight: 700;
            font-size: 7px;
            color: #0f172a;
          }
          .variant-row {
            background-color: #ffffff;
            color: #475569;
          }
          .grand-total-row {
            background-color: #cbd5e1;
            font-weight: 900;
            font-size: 8px;
            color: #000000;
          }
          
          /* Column highlighting */
          .highlight-in {
            background-color: rgba(16, 185, 129, 0.08);
            font-weight: 700;
            color: #047857;
          }
          .highlight-out {
            background-color: rgba(239, 68, 68, 0.08);
            font-weight: 700;
            color: #b91c1c;
          }
          .highlight-avail {
            background-color: rgba(59, 130, 246, 0.08);
            font-weight: 700;
            color: #1d4ed8;
          }
          .highlight-transit {
            font-weight: 700;
            color: #b45309;
          }
          .highlight-bal {
            background-color: #f1f5f9;
            font-weight: 900;
            color: #0f172a;
          }
        </style>
      </head>
      <body>
        <!-- Page 1: Short Summary Page -->
        <div class="summary-page page-break">
          <div class="summary-header">
            <h1>Innovative Network</h1>
            <p>Stock Activity Report Summary &bull; Outlet: ${locationName}</p>
            <p>Date Period: ${fromDateStr} to ${toDateStr}</p>
          </div>
          <div style="font-size: 11px; margin-bottom: 20px; font-weight: bold; color: #334155;">
            Executive Summary Overview
          </div>
          <div class="summary-grid">
            <div class="summary-card">
              <p>Opening Balance</p>
              <h3>${grandTotals.bf}</h3>
            </div>
            <div class="summary-card in">
              <p>Total Transfers IN</p>
              <h3>+${grandTotals.totalTrfIn}</h3>
            </div>
            <div class="summary-card out">
              <p>Total Transfers OUT</p>
              <h3>-${grandTotals.totalTrfOut}</h3>
            </div>
            <div class="summary-card">
              <p>Total Sales</p>
              <h3>${grandTotals.sales}</h3>
            </div>
            <div class="summary-card">
              <p>Approved Claims</p>
              <h3>${grandTotals.claim}</h3>
            </div>
            <div class="summary-card">
              <p>Total Adjustments</p>
              <h3>${grandTotals.adj}</h3>
            </div>
            <div class="summary-card">
              <p>Total In Transit</p>
              <h3>${grandTotals.transit}</h3>
            </div>
            <div class="summary-card bal">
              <p>Closing Net Balance</p>
              <h3>${grandTotals.balance}</h3>
            </div>
          </div>
          <div style="font-size: 8px; color: #94a3b8; text-align: center;">
            Detailed item-by-item movements and hierarchy grids start on the next page.
          </div>
        </div>

        <!-- Page 2+: Detailed Hierarchy Table -->
        <div class="header-block">
          <div class="company-name">Innovative Network</div>
          <div class="report-title">Stock Activity Report — ${locationName}</div>
          <div class="meta-info">Period: ${fromDateStr} to ${toDateStr}</div>
        </div>
        <table style="table-layout: fixed; width: 100%;">
          <colgroup>
            <col style="width: 15%;" />
            <col style="width: 6%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
            <col style="width: 5%;" />
          </colgroup>
          <thead>
            <tr>
              <th colspan="3" class="align-left">Article / Variant Info</th>
              <th>BF (Opening)</th>
              <th>Wh IN</th>
              <th>Out IN</th>
              <th style="background-color: #047857;">Trf IN</th>
              <th>Wh OUT</th>
              <th>Out OUT</th>
              <th style="background-color: #b91c1c;">Trf OUT</th>
              <th>Exchg</th>
              <th>Refund</th>
              <th>Claim</th>
              <th>Sales</th>
              <th>Adj</th>
              <th style="background-color: #1d4ed8;">Available</th>
              <th style="background-color: #b45309;">Transit</th>
              <th style="background-color: #0f172a;">Balance</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            
            <!-- GRAND TOTALS ROW AT BOTTOM -->
            <tr class="grand-total-row">
              <td colspan="3">GRAND TOTAL</td>
              <td class="num">${formatVal(grandTotals.bf)}</td>
              <td class="num">${formatVal(grandTotals.fromWarehouse)}</td>
              <td class="num">${formatVal(grandTotals.fromOutlet)}</td>
              <td class="num highlight-in">${formatVal(grandTotals.totalTrfIn)}</td>
              <td class="num">${formatVal(grandTotals.toWarehouse)}</td>
              <td class="num">${formatVal(grandTotals.toOutlet)}</td>
              <td class="num highlight-out">${formatVal(grandTotals.totalTrfOut)}</td>
              <td class="num">${formatVal(grandTotals.exchg)}</td>
              <td class="num">${formatVal(grandTotals.refund)}</td>
              <td class="num">${formatVal(grandTotals.claim)}</td>
              <td class="num">${formatVal(grandTotals.sales)}</td>
              <td class="num">${formatVal(grandTotals.adj)}</td>
              <td class="num highlight-avail">${formatVal(grandTotals.availableStock)}</td>
              <td class="num highlight-transit">${formatVal(grandTotals.transit)}</td>
              <td class="num highlight-bal">${formatVal(grandTotals.balance)}</td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `;
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

  private async writeEmptyPdf(filePath: string, locationName: string, startDate: Date, endDate: Date): Promise<void> {
    const html = `
      <html>
      <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h2>Innovative Network - Stock Activity Report</h2>
        <p>Outlet: ${locationName}</p>
        <p>Period: ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}</p>
        <div style="margin-top: 30px; color: #666;">No ledger records found matching options.</div>
      </body>
      </html>
    `;
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html);
    const pdf = await page.pdf({ format: 'A4', landscape: true });
    fs.writeFileSync(filePath, pdf);
    await browser.close();
  }
}
