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
  PoRegisterExportService,
  PoRegisterReportResult,
} from './po-register-export.service';
import { runInBackground } from '../../common/utils/run-in-background.util';

export interface PoRegisterExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  brandId?: string;
  vendorId?: string;
  startDate?: string;
  endDate?: string;
  orderType?: string;
  goodsType?: string;
  status?: string;
  format: 'xlsx' | 'pdf';
  search?: string;
}

@Processor('po-register-export')
export class PoRegisterExportProcessor {
  private readonly logger = new Logger(PoRegisterExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly exportHistoryService: ExportHistoryService,
    private readonly poRegisterExportService: PoRegisterExportService,
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
  async handleExport(job: Job<PoRegisterExportJobData>): Promise<void> {
    const {
      jobId,
      userId,
      tenantId,
      tenantDbUrl,
      brandId,
      vendorId,
      startDate,
      endDate,
      orderType,
      goodsType,
      status,
      format,
      search,
    } = job.data;
    this.logger.log(`[PoRegisterExport ${jobId}] Starting ${format.toUpperCase()} export`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);
    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const ext = format === 'pdf' ? 'pdf' : 'xlsx';
    const fileName = `po-register-${new Date().toISOString().slice(0, 10)}.${ext}`;
    const filePath = path.join(exportDir, `export-${jobId}.${ext}`);

    try {
      await job.progress(10);

      const reportData = await this.poRegisterExportService.getReportData({
        brandId,
        vendorId,
        startDate,
        endDate,
        orderType,
        goodsType,
        status,
        search,
      });

      await job.progress(40);

      if (format === 'xlsx') {
        await this.generateExcel(filePath, reportData);
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
        'PO Register Export Notification',
        this.notificationsService.create({
          userId,
          title: 'Export Ready',
          message: `Purchase Order Register Report export (${format.toUpperCase()}) is ready for download.`,
          category: 'export',
          priority: 'normal',
        }),
      );
    } catch (err: any) {
      this.logger.error(`[PoRegisterExport ${jobId}] Failed: ${err.message}`, err.stack);
      try {
        await this.exportHistoryService.failExport(prisma as any, jobId);
      } catch (e: any) {
        this.logger.error(`Failed to update export history status to FAILED for job ${jobId}`);
      }
      throw err;
    }
  }

  private async generateExcel(filePath: string, reportData: PoRegisterReportResult): Promise<void> {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: filePath,
      useStyles: true,
      useSharedStrings: true,
    });

    const worksheet = workbook.addWorksheet('PO Register');

    worksheet.columns = [
      { header: 'GPC / Category / Product', key: 'description', width: 42 },
      { header: 'Color', key: 'color', width: 18 },
      { header: 'Size', key: 'size', width: 14 },
      { header: 'Quantity', key: 'quantity', width: 14 },
      { header: 'Unit Price', key: 'unitPrice', width: 16 },
      { header: 'Line Total', key: 'lineTotal', width: 18 },
    ];

    const borderThin = {
      top: { style: 'thin' as const },
      left: { style: 'thin' as const },
      bottom: { style: 'thin' as const },
      right: { style: 'thin' as const },
    };

    // Title Row
    const titleRow = worksheet.addRow(['Purchase Order Register', '', '', '', '', `${reportData.startDate} - ${reportData.endDate}`]);
    titleRow.height = 30;
    titleRow.getCell(1).font = { bold: true, color: { argb: 'FFCC0000' }, size: 14, underline: true };
    titleRow.getCell(6).font = { bold: true, color: { argb: 'FFCC0000' }, size: 11, underline: true };
    titleRow.commit();

    worksheet.addRow([]).commit();

    for (const brand of reportData.brands) {
      // Brand Header Row
      const brandRow = worksheet.addRow([`BRAND: ${brand.brandName}`]);
      brandRow.height = 26;
      const bCell = brandRow.getCell(1);
      bCell.font = { bold: true, color: { argb: 'FF005F5B' }, size: 13 };
      bCell.alignment = { horizontal: 'center' };
      brandRow.commit();

      for (const doc of brand.documents) {
        // Document Header Box Row
        const docBoxRow1 = worksheet.addRow([
          `Document #: ${doc.docNoDisplay} (${doc.poNumber})`,
          `Date: ${doc.orderDate}`,
          `Supplier: ${doc.supplierName} (${doc.supplierLocation})`,
          `Status: ${doc.status}`,
        ]);
        docBoxRow1.height = 24;
        docBoxRow1.getCell(1).font = { bold: true, color: { argb: 'FFCC0000' }, size: 11 };
        docBoxRow1.getCell(2).font = { bold: true, size: 10 };
        docBoxRow1.getCell(3).font = { bold: true, size: 10 };
        docBoxRow1.commit();

        // Header Labels
        const colHeaderRow = worksheet.addRow([
          'GPC / Category / Product',
          'Color',
          'Size',
          'Quantity',
          'Unit Price',
          'Line Total',
        ]);
        colHeaderRow.height = 22;
        for (let c = 1; c <= 6; c++) {
          const cell = colHeaderRow.getCell(c);
          cell.font = { bold: true, color: { argb: 'FF333333' } };
          cell.border = { bottom: { style: 'medium' } };
          if (c >= 4) cell.alignment = { horizontal: 'right' };
        }
        colHeaderRow.commit();

        for (const cat of doc.categories) {
          // Category Row (Green)
          const catRow = worksheet.addRow([cat.categoryName, '', '', cat.totalQuantity, '', cat.totalAmount]);
          catRow.height = 22;
          const catCell = catRow.getCell(1);
          catCell.font = { bold: true, color: { argb: 'FF008000' }, size: 11 };
          const catQtyCell = catRow.getCell(4);
          catQtyCell.font = { bold: true, color: { argb: 'FF008000' }, size: 11 };
          catQtyCell.alignment = { horizontal: 'right' };
          catQtyCell.numFmt = '#,##0';
          catRow.getCell(6).font = { bold: true, color: { argb: 'FF008000' } };
          catRow.getCell(6).numFmt = '#,##0.00';
          catRow.commit();

          for (const subCat of cat.subcategories) {
            // Subcategory Row (Purple)
            const subRow = worksheet.addRow([`  ${subCat.subCategoryName}`, '', '', subCat.totalQuantity, '', subCat.totalAmount]);
            subRow.height = 20;
            subRow.getCell(1).font = { bold: true, color: { argb: 'FF800080' }, size: 10 };
            const subQtyCell = subRow.getCell(4);
            subQtyCell.font = { bold: true, color: { argb: 'FF800080' }, size: 10 };
            subQtyCell.alignment = { horizontal: 'right' };
            subQtyCell.numFmt = '#,##0';
            subRow.getCell(6).font = { bold: true, color: { argb: 'FF800080' } };
            subRow.getCell(6).numFmt = '#,##0.00';
            subRow.commit();

            for (const prod of subCat.products) {
              // Product Row (Blue)
              const prodRow = worksheet.addRow([`    ${prod.articleCode} - ${prod.articleName}`, '', '', prod.totalQuantity, '', prod.totalAmount]);
              prodRow.height = 20;
              prodRow.getCell(1).font = { bold: true, color: { argb: 'FF0000FF' }, size: 10 };
              const prodQtyCell = prodRow.getCell(4);
              prodQtyCell.font = { bold: true, color: { argb: 'FF0000FF' }, size: 10 };
              prodQtyCell.alignment = { horizontal: 'right' };
              prodQtyCell.numFmt = '#,##0';
              prodRow.getCell(6).font = { bold: true, color: { argb: 'FF0000FF' } };
              prodRow.getCell(6).numFmt = '#,##0.00';
              prodRow.commit();

              // Variant Detail Rows
              for (const v of prod.variants) {
                const vRow = worksheet.addRow(['', v.color, v.size, v.quantity, v.unitPrice, v.lineTotal]);
                vRow.height = 18;
                vRow.getCell(2).alignment = { horizontal: 'center' };
                vRow.getCell(3).alignment = { horizontal: 'center' };
                vRow.getCell(4).alignment = { horizontal: 'right' };
                vRow.getCell(4).numFmt = '#,##0';
                vRow.getCell(5).alignment = { horizontal: 'right' };
                vRow.getCell(5).numFmt = '#,##0.00';
                vRow.getCell(6).alignment = { horizontal: 'right' };
                vRow.getCell(6).numFmt = '#,##0.00';
                for (let c = 1; c <= 6; c++) {
                  vRow.getCell(c).border = borderThin;
                }
                vRow.commit();
              }
            }
          }
        }

        // Document Total Row
        const docTotRow = worksheet.addRow([`Total for Document #${doc.docNoDisplay}`, '', '', doc.totalQuantity, '', doc.totalAmount]);
        docTotRow.height = 22;
        for (let c = 1; c <= 6; c++) {
          const cell = docTotRow.getCell(c);
          cell.font = { bold: true, size: 10, color: { argb: 'FFCC0000' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF0F0' } };
          cell.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
        }
        docTotRow.getCell(4).alignment = { horizontal: 'right' };
        docTotRow.getCell(4).numFmt = '#,##0';
        docTotRow.getCell(6).alignment = { horizontal: 'right' };
        docTotRow.getCell(6).numFmt = '#,##0.00';
        docTotRow.commit();

        worksheet.addRow([]).commit();
      }

      // Brand Total Row
      const brandTotRow = worksheet.addRow([`Total for ${brand.brandName}`, '', '', brand.totalQuantity, '', brand.totalAmount]);
      brandTotRow.height = 24;
      for (let c = 1; c <= 6; c++) {
        const cell = brandTotRow.getCell(c);
        cell.font = { bold: true, size: 11, color: { argb: 'FF005F5B' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2F1' } };
        cell.border = { top: { style: 'medium' }, bottom: { style: 'medium' } };
      }
      brandTotRow.getCell(4).alignment = { horizontal: 'right' };
      brandTotRow.getCell(4).numFmt = '#,##0';
      brandTotRow.getCell(6).alignment = { horizontal: 'right' };
      brandTotRow.getCell(6).numFmt = '#,##0.00';
      brandTotRow.commit();

      worksheet.addRow([]).commit();
    }

    // Grand Total Row
    const grandRow = worksheet.addRow(['GRAND TOTAL', '', '', reportData.grandTotals.quantity, '', reportData.grandTotals.amount]);
    grandRow.height = 26;
    for (let c = 1; c <= 6; c++) {
      const cell = grandRow.getCell(c);
      cell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      cell.border = borderThin;
    }
    grandRow.getCell(4).alignment = { horizontal: 'right' };
    grandRow.getCell(4).numFmt = '#,##0';
    grandRow.getCell(6).alignment = { horizontal: 'right' };
    grandRow.getCell(6).numFmt = '#,##0.00';
    grandRow.commit();

    await workbook.commit();
  }

  private async generatePdf(filePath: string, reportData: PoRegisterReportResult): Promise<void> {
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

  private buildHtmlReport(reportData: PoRegisterReportResult): string {
    const dateRangeStr = `${reportData.startDate} - ${reportData.endDate}`;

    let brandsHtml = '';

    for (const brand of reportData.brands) {
      let docsHtml = '';

      for (const doc of brand.documents) {
        let categoriesHtml = '';

        for (const cat of doc.categories) {
          let subCatsHtml = '';

          for (const subCat of cat.subcategories) {
            let prodsHtml = '';

            for (const prod of subCat.products) {
              let variantsHtml = '';

              for (const v of prod.variants) {
                variantsHtml += `
                  <tr class="variant-row">
                    <td style="padding-left: 60px;"></td>
                    <td class="text-center">${v.color}</td>
                    <td class="text-center">${v.size}</td>
                    <td class="text-right font-semibold">${v.quantity.toLocaleString()}</td>
                  </tr>
                `;
              }

              prodsHtml += `
                <tr class="prod-row">
                  <td class="prod-title" style="padding-left: 40px;">
                    <span class="prod-code">${prod.articleCode}</span>
                    <span class="prod-name">${prod.articleName}</span>
                  </td>
                  <td></td>
                  <td></td>
                  <td class="text-right prod-qty">${prod.totalQuantity.toLocaleString()}</td>
                </tr>
                ${variantsHtml}
              `;
            }

            subCatsHtml += `
              <tr class="subcat-row">
                <td class="subcat-title" style="padding-left: 20px;">${subCat.subCategoryName}</td>
                <td></td>
                <td></td>
                <td class="text-right subcat-qty">${subCat.totalQuantity.toLocaleString()}</td>
              </tr>
              ${prodsHtml}
            `;
          }

          categoriesHtml += `
            <tr class="cat-row">
              <td class="cat-title">${cat.categoryName}</td>
              <td></td>
              <td></td>
              <td class="text-right cat-qty">${cat.totalQuantity.toLocaleString()}</td>
            </tr>
            ${subCatsHtml}
          `;
        }

        docsHtml += `
          <div class="doc-block">
            <div class="doc-box">
              <div class="doc-box-item">
                <span class="lbl">Document #</span>
                <span class="doc-num">${doc.docNoDisplay}</span>
              </div>
              <div class="doc-box-item">
                <span class="lbl">Date</span>
                <span class="val">${doc.orderDate}</span>
              </div>
              <div class="doc-box-item flex-grow">
                <span class="lbl">Supplier</span>
                <span class="val">${doc.supplierName} <span class="loc">${doc.supplierLocation}</span></span>
              </div>
            </div>

            <table class="report-table">
              <colgroup>
                <col style="width: 55%;" />
                <col style="width: 20%;" />
                <col style="width: 12%;" />
                <col style="width: 13%;" />
              </colgroup>
              <thead>
                <tr>
                  <th class="text-left">GPC / Category / Product</th>
                  <th class="text-center">Color</th>
                  <th class="text-center">Size</th>
                  <th class="text-right">Quantity</th>
                </tr>
              </thead>
              <tbody>
                ${categoriesHtml}
              </tbody>
            </table>
          </div>
        `;
      }

      brandsHtml += `
        <div class="brand-block">
          <div class="brand-header">${brand.brandName}</div>
          ${docsHtml}
        </div>
      `;
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Purchase Order Register Report</title>
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

          .brand-block {
            margin-bottom: 24px;
            page-break-inside: avoid;
          }

          .brand-header {
            color: #006666;
            font-size: 16px;
            font-weight: bold;
            text-align: center;
            text-transform: uppercase;
            letter-spacing: 1px;
            border-bottom: 2px solid #006666;
            padding-bottom: 4px;
            margin-bottom: 12px;
          }

          .doc-block {
            margin-bottom: 16px;
          }

          .doc-box {
            display: flex;
            border: 1.5px solid #000;
            padding: 4px 8px;
            margin-bottom: 8px;
            align-items: center;
            gap: 24px;
            background-color: #fafafa;
          }

          .doc-box-item {
            display: flex;
            flex-direction: column;
          }

          .doc-box-item.flex-grow { flex-grow: 1; }

          .doc-box-item .lbl {
            font-size: 9px;
            font-weight: bold;
            color: #374151;
            text-transform: uppercase;
          }

          .doc-box-item .doc-num {
            color: #cc0000;
            font-size: 14px;
            font-weight: bold;
            text-decoration: underline;
          }

          .doc-box-item .val {
            font-size: 11px;
            font-weight: bold;
          }

          .doc-box-item .loc {
            font-weight: normal;
            color: #4b5563;
            margin-left: 8px;
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

          .subcat-row {
            page-break-inside: avoid;
            border-bottom: 1px solid #f3f4f6;
          }

          .subcat-title {
            color: #800080;
            font-size: 11px;
            font-weight: bold;
            text-transform: uppercase;
          }

          .subcat-qty {
            color: #800080;
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

          .variant-row:nth-child(even) {
            background-color: #f9fafb;
          }

          .text-left { text-align: left; }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .font-semibold { font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="header-banner">
          <span class="report-title">Purchase Order Register</span>
          <span class="date-range">${dateRangeStr}</span>
        </div>
        ${brandsHtml}
      </body>
      </html>
    `;
  }
}
