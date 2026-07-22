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
import { ExportHistoryService } from '../export-history/export-history.service';


export interface StockActivityExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  locationId?: string;
  warehouseId?: string;
  startDate?: string;
  endDate?: string;
  format: 'xlsx' | 'pdf';
  summaryOnly?: boolean;
  showBrand?: boolean;
  showDivision?: boolean;
  showCategory?: boolean;
  showGender?: boolean;
  showSilhouette?: boolean;
  showArticle?: boolean;
  showVariant?: boolean;
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
  { header: 'Opening', key: 'bf', width: 14, group: 'General', align: 'right' as const },
  { header: 'Wh IN', key: 'fromWarehouse', width: 12, group: 'Transfer IN', align: 'right' as const },
  { header: 'Outlet IN', key: 'fromOutlet', width: 12, group: 'Transfer IN', align: 'right' as const },
  { header: 'Total IN', key: 'totalTrfIn', width: 14, group: 'Transfer IN', align: 'right' as const },
  { header: 'Wh OUT', key: 'toWarehouse', width: 12, group: 'Transfer OUT', align: 'right' as const },
  { header: 'Outlet OUT', key: 'toOutlet', width: 12, group: 'Transfer OUT', align: 'right' as const },
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
    private readonly exportHistoryService: ExportHistoryService,
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

  @Process({ concurrency: 1 })
  async handleExport(job: Job<StockActivityExportJobData>): Promise<void> {
    const {
      jobId, userId, tenantId, tenantDbUrl, locationId, warehouseId, startDate: startStr, endDate: endStr, format, summaryOnly,
      showBrand, showDivision, showCategory, showGender, showSilhouette, showArticle, showVariant
    } = job.data;
    this.logger.log(`[StockActivityExport ${jobId}] Starting ${format.toUpperCase()} export for user ${userId}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);
    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const ext = format === 'pdf' ? 'pdf' : 'xlsx';
    const filePath = path.join(exportDir, `export-${jobId}.${ext}`);

    try {
      await job.progress(5);

      const locIds = locationId ? locationId.split(',').map(s => s.trim()).filter(Boolean) : [];
      const locationWhere = locIds.length > 1 ? { in: locIds } : (locIds.length === 1 ? locIds[0] : undefined);

      const whIds = warehouseId ? warehouseId.split(',').map(s => s.trim()).filter(Boolean) : [];
      const warehouseWhere = whIds.length > 1 ? { in: whIds } : (whIds.length === 1 ? whIds[0] : undefined);

      const locOrWhFilters: any[] = [];
      if (locationWhere) locOrWhFilters.push({ locationId: locationWhere });
      if (warehouseWhere) locOrWhFilters.push({ warehouseId: warehouseWhere });

      const locationOrWarehouseWhere = locOrWhFilters.length > 1
        ? { OR: locOrWhFilters }
        : (locOrWhFilters.length === 1 ? locOrWhFilters[0] : {});

      let locationName = '';
      if (locIds.length > 0) {
        const locs = await prisma.location.findMany({ where: { id: { in: locIds } }, select: { name: true } });
        locationName += locs.map(l => l.name).join(', ');
      }
      if (whIds.length > 0) {
        if (locationName) locationName += ' & ';
        const whs = await prisma.warehouse.findMany({ where: { id: { in: whIds } }, select: { name: true } });
        locationName += whs.map(w => w.name).join(', ');
      }
      if (!locationName) locationName = 'All Locations & Warehouses';

      const now = new Date();
      const startDate = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate = endStr ? new Date(endStr) : new Date(now);

      await job.progress(10);

      // Fetch inventory item ids
      const inventoryItems = await prisma.inventoryItem.findMany({
        where: {
          ...locationOrWarehouseWhere,
          status: 'AVAILABLE',
        },
        select: { itemId: true },
      });

      const ledgerItems = await prisma.stockLedger.findMany({
        where: locationOrWarehouseWhere,
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
        where: {
          OR: [
            { id: { in: uniqueItemIds } },
            { itemId: { in: uniqueItemIds } },
          ],
        },
        include: {
          color: true,
          size: true,
          gender: true,
          category: true,
          division: true,
          brand: true,
          silhouette: true,
        },
      });

      await job.progress(45);

      const matchedItemIds = items.map(i => i.id);

      const bfGroup = await prisma.stockLedger.groupBy({
        by: ['itemId'],
        where: {
          ...locationOrWarehouseWhere,
          itemId: { in: matchedItemIds },
          createdAt: { lt: startDate },
        },
        _sum: { qty: true },
      });

      const bfMap = new Map<string, number>();
      for (const row of bfGroup) {
        bfMap.set(row.itemId, Number(row._sum.qty || 0));
      }

      // Query and add any OPENING_BALANCE entries that were created within the date range
      const inRangeOpeningGroup = await prisma.stockLedger.groupBy({
        by: ['itemId'],
        where: {
          ...locationOrWarehouseWhere,
          itemId: { in: matchedItemIds },
          createdAt: { gte: startDate, lte: endDate },
          OR: [
            { movementType: MovementType.OPENING_BALANCE },
            { referenceType: 'OPENING_BALANCE' },
            { referenceType: 'BULK_STOCK_UPLOAD' }
          ]
        },
        _sum: { qty: true },
      });

      for (const row of inRangeOpeningGroup) {
        const currentBf = bfMap.get(row.itemId) || 0;
        bfMap.set(row.itemId, currentBf + Number(row._sum.qty || 0));
      }

      const ledgerEntries = await prisma.stockLedger.findMany({
        where: {
          ...locationOrWarehouseWhere,
          itemId: { in: matchedItemIds },
          createdAt: { gte: startDate, lte: endDate },
          NOT: [
            { movementType: MovementType.OPENING_BALANCE },
            { referenceType: 'OPENING_BALANCE' },
            { referenceType: 'BULK_STOCK_UPLOAD' }
          ]
        },
        select: {
          itemId: true,
          qty: true,
          referenceType: true,
          movementType: true,
        },
      });

      const toLocOrWhFilters: any[] = [];
      if (locationWhere) toLocOrWhFilters.push({ toLocationId: locationWhere });
      if (warehouseWhere) toLocOrWhFilters.push({ toWarehouseId: warehouseWhere });

      const toLocOrWhWhere = toLocOrWhFilters.length > 1
        ? { OR: toLocOrWhFilters }
        : (toLocOrWhFilters.length === 1 ? toLocOrWhFilters[0] : {});

      const transitItems = await prisma.transferRequestItem.findMany({
        where: {
          itemId: { in: matchedItemIds },
          transferRequest: {
            ...toLocOrWhWhere,
            status: { in: ['PENDING', 'SOURCE_APPROVED'] },
            transferType: { in: ['WAREHOUSE_TO_OUTLET', 'OUTLET_TO_OUTLET', 'OUTLET_TO_WAREHOUSE', 'WAREHOUSE_TO_WAREHOUSE'] },
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

        if (mov === MovementType.ADJUSTMENT || ref === 'STOCK_ADJUSTMENT' || ref === 'ADJUSTMENT') {
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

      // Build hierarchical grouping dynamically
      const sBrand = showBrand !== false;
      const sDivision = showDivision !== false;
      const sCategory = showCategory !== false;
      const sGender = showGender !== false;
      const sSilhouette = showSilhouette !== false;
      const sArticle = showArticle !== false;
      const sVariant = showVariant !== undefined ? showVariant : !summaryOnly;

      const levels: string[] = [];
      if (sBrand) levels.push('brand');
      if (sDivision) levels.push('division');
      if (sCategory) levels.push('category');
      if (sGender) levels.push('gender');
      if (sSilhouette) levels.push('silhouette');
      if (sArticle) levels.push('article');
      if (sVariant) levels.push('variant');

      if (levels.length === 0) {
        levels.push('brand');
      }

      const root: any[] = [];
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

        const variantMetrics = {
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

        let currentLevelNodes = root;
        for (let i = 0; i < levels.length; i++) {
          const levelName = levels[i];
          let nodeVal = '';
          let extraFields: any = {};

          if (levelName === 'brand') {
            nodeVal = item.brand?.name || 'No Brand';
          } else if (levelName === 'division') {
            nodeVal = item.division?.name || 'No Division';
          } else if (levelName === 'category') {
            nodeVal = item.category?.name || 'No Category';
          } else if (levelName === 'gender') {
            nodeVal = item.gender?.name || 'No Gender';
          } else if (levelName === 'silhouette') {
            nodeVal = item.silhouette?.name || 'No Silhouette';
          } else if (levelName === 'article') {
            nodeVal = item.sku;
            extraFields.sku = item.sku;
            extraFields.articleName = item.description || 'Unknown Article';
          } else if (levelName === 'variant') {
            nodeVal = `${item.color?.name || 'Default'}-${item.size?.name || 'Default'}`;
            extraFields.color = item.color?.name || 'Default';
            extraFields.size = item.size?.name || 'Default';
          }

          let existingNode = currentLevelNodes.find(n => n.level === levelName && n.value === nodeVal);
          if (!existingNode) {
            existingNode = {
              level: levelName,
              value: nodeVal,
              totals: createEmptyTotals(),
              ...extraFields,
              children: [],
            };
            currentLevelNodes.push(existingNode);
          }

          addTotals(existingNode.totals, variantMetrics);

          if (i < levels.length - 1) {
            currentLevelNodes = existingNode.children;
          }
        }
      }

      // Compute grand totals
      const grandTotals = createEmptyTotals();
      for (const node of root) {
        addTotals(grandTotals, node.totals);
      }

      await job.progress(80);

      if (format === 'pdf') {
        const fromDateStr = startDate.toLocaleDateString();
        const toDateStr = endDate.toLocaleDateString();
        const html = this.buildPdfHtml(root, locationName, fromDateStr, toDateStr, grandTotals, !!summaryOnly);

        const launchArgs = process.platform === 'linux'
          ? [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-gpu',
              '--no-first-run',
              '--no-zygote',
            ]
          : [];

        const browser = await puppeteer.launch({
          headless: true,
          args: launchArgs,
        });

        try {
          const page = await browser.newPage();
          page.setDefaultTimeout(0);
          page.setDefaultNavigationTimeout(0);
          await page.setContent(html, { waitUntil: 'domcontentloaded' });

          // Start an active progress ticker to prevent UI looking stuck at 80%
          let currentProgress = 80;
          const progressInterval = setInterval(() => {
            if (currentProgress < 94) {
              currentProgress += 1;
              job.progress(currentProgress).catch(() => {});
            }
          }, 3000);

          let pdfBuffer;
          try {
            pdfBuffer = await page.pdf({
              format: 'A4',
              landscape: true,
              margin: { top: '15mm', bottom: '15mm', left: '10mm', right: '10mm' },
              printBackground: true,
              displayHeaderFooter: true,
              headerTemplate: '<div style="font-size: 7px; width: 100%; text-align: right; padding-right: 15mm; color: #94a3b8;">Speed (Pvt.) Limited | Stock Activity Report</div>',
              footerTemplate: '<div style="font-size: 7px; width: 100%; text-align: center; color: #94a3b8;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
            });
          } finally {
            clearInterval(progressInterval);
          }

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
        const LEVEL_EXCEL_STYLES: Record<string, {
          bgHex: string;
          fgHex: string;
          fontSize: number;
          bold: boolean;
          indent: number;
          prefix: string;
        }> = {
          brand: { bgHex: '1E293B', fgHex: 'FFFFFF', fontSize: 10, bold: true, indent: 0, prefix: 'BRAND: ' },
          division: { bgHex: '334155', fgHex: 'FFFFFF', fontSize: 9.5, bold: true, indent: 2, prefix: 'DIVISION: ' },
          category: { bgHex: '475569', fgHex: 'FFFFFF', fontSize: 9, bold: true, indent: 4, prefix: 'CATEGORY: ' },
          gender: { bgHex: '64748B', fgHex: 'FFFFFF', fontSize: 9, bold: true, indent: 6, prefix: 'GENDER: ' },
          silhouette: { bgHex: '94A3B8', fgHex: 'FFFFFF', fontSize: 9, bold: true, indent: 8, prefix: 'SILHOUETTE: ' },
          article: { bgHex: 'F1F5F9', fgHex: '1E293B', fontSize: 9, bold: true, indent: 10, prefix: 'SKU: ' },
          variant: { bgHex: 'FFFFFF', fgHex: '475569', fontSize: 9, bold: false, indent: 12, prefix: '' },
        };

        const writeNodeToExcel = (node: any) => {
          const style = LEVEL_EXCEL_STYLES[node.level] || LEVEL_EXCEL_STYLES.brand;
          
          let label = ' '.repeat(style.indent) + style.prefix;
          let colorVal = '';
          let sizeVal = '';
          
          if (node.level === 'article') {
            label = ' '.repeat(style.indent) + `SKU: ${node.sku} (${node.articleName})`;
            colorVal = 'ALL COLORS';
            sizeVal = 'ALL SIZES';
          } else if (node.level === 'variant') {
            label = ' '.repeat(style.indent) + 'Variant Item';
            colorVal = node.color;
            sizeVal = node.size;
          } else {
            label = ' '.repeat(style.indent) + style.prefix + node.value.toUpperCase();
          }
          
          const row = ws.addRow({
            sku: label,
            color: colorVal,
            size: sizeVal,
            bf: node.totals.bf,
            fromWarehouse: node.totals.fromWarehouse,
            fromOutlet: node.totals.fromOutlet,
            totalTrfIn: node.totals.totalTrfIn,
            toWarehouse: node.totals.toWarehouse,
            toOutlet: node.totals.toOutlet,
            totalTrfOut: node.totals.totalTrfOut,
            exchg: node.totals.exchg,
            refund: node.totals.refund,
            claim: node.totals.claim,
            sales: node.totals.sales,
            adj: node.totals.adj,
            availableStock: node.totals.availableStock,
            transit: node.totals.transit,
            balance: node.totals.balance,
          });
          
          for (let colNum = 1; colNum <= 18; colNum++) {
            const cell = row.getCell(colNum);
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${style.bgHex}` } };
            cell.font = { bold: style.bold, size: style.fontSize, color: { argb: `FF${style.fgHex}` } };
            cell.border = borderThin;
            cell.alignment = colNum === 2 || colNum === 3 
              ? centerAlign 
              : (colNum === 1 ? leftAlign : rightAlign);
          }
          row.height = node.level === 'variant' ? 18 : 20;
          row.commit();
          
          if (node.children && node.children.length > 0) {
            for (const child of node.children) {
              writeNodeToExcel(child);
            }
          }
        };

        for (const rootNode of root) {
          writeNodeToExcel(rootNode);
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

      const mimeType = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const fileName = format === 'pdf'
        ? `stock-activity-report-${new Date().toISOString().slice(0, 10)}.pdf`
        : `stock-activity-report-${new Date().toISOString().slice(0, 10)}.xlsx`;

      await this.exportHistoryService.completeAndUploadExport(
        prisma,
        jobId,
        filePath,
        fileName,
        mimeType,
      );

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
      await this.exportHistoryService.failExport(prisma, jobId);
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

    const LEVEL_PDF_STYLES: Record<string, {
      className: string;
      indentStyles: string;
      prefix: string;
    }> = {
      brand: { className: 'brand-row', indentStyles: '', prefix: 'BRAND: ' },
      division: { className: 'division-row', indentStyles: 'padding-left: 10px;', prefix: 'DIVISION: ' },
      category: { className: 'category-row', indentStyles: 'padding-left: 20px;', prefix: 'CATEGORY: ' },
      gender: { className: 'gender-row', indentStyles: 'padding-left: 30px;', prefix: 'GENDER: ' },
      silhouette: { className: 'silhouette-row', indentStyles: 'padding-left: 40px;', prefix: 'SILHOUETTE: ' },
      article: { className: 'article-row', indentStyles: 'padding-left: 50px;', prefix: 'SKU: ' },
      variant: { className: 'variant-row', indentStyles: 'padding-left: 60px;', prefix: '' },
    };

    const buildHtmlRows = (node: any): string => {
      const style = LEVEL_PDF_STYLES[node.level] || LEVEL_PDF_STYLES.brand;
      let html = '';
      
      if (node.level === 'article') {
        html += `
          <tr class="${style.className}">
            <td style="${style.indentStyles}">SKU: ${node.sku} (${node.articleName})</td>
            <td class="center">ALL COLORS</td>
            <td class="center">ALL SIZES</td>
            <td class="num">${formatVal(node.totals.bf)}</td>
            <td class="num">${formatVal(node.totals.fromWarehouse)}</td>
            <td class="num">${formatVal(node.totals.fromOutlet)}</td>
            <td class="num highlight-in">${formatVal(node.totals.totalTrfIn)}</td>
            <td class="num">${formatVal(node.totals.toWarehouse)}</td>
            <td class="num">${formatVal(node.totals.toOutlet)}</td>
            <td class="num highlight-out">${formatVal(node.totals.totalTrfOut)}</td>
            <td class="num">${formatVal(node.totals.exchg)}</td>
            <td class="num">${formatVal(node.totals.refund)}</td>
            <td class="num">${formatVal(node.totals.claim)}</td>
            <td class="num">${formatVal(node.totals.sales)}</td>
            <td class="num">${formatVal(node.totals.adj)}</td>
            <td class="num highlight-avail">${formatVal(node.totals.availableStock)}</td>
            <td class="num highlight-transit">${formatVal(node.totals.transit)}</td>
            <td class="num highlight-bal">${formatVal(node.totals.balance)}</td>
          </tr>
        `;
      } else if (node.level === 'variant') {
        html += `
          <tr class="${style.className}">
            <td style="${style.indentStyles} color: #64748b; font-style: italic;">&mdash; Variant Item</td>
            <td class="center">${node.color}</td>
            <td class="center">${node.size}</td>
            <td class="num">${formatVal(node.totals.bf)}</td>
            <td class="num">${formatVal(node.totals.fromWarehouse)}</td>
            <td class="num">${formatVal(node.totals.fromOutlet)}</td>
            <td class="num highlight-in">${formatVal(node.totals.totalTrfIn)}</td>
            <td class="num">${formatVal(node.totals.toWarehouse)}</td>
            <td class="num">${formatVal(node.totals.toOutlet)}</td>
            <td class="num highlight-out">${formatVal(node.totals.totalTrfOut)}</td>
            <td class="num">${formatVal(node.totals.exchg)}</td>
            <td class="num">${formatVal(node.totals.refund)}</td>
            <td class="num">${formatVal(node.totals.claim)}</td>
            <td class="num">${formatVal(node.totals.sales)}</td>
            <td class="num">${formatVal(node.totals.adj)}</td>
            <td class="num highlight-avail">${formatVal(node.totals.availableStock)}</td>
            <td class="num highlight-transit">${formatVal(node.totals.transit)}</td>
            <td class="num highlight-bal">${formatVal(node.totals.balance)}</td>
          </tr>
        `;
      } else {
        html += `
          <tr class="${style.className}">
            <td colspan="3" style="${style.indentStyles}">${style.prefix}${node.value.toUpperCase()}</td>
            <td class="num">${formatVal(node.totals.bf)}</td>
            <td class="num">${formatVal(node.totals.fromWarehouse)}</td>
            <td class="num">${formatVal(node.totals.fromOutlet)}</td>
            <td class="num highlight-in">${formatVal(node.totals.totalTrfIn)}</td>
            <td class="num">${formatVal(node.totals.toWarehouse)}</td>
            <td class="num">${formatVal(node.totals.toOutlet)}</td>
            <td class="num highlight-out">${formatVal(node.totals.totalTrfOut)}</td>
            <td class="num">${formatVal(node.totals.exchg)}</td>
            <td class="num">${formatVal(node.totals.refund)}</td>
            <td class="num">${formatVal(node.totals.claim)}</td>
            <td class="num">${formatVal(node.totals.sales)}</td>
            <td class="num">${formatVal(node.totals.adj)}</td>
            <td class="num highlight-avail">${formatVal(node.totals.availableStock)}</td>
            <td class="num highlight-transit">${formatVal(node.totals.transit)}</td>
            <td class="num highlight-bal">${formatVal(node.totals.balance)}</td>
          </tr>
        `;
      }
      
      if (node.children && node.children.length > 0) {
        for (const child of node.children) {
          html += buildHtmlRows(child);
        }
      }
      
      return html;
    };

    for (const rootNode of data) {
      rowsHtml += buildHtmlRows(rootNode);
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
            page-break-inside: auto;
          }
          tr.brand-row, tr.division-row, tr.category-row, tr.gender-row, tr.silhouette-row, tr.article-row, tr.grand-total-row {
            page-break-inside: avoid;
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
          .brand-row {
            background-color: #1e293b;
            font-weight: 800;
            font-size: 8px;
            color: #ffffff;
          }
          .division-row {
            background-color: #334155;
            font-weight: 700;
            font-size: 7.5px;
            color: #ffffff;
          }
          .category-row {
            background-color: #475569;
            font-weight: 700;
            font-size: 7px;
            color: #ffffff;
          }
          .gender-row {
            background-color: #64748b;
            font-weight: 700;
            font-size: 7px;
            color: #ffffff;
          }
          .silhouette-row {
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

        <!-- Page 2+: Detailed Hierarchy Table -->
        <div class="header-block">
          <div class="company-name">Speed (Pvt.) Limited</div>
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
              <th>Opening</th>
              <th>Wh IN</th>
              <th>Outlet IN</th>
              <th style="background-color: #047857;">Trf IN</th>
              <th>Wh OUT</th>
              <th>Outlet OUT</th>
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
        <h2>Speed (Pvt.) Limited - Stock Activity Report</h2>
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
