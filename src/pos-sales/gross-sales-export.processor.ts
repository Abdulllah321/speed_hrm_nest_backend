import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import * as puppeteer from 'puppeteer';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { ExportHistoryService } from '../warehouse/export-history/export-history.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PosSalesService } from './pos-sales.service';

interface GrossSalesExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  locationId: string;
  startDate?: string;
  endDate?: string;
  cashierUserId?: string;
  format: 'xlsx' | 'pdf';
  search?: string;
  paymentModeGroup?: string;
  minAmount?: number;
  maxAmount?: number;
  fbrOnly?: boolean;
  reportType: 'summary' | 'return';
}

const COLUMNS = [
  { header: 'GPC / Category / Product', key: 'label', width: 38, align: 'left' },
  { header: 'Size', key: 'size', width: 10, align: 'center' },
  { header: 'Color', key: 'color', width: 14, align: 'center' },
  { header: 'Qty', key: 'qty', width: 10, align: 'right', numFmt: '#,##0' },
  { header: 'Retail Price (Rs.)', key: 'retailPrice', width: 16, align: 'right', numFmt: '#,##0.00' },
  { header: 'Total Price WOST', key: 'totalPriceWost', width: 18, align: 'right', numFmt: '#,##0.00' },
  { header: 'Discount Amount (Rs.)', key: 'discountAmount', width: 18, align: 'right', numFmt: '#,##0.00' },
  { header: 'Excluding Sales Tax', key: 'excludingSalesTax', width: 18, align: 'right', numFmt: '#,##0.00' },
  { header: 'Sales Tax %', key: 'salesTaxPercent', width: 12, align: 'center', numFmt: '0.00%' },
  { header: 'Sales Tax Amount', key: 'salesTaxAmount', width: 18, align: 'right', numFmt: '#,##0.00' },
  { header: 'Further Tax Amount', key: 'furtherTaxAmount', width: 18, align: 'right', numFmt: '#,##0.00' },
  { header: 'Total Tax', key: 'totalTax', width: 16, align: 'right', numFmt: '#,##0.00' },
  { header: 'Including Sales Tax', key: 'includingSalesTax', width: 18, align: 'right', numFmt: '#,##0.00' },
  { header: 'Sales Person', key: 'salesPerson', width: 22, align: 'left' }
];

@Processor('gross-sales-export')
export class GrossSalesExportProcessor {
  private readonly logger = new Logger(GrossSalesExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly exportHistoryService: ExportHistoryService,
    private readonly posSalesService: PosSalesService,
  ) {
    if (process.platform === 'linux') {
      try {
        const { exec } = require('child_process');
        exec(
          'apt-get update && apt-get install -y libatk1.0-0 libatk-bridge2.0-0 libcups2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpangocairo-1.0-0 libasound2 libnss3 libxshmfence1 libgtk-3-0',
          () => {}
        );
      } catch (e: any) {
        this.logger.warn(`Error installing Chromium dependencies: ${e.message}`);
      }
    }
  }

  @Process({ concurrency: 1 })
  async handleExport(job: Job<GrossSalesExportJobData>): Promise<void> {
    const {
      jobId,
      userId,
      tenantId,
      tenantDbUrl,
      locationId,
      startDate,
      endDate,
      cashierUserId,
      format,
      search,
      paymentModeGroup,
      minAmount,
      maxAmount,
      fbrOnly,
      reportType,
    } = job.data;

    const reportLabel = reportType === 'return' ? 'Gross Sales Return' : 'Gross Sales Summary';
    this.logger.log(`[GrossSalesExport ${jobId}] Starting ${format.toUpperCase()} export for ${reportLabel}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);
    const prismaMaster = new PrismaMasterService();
    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const ext = format === 'pdf' ? 'pdf' : 'xlsx';
    const filePath = path.join(exportDir, `export-${jobId}.${ext}`);

    try {
      await job.progress(15);

      const location = await prisma.location.findUnique({
        where: { id: locationId },
        select: { name: true },
      });
      const locationName = location?.name || 'Store';

      // Fetch flat rows from Service
      let result;
      if (reportType === 'return') {
        result = await this.posSalesService.getGrossSalesReturnReport({
          locationId,
          startDate,
          endDate,
          cashierUserId,
          search,
          paymentModeGroup,
          minAmount,
          maxAmount,
          fbrOnly,
        });
      } else {
        result = await this.posSalesService.getGrossSalesSummaryReport({
          locationId,
          startDate,
          endDate,
          cashierUserId,
          search,
          paymentModeGroup,
          minAmount,
          maxAmount,
          fbrOnly,
        });
      }

      const rows = result.data || [];
      await job.progress(50);

      // Compute Grand Totals
      const grandTotals = {
        qty: 0,
        totalPriceWost: 0,
        discountAmount: 0,
        excludingSalesTax: 0,
        salesTaxAmount: 0,
        furtherTaxAmount: 0,
        totalTax: 0,
        includingSalesTax: 0,
      };

      for (const r of rows) {
        if (r.type === 'variant') {
          grandTotals.qty += r.qty || 0;
          grandTotals.totalPriceWost += r.totalPriceWost || 0;
          grandTotals.discountAmount += r.discountAmount || 0;
          grandTotals.excludingSalesTax += r.excludingSalesTax || 0;
          grandTotals.salesTaxAmount += r.salesTaxAmount || 0;
          grandTotals.furtherTaxAmount += r.furtherTaxAmount || 0;
          grandTotals.totalTax += r.totalTax || 0;
          grandTotals.includingSalesTax += r.includingSalesTax || 0;
        }
      }

      await job.progress(70);

      if (format === 'pdf') {
        const fromStr = startDate ? new Date(startDate).toLocaleDateString() : '';
        const toStr = endDate ? new Date(endDate).toLocaleDateString() : '';
        const html = this.buildPdfHtml(rows, locationName, fromStr, toStr, grandTotals, reportLabel);

        const launchArgs = [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
        ];
        const browser = await puppeteer.launch({
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
          headless: true,
          args: launchArgs,
        });

        try {
          const page = await browser.newPage();
          page.setDefaultTimeout(0);
          page.setDefaultNavigationTimeout(0);
          await page.setContent(html, { waitUntil: 'domcontentloaded' });

          const pdfBuffer = await page.pdf({
            format: 'A4',
            landscape: true,
            margin: { top: '15mm', bottom: '15mm', left: '10mm', right: '10mm' },
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate: `<div style="font-size: 7px; width: 100%; text-align: right; padding-right: 15mm; color: #94a3b8;">${reportLabel}</div>`,
            footerTemplate: '<div style="font-size: 7px; width: 100%; text-align: center; color: #94a3b8;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
          });

          fs.writeFileSync(filePath, pdfBuffer);
        } finally {
          await browser.close();
        }
      } else {
        // XLSX format
        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
          filename: filePath,
          useStyles: true,
          useSharedStrings: false,
        });

        const ws = workbook.addWorksheet(reportLabel.slice(0, 30), {
          pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
        });

        ws.columns = COLUMNS.map(c => ({ key: c.key, width: c.width }));

        // Add Header Row
        const headerRow = ws.getRow(1);
        COLUMNS.forEach((col, idx) => {
          const cell = headerRow.getCell(idx + 1);
          cell.value = col.header;
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
          cell.alignment = { horizontal: col.align === 'right' ? 'right' : (col.align === 'center' ? 'center' : 'left'), vertical: 'middle' };
        });
        headerRow.height = 24;
        headerRow.commit();

        const borderThin = {
          top: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
        };

        for (const r of rows) {
          const labelPadding = '  '.repeat(r.depth || 0) + r.label;
          const rowData = {
            label: labelPadding,
            size: r.size || '',
            color: r.color || '',
            qty: r.qty,
            retailPrice: r.type === 'variant' ? r.retailPrice : '',
            totalPriceWost: r.totalPriceWost,
            discountAmount: r.discountAmount,
            excludingSalesTax: r.excludingSalesTax,
            salesTaxPercent: r.type === 'variant' ? (r.salesTaxPercent / 100) : '',
            salesTaxAmount: r.salesTaxAmount,
            furtherTaxAmount: r.furtherTaxAmount,
            totalTax: r.totalTax,
            includingSalesTax: r.includingSalesTax,
            salesPerson: r.salesPerson || '',
          };

          const row = ws.addRow(rowData);
          const isGroup = r.type !== 'variant';

          for (let colNum = 1; colNum <= COLUMNS.length; colNum++) {
            const cell = row.getCell(colNum);
            cell.border = borderThin;
            cell.alignment = {
              horizontal: COLUMNS[colNum - 1].align === 'right' ? 'right' : (COLUMNS[colNum - 1].align === 'center' ? 'center' : 'left'),
              vertical: 'middle',
            };

            const c = COLUMNS[colNum - 1];
            if (c.numFmt && cell.value !== '') {
              cell.numFmt = c.numFmt;
            }

            if (isGroup) {
              cell.font = { bold: true, size: 9 };
              if (r.type === 'brand') {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
              } else if (r.type === 'division') {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
              }
            } else {
              cell.font = { size: 8.5 };
            }
          }
          row.height = 20;
          row.commit();
        }

        // Add Grand Totals
        const totalRow = ws.addRow({
          label: 'GRAND TOTALS',
          size: '',
          color: '',
          qty: grandTotals.qty,
          retailPrice: '',
          totalPriceWost: grandTotals.totalPriceWost,
          discountAmount: grandTotals.discountAmount,
          excludingSalesTax: grandTotals.excludingSalesTax,
          salesTaxPercent: '',
          salesTaxAmount: grandTotals.salesTaxAmount,
          furtherTaxAmount: grandTotals.furtherTaxAmount,
          totalTax: grandTotals.totalTax,
          includingSalesTax: grandTotals.includingSalesTax,
          salesPerson: '',
        });

        totalRow.eachCell((cell, colNum) => {
          cell.font = { bold: true, size: 9.5 };
          cell.border = {
            top: { style: 'medium', color: { argb: 'FF1E293B' } },
            bottom: { style: 'double', color: { argb: 'FF1E293B' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          };
          const c = COLUMNS[colNum - 1];
          cell.alignment = {
            horizontal: c.align === 'right' ? 'right' : (c.align === 'center' ? 'center' : 'left'),
            vertical: 'middle',
          };
          if (c.numFmt && cell.value !== '') {
            cell.numFmt = c.numFmt;
          }
        });
        totalRow.height = 24;
        totalRow.commit();

        await workbook.commit();
      }

      await job.progress(95);

      const mimeType = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const fileName = format === 'pdf'
        ? `${reportType === 'return' ? 'gross-sales-return-report' : 'gross-sales-summary-report'}-${new Date().toISOString().slice(0, 10)}.pdf`
        : `${reportType === 'return' ? 'gross-sales-return-report' : 'gross-sales-summary-report'}-${new Date().toISOString().slice(0, 10)}.xlsx`;

      await this.exportHistoryService.completeAndUploadExport(
        prisma,
        jobId,
        filePath,
        fileName,
        mimeType,
      );

      // Notify User
      await this.notificationsService.create({
        userId,
        title: `${reportLabel} Export Ready`,
        message: `Your ${reportLabel} ${format.toUpperCase()} report has been processed successfully.`,
        category: 'export',
        priority: 'high',
        actionType: `gross-sales-${reportType}-export.ready`,
        actionPayload: JSON.stringify({ jobId }),
      });

      await job.progress(100);
      this.logger.log(`[GrossSalesExport ${jobId}] Finished processing successfully`);
    } catch (err) {
      this.logger.error(`[GrossSalesExport ${jobId}] Failed: ${err.message}`, err.stack);
      await this.exportHistoryService.failExport(prisma, jobId);
      throw err;
    } finally {
      await prismaMaster.$disconnect();
    }
  }

  private buildPdfHtml(
    data: any[],
    locationName: string,
    fromDateStr: string,
    toDateStr: string,
    grandTotals: any,
    reportLabel: string
  ): string {
    let rowsHtml = '';
    const formatVal = (val: number) => val === 0 ? '-' : val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formatPct = (val: number) => val === 0 ? '-' : `${val.toFixed(2)}%`;

    for (const r of data) {
      const isGroup = r.type !== 'variant';
      const labelPadding = '&nbsp;'.repeat((r.depth || 0) * 4) + r.label;

      rowsHtml += `
        <tr class="${isGroup ? `group-row depth-${r.depth}` : 'variant-row'}">
          <td class="label-col">${labelPadding}</td>
          <td class="center">${r.size || '-'}</td>
          <td class="center">${r.color || '-'}</td>
          <td class="num font-bold">${r.qty || '-'}</td>
          <td class="num">${r.type === 'variant' ? formatVal(r.retailPrice) : '-'}</td>
          <td class="num">${formatVal(r.totalPriceWost)}</td>
          <td class="num">${formatVal(r.discountAmount)}</td>
          <td class="num font-bold">${formatVal(r.excludingSalesTax)}</td>
          <td class="center">${r.type === 'variant' ? formatPct(r.salesTaxPercent) : '-'}</td>
          <td class="num">${formatVal(r.salesTaxAmount)}</td>
          <td class="num">${formatVal(r.furtherTaxAmount)}</td>
          <td class="num">${formatVal(r.totalTax)}</td>
          <td class="num font-bold">${formatVal(r.includingSalesTax)}</td>
          <td>${r.salesPerson || '-'}</td>
        </tr>
      `;
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #1e293b;
            font-size: 5.5px;
            margin: 0;
            padding: 0;
            background: #ffffff;
          }
          .header-block {
            border-bottom: 2px solid #0f172a;
            padding-bottom: 8px;
            margin-bottom: 12px;
          }
          .company-name {
            font-size: 11px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #0f172a;
          }
          .report-title {
            font-size: 9px;
            font-weight: 700;
            color: #475569;
            margin-top: 2px;
          }
          .meta-info {
            font-size: 7.5px;
            color: #64748b;
            margin-top: 4px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
          tr {
            page-break-inside: avoid;
          }
          thead {
            display: table-header-group;
          }
          th {
            background-color: #1e293b;
            color: #ffffff;
            font-weight: 700;
            text-transform: uppercase;
            font-size: 5.5px;
            padding: 3px 2px;
            border: 1px solid #475569;
            text-align: center;
          }
          td {
            padding: 3px 2px;
            border: 1px solid #cbd5e1;
            vertical-align: middle;
            word-wrap: break-word;
          }
          td.num {
            text-align: right;
          }
          td.center {
            text-align: center;
          }
          td.label-col {
            font-family: monospace;
          }
          .group-row {
            font-weight: bold;
            color: #0f172a;
          }
          .group-row.depth-1 {
            background-color: #f1f5f9;
            font-size: 6px;
          }
          .group-row.depth-2 {
            background-color: #e2e8f0;
            font-size: 6px;
          }
          .variant-row {
            color: #475569;
          }
          .grand-total-row {
            background-color: #cbd5e1;
            color: #0f172a;
            font-weight: bold;
            font-size: 6.5px;
            border-top: 2px solid #0f172a;
            border-bottom: 2px double #0f172a;
          }
        </style>
      </head>
      <body>
        <div class="header-block">
          <div class="company-name">Speed (Pvt.) Limited</div>
          <div class="report-title">${reportLabel}</div>
          <div class="meta-info">
            <strong>Location:</strong> ${locationName} | 
            <strong>Period:</strong> ${fromDateStr} - ${toDateStr}
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>GPC / Category / Product</th>
              <th>Size</th>
              <th>Color</th>
              <th>Qty</th>
              <th>Retail Price</th>
              <th>Total Price WOST</th>
              <th>Discount Amount</th>
              <th>Excluding Sales Tax</th>
              <th>Sales Tax %</th>
              <th>Sales Tax Amount</th>
              <th>Further Tax</th>
              <th>Total Tax</th>
              <th>Including Sales Tax</th>
              <th>Sales Person</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            <tr class="grand-total-row">
              <td>GRAND TOTALS</td>
              <td class="center">-</td>
              <td class="center">-</td>
              <td class="num">${grandTotals.qty}</td>
              <td class="num">-</td>
              <td class="num">${formatVal(grandTotals.totalPriceWost)}</td>
              <td class="num">${formatVal(grandTotals.discountAmount)}</td>
              <td class="num">${formatVal(grandTotals.excludingSalesTax)}</td>
              <td class="center">-</td>
              <td class="num">${formatVal(grandTotals.salesTaxAmount)}</td>
              <td class="num">${formatVal(grandTotals.furtherTaxAmount)}</td>
              <td class="num">${formatVal(grandTotals.totalTax)}</td>
              <td class="num font-bold">${formatVal(grandTotals.includingSalesTax)}</td>
              <td>&nbsp;</td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `;
  }
}
