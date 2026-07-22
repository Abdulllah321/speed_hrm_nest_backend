import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import * as puppeteer from 'puppeteer';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ExportHistoryService } from '../export-history/export-history.service';
import { AvailableStockSummaryExportService } from './available-stock-summary-export.service';

export interface AvailableStockSummaryExportJobData {
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
  includeCosting?: boolean;
}

const COLUMNS = [
  { header: 'GPC / Category / Product', key: 'sku', width: 35, align: 'left' as const },
  { header: 'Size', key: 'size', width: 10, align: 'center' as const },
  { header: 'Color', key: 'color', width: 14, align: 'center' as const },
  { header: 'Quantity', key: 'quantity', width: 14, align: 'right' as const },
  { header: 'In Transit', key: 'transit', width: 12, align: 'right' as const },
  { header: 'Stock Reserved', key: 'reserved', width: 14, align: 'right' as const },
  { header: 'Total', key: 'total', width: 14, align: 'right' as const },
  { header: 'Selling Price', key: 'unitPrice', width: 14, align: 'right' as const },
  { header: 'Value (Rs.)', key: 'value', width: 18, align: 'right' as const },
];

@Processor('available-stock-summary-export')
export class AvailableStockSummaryExportProcessor {
  private readonly logger = new Logger(AvailableStockSummaryExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly exportHistoryService: ExportHistoryService,
    private readonly availableStockSummaryService: AvailableStockSummaryExportService,
  ) {}

  @Process({ concurrency: 1 })
  async handleExport(job: Job<AvailableStockSummaryExportJobData>): Promise<void> {
    const {
      jobId, userId, tenantId, tenantDbUrl, locationId, warehouseId, startDate: startStr, endDate: endStr, format,
      summaryOnly, showBrand, showDivision, showCategory, showGender, showSilhouette, showArticle, showVariant,
      includeCosting
    } = job.data;
    this.logger.log(`[AvailableStockSummaryExport ${jobId}] Starting ${format.toUpperCase()} export for user ${userId}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);
    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const ext = format === 'pdf' ? 'pdf' : 'xlsx';
    const filePath = path.join(exportDir, `export-${jobId}.${ext}`);

    try {
      await job.progress(10);

      const locIds = locationId ? locationId.split(',').map(s => s.trim()).filter(Boolean) : [];
      const whIds = warehouseId ? warehouseId.split(',').map(s => s.trim()).filter(Boolean) : [];

      const nameParts: string[] = [];
      if (whIds.length > 0) {
        const warehouses = await prisma.warehouse.findMany({
          where: { id: { in: whIds } },
          select: { name: true },
        });
        if (warehouses.length > 0) {
          nameParts.push(`Warehouses: ${warehouses.map(w => w.name).join(', ')}`);
        }
      }
      if (locIds.length > 0) {
        const locations = await prisma.location.findMany({
          where: { id: { in: locIds } },
          select: { name: true },
        });
        if (locations.length > 0) {
          nameParts.push(`Outlets: ${locations.map(l => l.name).join(', ')}`);
        }
      }
      const locationName = nameParts.length > 0 ? nameParts.join(' | ') : 'All Warehouses & Locations';

      const now = new Date();
      const startDate = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate = endStr ? new Date(endStr) : new Date(now);

      await job.progress(25);

      // Generate structured data using our service core method
      const { root, grandTotals } = await this.availableStockSummaryService.generateAvailableStockSummaryReportDataInternal(
        prisma,
        {
          locationId,
          warehouseId,
          startDate: startStr,
          endDate: endStr,
          summaryOnly,
          showBrand,
          showDivision,
          showCategory,
          showGender,
          showSilhouette,
          showArticle,
          showVariant,
        }
      );

      await job.progress(60);

      if (format === 'pdf') {
        const fromDateStr = startDate.toLocaleDateString();
        const toDateStr = endDate.toLocaleDateString();
        const html = this.buildPdfHtml(root, locationName, fromDateStr, toDateStr, grandTotals, !!summaryOnly, !!includeCosting);

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

          let currentProgress = 60;
          const progressInterval = setInterval(() => {
            if (currentProgress < 90) {
              currentProgress += 2;
              job.progress(currentProgress).catch(() => {});
            }
          }, 2000);

          let pdfBuffer;
          try {
            pdfBuffer = await page.pdf({
              format: 'A4',
              landscape: true,
              margin: { top: '15mm', bottom: '15mm', left: '10mm', right: '10mm' },
              printBackground: true,
              displayHeaderFooter: true,
              headerTemplate: '<div style="font-size: 7px; width: 100%; text-align: right; padding-right: 15mm; color: #94a3b8;">Speed (Pvt.) Limited | Available Stock Summary</div>',
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
        // XLSX Export using ExcelJS stream WorkbookWriter
        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
          filename: filePath,
          useStyles: true,
          useSharedStrings: false,
        });

        const colsToUse = [...COLUMNS];
        if (includeCosting) {
          colsToUse.push(
            { header: 'Cost Price', key: 'unitCost', width: 14, align: 'right' as const },
            { header: 'Total Costing', key: 'costingValue', width: 18, align: 'right' as const }
          );
        }

        const ws = workbook.addWorksheet('Available Stock Summary', {
          pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
          views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
        });

        ws.columns = colsToUse.map(c => ({ key: c.key, width: c.width }));

        // 1. Column headers
        const headerRow = ws.getRow(1);
        colsToUse.forEach((col, idx) => {
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
        headerRow.height = 24;
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
          let unitPriceVal: any = '';
          let unitCostVal: any = '';
          let costingValueVal: any = node.totals.costingValue;
          
          if (node.level === 'article') {
            label = ' '.repeat(style.indent) + `SKU: ${node.sku} (${node.articleName})`;
            unitPriceVal = node.totals.unitPrice;
            unitCostVal = node.totals.unitCost;
          } else if (node.level === 'variant') {
            label = ' '.repeat(style.indent) + 'Variant Item';
            colorVal = node.color;
            sizeVal = node.size;
            unitPriceVal = '';
            unitCostVal = '';
          } else {
            label = ' '.repeat(style.indent) + style.prefix + node.value.toUpperCase();
          }

          const rowData: any = {
            sku: label,
            size: sizeVal,
            color: colorVal,
            quantity: node.totals.quantity,
            transit: node.totals.transit,
            reserved: node.totals.reserved,
            total: node.totals.total,
            unitPrice: unitPriceVal,
            value: node.totals.value,
          };
          if (includeCosting) {
            rowData.unitCost = unitCostVal;
            rowData.costingValue = costingValueVal;
          }

          const row = ws.addRow(rowData);

          const numCols = colsToUse.length;
          for (let colNum = 1; colNum <= numCols; colNum++) {
            const cell = row.getCell(colNum);
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${style.bgHex}` } };
            cell.font = { bold: style.bold, size: style.fontSize, color: { argb: `FF${style.fgHex}` } };
            cell.border = borderThin;
            cell.alignment = colNum === 2 || colNum === 3 
              ? centerAlign 
              : (colNum === 1 ? leftAlign : rightAlign);

            if ((colNum === 8 || colNum === 9 || colNum === 10 || colNum === 11) && typeof cell.value === 'number') {
              cell.numFmt = '#,##0';
            } else if (colNum >= 4 && colNum <= 7 && typeof cell.value === 'number') {
              cell.numFmt = '#,##0';
            }
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

        // Grand totals row
        const grandTotalsData: any = {
          sku: 'GRAND TOTAL',
          size: '',
          color: '',
          quantity: grandTotals.quantity,
          transit: grandTotals.transit,
          reserved: grandTotals.reserved,
          total: grandTotals.total,
          unitPrice: '',
          value: grandTotals.value,
        };
        if (includeCosting) {
          grandTotalsData.unitCost = '';
          grandTotalsData.costingValue = grandTotals.costingValue;
        }

        const totalRow = ws.addRow(grandTotalsData);

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

          if (colNum >= 4 && typeof cell.value === 'number') {
            cell.numFmt = '#,##0';
          }
        });
        totalRow.height = 24;
        totalRow.commit();

        await workbook.commit();
      }

      await job.progress(95);

      const mimeType = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const fileName = format === 'pdf'
        ? `available-stock-summary-${new Date().toISOString().slice(0, 10)}.pdf`
        : `available-stock-summary-${new Date().toISOString().slice(0, 10)}.xlsx`;

      await this.exportHistoryService.completeAndUploadExport(
        prisma,
        jobId,
        filePath,
        fileName,
        mimeType,
      );

      await this.notificationsService.create({
        userId,
        title: 'Available Stock Summary Ready',
        message: `Your Available Stock Summary ${format.toUpperCase()} report has been generated.`,
        category: 'export',
        priority: 'high',
        actionType: 'available-stock-summary-export.ready',
        actionPayload: JSON.stringify({ jobId }),
      });

      await job.progress(100);
      this.logger.log(`[AvailableStockSummaryExport ${jobId}] Finished processing successfully`);
    } catch (err) {
      this.logger.error(`[AvailableStockSummaryExport ${jobId}] Failed: ${err.message}`, err.stack);
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
    includeCosting: boolean,
  ): string {
    let rowsHtml = '';
    const formatVal = (val: number) => val === 0 ? '-' : val.toLocaleString();

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

    const buildHtmlRows = (node: any): void => {
      const style = LEVEL_PDF_STYLES[node.level] || LEVEL_PDF_STYLES.brand;
      const val = node.totals;
      
      if (node.level === 'article') {
        const costCells = includeCosting 
          ? `<td class="num">${formatVal(val.unitCost)}</td>
             <td class="num highlight-val">${formatVal(val.costingValue)}</td>`
          : '';
        rowsHtml += `
          <tr class="${style.className}">
            <td style="${style.indentStyles}">SKU: ${node.sku} (${node.articleName})</td>
            <td class="center">ALL SIZES</td>
            <td class="center">ALL COLORS</td>
            <td class="num">${formatVal(val.quantity)}</td>
            <td class="num">${formatVal(val.transit)}</td>
            <td class="num">${formatVal(val.reserved)}</td>
            <td class="num highlight-tot">${formatVal(val.total)}</td>
            <td class="num">${formatVal(val.unitPrice)}</td>
            <td class="num highlight-val">${formatVal(val.value)}</td>
            ${costCells}
          </tr>
        `;
      } else if (node.level === 'variant') {
        const costCells = includeCosting 
          ? `<td class="num">-</td>
             <td class="num highlight-val">${formatVal(val.costingValue)}</td>`
          : '';
        rowsHtml += `
          <tr class="${style.className}">
            <td style="${style.indentStyles} color: #64748b; font-style: italic;">&mdash; Variant Item</td>
            <td class="center">${node.size}</td>
            <td class="center">${node.color}</td>
            <td class="num">${formatVal(val.quantity)}</td>
            <td class="num">${formatVal(val.transit)}</td>
            <td class="num">${formatVal(val.reserved)}</td>
            <td class="num highlight-tot">${formatVal(val.total)}</td>
            <td class="num">-</td>
            <td class="num highlight-val">${formatVal(val.value)}</td>
            ${costCells}
          </tr>
        `;
      } else {
        const costCells = includeCosting 
          ? `<td class="num">-</td>
             <td class="num highlight-val">${formatVal(val.costingValue)}</td>`
          : '';
        rowsHtml += `
          <tr class="${style.className}">
            <td colspan="3" style="${style.indentStyles}">${style.prefix}${node.value.toUpperCase()}</td>
            <td class="num">${formatVal(val.quantity)}</td>
            <td class="num">${formatVal(val.transit)}</td>
            <td class="num">${formatVal(val.reserved)}</td>
            <td class="num highlight-tot">${formatVal(val.total)}</td>
            <td class="num">-</td>
            <td class="num highlight-val">${formatVal(val.value)}</td>
            ${costCells}
          </tr>
        `;
      }
      
      if (node.children && node.children.length > 0) {
        for (const child of node.children) {
          buildHtmlRows(child);
        }
      }
    };

    for (const rootNode of data) {
      buildHtmlRows(rootNode);
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Available Stock Summary</title>
        <style>
          @page {
            size: A4 landscape;
            margin: 10mm;
          }
          body {
            font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
            font-size: 8px;
            color: #1e293b;
            margin: 0;
            padding: 0;
            background-color: #ffffff;
          }
          .header {
            margin-bottom: 12px;
            border-bottom: 2px solid #0f172a;
            padding-bottom: 8px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
          }
          .title-area h1 {
            font-size: 16px;
            font-weight: 800;
            color: #0f172a;
            margin: 0;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .title-area p {
            margin: 2px 0 0 0;
            font-size: 9px;
            color: #64748b;
            font-weight: 500;
          }
          .meta-area {
            text-align: right;
            font-size: 9px;
            color: #334155;
            font-weight: 600;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }
          th {
            font-size: 7.5px;
            font-weight: 700;
            text-transform: uppercase;
            background-color: #334155;
            color: #ffffff;
            padding: 5px 6px;
            border: 0.5px solid #475569;
            text-align: left;
          }
          th.num, td.num {
            text-align: right;
          }
          th.center, td.center {
            text-align: center;
          }
          td {
            padding: 4px 6px;
            border: 0.5px solid #cbd5e1;
            font-size: 8px;
            vertical-align: middle;
          }
          tr {
            page-break-inside: auto;
          }
          tr.header-row {
            page-break-inside: avoid;
          }
          .brand-row {
            background-color: #0f172a;
            color: #93c5fd;
            font-weight: 800;
          }
          .brand-row td {
            border-color: #1e293b;
          }
          .division-row {
            background-color: #1e293b;
            color: #cbd5e1;
            font-weight: 700;
          }
          .division-row td {
            border-color: #334155;
          }
          .category-row {
            background-color: #334155;
            color: #ffffff;
            font-weight: 700;
          }
          .category-row td {
            border-color: #475569;
          }
          .gender-row {
            background-color: #475569;
            color: #ffffff;
            font-weight: 600;
          }
          .gender-row td {
            border-color: #64748b;
          }
          .silhouette-row {
            background-color: #64748b;
            color: #ffffff;
            font-weight: 600;
          }
          .silhouette-row td {
            border-color: #94a3b8;
          }
          .article-row {
            background-color: #f1f5f9;
            color: #0f172a;
            font-weight: 700;
          }
          .variant-row {
            background-color: #ffffff;
            color: #334155;
          }
          .highlight-tot {
            font-weight: 700;
            background-color: rgba(30, 41, 59, 0.05);
          }
          .highlight-val {
            font-weight: 700;
            background-color: rgba(30, 41, 59, 0.08);
          }
          .grand-total-row {
            background-color: #e2e8f0;
            font-weight: 800;
            font-size: 9px;
            color: #0f172a;
          }
          .grand-total-row td {
            border-top: 1px solid #0f172a;
            border-bottom: 2px double #0f172a;
            border-color: #0f172a;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="title-area">
            <h1>Available Stock Summary</h1>
            <p>Outlet: ${locationName}</p>
          </div>
          <div class="meta-area">
            Period: ${fromDateStr} - ${toDateStr}
          </div>
        </div>

        <table>
          <colgroup>
            <col style="width: ${includeCosting ? '22%' : '28%'};" />
            <col style="width: ${includeCosting ? '5%' : '8%'};" />
            <col style="width: ${includeCosting ? '7%' : '9%'};" />
            <col style="width: ${includeCosting ? '8%' : '10%'};" />
            <col style="width: ${includeCosting ? '7%' : '9%'};" />
            <col style="width: ${includeCosting ? '8%' : '9%'};" />
            <col style="width: ${includeCosting ? '8%' : '9%'};" />
            <col style="width: ${includeCosting ? '8%' : '8%'};" />
            <col style="width: ${includeCosting ? '10%' : '10%'};" />
            ${includeCosting ? '<col style="width: 8%;" /><col style="width: 11%;" />' : ''}
          </colgroup>
          <thead>
            <tr class="header-row">
              <th>GPC / Category / Product</th>
              <th class="center">Size</th>
              <th class="center">Color</th>
              <th class="num">Quantity</th>
              <th class="num">In Transit</th>
              <th class="num">Stock Reserved</th>
              <th class="num">Total</th>
              <th class="num">Selling Price</th>
              <th class="num">Value (Rs.)</th>
              ${includeCosting ? '<th class="num">Cost Price</th><th class="num">Total Costing</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            <tr class="grand-total-row">
              <td colspan="3">GRAND TOTALS</td>
              <td class="num">${formatVal(grandTotals.quantity)}</td>
              <td class="num">${formatVal(grandTotals.transit)}</td>
              <td class="num">${formatVal(grandTotals.reserved)}</td>
              <td class="num">${formatVal(grandTotals.total)}</td>
              <td class="num">-</td>
              <td class="num">${formatVal(grandTotals.value)}</td>
              ${includeCosting ? `<td class="num">-</td><td class="num">${formatVal(grandTotals.costingValue)}</td>` : ''}
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `;
  }
}
