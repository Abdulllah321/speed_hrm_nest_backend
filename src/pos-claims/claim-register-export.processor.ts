import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import * as puppeteer from 'puppeteer';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ExportHistoryService } from '../warehouse/export-history/export-history.service';
import { ClaimRegisterExportService } from './claim-register-export.service';

export interface ClaimRegisterExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  locationId?: string;
  startDate?: string;
  endDate?: string;
  format: 'xlsx' | 'pdf';
  search?: string;
}

const COLUMNS = [
  { header: 'Base CM Number', key: 'baseCmNumber', width: 16 },
  { header: 'Base CM Date', key: 'baseCmDate', width: 14 },
  { header: 'Claim Number', key: 'claimNumber', width: 16 },
  { header: 'Claim Date', key: 'claimDate', width: 14 },
  { header: 'Settled Inv Number', key: 'settledInvNumber', width: 18 },
  { header: 'Settled Date', key: 'settledDate', width: 14 },
  { header: 'Product Description', key: 'productDescription', width: 28 },
  { header: 'Product', key: 'productSku', width: 16 },
  { header: 'Size', key: 'size', width: 10, align: 'center' },
  { header: 'HS Code', key: 'hsCode', width: 14, align: 'center' },
  { header: 'Quantity', key: 'quantity', width: 12, align: 'right', numFmt: '#,##0' },
  { header: 'Unit Price', key: 'unitPrice', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Tax %', key: 'taxPercent', width: 10, align: 'right', numFmt: '#,##0.00' },
  { header: 'Unit Price WOT', key: 'unitPriceWot', width: 16, align: 'right', numFmt: '#,##0.00' },
  { header: 'Sub Total', key: 'subTotal', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Discount Amount', key: 'discountAmount', width: 16, align: 'right', numFmt: '#,##0.00' },
  { header: 'Tax Amount', key: 'taxAmount', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Net Total', key: 'netTotal', width: 16, align: 'right', numFmt: '#,##0.00' },
];

@Processor('claim-register-export')
export class ClaimRegisterExportProcessor {
  private readonly logger = new Logger(ClaimRegisterExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly exportHistoryService: ExportHistoryService,
    private readonly claimRegisterExportService: ClaimRegisterExportService,
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
  async handleExport(job: Job<ClaimRegisterExportJobData>): Promise<void> {
    const { jobId, userId, tenantId, tenantDbUrl, locationId, startDate, endDate, format, search } = job.data;
    this.logger.log(`[ClaimRegisterExport ${jobId}] Starting ${format.toUpperCase()} export`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);
    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const ext = format === 'pdf' ? 'pdf' : 'xlsx';
    const fileName = `claim-register-${new Date().toISOString().slice(0, 10)}.${ext}`;
    const filePath = path.join(exportDir, `export-${jobId}.${ext}`);

    try {
      await job.progress(10);

      const reportData = await this.claimRegisterExportService.getReportData({
        locationId,
        startDate,
        endDate,
        search,
      });

      await job.progress(40);

      if (format === 'xlsx') {
        await this.generateExcel(filePath, reportData);
      } else {
        await this.generatePdf(filePath, reportData);
      }

      await job.progress(90);

      const mimeType = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

      await this.exportHistoryService.completeAndUploadExport(
        prisma as any,
        jobId,
        filePath,
        fileName,
        mimeType,
      );

      await job.progress(100);

      runInBackground(
        this.notificationsService.create({
          userId,
          title: 'Export Ready',
          message: `Claim Register Report export (${format.toUpperCase()}) is ready for download.`,
          category: 'export',
          priority: 'normal',
        }),
      );
    } catch (err: any) {
      this.logger.error(`[ClaimRegisterExport ${jobId}] Failed: ${err.message}`, err.stack);
      try {
        await this.exportHistoryService.failExport(prisma as any, jobId);
      } catch (e: any) {
        this.logger.error(`Failed to update export history status to FAILED for job ${jobId}`);
      }
      throw err;
    }
  }

  private async generateExcel(filePath: string, reportData: any): Promise<void> {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: filePath,
      useStyles: true,
      useSharedStrings: true,
    });

    const worksheet = workbook.addWorksheet('Claim Register');

    worksheet.columns = COLUMNS.map((col) => ({
      header: col.header,
      key: col.key,
      width: col.width,
    }));

    const borderThin = {
      top: { style: 'thin' as const },
      left: { style: 'thin' as const },
      bottom: { style: 'thin' as const },
      right: { style: 'thin' as const },
    };

    const headerRow = worksheet.getRow(1);
    headerRow.height = 28;
    for (let c = 1; c <= COLUMNS.length; c++) {
      const cell = headerRow.getCell(c);
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E293B' },
      };
      cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
      cell.border = borderThin;
      cell.alignment = { vertical: 'middle', horizontal: (COLUMNS[c - 1].align as any) || 'left' };
    }
    headerRow.commit();

    for (const outlet of reportData.outlets) {
      const outletRow = worksheet.addRow([`Outlet: ${outlet.locationName}`]);
      outletRow.height = 24;
      const outletCell = outletRow.getCell(1);
      outletCell.font = { bold: true, color: { argb: 'FF0F172A' }, size: 11 };
      outletRow.commit();

      for (const claimGroup of outlet.claims) {
        for (const item of claimGroup.items) {
          const row = worksheet.addRow({
            baseCmNumber: item.baseCmNumber,
            baseCmDate: item.baseCmDate,
            claimNumber: item.claimNumber,
            claimDate: item.claimDate,
            settledInvNumber: item.settledInvNumber,
            settledDate: item.settledDate,
            productDescription: item.productDescription,
            productSku: item.productSku,
            size: item.size,
            hsCode: item.hsCode,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxPercent: item.taxPercent,
            unitPriceWot: item.unitPriceWot,
            subTotal: item.subTotal,
            discountAmount: item.discountAmount,
            taxAmount: item.taxAmount,
            netTotal: item.netTotal,
          });

          for (let c = 1; c <= COLUMNS.length; c++) {
            const cell = row.getCell(c);
            cell.border = borderThin;
            const col = COLUMNS[c - 1];
            if (col.align) cell.alignment = { horizontal: col.align as any };
            if (col.numFmt) cell.numFmt = col.numFmt;
          }
          row.commit();
        }

        const claimSubRow = worksheet.addRow({
          size: `Claim #: ${claimGroup.claimNumber}`,
          quantity: claimGroup.totals.quantity,
          subTotal: claimGroup.totals.subTotal,
          discountAmount: claimGroup.totals.discountAmount,
          taxAmount: claimGroup.totals.taxAmount,
          netTotal: claimGroup.totals.netTotal,
        });

        claimSubRow.height = 22;
        for (let c = 1; c <= COLUMNS.length; c++) {
          const cell = claimSubRow.getCell(c);
          cell.font = { bold: true, size: 9 };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF1F5F9' },
          };
          cell.border = {
            top: { style: 'thin' },
            bottom: { style: 'double' },
          };
          const col = COLUMNS[c - 1];
          if (col.align) cell.alignment = { horizontal: col.align as any };
          if (col.numFmt) cell.numFmt = col.numFmt;
        }
        claimSubRow.commit();
      }

      const outletTotalRow = worksheet.addRow({
        productDescription: `Total for ${outlet.locationName}`,
        quantity: outlet.totals.quantity,
        subTotal: outlet.totals.subTotal,
        discountAmount: outlet.totals.discountAmount,
        taxAmount: outlet.totals.taxAmount,
        netTotal: outlet.totals.netTotal,
      });

      outletTotalRow.height = 24;
      for (let c = 1; c <= COLUMNS.length; c++) {
        const cell = outletTotalRow.getCell(c);
        cell.font = { bold: true, size: 10, color: { argb: 'FF1E3A8A' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE2E8F0' },
        };
        cell.border = {
          top: { style: 'thin' },
          bottom: { style: 'double' },
        };
        const col = COLUMNS[c - 1];
        if (col.align) cell.alignment = { horizontal: col.align as any };
        if (col.numFmt) cell.numFmt = col.numFmt;
      }
      outletTotalRow.commit();
    }

    const grandRow = worksheet.addRow({
      productDescription: 'GRAND TOTAL',
      quantity: reportData.grandTotals.quantity,
      subTotal: reportData.grandTotals.subTotal,
      discountAmount: reportData.grandTotals.discountAmount,
      taxAmount: reportData.grandTotals.taxAmount,
      netTotal: reportData.grandTotals.netTotal,
    });

    grandRow.height = 26;
    for (let c = 1; c <= COLUMNS.length; c++) {
      const cell = grandRow.getCell(c);
      cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0F172A' },
      };
      cell.border = borderThin;
      const col = COLUMNS[c - 1];
      if (col.align) cell.alignment = { horizontal: col.align as any };
      if (col.numFmt) cell.numFmt = col.numFmt;
    }
    grandRow.commit();

    await workbook.commit();
  }

  private async generatePdf(filePath: string, reportData: any): Promise<void> {
    const launchArgs = process.platform === 'linux'
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
        format: 'A3',
        landscape: true,
        printBackground: true,
        margin: { top: '15mm', right: '10mm', bottom: '15mm', left: '10mm' },
      });
    } finally {
      await browser.close();
    }
  }

  private buildHtmlReport(reportData: any): string {
    const dateRangeStr = `${reportData.startDate} - ${reportData.endDate}`;

    let outletTablesHtml = '';

    for (const outlet of reportData.outlets) {
      let rowsHtml = '';

      for (const claimGroup of outlet.claims) {
        for (const item of claimGroup.items) {
          rowsHtml += `
            <tr>
              <td>${item.baseCmNumber}</td>
              <td>${item.baseCmDate}</td>
              <td>${item.claimNumber}</td>
              <td>${item.claimDate}</td>
              <td>${item.settledInvNumber}</td>
              <td>${item.settledDate}</td>
              <td style="text-align: left;">${item.productDescription}</td>
              <td>${item.productSku}</td>
              <td style="text-align: center;">${item.size}</td>
              <td style="text-align: center;">${item.hsCode}</td>
              <td style="text-align: right;">${item.quantity}</td>
              <td style="text-align: right;">${item.unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              <td style="text-align: right;">${item.taxPercent.toFixed(2)}</td>
              <td style="text-align: right;">${item.unitPriceWot.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              <td style="text-align: right;">${item.subTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              <td style="text-align: right;">${item.discountAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              <td style="text-align: right;">${item.taxAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              <td style="text-align: right; font-weight: 600;">${item.netTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            </tr>
          `;
        }

        rowsHtml += `
          <tr class="claim-subtotal-row">
            <td colspan="8"></td>
            <td colspan="2" class="claim-badge">Claim #: ${claimGroup.claimNumber}</td>
            <td style="text-align: right;">${claimGroup.totals.quantity}</td>
            <td colspan="3"></td>
            <td style="text-align: right;">${claimGroup.totals.subTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            <td style="text-align: right;">${claimGroup.totals.discountAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            <td style="text-align: right;">${claimGroup.totals.taxAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            <td style="text-align: right;">${claimGroup.totals.netTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          </tr>
        `;
      }

      rowsHtml += `
        <tr class="outlet-subtotal-row">
          <td colspan="8" style="text-align: left; font-weight: bold;">Total for ${outlet.locationName}</td>
          <td colspan="2"></td>
          <td style="text-align: right;">${outlet.totals.quantity}</td>
          <td colspan="3"></td>
          <td style="text-align: right;">${outlet.totals.subTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          <td style="text-align: right;">${outlet.totals.discountAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          <td style="text-align: right;">${outlet.totals.taxAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          <td style="text-align: right;">${outlet.totals.netTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
        </tr>
      `;

      outletTablesHtml += `
        <div class="outlet-block">
          <div class="outlet-header">${outlet.locationName}</div>
          <div class="report-subtitle">Sales Return | Claim Register | Crystal <span class="date-badge">${dateRangeStr}</span></div>
          <table class="report-table">
            <thead>
              <tr class="header-row">
                <th style="width: 5.5%;">Base CM Number</th>
                <th style="width: 5%;">Base CM Date</th>
                <th style="width: 5.5%;">Claim Number</th>
                <th style="width: 5%;">Claim Date</th>
                <th style="width: 6%;">Settled Inv Number</th>
                <th style="width: 5%;">Settled Date</th>
                <th style="width: 14%; text-align: left;">Product Description</th>
                <th style="width: 7.5%;">Product</th>
                <th style="width: 4.5%;">Size</th>
                <th style="width: 5.5%;">HS Code</th>
                <th style="width: 4.5%; text-align: right;">Quantity</th>
                <th style="width: 5.5%; text-align: right;">Unit Price</th>
                <th style="width: 4%; text-align: right;">Tax %</th>
                <th style="width: 6%; text-align: right;">Unit Price WOT</th>
                <th style="width: 5.5%; text-align: right;">Sub Total</th>
                <th style="width: 5.5%; text-align: right;">Discount Amount</th>
                <th style="width: 5.5%; text-align: right;">Tax Amount</th>
                <th style="width: 6%; text-align: right;">Net Total</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      `;
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          @page { size: A3 landscape; margin: 12mm; }
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 10px; color: #1e293b; margin: 0; padding: 0; background: #fff; }
          .outlet-block { page-break-after: always; margin-bottom: 20px; }
          .outlet-block:last-child { page-break-after: auto; }
          .outlet-header { font-size: 16px; font-weight: bold; text-align: center; color: #000080; margin-bottom: 4px; text-transform: uppercase; }
          .report-subtitle { font-size: 12px; font-weight: bold; text-align: center; color: #cc0000; margin-bottom: 12px; position: relative; }
          .date-badge { position: absolute; right: 0; top: 0; color: #cc0000; font-weight: bold; }
          .report-table { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 4px; }
          .report-table th, .report-table td { padding: 4px 5px; font-size: 9.5px; border-bottom: 1px solid #cbd5e1; }
          .header-row { background: #f8fafc; border-top: 2px solid #000; border-bottom: 2px solid #000; }
          .header-row th { font-weight: bold; color: #0f172a; text-align: left; }
          tr { page-break-inside: auto; }
          tr.header-row { page-break-inside: avoid; }
          .claim-subtotal-row td { background: #f1f5f9; font-weight: bold; border-top: 1px solid #94a3b8; border-bottom: 3px double #000; }
          .claim-badge { border: 1.5px solid #000; text-align: center; font-size: 10px; font-weight: bold; background: #fff; }
          .outlet-subtotal-row td { font-size: 10.5px; font-weight: bold; border-top: 1px solid #000; border-bottom: 3px double #000; padding-top: 6px; padding-bottom: 6px; }
        </style>
      </head>
      <body>
        ${outletTablesHtml}
      </body>
      </html>
    `;
  }
}

function runInBackground(promise: Promise<any>) {
  promise.catch((err) => {
    Logger.error(`[ClaimRegisterExportProcessor] Background error: ${err?.message || err}`);
  });
}
