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
import { CostOfSalesExportService } from './cost-of-sales-export.service';

export interface CostOfSalesExportJobData {
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
  { header: 'GPC / Category / Product', key: 'gpc', width: 40 },
  { header: 'SKU', key: 'sku', width: 16 },
  { header: 'Size', key: 'size', width: 12, align: 'center' },
  { header: 'Quantity', key: 'quantity', width: 14, align: 'right', numFmt: '#,##0' },
  { header: 'Cost Price (Rs.)', key: 'costPrice', width: 18, align: 'right', numFmt: '#,##0.00' },
  { header: 'Total Cost (Rs.)', key: 'totalCost', width: 20, align: 'right', numFmt: '#,##0.00' },
];

@Processor('cost-of-sales-export')
export class CostOfSalesExportProcessor {
  private readonly logger = new Logger(CostOfSalesExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly exportHistoryService: ExportHistoryService,
    private readonly costOfSalesExportService: CostOfSalesExportService,
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
  async handleExport(job: Job<CostOfSalesExportJobData>): Promise<void> {
    const { jobId, userId, tenantId, tenantDbUrl, locationId, startDate, endDate, format, search } = job.data;
    this.logger.log(`[CostOfSalesExport ${jobId}] Starting ${format.toUpperCase()} export`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);
    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const ext = format === 'pdf' ? 'pdf' : 'xlsx';
    const fileName = `cost-of-sales-${new Date().toISOString().slice(0, 10)}.${ext}`;
    const filePath = path.join(exportDir, `export-${jobId}.${ext}`);

    try {
      await job.progress(10);

      const reportData = await this.costOfSalesExportService.getReportData({
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
          message: `Cost of Sales Report export (${format.toUpperCase()}) is ready for download.`,
          category: 'export',
          priority: 'normal',
        }),
      );
    } catch (err: any) {
      this.logger.error(`[CostOfSalesExport ${jobId}] Failed: ${err.message}`, err.stack);
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

    const worksheet = workbook.addWorksheet('Cost of Sales');

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

    for (const brand of reportData.brands) {
      const brandRow = worksheet.addRow({
        gpc: `BRAND: ${brand.brandName.toUpperCase()}`,
        sku: '-',
        size: '-',
        quantity: brand.totals.quantity,
        costPrice: brand.totals.avgUnitCost || 0,
        totalCost: brand.totals.totalCost,
      });
      brandRow.height = 22;
      for (let c = 1; c <= COLUMNS.length; c++) {
        const cell = brandRow.getCell(c);
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        cell.border = borderThin;
        const col = COLUMNS[c - 1];
        if (col.align) cell.alignment = { horizontal: col.align as any };
        if (col.numFmt) cell.numFmt = col.numFmt;
      }
      brandRow.commit();

      for (const div of brand.divisions) {
        const divRow = worksheet.addRow({
          gpc: `DIVISION: ${div.divisionName.toUpperCase()}`,
          sku: '-',
          size: '-',
          quantity: div.totals.quantity,
          costPrice: div.totals.avgUnitCost || 0,
          totalCost: div.totals.totalCost,
        });
        divRow.height = 22;
        for (let c = 1; c <= COLUMNS.length; c++) {
          const cell = divRow.getCell(c);
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
          cell.border = borderThin;
          const col = COLUMNS[c - 1];
          if (col.align) cell.alignment = { horizontal: col.align as any };
          if (col.numFmt) cell.numFmt = col.numFmt;
        }
        divRow.commit();

        for (const gender of div.genders) {
          const genderRow = worksheet.addRow({
            gpc: `GENDER: ${gender.genderName.toUpperCase()}`,
            sku: '-',
            size: '-',
            quantity: gender.totals.quantity,
            costPrice: gender.totals.avgUnitCost || 0,
            totalCost: gender.totals.totalCost,
          });
          genderRow.height = 20;
          for (let c = 1; c <= COLUMNS.length; c++) {
            const cell = genderRow.getCell(c);
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9.5 };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF475569' } };
            cell.border = borderThin;
            const col = COLUMNS[c - 1];
            if (col.align) cell.alignment = { horizontal: col.align as any };
            if (col.numFmt) cell.numFmt = col.numFmt;
          }
          genderRow.commit();

          for (const cat of gender.categories) {
            const catRow = worksheet.addRow({
              gpc: `CATEGORY: ${cat.categoryName.toUpperCase()}`,
              sku: '-',
              size: '-',
              quantity: cat.totals.quantity,
              costPrice: cat.totals.avgUnitCost || 0,
              totalCost: cat.totals.totalCost,
            });
            catRow.height = 20;
            for (let c = 1; c <= COLUMNS.length; c++) {
              const cell = catRow.getCell(c);
              cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9.5 };
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF64748B' } };
              cell.border = borderThin;
              const col = COLUMNS[c - 1];
              if (col.align) cell.alignment = { horizontal: col.align as any };
              if (col.numFmt) cell.numFmt = col.numFmt;
            }
            catRow.commit();

            for (const prod of cat.products) {
              const prodRow = worksheet.addRow({
                gpc: prod.description,
                sku: prod.sku,
                size: 'All Sizes',
                quantity: prod.totals.quantity,
                costPrice: prod.totals.avgUnitCost || 0,
                totalCost: prod.totals.totalCost,
              });
              prodRow.height = 22;
              for (let c = 1; c <= COLUMNS.length; c++) {
                const cell = prodRow.getCell(c);
                cell.font = { bold: true, color: { argb: 'FF0F172A' }, size: 10 };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
                cell.border = borderThin;
                const col = COLUMNS[c - 1];
                if (col.align) cell.alignment = { horizontal: col.align as any };
                if (col.numFmt) cell.numFmt = col.numFmt;
              }
              prodRow.commit();

              for (const item of prod.sizes) {
                const itemRow = worksheet.addRow({
                  gpc: '— Variant Size',
                  sku: prod.sku,
                  size: item.size,
                  quantity: item.quantity,
                  costPrice: item.costPrice,
                  totalCost: item.totalCost,
                });
                for (let c = 1; c <= COLUMNS.length; c++) {
                  const cell = itemRow.getCell(c);
                  cell.border = borderThin;
                  const col = COLUMNS[c - 1];
                  if (col.align) cell.alignment = { horizontal: col.align as any };
                  if (col.numFmt) cell.numFmt = col.numFmt;
                }
                itemRow.commit();
              }
            }
          }
        }
      }
    }

    const grandRow = worksheet.addRow({
      gpc: 'GRAND TOTALS (ALL OUTLETS)',
      sku: '-',
      size: '-',
      quantity: reportData.grandTotals.quantity,
      costPrice: reportData.grandTotals.avgUnitCost || 0,
      totalCost: reportData.grandTotals.totalCost,
    });

    grandRow.height = 26;
    for (let c = 1; c <= COLUMNS.length; c++) {
      const cell = grandRow.getCell(c);
      cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
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

    for (const brand of reportData.brands) {
      rowsHtml += `
        <tr class="level-brand">
          <td colspan="3" style="padding-left: 10px;">BRAND: ${brand.brandName.toUpperCase()}</td>
          <td style="text-align: right;">${brand.totals.quantity}</td>
          <td style="text-align: right;">${(brand.totals.avgUnitCost || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          <td style="text-align: right; color: #4ade80;">PKR ${(brand.totals.totalCost || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
        </tr>
      `;

      for (const div of brand.divisions) {
        rowsHtml += `
          <tr class="level-division">
            <td colspan="3" style="padding-left: 20px;">DIVISION: ${div.divisionName.toUpperCase()}</td>
            <td style="text-align: right;">${div.totals.quantity}</td>
            <td style="text-align: right;">${(div.totals.avgUnitCost || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            <td style="text-align: right; color: #4ade80;">PKR ${(div.totals.totalCost || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          </tr>
        `;

        for (const gender of div.genders) {
          rowsHtml += `
            <tr class="level-gender">
              <td colspan="3" style="padding-left: 30px;">GENDER: ${gender.genderName.toUpperCase()}</td>
              <td style="text-align: right;">${gender.totals.quantity}</td>
              <td style="text-align: right;">${(gender.totals.avgUnitCost || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              <td style="text-align: right; color: #4ade80;">PKR ${(gender.totals.totalCost || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            </tr>
          `;

          for (const cat of gender.categories) {
            rowsHtml += `
              <tr class="level-category">
                <td colspan="3" style="padding-left: 40px;">CATEGORY: ${cat.categoryName.toUpperCase()}</td>
                <td style="text-align: right;">${cat.totals.quantity}</td>
                <td style="text-align: right;">${(cat.totals.avgUnitCost || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                <td style="text-align: right; color: #4ade80;">PKR ${(cat.totals.totalCost || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              </tr>
            `;

            for (const prod of cat.products) {
              rowsHtml += `
                <tr class="level-article">
                  <td style="padding-left: 50px; font-weight: bold;">${prod.description}</td>
                  <td style="font-weight: bold; font-family: monospace; color: #0284c7;">${prod.sku}</td>
                  <td style="text-align: center;">All Sizes</td>
                  <td style="text-align: right; font-weight: bold;">${prod.totals.quantity}</td>
                  <td style="text-align: right; font-weight: bold;">PKR ${(prod.totals.avgUnitCost || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td style="text-align: right; font-weight: bold; color: #059669;">PKR ${(prod.totals.totalCost || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                </tr>
              `;

              for (const item of prod.sizes) {
                rowsHtml += `
                  <tr class="level-variant">
                    <td style="padding-left: 60px; color: #64748b; italic;">— Variant Size</td>
                    <td style="font-family: monospace; color: #64748b;">${prod.sku}</td>
                    <td style="text-align: center; font-weight: bold;">${item.size}</td>
                    <td style="text-align: right;">${item.quantity}</td>
                    <td style="text-align: right;">PKR ${item.costPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                    <td style="text-align: right; font-weight: bold; color: #059669;">PKR ${item.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  </tr>
                `;
              }
            }
          }
        }
      }
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
          .report-subtitle { font-size: 12px; font-weight: bold; color: #0284c7; margin-top: 4px; }
          .report-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
          .report-table th, .report-table td { padding: 6px 8px; font-size: 9.5px; border: 1px solid #cbd5e1; }
          .header-row { background: #0f172a; color: #fff; }
          .header-row th { font-weight: bold; color: #fff; text-align: left; }
          .level-brand { background: #1e293b; color: #fff; font-weight: bold; }
          .level-division { background: #334155; color: #fff; font-weight: bold; }
          .level-gender { background: #475569; color: #fff; font-weight: bold; }
          .level-category { background: #64748b; color: #fff; font-weight: bold; }
          .level-article { background: #f1f5f9; font-weight: bold; color: #0f172a; }
          .level-variant { background: #ffffff; }
        </style>
      </head>
      <body>
        <div class="report-header">
          <h1 class="report-title">Cost of Sales Report</h1>
          <div class="report-subtitle">Period: ${dateRangeStr}</div>
        </div>
        <table class="report-table">
          <thead>
            <tr class="header-row">
              <th style="width: 35%;">GPC / Category / Product</th>
              <th style="width: 15%;">SKU</th>
              <th style="width: 10%; text-align: center;">Size</th>
              <th style="width: 12%; text-align: right;">Quantity</th>
              <th style="width: 14%; text-align: right;">Cost Price (Rs.)</th>
              <th style="width: 14%; text-align: right;">Total Cost (Rs.)</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
          <tfoot>
            <tr style="background: #0f172a; color: #fff; font-weight: bold;">
              <td colspan="3">GRAND TOTALS (ALL OUTLETS)</td>
              <td style="text-align: right;">${reportData.grandTotals.quantity}</td>
              <td style="text-align: right;">PKR ${(reportData.grandTotals.avgUnitCost || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              <td style="text-align: right; color: #4ade80;">PKR ${(reportData.grandTotals.totalCost || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
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
    Logger.error(`[CostOfSalesExportProcessor] Background error: ${err?.message || err}`);
  });
}
