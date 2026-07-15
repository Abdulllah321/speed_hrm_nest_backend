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
import { StockValuationExportService } from './stock-valuation-export.service';

export interface StockValuationExportJobData {
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

const GROUP_COLORS: Record<string, string> = {
  General: '1E293B',
  'Opening Stock': '475569',
  Purchases: '065F46',
  'Purchases Return': '991B1B',
  Available: '1E3A8A',
  'Net Sale': '5B21B6',
  Adjustment: '4F46E5',
  'Closing balance': '0F172A',
};

const COLUMNS = [
  { header: 'Concept', key: 'concept', width: 16, group: 'General' },
  { header: 'Division', key: 'division', width: 14, group: 'General' },
  { header: 'ItemName', key: 'itemName', width: 28, group: 'General' },
  { header: 'SKU', key: 'sku', width: 14, group: 'General' },
  { header: 'Size', key: 'size', width: 8, group: 'General', align: 'center' as const },
  
  { header: 'Unit', key: 'openingQty', width: 10, group: 'Opening Stock', align: 'right' as const },
  { header: 'Cost', key: 'openingCost', width: 11, group: 'Opening Stock', align: 'right' as const },
  { header: 'Value', key: 'openingValue', width: 13, group: 'Opening Stock', align: 'right' as const },
  
  { header: 'Unit', key: 'purchaseQty', width: 10, group: 'Purchases', align: 'right' as const },
  { header: 'Cost', key: 'purchaseCost', width: 11, group: 'Purchases', align: 'right' as const },
  { header: 'Value', key: 'purchaseValue', width: 13, group: 'Purchases', align: 'right' as const },
  
  { header: 'Unit', key: 'purchaseRetQty', width: 10, group: 'Purchases Return', align: 'right' as const },
  { header: 'Cost', key: 'purchaseRetCost', width: 11, group: 'Purchases Return', align: 'right' as const },
  { header: 'Value', key: 'purchaseRetValue', width: 13, group: 'Purchases Return', align: 'right' as const },
  
  { header: 'Unit', key: 'availableQty', width: 10, group: 'Available', align: 'right' as const },
  { header: 'Cost', key: 'availableCost', width: 11, group: 'Available', align: 'right' as const },
  { header: 'Value', key: 'availableValue', width: 13, group: 'Available', align: 'right' as const },
  
  { header: 'Unit', key: 'salesQty', width: 10, group: 'Net Sale', align: 'right' as const },
  { header: 'Cost', key: 'salesCost', width: 11, group: 'Net Sale', align: 'right' as const },
  { header: 'Value', key: 'salesValue', width: 13, group: 'Net Sale', align: 'right' as const },
  
  { header: 'Unit', key: 'adjQty', width: 10, group: 'Adjustment', align: 'right' as const },
  { header: 'Cost', key: 'adjCost', width: 11, group: 'Adjustment', align: 'right' as const },
  { header: 'Value', key: 'adjValue', width: 13, group: 'Adjustment', align: 'right' as const },
  
  { header: 'Unit', key: 'closingQty', width: 10, group: 'Closing balance', align: 'right' as const },
  { header: 'Cost', key: 'closingCost', width: 11, group: 'Closing balance', align: 'right' as const },
  { header: 'Value', key: 'closingValue', width: 13, group: 'Closing balance', align: 'right' as const },
];

@Processor('stock-valuation-export')
export class StockValuationExportProcessor {
  private readonly logger = new Logger(StockValuationExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly exportHistoryService: ExportHistoryService,
    private readonly stockValuationExportService: StockValuationExportService,
  ) {
    if (process.platform === 'linux') {
      try {
        const logger = new Logger('StockValuationExportProcessor');
        const { exec } = require('child_process');
        exec(
          'apt-get update && apt-get install -y libatk1.0-0 libatk-bridge2.0-0 libcups2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpangocairo-1.0-0 libasound2 libnss3 libxshmfence1 libgtk-3-0',
          (err: any) => {
            if (!err) {
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
  async handleExport(job: Job<StockValuationExportJobData>): Promise<void> {
    const {
      jobId, userId, tenantId, tenantDbUrl, locationId, startDate: startStr, endDate: endStr, format, summaryOnly,
      showBrand, showDivision, showCategory, showGender, showSilhouette, showArticle, showVariant
    } = job.data;
    this.logger.log(`[StockValuationExport ${jobId}] Starting ${format.toUpperCase()} export for user ${userId}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);
    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const ext = format === 'pdf' ? 'pdf' : 'xlsx';
    const filePath = path.join(exportDir, `export-${jobId}.${ext}`);

    try {
      await job.progress(10);

      let locationName = 'All Locations';
      if (locationId) {
        const location = await prisma.location.findUnique({
          where: { id: locationId },
          select: { name: true },
        });
        locationName = location?.name || 'Store';
      }

      const now = new Date();
      const startDate = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate = endStr ? new Date(endStr) : new Date(now);

      await job.progress(20);

      const { root, grandTotals } = await this.stockValuationExportService.generateValuationReportDataInternal(prisma, {
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
      });

      await job.progress(60);

      if (root.length === 0) {
        if (format === 'xlsx') {
          await this.writeEmptyWorkbook(filePath);
        } else {
          await this.writeEmptyPdf(filePath, locationName, startDate, endDate);
        }
        await job.progress(100);
        return;
      }

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

          // Active progress update during PDF printing
          let currentProgress = 70;
          const progressInterval = setInterval(() => {
            if (currentProgress < 94) {
              currentProgress += 1;
              job.progress(currentProgress).catch(() => {});
            }
          }, 2000);

          let pdfBuffer;
          try {
            pdfBuffer = await page.pdf({
              format: 'A3',
              landscape: true,
              margin: { top: '15mm', bottom: '15mm', left: '10mm', right: '10mm' },
              printBackground: true,
              displayHeaderFooter: true,
              headerTemplate: '<div style="font-size: 8px; width: 100%; text-align: right; padding-right: 15mm; color: #94a3b8;">Speed (Private) Limited | Stock Valuation Report</div>',
              footerTemplate: '<div style="font-size: 8px; width: 100%; text-align: center; color: #94a3b8;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
            });
          } finally {
            clearInterval(progressInterval);
          }

          fs.writeFileSync(filePath, pdfBuffer);
        } finally {
          await browser.close();
        }
      } else {
        // Excel Format Export
        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
          filename: filePath,
          useStyles: true,
          useSharedStrings: false,
        });

        const ws = workbook.addWorksheet('Stock Valuation Report', {
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
        groupRow.height = 24;
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
          
          let conceptVal = '';
          let divisionVal = '';
          let itemNameVal = '';
          let skuVal = '';
          let sizeVal = '';

          const displayLabel = ' '.repeat(style.indent) + (style.prefix ? style.prefix : '') + node.value.toUpperCase();

          if (node.level === 'brand') {
            conceptVal = displayLabel;
          } else if (node.level === 'division') {
            divisionVal = displayLabel;
          } else if (node.level === 'article') {
            skuVal = node.sku;
            itemNameVal = node.articleName;
          } else if (node.level === 'variant') {
            itemNameVal = ' '.repeat(style.indent) + 'Variant Details';
            sizeVal = node.size;
          } else {
            conceptVal = displayLabel;
          }
          
          const row = ws.addRow({
            concept: conceptVal,
            division: divisionVal,
            itemName: itemNameVal,
            sku: skuVal,
            size: sizeVal,
            
            openingQty: node.totals.openingQty,
            openingCost: node.totals.openingCost,
            openingValue: node.totals.openingValue,
            
            purchaseQty: node.totals.purchaseQty,
            purchaseCost: node.totals.purchaseCost,
            purchaseValue: node.totals.purchaseValue,
            
            purchaseRetQty: node.totals.purchaseRetQty,
            purchaseRetCost: node.totals.purchaseRetCost,
            purchaseRetValue: node.totals.purchaseRetValue,
            
            availableQty: node.totals.availableQty,
            availableCost: node.totals.availableCost,
            availableValue: node.totals.availableValue,
            
            salesQty: node.totals.salesQty,
            salesCost: node.totals.salesCost,
            salesValue: node.totals.salesValue,
            
            adjQty: node.totals.adjQty,
            adjCost: node.totals.adjCost,
            adjValue: node.totals.adjValue,
            
            closingQty: node.totals.closingQty,
            closingCost: node.totals.closingCost,
            closingValue: node.totals.closingValue,
          });
          
          for (let colNum = 1; colNum <= COLUMNS.length; colNum++) {
            const cell = row.getCell(colNum);
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${style.bgHex}` } };
            cell.font = { bold: style.bold, size: style.fontSize, color: { argb: `FF${style.fgHex}` } };
            cell.border = borderThin;
            cell.alignment = colNum === 5 
              ? centerAlign 
              : (colNum <= 4 ? leftAlign : rightAlign);

            // Format numbers nicely, display dash for 0
            if (colNum >= 6) {
              const val = cell.value;
              if (typeof val === 'number') {
                if (val === 0) {
                  cell.value = '-';
                  cell.alignment = rightAlign;
                } else {
                  // If it's a Cost or Value column (indexes: 7,8, 10,11, 13,14, 16,17, 19,20, 22,23, 25,26)
                  const isCostOrVal = [7, 8, 10, 11, 13, 14, 16, 17, 19, 20, 22, 23, 25, 26].includes(colNum);
                  cell.numFmt = isCostOrVal ? '#,##0.00' : '#,##0';
                }
              }
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

        // Add GRAND TOTALS Row at bottom of Excel
        const totalRow = ws.addRow({
          concept: 'GRAND TOTAL',
          division: '',
          itemName: '',
          sku: '',
          size: '',
          
          openingQty: grandTotals.openingQty,
          openingCost: grandTotals.openingCost,
          openingValue: grandTotals.openingValue,
          
          purchaseQty: grandTotals.purchaseQty,
          purchaseCost: grandTotals.purchaseCost,
          purchaseValue: grandTotals.purchaseValue,
          
          purchaseRetQty: grandTotals.purchaseRetQty,
          purchaseRetCost: grandTotals.purchaseRetCost,
          purchaseRetValue: grandTotals.purchaseRetValue,
          
          availableQty: grandTotals.availableQty,
          availableCost: grandTotals.availableCost,
          availableValue: grandTotals.availableValue,
          
          salesQty: grandTotals.salesQty,
          salesCost: grandTotals.salesCost,
          salesValue: grandTotals.salesValue,
          
          adjQty: grandTotals.adjQty,
          adjCost: grandTotals.adjCost,
          adjValue: grandTotals.adjValue,
          
          closingQty: grandTotals.closingQty,
          closingCost: grandTotals.closingCost,
          closingValue: grandTotals.closingValue,
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
          cell.alignment = colNum <= 5 ? leftAlign : rightAlign;

          if (colNum >= 6) {
            const val = cell.value;
            if (typeof val === 'number') {
              if (val === 0) {
                cell.value = '-';
              } else {
                const isCostOrVal = [7, 8, 10, 11, 13, 14, 16, 17, 19, 20, 22, 23, 25, 26].includes(colNum);
                cell.numFmt = isCostOrVal ? '#,##0.00' : '#,##0';
              }
            }
          }
        });
        totalRow.height = 24;
        totalRow.commit();

        await workbook.commit();
      }

      await job.progress(95);

      const mimeType = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const fileName = format === 'pdf'
        ? `stock-valuation-report-${new Date().toISOString().slice(0, 10)}.pdf`
        : `stock-valuation-report-${new Date().toISOString().slice(0, 10)}.xlsx`;

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
        title: 'Stock Valuation Export Ready',
        message: `Your Stock Valuation ${format.toUpperCase()} report has been processed successfully.`,
        category: 'export',
        priority: 'high',
        actionType: 'stock-valuation-export.ready',
        actionPayload: JSON.stringify({ jobId }),
      });

      await job.progress(100);
      this.logger.log(`[StockValuationExport ${jobId}] Finished processing ${format.toUpperCase()} successfully`);
    } catch (err) {
      this.logger.error(`[StockValuationExport ${jobId}] Failed: ${err.message}`, err.stack);
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
    const formatVal = (val: number, isCostOrVal = false) => {
      if (val === 0) return '-';
      return isCostOrVal ? val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : val.toLocaleString();
    };

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
      
      let conceptVal = '';
      let divisionVal = '';
      let itemNameVal = '';
      let skuVal = '';
      let sizeVal = '';

      const label = (style.prefix ? style.prefix : '') + node.value.toUpperCase();

      if (node.level === 'brand') {
        conceptVal = label;
      } else if (node.level === 'division') {
        divisionVal = label;
      } else if (node.level === 'article') {
        skuVal = node.sku;
        itemNameVal = node.articleName;
      } else if (node.level === 'variant') {
        itemNameVal = 'Variant Details';
        sizeVal = node.size;
      } else {
        conceptVal = label;
      }

      html += `
        <tr class="${style.className}">
          <td style="${style.indentStyles}">${conceptVal}</td>
          <td>${divisionVal}</td>
          <td>${itemNameVal}</td>
          <td>${skuVal}</td>
          <td class="center">${sizeVal}</td>
          
          <td class="num">${formatVal(node.totals.openingQty)}</td>
          <td class="num">${formatVal(node.totals.openingCost, true)}</td>
          <td class="num font-bold">${formatVal(node.totals.openingValue, true)}</td>
          
          <td class="num">${formatVal(node.totals.purchaseQty)}</td>
          <td class="num">${formatVal(node.totals.purchaseCost, true)}</td>
          <td class="num font-bold">${formatVal(node.totals.purchaseValue, true)}</td>
          
          <td class="num">${formatVal(node.totals.purchaseRetQty)}</td>
          <td class="num">${formatVal(node.totals.purchaseRetCost, true)}</td>
          <td class="num font-bold">${formatVal(node.totals.purchaseRetValue, true)}</td>
          
          <td class="num highlight-blue">${formatVal(node.totals.availableQty)}</td>
          <td class="num highlight-blue">${formatVal(node.totals.availableCost, true)}</td>
          <td class="num highlight-blue font-bold">${formatVal(node.totals.availableValue, true)}</td>
          
          <td class="num">${formatVal(node.totals.salesQty)}</td>
          <td class="num">${formatVal(node.totals.salesCost, true)}</td>
          <td class="num font-bold">${formatVal(node.totals.salesValue, true)}</td>
          
          <td class="num">${formatVal(node.totals.adjQty)}</td>
          <td class="num">${formatVal(node.totals.adjCost, true)}</td>
          <td class="num font-bold">${formatVal(node.totals.adjValue, true)}</td>
          
          <td class="num highlight-closing">${formatVal(node.totals.closingQty)}</td>
          <td class="num highlight-closing">${formatVal(node.totals.closingCost, true)}</td>
          <td class="num highlight-closing font-bold">${formatVal(node.totals.closingValue, true)}</td>
        </tr>
      `;
      
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
            font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
            color: #1e293b;
            font-size: 7.5px;
            margin: 0;
            padding: 0;
          }
          .header {
            margin-bottom: 12px;
          }
          .company-name {
            font-size: 14px;
            font-weight: bold;
            color: #0f172a;
          }
          .report-title {
            font-size: 11px;
            font-weight: 600;
            color: #475569;
            margin-top: 2px;
          }
          .report-date {
            font-size: 8px;
            color: #64748b;
            margin-top: 2px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }
          th, td {
            padding: 4px 3px;
            border: 1px solid #e2e8f0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          th {
            font-weight: bold;
            text-transform: uppercase;
            font-size: 7px;
          }
          .group-header th {
            color: #ffffff;
            text-align: center;
          }
          .sub-header th {
            background-color: #334155;
            color: #ffffff;
          }
          tr {
            page-break-inside: auto;
          }
          .brand-row {
            background-color: #1e293b;
            color: #ffffff;
            font-weight: bold;
            page-break-inside: avoid;
          }
          .brand-row td {
            border-color: #334155;
          }
          .division-row {
            background-color: #334155;
            color: #ffffff;
            font-weight: bold;
            page-break-inside: avoid;
          }
          .division-row td {
            border-color: #475569;
          }
          .category-row {
            background-color: #475569;
            color: #ffffff;
            font-weight: bold;
          }
          .gender-row {
            background-color: #64748b;
            color: #ffffff;
            font-weight: bold;
          }
          .silhouette-row {
            background-color: #94a3b8;
            color: #ffffff;
            font-weight: bold;
          }
          .article-row {
            background-color: #f1f5f9;
            font-weight: bold;
          }
          .variant-row {
            background-color: #ffffff;
          }
          .grand-total-row {
            background-color: #e2e8f0;
            font-weight: bold;
            font-size: 8px;
            border-top: 2px solid #0f172a;
            border-bottom: 2px double #0f172a;
          }
          .center { text-align: center; }
          .num { text-align: right; }
          .font-bold { font-weight: bold; }
          
          /* Colors for header bands */
          .bg-general { background-color: #1e293b; }
          .bg-opening { background-color: #475569; }
          .bg-purchases { background-color: #065f46; }
          .bg-returns { background-color: #991b1b; }
          .bg-avail { background-color: #1e3a8a; }
          .bg-sales { background-color: #5b21b6; }
          .bg-adj { background-color: #4f46e5; }
          .bg-closing { background-color: #0f172a; }

          .highlight-blue { background-color: #eff6ff; }
          .highlight-closing { background-color: #f8fafc; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="company-name">Speed (Private) Limited</div>
          <div class="report-title">Stocks Valuation - ${locationName}</div>
          <div class="report-date">From ${fromDateStr} to ${toDateStr}</div>
        </div>
        <table>
          <colgroup>
            <!-- General Columns (Concept, Division, ItemName, SKU, Size) -->
            <col style="width: 6.5%;">
            <col style="width: 5.5%;">
            <col style="width: 12%;">
            <col style="width: 6%;">
            <col style="width: 3%;">
            <!-- Opening -->
            <col style="width: 3.2%;">
            <col style="width: 3.5%;">
            <col style="width: 4%;">
            <!-- Purchases -->
            <col style="width: 3.2%;">
            <col style="width: 3.5%;">
            <col style="width: 4%;">
            <!-- Purchases Return -->
            <col style="width: 3.2%;">
            <col style="width: 3.5%;">
            <col style="width: 4%;">
            <!-- Available -->
            <col style="width: 3.2%;">
            <col style="width: 3.5%;">
            <col style="width: 4%;">
            <!-- Net Sale -->
            <col style="width: 3.2%;">
            <col style="width: 3.5%;">
            <col style="width: 4%;">
            <!-- Adjustment -->
            <col style="width: 3.2%;">
            <col style="width: 3.5%;">
            <col style="width: 4%;">
            <!-- Closing -->
            <col style="width: 3.2%;">
            <col style="width: 3.5%;">
            <col style="width: 4%;">
          </colgroup>
          <thead>
            <tr class="group-header">
              <th colspan="5" class="bg-general">General</th>
              <th colspan="3" class="bg-opening">Opening Stock</th>
              <th colspan="3" class="bg-purchases">Purchases</th>
              <th colspan="3" class="bg-returns">Purchases Return</th>
              <th colspan="3" class="bg-avail">Available</th>
              <th colspan="3" class="bg-sales">Net Sale</th>
              <th colspan="3" class="bg-adj">Adjustment</th>
              <th colspan="3" class="bg-closing">Closing balance</th>
            </tr>
            <tr class="sub-header">
              <th>Concept</th>
              <th>Division</th>
              <th>ItemName</th>
              <th>SKU</th>
              <th class="center">Size</th>
              
              <th class="num">Unit</th>
              <th class="num">Cost</th>
              <th class="num">Value</th>
              
              <th class="num">Unit</th>
              <th class="num">Cost</th>
              <th class="num">Value</th>
              
              <th class="num">Unit</th>
              <th class="num">Cost</th>
              <th class="num">Value</th>
              
              <th class="num">Unit</th>
              <th class="num">Cost</th>
              <th class="num">Value</th>
              
              <th class="num">Unit</th>
              <th class="num">Cost</th>
              <th class="num">Value</th>
              
              <th class="num">Unit</th>
              <th class="num">Cost</th>
              <th class="num">Value</th>
              
              <th class="num">Unit</th>
              <th class="num">Cost</th>
              <th class="num">Value</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            <tr class="grand-total-row">
              <td>GRAND TOTAL</td>
              <td></td>
              <td></td>
              <td></td>
              <td></td>
              
              <td class="num">${formatVal(grandTotals.openingQty)}</td>
              <td class="num">${formatVal(grandTotals.openingCost, true)}</td>
              <td class="num">${formatVal(grandTotals.openingValue, true)}</td>
              
              <td class="num">${formatVal(grandTotals.purchaseQty)}</td>
              <td class="num">${formatVal(grandTotals.purchaseCost, true)}</td>
              <td class="num">${formatVal(grandTotals.purchaseValue, true)}</td>
              
              <td class="num">${formatVal(grandTotals.purchaseRetQty)}</td>
              <td class="num">${formatVal(grandTotals.purchaseRetCost, true)}</td>
              <td class="num">${formatVal(grandTotals.purchaseRetValue, true)}</td>
              
              <td class="num">${formatVal(grandTotals.availableQty)}</td>
              <td class="num">${formatVal(grandTotals.availableCost, true)}</td>
              <td class="num">${formatVal(grandTotals.availableValue, true)}</td>
              
              <td class="num">${formatVal(grandTotals.salesQty)}</td>
              <td class="num">${formatVal(grandTotals.salesCost, true)}</td>
              <td class="num">${formatVal(grandTotals.salesValue, true)}</td>
              
              <td class="num">${formatVal(grandTotals.adjQty)}</td>
              <td class="num">${formatVal(grandTotals.adjCost, true)}</td>
              <td class="num">${formatVal(grandTotals.adjValue, true)}</td>
              
              <td class="num">${formatVal(grandTotals.closingQty)}</td>
              <td class="num">${formatVal(grandTotals.closingCost, true)}</td>
              <td class="num">${formatVal(grandTotals.closingValue, true)}</td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `;
  }

  private async writeEmptyWorkbook(filePath: string): Promise<void> {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath });
    const ws = workbook.addWorksheet('No Data');
    ws.addRow(['No stock movements found for the selected store/dates.']);
    await workbook.commit();
  }

  private async writeEmptyPdf(filePath: string, store: string, start: Date, end: Date): Promise<void> {
    const html = `
      <html>
      <body>
        <h2>Speed (Private) Limited</h2>
        <h3>Stock Valuation Report - ${store}</h3>
        <p>From ${start.toLocaleDateString()} to ${end.toLocaleDateString()}</p>
        <hr/>
        <p>No stock ledger records or inventory items found matching filters.</p>
      </body>
      </html>
    `;
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html);
    const pdf = await page.pdf({ format: 'A4', landscape: true });
    fs.writeFileSync(filePath, pdf);
    await browser.close();
  }
}
