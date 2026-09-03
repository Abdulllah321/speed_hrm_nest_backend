import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import * as puppeteer from 'puppeteer';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ExportHistoryService } from '../../warehouse/export-history/export-history.service';
import {
  PurchaseReturnRegisterExportService,
  PurchaseReturnRegisterReportResult,
} from './purchase-return-register-export.service';
import { runInBackground } from '../../common/utils/run-in-background.util';

export interface PurchaseReturnRegisterExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  brandId?: string;
  supplierId?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  returnType?: string;
  sourceType?: string;
  format: 'xlsx' | 'pdf';
  exportType?: 'hierarchical' | 'flat';
  search?: string;
}

@Processor('purchase-return-register-export')
export class PurchaseReturnRegisterExportProcessor {
  private readonly logger = new Logger(PurchaseReturnRegisterExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly exportHistoryService: ExportHistoryService,
    private readonly purchaseReturnRegisterExportService: PurchaseReturnRegisterExportService,
  ) {
    if (process.platform === 'linux') {
      try {
        const { exec } = require('child_process');
        exec(
          'apt-get update && apt-get install -y libatk1.0-0 libatk-bridge2.0-0 libcups2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpangocairo-1.0-0 libasound2 libnss3 libxshmfence1 libgtk-3-0',
          () => {},
        );
      } catch (e: any) {
        this.logger.warn(`Error installing Chromium dependencies: ${e.message}`);
      }
    }
  }

  @Process({ concurrency: 1 })
  async handleExport(job: Job<PurchaseReturnRegisterExportJobData>): Promise<void> {
    const {
      jobId,
      userId,
      tenantId,
      tenantDbUrl,
      brandId,
      supplierId,
      startDate,
      endDate,
      status,
      returnType,
      sourceType,
      format,
      exportType,
      search,
    } = job.data;
    this.logger.log(`[PurchaseReturnRegisterExport ${jobId}] Starting ${format.toUpperCase()} (${exportType || 'hierarchical'}) export`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);
    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const ext = format === 'pdf' ? 'pdf' : 'xlsx';
    const fileName = `purchase-return-register-${new Date().toISOString().slice(0, 10)}.${ext}`;
    const filePath = path.join(exportDir, `export-${jobId}.${ext}`);

    try {
      await job.progress(10);

      const reportData = await this.purchaseReturnRegisterExportService.getReportData(
        {
          brandId,
          supplierId,
          startDate,
          endDate,
          status,
          returnType,
          sourceType,
          search,
        },
        prisma,
      );

      await job.progress(40);

      if (format === 'xlsx') {
        if (exportType === 'flat') {
          await this.generateFlatExcel(filePath, reportData);
        } else {
          await this.generateExcel(filePath, reportData);
        }
      } else {
        await this.generatePdf(filePath, reportData);
      }

      await job.progress(90);

      const mimeType =
        format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

      await this.exportHistoryService.completeAndUploadExport(
        prisma as any,
        jobId,
        filePath,
        fileName,
        mimeType,
      );

      await job.progress(100);

      runInBackground(
        'Purchase Return Register Export Notification',
        this.notificationsService.create({
          userId,
          title: 'Export Ready',
          message: `Purchase Return Register Report export (${format.toUpperCase()}) is ready for download.`,
          category: 'export',
          priority: 'normal',
        }),
      );
    } catch (err: any) {
      this.logger.error(`[PurchaseReturnRegisterExport ${jobId}] Failed: ${err.message}`, err.stack);
      try {
        await this.exportHistoryService.failExport(prisma as any, jobId);
      } catch (e: any) {
        this.logger.error(`Failed to update export history status to FAILED for job ${jobId}`);
      }
      throw err;
    }
  }

  private async generateExcel(filePath: string, reportData: PurchaseReturnRegisterReportResult): Promise<void> {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: filePath,
      useStyles: true,
      useSharedStrings: true,
    });

    const worksheet = workbook.addWorksheet('Purchase Return Register');

    worksheet.columns = [
      { header: 'Product Description / SKU', key: 'description', width: 38 },
      { header: 'Color', key: 'color', width: 14 },
      { header: 'Size', key: 'size', width: 10 },
      { header: 'Barcode', key: 'barCode', width: 16 },
      { header: 'Return Qty', key: 'returnQty', width: 12 },
      { header: 'Unit Price', key: 'unitPrice', width: 14 },
      { header: 'Val Excl Tax', key: 'valExclTax', width: 16 },
      { header: 'Sales Tax', key: 'salesTax', width: 14 },
      { header: 'Val Incl Tax', key: 'valInclTax', width: 16 },
      { header: 'Adv Tax', key: 'advTax', width: 14 },
      { header: 'Line Total', key: 'lineTotal', width: 18 },
    ];

    const borderThin = {
      top: { style: 'thin' as const },
      left: { style: 'thin' as const },
      bottom: { style: 'thin' as const },
      right: { style: 'thin' as const },
    };

    // Title Row
    const titleRow = worksheet.addRow(['Purchase Return Register', '', '', '', '', '', '', '', '', '', `${reportData.startDate} - ${reportData.endDate}`]);
    titleRow.height = 30;
    titleRow.getCell(1).font = { bold: true, color: { argb: 'FFCC0000' }, size: 14, underline: true };
    titleRow.getCell(11).font = { bold: true, color: { argb: 'FFCC0000' }, size: 11, underline: true };
    titleRow.commit();

    worksheet.addRow([]).commit();

    for (const doc of reportData.documents) {
      // Document Box Header Row
      const docBoxRow = worksheet.addRow([
        `Return #: ${doc.returnNumber}`,
        `Brands: ${doc.brandsDisplay}`,
        `Date: ${doc.returnDate}`,
        `Supplier: ${doc.supplierName} (${doc.supplierLocation})`,
        `Type: ${doc.returnType}`,
        `Status: ${doc.status}`,
        '',
        '',
        '',
        '',
        '',
      ]);
      docBoxRow.height = 26;
      docBoxRow.getCell(1).font = { bold: true, color: { argb: 'FFCC0000' }, size: 11 };
      docBoxRow.getCell(2).font = { bold: true, color: { argb: 'FF005F5B' }, size: 11 };
      docBoxRow.getCell(3).font = { bold: true, size: 10 };
      docBoxRow.getCell(4).font = { bold: true, size: 10 };
      docBoxRow.getCell(5).font = { bold: true, color: { argb: 'FF0284C7' }, size: 10 };
      docBoxRow.commit();

      // Table Headers
      const colHeaderRow = worksheet.addRow([
        'Product Description / SKU',
        'Color',
        'Size',
        'Barcode',
        'Return Qty',
        'Unit Price',
        'Val Excl Tax',
        'Sales Tax',
        'Val Incl Tax',
        'Adv Tax',
        'Line Total',
      ]);
      colHeaderRow.height = 22;
      for (let c = 1; c <= 11; c++) {
        const cell = colHeaderRow.getCell(c);
        cell.font = { bold: true, color: { argb: 'FF333333' } };
        cell.border = { bottom: { style: 'medium' } };
        if (c >= 5) cell.alignment = { horizontal: 'right' };
      }
      colHeaderRow.commit();

      for (const div of doc.divisions) {
        for (const cat of div.categories) {
          // Category Row (Green)
          const catRow = worksheet.addRow([
            `Category: ${cat.categoryName}`,
            '',
            '',
            '',
            cat.totalQuantity,
            '',
            cat.totalValExclTax,
            cat.totalSalesTax,
            cat.totalValInclTax,
            cat.totalAdvTax,
            cat.totalLineTotal,
          ]);
          catRow.height = 22;
          catRow.getCell(1).font = { bold: true, color: { argb: 'FF008000' }, size: 11 };
          catRow.getCell(5).font = { bold: true, color: { argb: 'FF008000' } };
          catRow.getCell(5).alignment = { horizontal: 'right' };
          catRow.getCell(5).numFmt = '#,##0';
          for (const colIdx of [7, 8, 9, 10, 11]) {
            catRow.getCell(colIdx).font = { bold: true, color: { argb: 'FF008000' } };
            catRow.getCell(colIdx).alignment = { horizontal: 'right' };
            catRow.getCell(colIdx).numFmt = '#,##0';
          }
          catRow.commit();

          for (const gen of cat.genders) {
            for (const sil of gen.silhouettes) {
              for (const art of sil.articles) {
                // Article Row (Blue, SKU & Description)
                const artRow = worksheet.addRow([
                  `  SKU: ${art.sku} - ${art.description}`,
                  '',
                  '',
                  '',
                  art.totalQuantity,
                  '',
                  art.totalValExclTax,
                  art.totalSalesTax,
                  art.totalValInclTax,
                  art.totalAdvTax,
                  art.totalLineTotal,
                ]);
                artRow.height = 20;
                artRow.getCell(1).font = { bold: true, color: { argb: 'FF0000FF' }, size: 10 };
                artRow.getCell(5).font = { bold: true, color: { argb: 'FF0000FF' } };
                artRow.getCell(5).alignment = { horizontal: 'right' };
                artRow.getCell(5).numFmt = '#,##0';
                for (const colIdx of [7, 8, 9, 10, 11]) {
                  artRow.getCell(colIdx).font = { bold: true, color: { argb: 'FF0000FF' } };
                  artRow.getCell(colIdx).alignment = { horizontal: 'right' };
                  artRow.getCell(colIdx).numFmt = '#,##0';
                }
                artRow.commit();

                // Variant Detail Rows
                for (const v of art.variants) {
                  const vRow = worksheet.addRow([
                    '',
                    v.color,
                    v.size,
                    v.barCode,
                    v.returnQty,
                    v.unitPrice,
                    v.valExclTax,
                    v.salesTax,
                    v.valInclTax,
                    v.advTax,
                    v.lineTotal,
                  ]);
                  vRow.height = 18;
                  vRow.getCell(2).alignment = { horizontal: 'center' };
                  vRow.getCell(3).alignment = { horizontal: 'center' };
                  vRow.getCell(4).alignment = { horizontal: 'center' };
                  vRow.getCell(5).alignment = { horizontal: 'right' };
                  vRow.getCell(5).numFmt = '#,##0';
                  for (const colIdx of [6, 7, 8, 9, 10, 11]) {
                    vRow.getCell(colIdx).alignment = { horizontal: 'right' };
                    vRow.getCell(colIdx).numFmt = '#,##0';
                  }
                  for (let c = 1; c <= 11; c++) {
                    vRow.getCell(c).border = borderThin;
                  }
                  vRow.commit();
                }
              }
            }
          }
        }
      }

      // Document Total Row
      const docTotRow = worksheet.addRow([
        `Total for Return #${doc.returnNumber}`,
        '',
        '',
        '',
        doc.totalQuantity,
        '',
        doc.totalValExclTax,
        doc.totalSalesTax,
        doc.totalValInclTax,
        doc.totalAdvTax,
        doc.totalLineTotal,
      ]);
      docTotRow.height = 22;
      for (let c = 1; c <= 11; c++) {
        const cell = docTotRow.getCell(c);
        cell.font = { bold: true, size: 10, color: { argb: 'FFCC0000' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF0F0' } };
        cell.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
      }
      docTotRow.getCell(5).alignment = { horizontal: 'right' };
      docTotRow.getCell(5).numFmt = '#,##0';
      for (const colIdx of [7, 8, 9, 10, 11]) {
        docTotRow.getCell(colIdx).alignment = { horizontal: 'right' };
        docTotRow.getCell(colIdx).numFmt = '#,##0';
      }
      docTotRow.commit();

      worksheet.addRow([]).commit();
    }

    // Grand Total Row
    const grandRow = worksheet.addRow([
      'GRAND TOTAL',
      '',
      '',
      '',
      reportData.grandTotals.quantity,
      '',
      reportData.grandTotals.valExclTax,
      reportData.grandTotals.salesTax,
      reportData.grandTotals.valInclTax,
      reportData.grandTotals.advTax,
      reportData.grandTotals.lineTotal,
    ]);
    grandRow.height = 26;
    for (let c = 1; c <= 11; c++) {
      const cell = grandRow.getCell(c);
      cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      cell.border = borderThin;
    }
    grandRow.getCell(5).alignment = { horizontal: 'right' };
    grandRow.getCell(5).numFmt = '#,##0';
    for (const colIdx of [7, 8, 9, 10, 11]) {
      grandRow.getCell(colIdx).alignment = { horizontal: 'right' };
      grandRow.getCell(colIdx).numFmt = '#,##0';
    }
    grandRow.commit();

    await workbook.commit();
  }

  private async generateFlatExcel(filePath: string, reportData: PurchaseReturnRegisterReportResult): Promise<void> {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: filePath,
      useStyles: true,
      useSharedStrings: true,
    });

    const worksheet = workbook.addWorksheet('Purchase Return Register Flat');

    worksheet.columns = [
      { header: 'Return #', key: 'returnNumber', width: 16 },
      { header: 'Return Date', key: 'returnDate', width: 14 },
      { header: 'Supplier Name', key: 'supplierName', width: 28 },
      { header: 'Supplier Location', key: 'supplierLocation', width: 20 },
      { header: 'GRN #', key: 'grnNumber', width: 16 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Source Type', key: 'sourceType', width: 16 },
      { header: 'Return Type', key: 'returnType', width: 16 },
      { header: 'Brand', key: 'brand', width: 18 },
      { header: 'Division', key: 'division', width: 14 },
      { header: 'Category', key: 'category', width: 18 },
      { header: 'SubCategory', key: 'subCategory', width: 18 },
      { header: 'Gender', key: 'gender', width: 12 },
      { header: 'Silhouette', key: 'silhouette', width: 14 },
      { header: 'SKU', key: 'sku', width: 16 },
      { header: 'Product Description', key: 'description', width: 32 },
      { header: 'Color', key: 'color', width: 14 },
      { header: 'Size', key: 'size', width: 10 },
      { header: 'Barcode', key: 'barCode', width: 18 },
      { header: 'Return Qty', key: 'returnQty', width: 14 },
      { header: 'Unit Price', key: 'unitPrice', width: 16 },
      { header: 'Val Excl Tax', key: 'valExclTax', width: 16 },
      { header: 'Sales Tax', key: 'salesTax', width: 14 },
      { header: 'Val Incl Tax', key: 'valInclTax', width: 16 },
      { header: 'Adv Tax', key: 'advTax', width: 14 },
      { header: 'Line Total', key: 'lineTotal', width: 18 },
    ];

    const borderThin = {
      top: { style: 'thin' as const },
      left: { style: 'thin' as const },
      bottom: { style: 'thin' as const },
      right: { style: 'thin' as const },
    };

    // Title Row
    const titleRow = worksheet.addRow(['Purchase Return Register (Flat Data)', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', `${reportData.startDate} - ${reportData.endDate}`]);
    titleRow.height = 30;
    titleRow.getCell(1).font = { bold: true, color: { argb: 'FFCC0000' }, size: 14, underline: true };
    titleRow.getCell(26).font = { bold: true, color: { argb: 'FFCC0000' }, size: 11, underline: true };
    titleRow.commit();

    worksheet.addRow([]).commit();

    // Headers Row
    const colHeaderRow = worksheet.addRow([
      'Return #',
      'Return Date',
      'Supplier Name',
      'Supplier Location',
      'GRN #',
      'Status',
      'Source Type',
      'Return Type',
      'Brand',
      'Division',
      'Category',
      'SubCategory',
      'Gender',
      'Silhouette',
      'SKU',
      'Product Description',
      'Color',
      'Size',
      'Barcode',
      'Return Qty',
      'Unit Price',
      'Val Excl Tax',
      'Sales Tax',
      'Val Incl Tax',
      'Adv Tax',
      'Line Total',
    ]);
    colHeaderRow.height = 24;
    for (let c = 1; c <= 26; c++) {
      const cell = colHeaderRow.getCell(c);
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.border = borderThin;
      if (c >= 20) cell.alignment = { horizontal: 'right' };
      else if (c >= 17 && c <= 19) cell.alignment = { horizontal: 'center' };
      else cell.alignment = { horizontal: 'left' };
    }
    colHeaderRow.commit();

    for (const doc of reportData.documents) {
      for (const div of doc.divisions) {
        for (const cat of div.categories) {
          for (const gen of cat.genders) {
            for (const sil of gen.silhouettes) {
              for (const art of sil.articles) {
                for (const v of art.variants) {
                  const row = worksheet.addRow([
                    doc.returnNumber,
                    doc.returnDate,
                    doc.supplierName,
                    doc.supplierLocation,
                    doc.grnNumber || 'N/A',
                    doc.status,
                    doc.sourceType,
                    doc.returnType,
                    doc.brandsDisplay,
                    div.divisionName,
                    cat.categoryName,
                    cat.subCategoryName || 'N/A',
                    gen.genderName,
                    sil.silhouetteName,
                    art.sku,
                    art.description,
                    v.color,
                    v.size,
                    v.barCode,
                    v.returnQty,
                    v.unitPrice,
                    v.valExclTax,
                    v.salesTax,
                    v.valInclTax,
                    v.advTax,
                    v.lineTotal,
                  ]);
                  row.height = 19;
                  for (let c = 1; c <= 26; c++) {
                    const cell = row.getCell(c);
                    cell.border = borderThin;
                    if (c >= 17 && c <= 19) cell.alignment = { horizontal: 'center' };
                    else if (c >= 20) {
                      cell.alignment = { horizontal: 'right' };
                      if (c === 20) cell.numFmt = '#,##0';
                      else cell.numFmt = '#,##0.00';
                    } else {
                      cell.alignment = { horizontal: 'left' };
                    }
                  }
                  row.commit();
                }
              }
            }
          }
        }
      }
    }

    // Grand Total Row
    const grandRow = worksheet.addRow([
      'GRAND TOTAL',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      reportData.grandTotals.quantity,
      '',
      reportData.grandTotals.valExclTax,
      reportData.grandTotals.salesTax,
      reportData.grandTotals.valInclTax,
      reportData.grandTotals.advTax,
      reportData.grandTotals.lineTotal,
    ]);
    grandRow.height = 26;
    for (let c = 1; c <= 26; c++) {
      const cell = grandRow.getCell(c);
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      cell.border = borderThin;
    }
    grandRow.getCell(20).alignment = { horizontal: 'right' };
    grandRow.getCell(20).numFmt = '#,##0';
    for (const colIdx of [22, 23, 24, 25, 26]) {
      grandRow.getCell(colIdx).alignment = { horizontal: 'right' };
      grandRow.getCell(colIdx).numFmt = '#,##0.00';
    }
    grandRow.commit();

    await workbook.commit();
  }

  private async generatePdf(filePath: string, reportData: PurchaseReturnRegisterReportResult): Promise<void> {
    const launchArgs =
      process.platform === 'linux'
        ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--no-zygote']
        : [];

    const browser = await puppeteer.launch({
      headless: true,
      args: launchArgs,
    });

    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(0);
      page.setDefaultNavigationTimeout(0);

      const html = this.buildHtmlReport(reportData);
      await page.setContent(html, { waitUntil: 'domcontentloaded' });

      await page.pdf({
        path: filePath,
        format: 'A4',
        landscape: true,
        printBackground: true,
        margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
      });
    } finally {
      await browser.close();
    }
  }

  private buildHtmlReport(reportData: PurchaseReturnRegisterReportResult): string {
    const dateRangeStr = `${reportData.startDate} - ${reportData.endDate}`;

    let docsHtml = '';

    for (const doc of reportData.documents) {
      let divHtml = '';

      for (const div of doc.divisions) {
        let catHtml = '';

        for (const cat of div.categories) {
          let genHtml = '';

          for (const gen of cat.genders) {
            let silHtml = '';

            for (const sil of gen.silhouettes) {
              let artHtml = '';

              for (const art of sil.articles) {
                let variantHtml = '';

                for (const v of art.variants) {
                  variantHtml += `
                    <tr class="variant-row">
                      <td style="padding-left: 60px;"></td>
                      <td class="text-center">${v.color}</td>
                      <td class="text-center">${v.size}</td>
                      <td class="text-center text-slate-500">${v.barCode}</td>
                      <td class="text-right font-semibold">${v.returnQty.toLocaleString()}</td>
                      <td class="text-right">${v.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td class="text-right">${v.valExclTax.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td class="text-right">${v.salesTax.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td class="text-right">${v.valInclTax.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td class="text-right">${v.advTax.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td class="text-right font-bold text-emerald-600">${v.lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    </tr>
                  `;
                }

                artHtml += `
                  <tr class="prod-row">
                    <td class="prod-title" style="padding-left: 40px;">
                      <span class="prod-code">SKU: ${art.sku}</span>
                      <span class="prod-name">${art.description}</span>
                    </td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td class="text-right prod-qty">${art.totalQuantity.toLocaleString()}</td>
                    <td></td>
                    <td class="text-right font-bold text-blue-600">${art.totalValExclTax.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td class="text-right font-bold text-blue-600">${art.totalSalesTax.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td class="text-right font-bold text-blue-600">${art.totalValInclTax.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td class="text-right font-bold text-blue-600">${art.totalAdvTax.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td class="text-right font-bold text-blue-600">${art.totalLineTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  </tr>
                  ${variantHtml}
                `;
              }

              silHtml += artHtml;
            }

            genHtml += silHtml;
          }

          catHtml += `
            <tr class="cat-row">
              <td class="cat-title">${cat.categoryName}</td>
              <td></td>
              <td></td>
              <td></td>
              <td class="text-right cat-qty">${cat.totalQuantity.toLocaleString()}</td>
              <td></td>
              <td class="text-right cat-qty">${cat.totalValExclTax.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
              <td class="text-right cat-qty">${cat.totalSalesTax.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
              <td class="text-right cat-qty">${cat.totalValInclTax.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
              <td class="text-right cat-qty">${cat.totalAdvTax.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
              <td class="text-right cat-qty">${cat.totalLineTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            </tr>
            ${genHtml}
          `;
        }

        divHtml += catHtml;
      }

      docsHtml += `
        <div class="doc-block">
          <div class="doc-box">
            <div class="doc-box-item">
              <span class="lbl">Return Number</span>
              <span class="doc-num">${doc.returnNumber}</span>
            </div>
            <div class="doc-box-item">
              <span class="lbl">Brands</span>
              <span class="brand-display">${doc.brandsDisplay}</span>
            </div>
            <div class="doc-box-item">
              <span class="lbl">Date</span>
              <span class="val">${doc.returnDate}</span>
            </div>
            <div class="doc-box-item">
              <span class="lbl">Supplier</span>
              <span class="val">${doc.supplierName} <span class="loc">(${doc.supplierLocation})</span></span>
            </div>
            <div class="doc-box-item">
              <span class="lbl">Return Type</span>
              <span class="val">${doc.returnType}</span>
            </div>
            <div class="doc-box-item">
              <span class="lbl">Status</span>
              <span class="val">${doc.status}</span>
            </div>
          </div>

          <table class="report-table">
            <colgroup>
              <col style="width: 24%;" />
              <col style="width: 8%;" />
              <col style="width: 6%;" />
              <col style="width: 9%;" />
              <col style="width: 6%;" />
              <col style="width: 8%;" />
              <col style="width: 9%;" />
              <col style="width: 8%;" />
              <col style="width: 9%;" />
              <col style="width: 5%;" />
              <col style="width: 8%;" />
            </colgroup>
            <thead>
              <tr>
                <th class="text-left">Product Description / SKU</th>
                <th class="text-center">Color</th>
                <th class="text-center">Size</th>
                <th class="text-center">Barcode</th>
                <th class="text-right">Return Qty</th>
                <th class="text-right">Unit Price</th>
                <th class="text-right">Val Excl Tax</th>
                <th class="text-right">Sales Tax</th>
                <th class="text-right">Val Incl Tax</th>
                <th class="text-right">Adv Tax</th>
                <th class="text-right">Line Total</th>
              </tr>
            </thead>
            <tbody>
              ${divHtml}
            </tbody>
          </table>
        </div>
      `;
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Purchase Return Register Report</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: Arial, Helvetica, sans-serif;
            font-size: 11px;
            color: #111827;
            padding: 10px;
            background: #fff;
          }

          .header-banner {
            position: relative;
            text-align: center;
            margin-bottom: 16px;
          }

          .report-title {
            color: #cc0000;
            font-size: 16px;
            font-weight: bold;
            text-decoration: underline;
            display: inline-block;
          }

          .date-range {
            position: absolute;
            right: 0;
            top: 0;
            color: #cc0000;
            font-size: 13px;
            font-weight: bold;
            text-decoration: underline;
          }

          .doc-block {
            margin-bottom: 20px;
            page-break-inside: avoid;
          }

          .doc-box {
            display: flex;
            border: 1.5px solid #000;
            padding: 4px 8px;
            margin-bottom: 8px;
            align-items: center;
            gap: 16px;
            background-color: #fafafa;
          }

          .doc-box-item {
            display: flex;
            flex-direction: column;
          }

          .doc-box-item .lbl {
            font-size: 9px;
            font-weight: bold;
            color: #374151;
            text-transform: uppercase;
          }

          .doc-box-item .doc-num {
            color: #cc0000;
            font-size: 13px;
            font-weight: bold;
          }

          .doc-box-item .brand-display {
            color: #006666;
            font-size: 12px;
            font-weight: bold;
            text-transform: uppercase;
          }

          .doc-box-item .val {
            font-size: 11px;
            font-weight: bold;
          }

          .doc-box-item .loc {
            font-weight: normal;
            color: #4b5563;
          }

          .report-table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }

          .report-table th {
            font-size: 10px;
            font-weight: bold;
            color: #111827;
            border-bottom: 1.5px solid #000;
            padding: 4px 6px;
          }

          .report-table td {
            padding: 3px 6px;
            vertical-align: middle;
          }

          .cat-row {
            page-break-inside: avoid;
            border-bottom: 1px solid #e5e7eb;
          }

          .cat-title {
            color: #008000;
            font-size: 11px;
            font-weight: bold;
            text-transform: uppercase;
          }

          .cat-qty {
            color: #008000;
            font-weight: bold;
            font-size: 11px;
          }

          .prod-row {
            page-break-inside: avoid;
          }

          .prod-code {
            color: #0000ff;
            font-weight: bold;
            display: block;
          }

          .prod-name {
            color: #0000ff;
            font-weight: bold;
            display: block;
            font-size: 10px;
          }

          .prod-qty {
            color: #0000ff;
            font-weight: bold;
            font-size: 11px;
          }

          .variant-row {
            background-color: #ffffff;
            border-bottom: 1px solid #f9fafb;
          }

          .text-left { text-align: left; }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .font-semibold { font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="header-banner">
          <span class="report-title">Purchase Return Register</span>
          <span class="date-range">${dateRangeStr}</span>
        </div>
        ${docsHtml}
      </body>
      </html>
    `;
  }
}
