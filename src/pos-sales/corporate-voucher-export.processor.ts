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
import { CorporateVoucherExportService } from './corporate-voucher-export.service';

export interface CorporateVoucherExportJobData {
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
  { header: 'Corporate Voucher #', key: 'voucherNumber', width: 22 },
  { header: 'Date Time', key: 'dateTime', width: 20 },
  { header: 'Company Name', key: 'companyName', width: 28 },
  { header: 'Company GL Code', key: 'companyGlCode', width: 18 },
  { header: 'Beneficiary / Customer', key: 'customerDetail', width: 26 },
  { header: 'Valid Till', key: 'validTill', width: 16 },
  { header: 'Issued Outlet', key: 'outletName', width: 24 },
  { header: 'Discount Amount (Rs.)', key: 'discountAmount', width: 20, align: 'right', numFmt: '#,##0.00' },
  { header: 'Face Value (Rs.)', key: 'faceValue', width: 18, align: 'right', numFmt: '#,##0.00' },
  { header: 'Settled In Invoice', key: 'settledInInvoice', width: 24 },
  { header: 'Settled Date Time', key: 'settledDateTime', width: 20 },
  { header: 'Status', key: 'status', width: 14, align: 'center' },
];

@Processor('corporate-voucher-export')
export class CorporateVoucherExportProcessor {
  private readonly logger = new Logger(CorporateVoucherExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly exportHistoryService: ExportHistoryService,
    private readonly reportService: CorporateVoucherExportService,
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
  async handleExport(job: Job<CorporateVoucherExportJobData>): Promise<void> {
    const { jobId, userId, tenantId, tenantDbUrl, locationId, startDate, endDate, format, search } = job.data;
    this.logger.log(`[CorporateVoucherExport ${jobId}] Starting ${format.toUpperCase()} export`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);
    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const ext = format === 'pdf' ? 'pdf' : 'xlsx';
    const fileName = `corporate-voucher-report-${new Date().toISOString().slice(0, 10)}.${ext}`;
    const filePath = path.join(exportDir, `export-${jobId}.${ext}`);

    try {
      await job.progress(10);

      const reportData = await this.reportService.getReportData({
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
          message: `Corporate Voucher Report export (${format.toUpperCase()}) is ready for download.`,
          category: 'export',
          priority: 'normal',
        }),
      );
    } catch (err: any) {
      this.logger.error(`[CorporateVoucherExport ${jobId}] Failed: ${err.message}`, err.stack);
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

    const worksheet = workbook.addWorksheet('Corporate Voucher Report');

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
        fgColor: { argb: 'FF0F172A' },
      };
      cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
      cell.border = borderThin;
      cell.alignment = { vertical: 'middle', horizontal: (COLUMNS[c - 1].align as any) || 'left' };
    }
    headerRow.commit();

    for (const item of reportData.items) {
      const row = worksheet.addRow({
        voucherNumber: item.voucherNumber,
        dateTime: item.dateTime,
        companyName: item.companyName,
        companyGlCode: item.companyGlCode,
        customerDetail: item.customerDetail,
        validTill: item.validTill,
        outletName: item.outletName,
        discountAmount: item.discountAmount,
        faceValue: item.faceValue,
        settledInInvoice: item.settledInInvoice,
        settledDateTime: item.settledDateTime,
        status: item.status,
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

    const summaryRow = worksheet.addRow({
      voucherNumber: 'TOTALS',
      dateTime: '-',
      companyName: '-',
      companyGlCode: '-',
      customerDetail: '-',
      validTill: '-',
      outletName: '-',
      discountAmount: reportData.kpis.totalDiscount,
      faceValue: reportData.kpis.totalAmount,
      settledInInvoice: '-',
      settledDateTime: '-',
      status: '-',
    });

    summaryRow.height = 26;
    for (let c = 1; c <= COLUMNS.length; c++) {
      const cell = summaryRow.getCell(c);
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      cell.border = borderThin;
      const col = COLUMNS[c - 1];
      if (col.align) cell.alignment = { horizontal: col.align as any };
      if (col.numFmt) cell.numFmt = col.numFmt;
    }
    summaryRow.commit();

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
        format: 'A4',
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

    let rowsHtml = '';

    for (const item of reportData.items) {
      rowsHtml += `
        <tr>
          <td style="font-family: monospace; font-weight: bold; color: #4f46e5;">${item.voucherNumber}</td>
          <td>${item.dateTime}</td>
          <td style="font-weight: bold; color: #0f172a;">${item.companyName}</td>
          <td style="font-family: monospace; color: #64748b;">${item.companyGlCode}</td>
          <td>${item.customerDetail}</td>
          <td>${item.validTill}</td>
          <td>${item.outletName}</td>
          <td style="text-align: right;">PKR ${item.discountAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          <td style="text-align: right; font-weight: bold; color: #059669;">PKR ${item.faceValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          <td>${item.settledInInvoice}</td>
          <td>${item.settledDateTime}</td>
          <td style="text-align: center; font-weight: bold;">${item.status}</td>
        </tr>
      `;
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          @page { size: A4 landscape; margin: 10mm; }
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 10px; color: #1e293b; margin: 0; padding: 0; background: #fff; }
          .report-header { text-align: center; margin-bottom: 16px; border-bottom: 2px solid #0f172a; padding-bottom: 8px; }
          .report-title { font-size: 18px; font-weight: bold; color: #0f172a; text-transform: uppercase; margin: 0; }
          .report-subtitle { font-size: 12px; font-weight: bold; color: #4f46e5; margin-top: 4px; }
          .report-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
          .report-table th, .report-table td { padding: 6px 8px; font-size: 9px; border: 1px solid #cbd5e1; }
          .header-row { background: #0f172a; color: #fff; }
          .header-row th { font-weight: bold; color: #fff; text-align: left; }
        </style>
      </head>
      <body>
        <div class="report-header">
          <h1 class="report-title">Corporate Voucher Sale Register Report</h1>
          <div class="report-subtitle">Period: ${dateRangeStr}</div>
        </div>
        <table class="report-table">
          <thead>
            <tr class="header-row">
              <th style="width: 12%;">Corporate Voucher #</th>
              <th style="width: 9%;">Date Time</th>
              <th style="width: 13%;">Company Name</th>
              <th style="width: 8%;">GL Code</th>
              <th style="width: 12%;">Beneficiary / Customer</th>
              <th style="width: 7%;">Valid Till</th>
              <th style="width: 10%;">Issued Outlet</th>
              <th style="width: 8%; text-align: right;">Discount</th>
              <th style="width: 8%; text-align: right;">Face Value</th>
              <th style="width: 8%;">Settled In Inv</th>
              <th style="width: 8%;">Settled Date</th>
              <th style="width: 7%; text-align: center;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
          <tfoot>
            <tr style="background: #0f172a; color: #fff; font-weight: bold;">
              <td colspan="7">TOTALS (${reportData.kpis.totalVouchers} Corporate Vouchers)</td>
              <td style="text-align: right;">PKR ${reportData.kpis.totalDiscount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              <td style="text-align: right; color: #4ade80;">PKR ${reportData.kpis.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              <td colspan="3">Settled Total: PKR ${reportData.kpis.totalSettledAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            </tr>
          </tfoot>
        </table>
      </body>
      </html>
    `;
  }
}

function runInBackground(promise: Promise<any>) {
  promise.catch((err) => {
    Logger.error(`[CorporateVoucherExportProcessor] Background error: ${err?.message || err}`);
  });
}
