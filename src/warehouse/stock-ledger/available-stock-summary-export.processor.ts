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

const COLUMNS = [
  { header: 'GPC / Category / Product', key: 'sku', width: 35, align: 'left' as const },
  { header: 'Size', key: 'size', width: 10, align: 'center' as const },
  { header: 'Color', key: 'color', width: 14, align: 'center' as const },
  { header: 'Quantity', key: 'quantity', width: 14, align: 'right' as const },
  { header: 'In Transit', key: 'transit', width: 12, align: 'right' as const },
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
      jobId, userId, tenantId, tenantDbUrl, locationId, startDate: startStr, endDate: endStr, format,
      summaryOnly, showBrand, showDivision, showCategory, showGender, showSilhouette, showArticle, showVariant
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
      let locationName = 'All Locations';
      if (locIds.length > 0) {
        const locations = await prisma.location.findMany({
          where: { id: { in: locIds } },
          select: { name: true },
        });
        if (locations.length > 0) {
          locationName = locations.map(l => l.name).join(', ');
        }
      }

      const now = new Date();
      const startDate = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate = endStr ? new Date(endStr) : new Date(now);

      await job.progress(25);

      // Generate structured data using our service core method
      const { root, grandTotals } = await this.availableStockSummaryService.generateAvailableStockSummaryReportDataInternal(
        prisma,
        {
          locationId,
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

        const ws = workbook.addWorksheet('Available Stock Summary', {
          pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
          views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
        });

        ws.columns = COLUMNS.map(c => ({ key: c.key, width: c.width }));

        // 1. Column headers
        const headerRow = ws.getRow(1);
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
          
          if (node.level === 'article') {
            label = ' '.repeat(style.indent) + `SKU: ${node.sku} (${node.articleName})`;
            unitPriceVal = node.totals.unitPrice;
          } else if (node.level === 'variant') {
            label = ' '.repeat(style.indent) + 'Variant Item';
            colorVal = node.color;
            sizeVal = node.size;
            // Selling price column on size detail is empty in the design pattern
            unitPriceVal = '';
          } else {
            label = ' '.repeat(style.indent) + style.prefix + node.value.toUpperCase();
          }

          const row = ws.addRow({
            sku: label,
            size: sizeVal,
            color: colorVal,
            quantity: node.totals.quantity,
            transit: node.totals.transit,
            total: node.totals.total,
            unitPrice: unitPriceVal,
            value: node.totals.value,
          });

          for (let colNum = 1; colNum <= 8; colNum++) {
            const cell = row.getCell(colNum);
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${style.bgHex}` } };
            cell.font = { bold: style.bold, size: style.fontSize, color: { argb: `FF${style.fgHex}` } };
            cell.border = borderThin;
            cell.alignment = colNum === 2 || colNum === 3 
              ? centerAlign 
              : (colNum === 1 ? leftAlign : rightAlign);

            if ((colNum === 7 || colNum === 8) && typeof cell.value === 'number') {
              cell.numFmt = '#,##0';
            } else if (colNum >= 4 && colNum <= 6 && typeof cell.value === 'number') {
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
        const totalRow = ws.addRow({
          sku: 'GRAND TOTAL',
          size: '',
          color: '',
          quantity: grandTotals.quantity,
          transit: grandTotals.transit,
          total: grandTotals.total,
          unitPrice: '',
          value: grandTotals.value,
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
        rowsHtml += `
          <tr class="${style.className}">
            <td style="${style.indentStyles}">SKU: ${node.sku} (${node.articleName})</td>
            <td class="center">ALL SIZES</td>
            <td class="center">ALL COLORS</td>
            <td class="num">${formatVal(val.quantity)}</td>
            <td class="num">${formatVal(val.transit)}</td>
            <td class="num highlight-tot">${formatVal(val.total)}</td>
            <td class="num">${formatVal(val.unitPrice)}</td>
            <td class="num highlight-val">${formatVal(val.value)}</td>
          </tr>
        `;
      } else if (node.level === 'variant') {
        rowsHtml += `
          <tr class="${style.className}">
            <td style="${style.indentStyles} color: #64748b; font-style: italic;">&mdash; Variant Item</td>
            <td class="center">${node.size}</td>
            <td class="center">${node.color}</td>
            <td class="num">${formatVal(val.quantity)}</td>
            <td class="num">${formatVal(val.transit)}</td>
            <td class="num highlight-tot">${formatVal(val.total)}</td>
            <td class="num">-</td>
            <td class="num highlight-val">${formatVal(val.value)}</td>
          </tr>
        `;
      } else {
        rowsHtml += `
          <tr class="${style.className}">
            <td colspan="3" style="${style.indentStyles}">${style.prefix}${node.value.toUpperCase()}</td>
            <td class="num">${formatVal(val.quantity)}</td>
            <td class="num">${formatVal(val.transit)}</td>
            <td class="num highlight-tot">${formatVal(val.total)}</td>
            <td class="num">-</td>
            <td class="num highlight-val">${formatVal(val.value)}</td>
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
        <style>
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
            color: #ffffff;
            font-weight: 800;
            font-size: 8.5px;
          }
          .brand-row td {
            border-color: #1e293b;
          }
          .division-row {
            background-color: #1e293b;
            color: #ffffff;
            font-weight: 700;
            font-size: 8px;
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
            <col style="width: 32%;" />
            <col style="width: 8%;" />
            <col style="width: 10%;" />
            <col style="width: 11%;" />
            <col style="width: 9%;" />
            <col style="width: 10%;" />
            <col style="width: 9%;" />
            <col style="width: 11%;" />
          </colgroup>
          <thead>
            <tr class="header-row">
              <th>GPC / Category / Product</th>
              <th class="center">Size</th>
              <th class="center">Color</th>
              <th class="num">Quantity</th>
              <th class="num">In Transit</th>
              <th class="num">Total</th>
              <th class="num">Selling Price</th>
              <th class="num">Value (Rs.)</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            <tr class="grand-total-row">
              <td colspan="3">GRAND TOTALS</td>
              <td class="num">${formatVal(grandTotals.quantity)}</td>
              <td class="num">${formatVal(grandTotals.transit)}</td>
              <td class="num">${formatVal(grandTotals.total)}</td>
              <td class="num">-</td>
              <td class="num">${formatVal(grandTotals.value)}</td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `;
  }
}
