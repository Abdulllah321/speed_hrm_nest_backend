import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import * as puppeteer from 'puppeteer';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { ExportHistoryService } from '../../warehouse/export-history/export-history.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { WholesaleReturnRegisterService, WholesaleReturnRegisterResult } from './wholesale-return-register.service';

interface WholesaleReturnExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  companyId?: string;
  tenantDbUrl: string;
  customerId?: string;
  startDate?: string;
  endDate?: string;
  format: 'xlsx' | 'pdf';
  reportType?: 'merged' | 'separate';
  search?: string;
}

export interface WholesaleReturnPreviewJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  customerId?: string;
  startDate?: string;
  endDate?: string;
  reportType?: 'merged' | 'separate';
  search?: string;
  fiscalYear?: string;
  year?: string | number;
}

const COLUMNS = [
  { header: 'Customer', key: 'customerName', width: 25, align: 'left' },
  { header: 'Invoice No', key: 'invoiceNo', width: 20, align: 'left' },
  { header: 'Date', key: 'invoiceDate', width: 15, align: 'center' },
  { header: 'GPC / Category', key: 'categoryName', width: 20, align: 'left' },
  { header: 'Brand / SubCat', key: 'brandName', width: 20, align: 'left' },
  { header: 'Product', key: 'description', width: 25, align: 'left' },
  { header: 'Color', key: 'colorName', width: 14, align: 'center' },
  { header: 'Size', key: 'sizeName', width: 10, align: 'center' },
  { header: 'Qty', key: 'quantity', width: 10, align: 'right', numFmt: '#,##0' },
  { header: 'Selling Price', key: 'unitPrice', width: 16, align: 'right', numFmt: '#,##0.00' },
  { header: 'Value Excl Tax', key: 'wostAmount', width: 18, align: 'right', numFmt: '#,##0.00' },
  { header: 'Discount', key: 'discountAmount', width: 16, align: 'right', numFmt: '#,##0.00' },
  { header: 'Sales Tax', key: 'taxAmount', width: 16, align: 'right', numFmt: '#,##0.00' },
  { header: 'Add. Tax', key: 'addTaxAmount', width: 16, align: 'right', numFmt: '#,##0.00' },
  { header: 'Tax Payable', key: 'taxPayable', width: 16, align: 'right', numFmt: '#,##0.00' },
  { header: 'Value Incl Tax', key: 'subTotal', width: 20, align: 'right', numFmt: '#,##0.00' },
];

@Processor('sales-invoice-export')
export class WholesaleReturnRegisterProcessor {
  private readonly logger = new Logger(WholesaleReturnRegisterProcessor.name);

  constructor(
    private readonly wholesaleReturnService: WholesaleReturnRegisterService,
    private readonly exportHistoryService: ExportHistoryService,
    private readonly notificationsService: NotificationsService,
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

  @Process('generate-wholesale-return-register-preview')
  async handleGeneratePreview(job: Job<WholesaleReturnPreviewJobData>): Promise<void> {
    const {
      jobId,
      tenantId,
      tenantDbUrl,
      customerId,
      startDate,
      endDate,
      reportType,
      search,
      fiscalYear,
      year,
    } = job.data;
    this.logger.log(`[WholesaleReturnPreview ${jobId}] Starting background wholesale-return preview computation`);

    const prisma = (tenantId && tenantDbUrl)
      ? PrismaService.getTenantClient(tenantId, tenantDbUrl)
      : new PrismaService({ tenantId, tenantDbUrl } as any);

    try {
      await job.progress({ percent: 10, message: 'Queueing wholesale invoice register preview computation task...' });

      const result = await this.wholesaleReturnService.generateWholesaleReturnRegisterDataInternal(
        prisma as any,
        {
          customerId,
          startDate,
          endDate,
          reportType,
          search,
          fiscalYear,
          year,
          onProgress: async (percent, message) => {
            await job.progress({ percent, message });
          },
        },
      );

      await this.wholesaleReturnService.saveReportPreviewResult(jobId, result);
      await job.progress({ percent: 100, message: 'Successfully generated wholesale-return preview result' });
      this.logger.log(`[WholesaleReturnPreview ${jobId}] Successfully generated and saved preview result`);
    } catch (err: any) {
      this.logger.error(`[WholesaleReturnPreview ${jobId}] Exception in background computation: ${err.message}`, err.stack);
      throw err;
    }
  }

  @Process('export-wholesale-return-register-report')
  async handleExport(job: Job<WholesaleReturnExportJobData>): Promise<void> {
    const {
      jobId,
      userId,
      tenantId,
      companyId,
      tenantDbUrl,
      customerId,
      startDate,
      endDate,
      format,
      search,
    } = job.data;

    return PrismaService.asyncLocalStorage.run(
      {
        tenantId,
        companyId: companyId || tenantId,
        dbUrl: tenantDbUrl,
      },
      async () => {
        const reportLabel = 'Wholesale Invoice Register';
        this.logger.log(`[WholesaleReturnExport ${jobId}] Starting ${format.toUpperCase()} export for ${reportLabel}`);

        const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);
        const prismaMaster = new PrismaMasterService();
        const exportDir = path.join(process.cwd(), 'uploads', 'exports');
        fs.mkdirSync(exportDir, { recursive: true });
        const ext = format === 'pdf' ? 'pdf' : 'xlsx';
        const filePath = path.join(exportDir, `export-${jobId}.${ext}`);

        try {
          await job.progress({ percent: 15, message: 'Loading details & parameters...' });

          const result = await this.wholesaleReturnService.generateWholesaleReturnRegisterDataInternal(
            prisma as any,
            {
              customerId,
              startDate,
              endDate,
              search,
              onProgress: async (percent, message) => {
                 await job.progress({ percent: 15 + percent * 0.35, message });
              }
            },
          );

          const rows = result.flatItems || [];
          const grandTotals = result.grandTotals;

          await job.progress({ percent: 50, message: `Loaded ${rows.length.toLocaleString()} rows. Aggregating totals...` });

          if (format === 'pdf') {
            const fromStr = startDate ? new Date(startDate).toLocaleDateString() : '';
            const toStr = endDate ? new Date(endDate).toLocaleDateString() : '';
            const html = this.buildPdfHtml(rows, fromStr, toStr, grandTotals, reportLabel);

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

            let processedRows = 0;
            const totalRowsCount = rows.length;

            for (const r of rows) {
              processedRows++;
              if (processedRows % 250 === 0 || processedRows === totalRowsCount) {
                const pct = 50 + Math.floor((processedRows / Math.max(1, totalRowsCount)) * 45);
                await job.progress({
                  percent: Math.min(95, pct),
                  message: `Streaming row ${processedRows.toLocaleString()} of ${totalRowsCount.toLocaleString()}...`,
                });
              }
              const rowData = {
                customerName: r.customerName,
                invoiceNo: r.invoiceNo,
                invoiceDate: new Date(r.invoiceDate).toLocaleDateString(),
                categoryName: r.categoryName,
                brandName: r.brandName,
                description: r.description,
                colorName: r.colorName,
                sizeName: r.sizeName,
                quantity: r.quantity,
                unitPrice: r.unitPrice,
                wostAmount: r.wostAmount,
                discountAmount: r.discountAmount,
                taxAmount: r.taxAmount,
                addTaxAmount: r.addTaxAmount,
                taxPayable: r.taxPayable,
                subTotal: r.subTotal,
              };

              const row = ws.addRow(rowData);

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
                cell.font = { size: 8.5 };
              }
              row.height = 20;
              row.commit();
            }

            // Add Grand Totals
            const totalRow = ws.addRow({
              customerName: 'GRAND TOTALS',
              invoiceNo: '',
              invoiceDate: '',
              categoryName: '',
              brandName: '',
              description: '',
              colorName: '',
              sizeName: '',
              quantity: grandTotals.totalItems,
              unitPrice: '',
              wostAmount: grandTotals.wostAmount,
              discountAmount: grandTotals.discountAmount,
              taxAmount: grandTotals.taxAmount,
              addTaxAmount: 0,
              taxPayable: grandTotals.taxAmount,
              subTotal: grandTotals.netAmount,
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
            ? `wholesale-return-register-report-${new Date().toISOString().slice(0, 10)}.pdf`
            : `wholesale-return-register-report-${new Date().toISOString().slice(0, 10)}.xlsx`;

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
            actionType: `wholesale-return-export.ready`,
            actionPayload: JSON.stringify({ jobId }),
          });

          await job.progress(100);
          this.logger.log(`[WholesaleReturnExport ${jobId}] Finished processing successfully`);
        } catch (err) {
          this.logger.error(`[WholesaleReturnExport ${jobId}] Failed: ${err.message}`, err.stack);
          await this.exportHistoryService.failExport(prisma, jobId);
          throw err;
        } finally {
          await prismaMaster.$disconnect();
        }
      },
    );
  }

  private buildPdfHtml(
    data: any[],
    fromDateStr: string,
    toDateStr: string,
    grandTotals: any,
    reportLabel: string
  ): string {
    let rowsHtml = '';
    const formatVal = (val: number) => val === 0 ? '-' : val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    for (const r of data) {
      rowsHtml += `
        <tr class="variant-row">
          <td>${r.customerName || '-'}</td>
          <td class="center">${r.invoiceNo || '-'}</td>
          <td class="center">${new Date(r.invoiceDate).toLocaleDateString()}</td>
          <td>${r.categoryName || '-'}</td>
          <td>${r.brandName || '-'}</td>
          <td>${r.description || '-'}</td>
          <td class="center">${r.colorName || '-'}</td>
          <td class="center">${r.sizeName || '-'}</td>
          <td class="num font-bold">${r.quantity || '-'}</td>
          <td class="num">${formatVal(r.unitPrice)}</td>
          <td class="num font-bold">${formatVal(r.wostAmount)}</td>
          <td class="num">${formatVal(r.discountAmount)}</td>
          <td class="num">${formatVal(r.taxAmount)}</td>
          <td class="num">${formatVal(r.addTaxAmount)}</td>
          <td class="num">${formatVal(r.taxPayable)}</td>
          <td class="num font-bold">${formatVal(r.subTotal)}</td>
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
            <strong>Period:</strong> ${fromDateStr} - ${toDateStr}
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Invoice No</th>
              <th>Date</th>
              <th>GPC / Category</th>
              <th>Brand / SubCat</th>
              <th>Product</th>
              <th>Color</th>
              <th>Size</th>
              <th>Qty</th>
              <th>Selling Price</th>
              <th>Value Excl Tax</th>
              <th>Discount</th>
              <th>Sales Tax</th>
              <th>Add Tax</th>
              <th>Tax Payable</th>
              <th>Value Incl Tax</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            <tr class="grand-total-row">
              <td>GRAND TOTALS</td>
              <td class="center">-</td>
              <td class="center">-</td>
              <td class="center">-</td>
              <td class="center">-</td>
              <td class="center">-</td>
              <td class="center">-</td>
              <td class="center">-</td>
              <td class="num">${grandTotals.totalItems}</td>
              <td class="num">-</td>
              <td class="num">${formatVal(grandTotals.wostAmount)}</td>
              <td class="num">${formatVal(grandTotals.discountAmount)}</td>
              <td class="num">${formatVal(grandTotals.taxAmount)}</td>
              <td class="num">-</td>
              <td class="num">${formatVal(grandTotals.taxAmount)}</td>
              <td class="num font-bold">${formatVal(grandTotals.netAmount)}</td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `;
  }
}
