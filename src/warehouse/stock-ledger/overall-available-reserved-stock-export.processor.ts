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
import { OverallAvailableReservedStockExportService } from './overall-available-reserved-stock-export.service';

export interface OverallAvailableReservedStockExportJobData {
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

@Processor('overall-available-reserved-stock-export')
export class OverallAvailableReservedStockExportProcessor {
  private readonly logger = new Logger(OverallAvailableReservedStockExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly exportHistoryService: ExportHistoryService,
    private readonly reportService: OverallAvailableReservedStockExportService,
  ) {}

  @Process({ concurrency: 1 })
  async handleExport(job: Job<OverallAvailableReservedStockExportJobData>): Promise<void> {
    const {
      jobId, userId, tenantId, tenantDbUrl, locationId, warehouseId, startDate: startStr, endDate: endStr, format,
      summaryOnly, showBrand, showDivision, showCategory, showGender, showSilhouette, showArticle, showVariant,
      includeCosting
    } = job.data;

    this.logger.log(`[OverallAvailableReservedStockExport ${jobId}] Starting ${format.toUpperCase()} export for user ${userId}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);
    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const ext = format === 'pdf' ? 'pdf' : 'xlsx';
    const filePath = path.join(exportDir, `export-${jobId}.${ext}`);

    try {
      await job.progress(10);

      const { root, grandTotals, warehouses, stockLocations } =
        await this.reportService.generateOverallAvailableReservedStockReportDataInternal(
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

      await job.progress(50);

      if (format === 'pdf') {
        const html = this.buildPdfHtml(root, warehouses, stockLocations, grandTotals, !!includeCosting);

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
              headerTemplate: '<div style="font-size: 7px; width: 100%; text-align: right; padding-right: 15mm; color: #94a3b8;">Speed (Pvt.) Limited | Overall Available + Reserved Stock Report</div>',
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

        const columns: { header: string; key: string; width: number; align?: 'left' | 'center' | 'right' }[] = [
          { header: 'GPC / Category / Product', key: 'sku', width: 35, align: 'left' },
          { header: 'Size', key: 'size', width: 10, align: 'center' },
          { header: 'Color', key: 'color', width: 14, align: 'center' },
          { header: 'Quantity', key: 'quantity', width: 14, align: 'right' },
          { header: 'In Transit', key: 'transit', width: 12, align: 'right' },
          { header: 'Stock Reserved', key: 'reserved', width: 14, align: 'right' },
          { header: 'Total', key: 'total', width: 14, align: 'right' },
          { header: 'Selling Price', key: 'unitPrice', width: 14, align: 'right' },
          { header: 'Discount %', key: 'discountRate', width: 12, align: 'right' },
          { header: 'Tax %', key: 'taxRate', width: 10, align: 'right' },
          { header: 'Value (Rs.)', key: 'value', width: 18, align: 'right' },
        ];

        if (includeCosting) {
          columns.push(
            { header: 'Cost Price', key: 'unitCost', width: 14, align: 'right' },
            { header: 'Total Costing', key: 'costingValue', width: 18, align: 'right' }
          );
        }

        for (const wh of warehouses) {
          columns.push({ header: `WH ${wh.name}`, key: `wh_${wh.id}`, width: 14, align: 'right' });
        }

        for (const loc of stockLocations) {
          const locHeader = loc.shortCode || loc.code || loc.name;
          columns.push({ header: locHeader, key: `loc_${loc.id}`, width: 14, align: 'right' });
        }

        const ws = workbook.addWorksheet('Stock Report', {
          pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
          views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
        });

        ws.columns = columns.map(c => ({ key: c.key, width: c.width }));

        // Write header row
        const headerRow = ws.getRow(1);
        columns.forEach((col, idx) => {
          const cell = headerRow.getCell(idx + 1);
          cell.value = col.header;
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
          cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
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
          brand: { bgHex: '0F172A', fgHex: 'FFFFFF', fontSize: 10, bold: true, indent: 0, prefix: 'BRAND: ' },
          division: { bgHex: '1E293B', fgHex: 'FFFFFF', fontSize: 9.5, bold: true, indent: 2, prefix: 'DIVISION: ' },
          category: { bgHex: '334155', fgHex: 'FFFFFF', fontSize: 9, bold: true, indent: 4, prefix: 'CATEGORY: ' },
          gender: { bgHex: '475569', fgHex: 'FFFFFF', fontSize: 9, bold: true, indent: 6, prefix: 'GENDER: ' },
          silhouette: { bgHex: '64748B', fgHex: 'FFFFFF', fontSize: 9, bold: true, indent: 8, prefix: 'SILHOUETTE: ' },
          article: { bgHex: 'F1F5F9', fgHex: '0F172A', fontSize: 9, bold: true, indent: 10, prefix: 'SKU: ' },
          variant: { bgHex: 'FFFFFF', fgHex: '334155', fontSize: 9, bold: false, indent: 12, prefix: '' },
        };

        const writeNodeToExcel = (node: any) => {
          const style = LEVEL_EXCEL_STYLES[node.level] || LEVEL_EXCEL_STYLES.brand;
          const tot = node.totals;

          let label = ' '.repeat(style.indent) + style.prefix;
          let colorVal = '';
          let sizeVal = '';
          let unitPriceVal: any = '';
          let unitCostVal: any = '';

          let discountVal: any = '';
          let taxVal: any = '';

          if (node.level === 'article') {
            label = ' '.repeat(style.indent) + `SKU: ${node.sku} (${node.articleName})`;
            unitPriceVal = tot.unitPrice;
            unitCostVal = tot.unitCost;
            discountVal = tot.discountRate ? tot.discountRate : '';
            taxVal = tot.taxRate ? tot.taxRate : '';
          } else if (node.level === 'variant') {
            label = ' '.repeat(style.indent) + 'Variant Item';
            colorVal = node.color;
            sizeVal = node.size;
            unitPriceVal = '';
            unitCostVal = '';
            discountVal = tot.discountRate ? tot.discountRate : '';
            taxVal = tot.taxRate ? tot.taxRate : '';
          } else {
            label = ' '.repeat(style.indent) + style.prefix + node.value.toUpperCase();
          }

          const rowData: Record<string, any> = {
            sku: label,
            size: sizeVal,
            color: colorVal,
            quantity: tot.quantity,
            transit: tot.transit,
            reserved: tot.reserved,
            total: tot.total,
            unitPrice: unitPriceVal,
            discountRate: discountVal,
            taxRate: taxVal,
            value: tot.value,
          };

          if (includeCosting) {
            rowData.unitCost = unitCostVal;
            rowData.costingValue = tot.costingValue;
          }

          for (const wh of warehouses) {
            rowData[`wh_${wh.id}`] = tot.warehouseStocks[wh.id] || 0;
          }

          for (const loc of stockLocations) {
            rowData[`loc_${loc.id}`] = tot.locationStocks[loc.id] || 0;
          }

          const row = ws.addRow(rowData);

          const numCols = columns.length;
          for (let colNum = 1; colNum <= numCols; colNum++) {
            const cell = row.getCell(colNum);
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${style.bgHex}` } };
            cell.font = { bold: style.bold, size: style.fontSize, color: { argb: `FF${style.fgHex}` } };
            cell.border = borderThin;
            cell.alignment = colNum === 2 || colNum === 3 ? centerAlign : (colNum === 1 ? leftAlign : rightAlign);

            if (typeof cell.value === 'number') {
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

        // Write Grand Total row
        const grandTotalsData: Record<string, any> = {
          sku: 'GRAND TOTAL',
          size: '',
          color: '',
          quantity: grandTotals.quantity,
          transit: grandTotals.transit,
          reserved: grandTotals.reserved,
          total: grandTotals.total,
          unitPrice: '',
          discountRate: '',
          taxRate: '',
          value: grandTotals.value,
        };

        if (includeCosting) {
          grandTotalsData.unitCost = '';
          grandTotalsData.costingValue = grandTotals.costingValue;
        }

        for (const wh of warehouses) {
          grandTotalsData[`wh_${wh.id}`] = grandTotals.warehouseStocks[wh.id] || 0;
        }

        for (const loc of stockLocations) {
          grandTotalsData[`loc_${loc.id}`] = grandTotals.locationStocks[loc.id] || 0;
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

          if (typeof cell.value === 'number') {
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
        ? `overall-available-reserved-stock-${new Date().toISOString().slice(0, 10)}.pdf`
        : `overall-available-reserved-stock-${new Date().toISOString().slice(0, 10)}.xlsx`;

      await this.exportHistoryService.completeAndUploadExport(
        prisma,
        jobId,
        filePath,
        fileName,
        mimeType,
      );

      await this.notificationsService.create({
        userId,
        title: 'Overall Available + Reserved Stock Report Ready',
        message: `Your Overall Available + Reserved Stock ${format.toUpperCase()} report has been generated.`,
        category: 'export',
        priority: 'high',
        actionType: 'overall-available-reserved-stock-export.ready',
        actionPayload: JSON.stringify({ jobId }),
      });

      await job.progress(100);
      this.logger.log(`[OverallAvailableReservedStockExport ${jobId}] Finished processing successfully`);
    } catch (err: any) {
      this.logger.error(`[OverallAvailableReservedStockExport ${jobId}] Failed: ${err.message}`, err.stack);
      await this.exportHistoryService.failExport(prisma, jobId);
      throw err;
    }
  }

  private buildPdfHtml(
    data: any[],
    warehouses: any[],
    stockLocations: any[],
    grandTotals: any,
    includeCosting: boolean,
  ): string {
    let rowsHtml = '';
    const formatVal = (val: number) => val === 0 ? '-' : val.toLocaleString();

    const buildHtmlRows = (node: any): void => {
      const tot = node.totals;

      let whCells = '';
      for (const wh of warehouses) {
        whCells += `<td class="num">${formatVal(tot.warehouseStocks[wh.id] || 0)}</td>`;
      }

      let locCells = '';
      for (const loc of stockLocations) {
        locCells += `<td class="num">${formatVal(tot.locationStocks[loc.id] || 0)}</td>`;
      }

      if (node.level === 'article') {
        const costCells = includeCosting
          ? `<td class="num">${formatVal(tot.unitCost)}</td>
             <td class="num highlight-val">${formatVal(tot.costingValue)}</td>`
          : '';
        rowsHtml += `
          <tr class="article-row">
            <td>SKU: ${node.sku} (${node.articleName})</td>
            <td class="center">ALL SIZES</td>
            <td class="center">ALL COLORS</td>
            <td class="num">${formatVal(tot.quantity)}</td>
            <td class="num">${formatVal(tot.transit)}</td>
            <td class="num">${formatVal(tot.reserved)}</td>
            <td class="num highlight-tot">${formatVal(tot.total)}</td>
            <td class="num">${formatVal(tot.unitPrice)}</td>
            <td class="num">${tot.discountRate ? tot.discountRate.toFixed(2) : '-'}</td>
            <td class="num">${tot.taxRate ? tot.taxRate : '-'}</td>
            <td class="num highlight-val">${formatVal(tot.value)}</td>
            ${costCells}
            ${whCells}
            ${locCells}
          </tr>
        `;
      } else if (node.level === 'variant') {
        const costCells = includeCosting
          ? `<td class="num">-</td>
             <td class="num highlight-val">${formatVal(tot.costingValue)}</td>`
          : '';
        rowsHtml += `
          <tr class="variant-row">
            <td style="padding-left: 20px; color: #64748b; font-style: italic;">&mdash; Variant Detail</td>
            <td class="center">${node.size}</td>
            <td class="center">${node.color}</td>
            <td class="num">${formatVal(tot.quantity)}</td>
            <td class="num">${formatVal(tot.transit)}</td>
            <td class="num">${formatVal(tot.reserved)}</td>
            <td class="num highlight-tot">${formatVal(tot.total)}</td>
            <td class="num">-</td>
            <td class="num">${tot.discountRate ? tot.discountRate.toFixed(2) : '-'}</td>
            <td class="num">${tot.taxRate ? tot.taxRate : '-'}</td>
            <td class="num highlight-val">${formatVal(tot.value)}</td>
            ${costCells}
            ${whCells}
            ${locCells}
          </tr>
        `;
      } else {
        const costCells = includeCosting
          ? `<td class="num">-</td>
             <td class="num highlight-val">${formatVal(tot.costingValue)}</td>`
          : '';
        rowsHtml += `
          <tr class="${node.level}-row">
            <td colspan="3">${node.level.toUpperCase()}: ${node.value.toUpperCase()}</td>
            <td class="num">${formatVal(tot.quantity)}</td>
            <td class="num">${formatVal(tot.transit)}</td>
            <td class="num">${formatVal(tot.reserved)}</td>
            <td class="num highlight-tot">${formatVal(tot.total)}</td>
            <td class="num">-</td>
            <td class="num">-</td>
            <td class="num">-</td>
            <td class="num highlight-val">${formatVal(tot.value)}</td>
            ${costCells}
            ${whCells}
            ${locCells}
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

    let grandWhCells = '';
    for (const wh of warehouses) {
      grandWhCells += `<td class="num">${formatVal(grandTotals.warehouseStocks[wh.id] || 0)}</td>`;
    }

    let grandLocCells = '';
    for (const loc of stockLocations) {
      grandLocCells += `<td class="num">${formatVal(grandTotals.locationStocks[loc.id] || 0)}</td>`;
    }

    const grandCostCells = includeCosting
      ? `<td class="num">-</td>
         <td class="num">${formatVal(grandTotals.costingValue)}</td>`
      : '';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Overall Available + Reserved Stock Report</title>
        <style>
          @page { size: A4 landscape; margin: 8mm; }
          body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 7px; color: #0f172a; margin: 0; padding: 0; }
          .header { margin-bottom: 8px; border-bottom: 2px solid #0f172a; padding-bottom: 4px; }
          .header h1 { font-size: 14px; font-weight: 800; text-transform: uppercase; margin: 0; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          th { font-size: 7px; font-weight: 700; background-color: #1e293b; color: #ffffff; padding: 4px; border: 0.5px solid #475569; text-align: left; }
          td { padding: 3px 4px; border: 0.5px solid #cbd5e1; font-size: 7px; }
          th.num, td.num { text-align: right; }
          th.center, td.center { text-align: center; }
          tr { page-break-inside: auto; }
          .brand-row { background-color: #0f172a; color: #ffffff; font-weight: 800; }
          .division-row { background-color: #1e293b; color: #ffffff; font-weight: 700; }
          .category-row { background-color: #334155; color: #ffffff; font-weight: 700; }
          .gender-row { background-color: #475569; color: #ffffff; font-weight: 600; }
          .silhouette-row { background-color: #64748b; color: #ffffff; font-weight: 600; }
          .article-row { background-color: #f1f5f9; color: #0f172a; font-weight: 700; }
          .variant-row { background-color: #ffffff; color: #334155; }
          .grand-total-row { background-color: #e2e8f0; font-weight: 800; font-size: 8px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Overall Available + Reserved Stock Report</h1>
        </div>
        <table>
          <thead>
            <tr>
              <th>GPC / Category / Product</th>
              <th class="center">Size</th>
              <th class="center">Color</th>
              <th class="num">Quantity</th>
              <th class="num">In Transit</th>
              <th class="num">Stock Reserved</th>
              <th class="num">Total</th>
              <th class="num">Selling Price</th>
              <th class="num">Disc %</th>
              <th class="num">Tax %</th>
              <th class="num">Value (Rs.)</th>
              ${includeCosting ? '<th class="num">Cost Price</th><th class="num">Total Costing</th>' : ''}
              ${warehouses.map(w => `<th class="num">WH ${w.name}</th>`).join('')}
              ${stockLocations.map(l => `<th class="num">${l.shortCode || l.code || l.name}</th>`).join('')}
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
              <td class="num">-</td>
              <td class="num">-</td>
              <td class="num">${formatVal(grandTotals.value)}</td>
              ${grandCostCells}
              ${grandWhCells}
              ${grandLocCells}
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `;
  }
}
