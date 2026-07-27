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
            includeCosting,
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
          { header: 'Brand', key: 'brand', width: 14, align: 'left' },
          { header: 'Division', key: 'division', width: 14, align: 'left' },
          { header: 'Department', key: 'department', width: 14, align: 'left' },
          { header: 'ProductCategory', key: 'category', width: 16, align: 'left' },
          { header: 'Gender', key: 'gender', width: 12, align: 'left' },
          { header: 'Silhouette', key: 'silhouette', width: 14, align: 'left' },
          { header: 'Season', key: 'season', width: 12, align: 'left' },
          { header: 'SKU', key: 'sku', width: 16, align: 'left' },
          { header: 'BarCode', key: 'barCode', width: 18, align: 'left' },
          { header: 'ItemName', key: 'itemName', width: 28, align: 'left' },
          { header: 'Size', key: 'size', width: 10, align: 'center' },
          { header: 'Color', key: 'color', width: 14, align: 'center' },
          { header: 'UnitPrice', key: 'unitPrice', width: 14, align: 'right' },
        ];

        if (includeCosting) {
          columns.push({ header: 'UnitCost', key: 'unitCost', width: 14, align: 'right' });
        }

        columns.push(
          { header: 'Discount %', key: 'discountRate', width: 12, align: 'right' },
          { header: 'Tax %', key: 'taxRate', width: 10, align: 'right' }
        );

        for (const wh of warehouses) {
          columns.push({ header: `WH ${wh.name}`, key: `wh_${wh.id}`, width: 14, align: 'right' });
        }

        for (const loc of stockLocations) {
          const locHeader = loc.shortCode || loc.code || loc.name;
          columns.push({ header: locHeader, key: `loc_${loc.id}`, width: 14, align: 'right' });
        }

        columns.push(
          { header: 'Available Stock', key: 'availableStock', width: 16, align: 'right' },
          { header: 'Reserved Stock', key: 'reservedStock', width: 16, align: 'right' },
          { header: 'Total Stock', key: 'totalStock', width: 16, align: 'right' },
          { header: 'Available Value', key: 'availableValue', width: 18, align: 'right' },
          { header: 'Reserved Value', key: 'reservedValue', width: 18, align: 'right' },
          { header: 'Total Value', key: 'totalValue', width: 20, align: 'right' }
        );

        if (includeCosting) {
          columns.push(
            { header: 'Available Costing', key: 'availableCostingValue', width: 18, align: 'right' },
            { header: 'Reserved Costing', key: 'reservedCostingValue', width: 18, align: 'right' },
            { header: 'Total Costing', key: 'totalCostingValue', width: 20, align: 'right' }
          );
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
        }> = {
          brand: { bgHex: '0F172A', fgHex: 'FFFFFF', fontSize: 10, bold: true },
          division: { bgHex: '1E293B', fgHex: 'FFFFFF', fontSize: 9.5, bold: true },
          category: { bgHex: '334155', fgHex: 'FFFFFF', fontSize: 9, bold: true },
          gender: { bgHex: '475569', fgHex: 'FFFFFF', fontSize: 9, bold: true },
          silhouette: { bgHex: '64748B', fgHex: 'FFFFFF', fontSize: 9, bold: true },
          article: { bgHex: 'F1F5F9', fgHex: '0F172A', fontSize: 9, bold: true },
          variant: { bgHex: 'FFFFFF', fgHex: '334155', fontSize: 9, bold: false },
        };

        const writeNodeToExcel = (node: any) => {
          const style = LEVEL_EXCEL_STYLES[node.level] || LEVEL_EXCEL_STYLES.brand;
          const tot = node.totals;

          const rowData: Record<string, any> = {
            brand: node.level === 'brand' ? `BRAND: ${node.value}` : (node.brand || ''),
            division: node.level === 'division' ? `DIVISION: ${node.value}` : (node.division || ''),
            department: node.department || 'N/A',
            category: node.level === 'category' ? `CATEGORY: ${node.value}` : (node.category || ''),
            gender: node.level === 'gender' ? `GENDER: ${node.value}` : (node.gender || ''),
            silhouette: node.level === 'silhouette' ? `SILHOUETTE: ${node.value}` : (node.silhouette || ''),
            season: node.season || '',
            sku: node.sku || '',
            barCode: node.barCode || '',
            itemName: node.itemName || '',
            size: node.size || '',
            color: node.color || '',
            unitPrice: (node.level === 'article' || node.level === 'variant') ? tot.unitPrice : '',
            discountRate: (node.level === 'article' || node.level === 'variant') ? tot.discountRate : '',
            taxRate: (node.level === 'article' || node.level === 'variant') ? tot.taxRate : '',
            availableStock: tot.availableStock,
            reservedStock: tot.reservedStock,
            totalStock: tot.totalStock,
            availableValue: tot.availableValue,
            reservedValue: tot.reservedValue,
            totalValue: tot.totalValue,
          };

          if (includeCosting) {
            rowData.unitCost = (node.level === 'article' || node.level === 'variant') ? tot.unitCost : '';
            rowData.availableCostingValue = tot.availableCostingValue;
            rowData.reservedCostingValue = tot.reservedCostingValue;
            rowData.totalCostingValue = tot.totalCostingValue;
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
            cell.alignment = colNum === 11 || colNum === 12 ? centerAlign : (colNum <= 10 ? leftAlign : rightAlign);

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
          brand: 'GRAND TOTALS',
          division: '',
          department: '',
          category: '',
          gender: '',
          silhouette: '',
          season: '',
          sku: '',
          barCode: '',
          itemName: '',
          size: '',
          color: '',
          unitPrice: '',
          discountRate: '',
          taxRate: '',
          availableStock: grandTotals.availableStock,
          reservedStock: grandTotals.reservedStock,
          totalStock: grandTotals.totalStock,
          availableValue: grandTotals.availableValue,
          reservedValue: grandTotals.reservedValue,
          totalValue: grandTotals.totalValue,
        };

        if (includeCosting) {
          grandTotalsData.unitCost = '';
          grandTotalsData.availableCostingValue = grandTotals.availableCostingValue;
          grandTotalsData.reservedCostingValue = grandTotals.reservedCostingValue;
          grandTotalsData.totalCostingValue = grandTotals.totalCostingValue;
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
          cell.alignment = colNum <= 12 ? leftAlign : rightAlign;

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

      if (node.level === 'article' || node.level === 'variant') {
        const costCells = includeCosting
          ? `<td class="num">${formatVal(tot.unitCost)}</td>
             <td class="num font-bold">${formatVal(tot.availableCostingValue)}</td>
             <td class="num font-bold">${formatVal(tot.reservedCostingValue)}</td>
             <td class="num font-bold">${formatVal(tot.totalCostingValue)}</td>`
          : '';

        rowsHtml += `
          <tr class="${node.level === 'article' ? 'article-row' : 'variant-row'}">
            <td>${node.brand || 'N/A'}</td>
            <td>${node.division || 'N/A'}</td>
            <td>${node.department || 'N/A'}</td>
            <td>${node.category || 'N/A'}</td>
            <td>${node.gender || 'N/A'}</td>
            <td>${node.silhouette || 'N/A'}</td>
            <td>${node.season || 'N/A'}</td>
            <td>${node.sku || 'N/A'}</td>
            <td>${node.barCode || 'N/A'}</td>
            <td>${node.itemName || 'N/A'}</td>
            <td class="center">${node.size || 'N/A'}</td>
            <td class="center">${node.color || 'N/A'}</td>
            <td class="num">${formatVal(tot.unitPrice)}</td>
            ${costCells}
            <td class="num">${tot.discountRate || 0}%</td>
            <td class="num">${tot.taxRate || 0}%</td>
            ${whCells}
            ${locCells}
            <td class="num font-bold">${formatVal(tot.availableStock)}</td>
            <td class="num font-bold">${formatVal(tot.reservedStock)}</td>
            <td class="num font-bold">${formatVal(tot.totalStock)}</td>
            <td class="num font-bold">${formatVal(tot.availableValue)}</td>
            <td class="num font-bold">${formatVal(tot.reservedValue)}</td>
            <td class="num font-bold">${formatVal(tot.totalValue)}</td>
          </tr>
        `;
      } else {
        const costCells = includeCosting
          ? `<td class="num">-</td>
             <td class="num font-bold">${formatVal(tot.availableCostingValue)}</td>
             <td class="num font-bold">${formatVal(tot.reservedCostingValue)}</td>
             <td class="num font-bold">${formatVal(tot.totalCostingValue)}</td>`
          : '';

        rowsHtml += `
          <tr class="${node.level}-row">
            <td colspan="12" style="font-weight: 800; text-transform: uppercase;">${node.level.toUpperCase()}: ${node.value}</td>
            <td class="num">-</td>
            ${costCells}
            <td class="num">-</td>
            <td class="num">-</td>
            ${whCells}
            ${locCells}
            <td class="num font-bold">${formatVal(tot.availableStock)}</td>
            <td class="num font-bold">${formatVal(tot.reservedStock)}</td>
            <td class="num font-bold">${formatVal(tot.totalStock)}</td>
            <td class="num font-bold">${formatVal(tot.availableValue)}</td>
            <td class="num font-bold">${formatVal(tot.reservedValue)}</td>
            <td class="num font-bold">${formatVal(tot.totalValue)}</td>
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
         <td class="num">${formatVal(grandTotals.availableCostingValue)}</td>
         <td class="num">${formatVal(grandTotals.reservedCostingValue)}</td>
         <td class="num">${formatVal(grandTotals.totalCostingValue)}</td>`
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
          .brand-row { background-color: #0f172a; color: #ffffff; }
          .division-row { background-color: #1e293b; color: #ffffff; }
          .category-row { background-color: #334155; color: #ffffff; }
          .gender-row { background-color: #475569; color: #ffffff; }
          .silhouette-row { background-color: #64748b; color: #ffffff; }
          .article-row { background-color: #f1f5f9; color: #0f172a; font-weight: 600; }
          .variant-row { background-color: #ffffff; color: #334155; }
          .grand-total-row { background-color: #e2e8f0; font-weight: 800; font-size: 8px; }
          .font-bold { font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Overall Available + Reserved Stock Report</h1>
        </div>
        <table>
          <thead>
            <tr>
              <th>Brand</th>
              <th>Division</th>
              <th>Dept</th>
              <th>Category</th>
              <th>Gender</th>
              <th>Silh</th>
              <th>Season</th>
              <th>SKU</th>
              <th>BarCode</th>
              <th>ItemName</th>
              <th class="center">Size</th>
              <th class="center">Color</th>
              <th class="num">UnitPrice</th>
              ${includeCosting ? '<th class="num">UnitCost</th><th class="num">Avail Cost</th><th class="num">Res Cost</th><th class="num">Tot Cost</th>' : ''}
              <th class="num">Disc %</th>
              <th class="num">Tax %</th>
              ${warehouses.map(w => `<th class="num">WH ${w.name}</th>`).join('')}
              ${stockLocations.map(l => `<th class="num">${l.shortCode || l.code || l.name}</th>`).join('')}
              <th class="num">Avail Qty</th>
              <th class="num">Res Qty</th>
              <th class="num">Tot Qty</th>
              <th class="num">Avail Val</th>
              <th class="num">Res Val</th>
              <th class="num">Tot Val</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            <tr class="grand-total-row">
              <td colspan="12">GRAND TOTALS</td>
              <td class="num">-</td>
              ${grandCostCells}
              <td class="num">-</td>
              <td class="num">-</td>
              ${grandWhCells}
              ${grandLocCells}
              <td class="num">${formatVal(grandTotals.availableStock)}</td>
              <td class="num">${formatVal(grandTotals.reservedStock)}</td>
              <td class="num">${formatVal(grandTotals.totalStock)}</td>
              <td class="num">${formatVal(grandTotals.availableValue)}</td>
              <td class="num">${formatVal(grandTotals.reservedValue)}</td>
              <td class="num">${formatVal(grandTotals.totalValue)}</td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `;
  }
}
