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
  { header: 'GPC / Category / Product', key: 'gpc', width: 45 },
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
      cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 11 };
      cell.border = borderThin;
      cell.alignment = { vertical: 'middle', horizontal: (COLUMNS[c - 1].align as any) || 'left' };
    }
    headerRow.commit();

    for (const outlet of reportData.outlets) {
      const outletRow = worksheet.addRow([`OUTLET: ${outlet.locationName.toUpperCase()}`]);
      outletRow.height = 26;
      const outletCell = outletRow.getCell(1);
      outletCell.font = { bold: true, color: { argb: 'FF1E3A8A' }, size: 12 };
      outletRow.commit();

      for (const div of outlet.divisions) {
        const divRow = worksheet.addRow([`  Division: ${div.divisionName}`]);
        divRow.height = 22;
        divRow.getCell(1).font = { bold: true, size: 11, color: { argb: 'FF0284C7' } };
        divRow.commit();

        for (const brand of div.brands) {
          const brandRow = worksheet.addRow([`    Brand: ${brand.brandName}`]);
          brandRow.height = 20;
          brandRow.getCell(1).font = { bold: true, size: 10, color: { argb: 'FF475569' } };
          brandRow.commit();

          for (const gender of brand.genders) {
            const genderRow = worksheet.addRow([`      Gender: ${gender.genderName}`]);
            genderRow.height = 20;
            genderRow.getCell(1).font = { bold: true, size: 10 };
            genderRow.commit();

            for (const cat of gender.categories) {
              const catRow = worksheet.addRow([`        Category: ${cat.categoryName}`]);
              catRow.height = 20;
              catRow.getCell(1).font = { bold: true, size: 10, color: { argb: 'FF0D9488' } };
              catRow.commit();

              for (const prod of cat.products) {
                for (const item of prod.sizes) {
                  const row = worksheet.addRow({
                    gpc: `          ${prod.productLabel}`,
                    size: item.size,
                    quantity: item.quantity,
                    costPrice: item.costPrice,
                    totalCost: item.totalCost,
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

                // Product Subtotal
                const prodSubRow = worksheet.addRow({
                  gpc: `          Total for ${prod.sku}`,
                  quantity: prod.totals.quantity,
                  totalCost: prod.totals.totalCost,
                });
                prodSubRow.height = 20;
                for (let c = 1; c <= COLUMNS.length; c++) {
                  const cell = prodSubRow.getCell(c);
                  cell.font = { bold: true, size: 9 };
                  cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' } };
                  const col = COLUMNS[c - 1];
                  if (col.align) cell.alignment = { horizontal: col.align as any };
                  if (col.numFmt) cell.numFmt = col.numFmt;
                }
                prodSubRow.commit();
              }

              // Category Subtotal
              const catSubRow = worksheet.addRow({
                gpc: `        Category Total: ${cat.categoryName}`,
                quantity: cat.totals.quantity,
                totalCost: cat.totals.totalCost,
              });
              catSubRow.height = 22;
              for (let c = 1; c <= COLUMNS.length; c++) {
                const cell = catSubRow.getCell(c);
                cell.font = { bold: true, size: 10, color: { argb: 'FF0D9488' } };
                cell.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
                const col = COLUMNS[c - 1];
                if (col.align) cell.alignment = { horizontal: col.align as any };
                if (col.numFmt) cell.numFmt = col.numFmt;
              }
              catSubRow.commit();
            }

            // Gender Subtotal
            const genderSubRow = worksheet.addRow({
              gpc: `      Gender Total: ${gender.genderName}`,
              quantity: gender.totals.quantity,
              totalCost: gender.totals.totalCost,
            });
            genderSubRow.height = 22;
            for (let c = 1; c <= COLUMNS.length; c++) {
              const cell = genderSubRow.getCell(c);
              cell.font = { bold: true, size: 10 };
              cell.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
              const col = COLUMNS[c - 1];
              if (col.align) cell.alignment = { horizontal: col.align as any };
              if (col.numFmt) cell.numFmt = col.numFmt;
            }
            genderSubRow.commit();
          }

          // Brand Subtotal
          const brandSubRow = worksheet.addRow({
            gpc: `    Brand Total: ${brand.brandName}`,
            quantity: brand.totals.quantity,
            totalCost: brand.totals.totalCost,
          });
          brandSubRow.height = 22;
          for (let c = 1; c <= COLUMNS.length; c++) {
            const cell = brandSubRow.getCell(c);
            cell.font = { bold: true, size: 10, color: { argb: 'FF475569' } };
            cell.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
            const col = COLUMNS[c - 1];
            if (col.align) cell.alignment = { horizontal: col.align as any };
            if (col.numFmt) cell.numFmt = col.numFmt;
          }
          brandSubRow.commit();
        }

        // Division Subtotal
        const divSubRow = worksheet.addRow({
          gpc: `  Division Total: ${div.divisionName}`,
          quantity: div.totals.quantity,
          totalCost: div.totals.totalCost,
        });
        divSubRow.height = 24;
        for (let c = 1; c <= COLUMNS.length; c++) {
          const cell = divSubRow.getCell(c);
          cell.font = { bold: true, size: 11, color: { argb: 'FF0284C7' } };
          cell.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
          const col = COLUMNS[c - 1];
          if (col.align) cell.alignment = { horizontal: col.align as any };
          if (col.numFmt) cell.numFmt = col.numFmt;
        }
        divSubRow.commit();
      }

      // Outlet Subtotal
      const outletSubRow = worksheet.addRow({
        gpc: `TOTAL FOR ${outlet.locationName.toUpperCase()}`,
        quantity: outlet.totals.quantity,
        totalCost: outlet.totals.totalCost,
      });
      outletSubRow.height = 26;
      for (let c = 1; c <= COLUMNS.length; c++) {
        const cell = outletSubRow.getCell(c);
        cell.font = { bold: true, size: 11, color: { argb: 'FF1E3A8A' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE2E8F0' },
        };
        cell.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
        const col = COLUMNS[c - 1];
        if (col.align) cell.alignment = { horizontal: col.align as any };
        if (col.numFmt) cell.numFmt = col.numFmt;
      }
      outletSubRow.commit();
    }

    // Grand Total
    const grandRow = worksheet.addRow({
      gpc: 'GRAND TOTAL (ALL OUTLETS)',
      quantity: reportData.grandTotals.quantity,
      totalCost: reportData.grandTotals.totalCost,
    });
    grandRow.height = 28;
    for (let c = 1; c <= COLUMNS.length; c++) {
      const cell = grandRow.getCell(c);
      cell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
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
        format: 'A4',
        landscape: false,
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

      for (const div of outlet.divisions) {
        rowsHtml += `<tr class="section-row div-row"><td colspan="5">Division: ${div.divisionName}</td></tr>`;

        for (const brand of div.brands) {
          rowsHtml += `<tr class="section-row brand-row"><td colspan="5" style="padding-left: 20px;">Brand: ${brand.brandName}</td></tr>`;

          for (const gender of brand.genders) {
            rowsHtml += `<tr class="section-row gender-row"><td colspan="5" style="padding-left: 35px;">Gender: ${gender.genderName}</td></tr>`;

            for (const cat of gender.categories) {
              rowsHtml += `<tr class="section-row cat-row"><td colspan="5" style="padding-left: 50px;">Category: ${cat.categoryName}</td></tr>`;

              for (const prod of cat.products) {
                for (const item of prod.sizes) {
                  rowsHtml += `
                    <tr>
                      <td style="padding-left: 65px;">${prod.productLabel}</td>
                      <td style="text-align: center;">${item.size}</td>
                      <td style="text-align: right;">${item.quantity}</td>
                      <td style="text-align: right;">${item.costPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                      <td style="text-align: right; font-weight: 600;">${item.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  `;
                }

                rowsHtml += `
                  <tr class="subtotal-row prod-sub">
                    <td style="padding-left: 65px; font-weight: bold;">Total for ${prod.sku}</td>
                    <td></td>
                    <td style="text-align: right; font-weight: bold;">${prod.totals.quantity}</td>
                    <td></td>
                    <td style="text-align: right; font-weight: bold;">${prod.totals.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  </tr>
                `;
              }

              rowsHtml += `
                <tr class="subtotal-row cat-sub">
                  <td style="padding-left: 50px; font-weight: bold;">Category Total: ${cat.categoryName}</td>
                  <td></td>
                  <td style="text-align: right; font-weight: bold;">${cat.totals.quantity}</td>
                  <td></td>
                  <td style="text-align: right; font-weight: bold;">${cat.totals.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                </tr>
              `;
            }

            rowsHtml += `
              <tr class="subtotal-row gender-sub">
                <td style="padding-left: 35px; font-weight: bold;">Gender Total: ${gender.genderName}</td>
                <td></td>
                <td style="text-align: right; font-weight: bold;">${gender.totals.quantity}</td>
                <td></td>
                <td style="text-align: right; font-weight: bold;">${gender.totals.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              </tr>
            `;
          }

          rowsHtml += `
            <tr class="subtotal-row brand-sub">
              <td style="padding-left: 20px; font-weight: bold;">Brand Total: ${brand.brandName}</td>
              <td></td>
              <td style="text-align: right; font-weight: bold;">${brand.totals.quantity}</td>
              <td></td>
              <td style="text-align: right; font-weight: bold;">${brand.totals.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            </tr>
          `;
        }

        rowsHtml += `
          <tr class="subtotal-row div-sub">
            <td style="font-weight: bold;">Division Total: ${div.divisionName}</td>
            <td></td>
            <td style="text-align: right; font-weight: bold;">${div.totals.quantity}</td>
            <td></td>
            <td style="text-align: right; font-weight: bold;">${div.totals.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          </tr>
        `;
      }

      rowsHtml += `
        <tr class="outlet-subtotal-row">
          <td style="font-weight: bold; font-size: 11px;">TOTAL FOR ${outlet.locationName.toUpperCase()}</td>
          <td></td>
          <td style="text-align: right; font-weight: bold;">${outlet.totals.quantity}</td>
          <td></td>
          <td style="text-align: right; font-weight: bold;">${outlet.totals.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
        </tr>
      `;

      outletTablesHtml += `
        <div class="outlet-block">
          <div class="outlet-header">${outlet.locationName}</div>
          <div class="report-subtitle">Cost of Sales Report <span class="date-badge">${dateRangeStr}</span></div>
          <table class="report-table">
            <thead>
              <tr class="header-row">
                <th style="width: 48%; text-align: left;">GPC / Category / Product</th>
                <th style="width: 12%; text-align: center;">Size</th>
                <th style="width: 12%; text-align: right;">Quantity</th>
                <th style="width: 14%; text-align: right;">Cost Price (Rs.)</th>
                <th style="width: 14%; text-align: right;">Total Cost (Rs.)</th>
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
          @page { size: A4 portrait; margin: 12mm; }
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 10px; color: #1e293b; margin: 0; padding: 0; background: #fff; }
          .outlet-block { page-break-after: always; margin-bottom: 20px; }
          .outlet-block:last-child { page-break-after: auto; }
          .outlet-header { font-size: 16px; font-weight: bold; text-align: center; color: #0f172a; margin-bottom: 4px; text-transform: uppercase; }
          .report-subtitle { font-size: 12px; font-weight: bold; text-align: center; color: #0284c7; margin-bottom: 12px; position: relative; }
          .date-badge { position: absolute; right: 0; top: 0; color: #0284c7; font-weight: bold; }
          .report-table { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 4px; }
          .report-table th, .report-table td { padding: 4px 6px; font-size: 9.5px; border-bottom: 1px solid #cbd5e1; }
          .header-row { background: #0f172a; color: #fff; border-top: 2px solid #000; }
          .header-row th { font-weight: bold; color: #fff; text-align: left; }
          tr { page-break-inside: auto; }
          tr.header-row { page-break-inside: avoid; }
          .section-row td { font-weight: bold; background: #f8fafc; color: #0f172a; }
          .div-row td { font-size: 11px; color: #0284c7; }
          .brand-row td { color: #475569; }
          .cat-row td { color: #0d9488; }
          .subtotal-row td { background: #f1f5f9; border-top: 1px solid #94a3b8; border-bottom: 2px double #000; }
          .outlet-subtotal-row td { background: #e2e8f0; font-size: 11px; font-weight: bold; border-top: 1px solid #000; border-bottom: 3px double #000; padding-top: 6px; padding-bottom: 6px; }
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
    Logger.error(`[CostOfSalesExportProcessor] Background error: ${err?.message || err}`);
  });
}
