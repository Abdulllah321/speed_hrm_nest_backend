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
import { StockLedgerService } from './stock-ledger.service';

export interface StockTransactionDetailExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  locationId?: string;
  warehouseId?: string;
  itemId?: string;
  startDate?: string;
  endDate?: string;
  format: 'xlsx' | 'pdf';
  search?: string;
  showBrand?: boolean;
  showDivision?: boolean;
  showCategory?: boolean;
  showGender?: boolean;
  showSilhouette?: boolean;
  showArticle?: boolean;
  showVariant?: boolean;
}

const LEVEL_COLORS: Record<string, string> = {
  brand: 'F1F5F9', // slate-100
  division: 'F8FAFC', // slate-50
  category: 'F1F5F9',
  gender: 'F8FAFC',
  silhouette: 'F1F5F9',
  article: 'E2E8F0', // slate-200
  variant: 'CBD5E1', // slate-300
};

@Processor('stock-transaction-detail-export')
export class StockTransactionDetailExportProcessor {
  private readonly logger = new Logger(StockTransactionDetailExportProcessor.name);

  constructor(
    private readonly stockLedgerService: StockLedgerService,
    private readonly notificationsService: NotificationsService,
    private readonly exportHistoryService: ExportHistoryService,
  ) {
    if (process.platform === 'linux') {
      try {
        const { exec } = require('child_process');
        exec(
          'apt-get update && apt-get install -y libatk1.0-0 libatk-bridge2.0-0 libcups2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpangocairo-1.0-0 libasound2 libnss3 libxshmfence1 libgtk-3-0',
          (err: any) => {
            if (err) {
              this.logger.warn(`Could not install Chromium dependencies automatically: ${err.message}`);
            }
          }
        );
      } catch (e: any) {
        this.logger.warn(`Error trying to run chromium dependencies installer: ${e.message}`);
      }
    }
  }

  @Process({ concurrency: 1 })
  async handleExport(job: Job<StockTransactionDetailExportJobData>): Promise<void> {
    const {
      jobId, userId, tenantId, tenantDbUrl, locationId, warehouseId, itemId, startDate: startStr, endDate: endStr, format, search,
      showBrand, showDivision, showCategory, showGender, showSilhouette, showArticle, showVariant
    } = job.data;
    this.logger.log(`[StockTransactionDetailExport ${jobId}] Starting ${format.toUpperCase()} export for user ${userId}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);

    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const ext = format === 'pdf' ? 'pdf' : 'xlsx';
    const filePath = path.join(exportDir, `export-${jobId}.${ext}`);

    try {
      await job.progress(10);

      // Fetch location or warehouse name for the header
      const locIds = locationId ? locationId.split(',').map(s => s.trim()).filter(Boolean) : [];
      const whIds = warehouseId ? warehouseId.split(',').map(s => s.trim()).filter(Boolean) : [];

      let targetName = '';
      if (locIds.length > 0) {
        const locs = await prisma.location.findMany({ where: { id: { in: locIds } }, select: { name: true } });
        targetName += locs.map(l => l.name).join(', ');
      }
      if (whIds.length > 0) {
        if (targetName) targetName += ' & ';
        const whs = await prisma.warehouse.findMany({ where: { id: { in: whIds } }, select: { name: true } });
        targetName += whs.map(w => w.name).join(', ');
      }
      if (!targetName) targetName = 'All Locations & Warehouses';

      const now = new Date();
      const startDate = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate = endStr ? new Date(endStr) : new Date(now);

      await job.progress(20);

      // Fetch aggregated report data
      const { root, grandTotals } = await this.stockLedgerService.getStockTransactionDetailReport({
        locationId,
        warehouseId,
        itemId,
        search,
        startDate: startStr,
        endDate: endStr,
        showBrand,
        showDivision,
        showCategory,
        showGender,
        showSilhouette,
        showArticle,
        showVariant,
      }, prisma);

      await job.progress(50);

      if (format === 'pdf') {
        const fromDateStr = startDate.toLocaleDateString();
        const toDateStr = endDate.toLocaleDateString();
        const html = this.buildPdfHtml(root, targetName, fromDateStr, toDateStr, grandTotals);

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
          await page.setContent(html, { waitUntil: 'domcontentloaded' });

          const pdfBuffer = await page.pdf({
            format: 'A4',
            landscape: true,
            margin: { top: '15mm', bottom: '15mm', left: '10mm', right: '10mm' },
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate: `<div style="font-size: 7px; width: 100%; text-align: right; padding-right: 15mm; color: #94a3b8;">Speed (Pvt.) Limited | Stock Transaction Detail Report</div>`,
            footerTemplate: `<div style="font-size: 7px; width: 100%; text-align: center; color: #94a3b8;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
          });

          fs.writeFileSync(filePath, pdfBuffer);
        } finally {
          await browser.close();
        }
      } else {
        // ExcelJS Workbook generation
        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
          filename: filePath,
          useStyles: true,
          useSharedStrings: false,
        });

        const ws = workbook.addWorksheet('Transaction Details', {
          pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
        });

        // 7 columns
        ws.columns = [
          { header: 'Date', key: 'date', width: 15 },
          { header: 'Doc Type', key: 'docType', width: 22 },
          { header: 'Doc Ref', key: 'docRef', width: 18 },
          { header: 'Narration / Remarks', key: 'remarks', width: 35 },
          { header: 'In', key: 'inQty', width: 12 },
          { header: 'Out', key: 'outQty', width: 12 },
          { header: 'Balance', key: 'balance', width: 14 },
        ];

        // Format worksheet titles
        const titleRow = ws.getRow(1);
        titleRow.getCell(1).value = 'STOCK TRANSACTION DETAIL REPORT';
        titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: 'FF1E293B' } };
        titleRow.commit();

        const infoRow = ws.getRow(2);
        infoRow.getCell(1).value = `Location/Warehouse: ${targetName}  |  Period: ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`;
        infoRow.getCell(1).font = { italic: true, size: 10, color: { argb: 'FF475569' } };
        infoRow.commit();

        // Write empty row
        ws.getRow(3).commit();

        let currentRowNum = 4;

        const borderThin = {
          top: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
        };

        const formatQty = (v: number) => (v === 0 ? '-' : v);

        const writeNode = async (node: any, indent = 0) => {
          const row = ws.getRow(currentRowNum);
          
          // Header Row for Group
          const labelPrefix = '  '.repeat(indent);
          const label = `${node.level.toUpperCase()}: ${node.value}`;
          row.getCell(1).value = labelPrefix + label;
          row.getCell(1).font = { bold: true, size: 10 };
          row.getCell(7).value = `Open: ${node.totals.openingBalance}  |  Close: ${node.totals.closingBalance}  |  Transit: ${node.totals.inTransitQty}`;
          row.getCell(7).font = { bold: true, size: 9, color: { argb: 'FF475569' } };

          const colFillColor = LEVEL_COLORS[node.level] || 'F1F5F9';
          for (let c = 1; c <= 7; c++) {
            const cell = row.getCell(c);
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${colFillColor}` } };
            cell.border = borderThin;
          }
          row.height = 20;
          row.commit();
          currentRowNum++;

          // If leaf node, write transaction details
          if (node.transactions) {
            // Write ledger columns headers
            const ledgerHeaderRow = ws.getRow(currentRowNum);
            const headers = ['Date', 'Doc Type', 'Doc Ref', 'Narration / Remarks', 'In', 'Out', 'Balance'];
            headers.forEach((h, idx) => {
              const cell = ledgerHeaderRow.getCell(idx + 1);
              cell.value = h;
              cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
              cell.alignment = { horizontal: idx >= 4 ? 'right' : 'left' };
              cell.border = borderThin;
            });
            ledgerHeaderRow.height = 18;
            ledgerHeaderRow.commit();
            currentRowNum++;

            // Opening Balance row
            const opRow = ws.getRow(currentRowNum);
            opRow.getCell(1).value = startDate.toLocaleDateString();
            opRow.getCell(2).value = 'Opening Balance';
            opRow.getCell(3).value = '-';
            opRow.getCell(4).value = 'Opening Balance B/F';
            opRow.getCell(5).value = '-';
            opRow.getCell(6).value = '-';
            opRow.getCell(7).value = node.openingBalance;
            
            for (let c = 1; c <= 7; c++) {
              const cell = opRow.getCell(c);
              cell.font = { size: 9, color: { argb: 'FF475569' } };
              cell.alignment = { horizontal: c >= 5 ? 'right' : 'left' };
              cell.border = borderThin;
            }
            opRow.height = 18;
            opRow.commit();
            currentRowNum++;

            // Transactions rows
            for (const t of node.transactions) {
              const txRow = ws.getRow(currentRowNum);
              txRow.getCell(1).value = new Date(t.date).toLocaleDateString();
              txRow.getCell(2).value = t.docType;
              txRow.getCell(3).value = t.docRef;
              txRow.getCell(4).value = t.remarks;
              txRow.getCell(5).value = formatQty(t.inQty);
              txRow.getCell(6).value = formatQty(t.outQty);
              txRow.getCell(7).value = t.balance;

              for (let c = 1; c <= 7; c++) {
                const cell = txRow.getCell(c);
                cell.font = { size: 9 };
                cell.alignment = { horizontal: c >= 5 ? 'right' : 'left' };
                cell.border = borderThin;
                if (t.isInTransit) {
                  cell.font = { italic: true, color: { argb: 'FFB45309' }, size: 9 }; // Amber italic for transit
                }
              }
              txRow.height = 18;
              txRow.commit();
              currentRowNum++;
            }

            // Closing Balance row
            const clRow = ws.getRow(currentRowNum);
            clRow.getCell(1).value = endDate.toLocaleDateString();
            clRow.getCell(2).value = 'Closing Balance';
            clRow.getCell(3).value = '-';
            clRow.getCell(4).value = 'Closing Balance C/F';
            clRow.getCell(5).value = '-';
            clRow.getCell(6).value = '-';
            clRow.getCell(7).value = node.closingBalance;

            for (let c = 1; c <= 7; c++) {
              const cell = clRow.getCell(c);
              cell.font = { bold: true, size: 9, color: { argb: 'FF0F172A' } };
              cell.alignment = { horizontal: c >= 5 ? 'right' : 'left' };
              cell.border = borderThin;
            }
            clRow.height = 18;
            clRow.commit();
            currentRowNum++;

            // Empty spacing row
            ws.getRow(currentRowNum).commit();
            currentRowNum++;
          }

          if (node.children && node.children.length > 0) {
            for (const child of node.children) {
              await writeNode(child, indent + 1);
            }
          }
        };

        for (const rootNode of root) {
          await writeNode(rootNode, 0);
        }

        // Write Grand Totals row at the very end
        const gtRow = ws.getRow(currentRowNum);
        gtRow.getCell(1).value = 'GRAND TOTALS';
        gtRow.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        gtRow.getCell(7).value = `Open: ${grandTotals.openingBalance}  |  Close: ${grandTotals.closingBalance}  |  Transit: ${grandTotals.inTransitQty}`;
        gtRow.getCell(7).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        for (let c = 1; c <= 7; c++) {
          const cell = gtRow.getCell(c);
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
          cell.border = borderThin;
        }
        gtRow.height = 22;
        gtRow.commit();

        await workbook.commit();
      }

      await job.progress(95);

      // Complete and upload file to S3 via ExportHistoryService
      const mimeType = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const fileName = `stock-transaction-details-${targetName}-${startDate.toISOString().slice(0, 10)}.${ext}`;
      await this.exportHistoryService.completeAndUploadExport(prisma, jobId, filePath, fileName, mimeType);

      await job.progress(100);

      // Send UI success notification
      await this.notificationsService.create({
        userId,
        title: 'Report Ready',
        message: `Your Stock Transaction Detail Report for ${targetName} is ready for download.`,
        category: 'export',
        priority: 'high',
        actionType: 'stock-transaction-detail-export.ready',
        actionPayload: JSON.stringify({ jobId }),
      });

      this.logger.log(`[StockTransactionDetailExport ${jobId}] Export completed successfully and uploaded.`);
    } catch (err: any) {
      this.logger.error(`[StockTransactionDetailExport ${jobId}] Processing failed: ${err.message}`, err.stack);
      await this.exportHistoryService.failExport(prisma, jobId);
      
      await this.notificationsService.create({
        userId,
        title: 'Report Generation Failed',
        message: `Your Stock Transaction Detail Report failed to generate: ${err.message}`,
        category: 'export',
        priority: 'high',
        actionType: 'stock-transaction-detail-export.failed',
        actionPayload: JSON.stringify({ jobId, error: err.message }),
      });
      throw err;
    }
  }

  private buildPdfHtml(root: any[], locationName: string, fromDateStr: string, toDateStr: string, grandTotals: any): string {
    const renderNodeHtml = (node: any, indent = 0): string => {
      let html = '';
      const indentStyle = `padding-left: ${indent * 16}px;`;
      const levelColors: Record<string, string> = {
        brand: '#f1f5f9',
        division: '#f8fafc',
        category: '#f1f5f9',
        gender: '#f8fafc',
        silhouette: '#f1f5f9',
        article: '#e2e8f0',
        variant: '#cbd5e1',
      };
      const bg = levelColors[node.level] || '#ffffff';

      html += `
        <tr style="background-color: ${bg}; font-weight: bold; height: 32px;">
          <td colspan="4" style="${indentStyle} border: 1px solid #e2e8f0; font-size: 11px;">
            ${node.level.toUpperCase()}: ${node.value}
          </td>
          <td colspan="3" style="border: 1px solid #e2e8f0; text-align: right; font-size: 10px; color: #475569; padding-right: 8px;">
            Open: ${node.totals.openingBalance} &bull; Close: ${node.totals.closingBalance} &bull; Transit: ${node.totals.inTransitQty}
          </td>
        </tr>
      `;

      if (node.transactions) {
        // Table headers for leaf ledger card
        html += `
          <tr style="background-color: #334155; color: #ffffff; font-weight: bold; font-size: 9px; height: 26px;">
            <th style="width: 12%; border: 1px solid #cbd5e1; text-align: left; padding-left: 8px;">Date</th>
            <th style="width: 15%; border: 1px solid #cbd5e1; text-align: left; padding-left: 8px;">Doc Type</th>
            <th style="width: 12%; border: 1px solid #cbd5e1; text-align: left; padding-left: 8px;">Doc Ref</th>
            <th style="width: 33%; border: 1px solid #cbd5e1; text-align: left; padding-left: 8px;">Narration / Remarks</th>
            <th style="width: 9%; border: 1px solid #cbd5e1; text-align: right; padding-right: 8px;">In</th>
            <th style="width: 9%; border: 1px solid #cbd5e1; text-align: right; padding-right: 8px;">Out</th>
            <th style="width: 10%; border: 1px solid #cbd5e1; text-align: right; padding-right: 8px;">Balance</th>
          </tr>
        `;

        // Opening balance row
        html += `
          <tr style="font-size: 9px; height: 24px; color: #475569;">
            <td style="border: 1px solid #e2e8f0; padding-left: 8px;">${fromDateStr}</td>
            <td style="border: 1px solid #e2e8f0; padding-left: 8px;">Opening Balance</td>
            <td style="border: 1px solid #e2e8f0; padding-left: 8px;">-</td>
            <td style="border: 1px solid #e2e8f0; padding-left: 8px;">Opening Balance B/F</td>
            <td style="border: 1px solid #e2e8f0; text-align: right; padding-right: 8px;">-</td>
            <td style="border: 1px solid #e2e8f0; text-align: right; padding-right: 8px;">-</td>
            <td style="border: 1px solid #e2e8f0; text-align: right; padding-right: 8px; font-weight: bold;">${node.openingBalance}</td>
          </tr>
        `;

        // Transactions
        for (const t of node.transactions) {
          const inVal = t.inQty === 0 ? '-' : t.inQty;
          const outVal = t.outQty === 0 ? '-' : t.outQty;
          const inlineStyle = t.isInTransit ? 'font-style: italic; color: #b45309;' : '';

          html += `
            <tr style="font-size: 9px; height: 24px; ${inlineStyle}">
              <td style="border: 1px solid #e2e8f0; padding-left: 8px;">${new Date(t.date).toLocaleDateString()}</td>
              <td style="border: 1px solid #e2e8f0; padding-left: 8px;">${t.docType}</td>
              <td style="border: 1px solid #e2e8f0; padding-left: 8px;">${t.docRef}</td>
              <td style="border: 1px solid #e2e8f0; padding-left: 8px;">${t.remarks}</td>
              <td style="border: 1px solid #e2e8f0; text-align: right; padding-right: 8px;">${inVal}</td>
              <td style="border: 1px solid #e2e8f0; text-align: right; padding-right: 8px;">${outVal}</td>
              <td style="border: 1px solid #e2e8f0; text-align: right; padding-right: 8px; font-weight: bold;">${t.balance}</td>
            </tr>
          `;
        }

        // Closing balance row
        html += `
          <tr style="font-size: 9px; height: 24px; color: #0f172a; font-weight: bold; background-color: #f8fafc;">
            <td style="border: 1px solid #cbd5e1; padding-left: 8px;">${toDateStr}</td>
            <td style="border: 1px solid #cbd5e1; padding-left: 8px;">Closing Balance</td>
            <td style="border: 1px solid #cbd5e1; padding-left: 8px;">-</td>
            <td style="border: 1px solid #cbd5e1; padding-left: 8px;">Closing Balance C/F</td>
            <td style="border: 1px solid #cbd5e1; text-align: right; padding-right: 8px;">-</td>
            <td style="border: 1px solid #cbd5e1; text-align: right; padding-right: 8px;">-</td>
            <td style="border: 1px solid #cbd5e1; text-align: right; padding-right: 8px;">${node.closingBalance}</td>
          </tr>
          <tr style="height: 12px;"><td colspan="7"></td></tr>
        `;
      }

      if (node.children && node.children.length > 0) {
        for (const child of node.children) {
          html += renderNodeHtml(child, indent + 1);
        }
      }
      return html;
    };

    let nodesHtml = '';
    for (const rootNode of root) {
      nodesHtml += renderNodeHtml(rootNode, 0);
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: 'Inter', 'Outfit', sans-serif;
            color: #1e293b;
            margin: 0;
            padding: 10px;
            background-color: #ffffff;
          }
          .header {
            margin-bottom: 25px;
            border-bottom: 2px solid #334155;
            padding-bottom: 12px;
          }
          .company-name {
            font-size: 14px;
            font-weight: 800;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            color: #475569;
          }
          .title {
            font-size: 20px;
            font-weight: 900;
            color: #1e293b;
            margin: 4px 0;
          }
          .meta-info {
            font-size: 9px;
            color: #64748b;
            font-weight: 550;
            margin-top: 6px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            page-break-inside: auto;
          }
          tr {
            page-break-inside: avoid;
          }
          th, td {
            padding: 4px 6px;
            box-sizing: border-box;
          }
          .grand-totals {
            background-color: #1e293b;
            color: #ffffff;
            font-weight: bold;
            font-size: 10px;
            height: 34px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="company-name">Speed (Pvt.) Limited</div>
          <div class="title">Stock Transaction Detail Report</div>
          <div class="meta-info">
            <strong>Location/Warehouse:</strong> ${locationName} &bull; 
            <strong>Period:</strong> ${fromDateStr} to ${toDateStr}
          </div>
        </div>

        <table>
          <colgroup>
            <col style="width: 12%;" />
            <col style="width: 15%;" />
            <col style="width: 12%;" />
            <col style="width: 33%;" />
            <col style="width: 9%;" />
            <col style="width: 9%;" />
            <col style="width: 10%;" />
          </colgroup>
          <tbody>
            ${nodesHtml}
            <tr class="grand-totals">
              <td colspan="4" style="border: 1px solid #1e293b; padding-left: 8px;">GRAND TOTALS</td>
              <td colspan="3" style="border: 1px solid #1e293b; text-align: right; padding-right: 8px;">
                Open: ${grandTotals.openingBalance} &bull; Close: ${grandTotals.closingBalance} &bull; Transit: ${grandTotals.inTransitQty}
              </td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `;
  }
}
