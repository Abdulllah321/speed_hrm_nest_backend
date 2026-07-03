import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import * as puppeteer from 'puppeteer';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ExportHistoryService } from '../warehouse/export-history/export-history.service';

export interface NetSalesSummaryExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  locationId: string;
  startDate?: string;
  endDate?: string;
  cashierUserId?: string;
  format: 'xlsx' | 'pdf';
  summaryOnly?: boolean;
  showSalesperson?: boolean;
  showYear?: boolean;
  showMonth?: boolean;
  showDay?: boolean;
  showDocument?: boolean;
  showBrand?: boolean;
  showDivision?: boolean;
  showSalesTax?: boolean;
  showCategory?: boolean;
  showGender?: boolean;
  showSilhouette?: boolean;
  showArticle?: boolean;
  showVariant?: boolean;
}

const GROUP_COLORS: Record<string, string> = {
  General: '1E293B',
  Sales: '065F46',
  Taxes: '1E3A8A',
};

const COLUMNS = [
  { header: 'Year | Month | Day | Document Type & # / Product', key: 'sku', width: 35, group: 'General' },
  { header: 'Size', key: 'size', width: 10, group: 'General', align: 'center' as const },
  { header: 'Qty', key: 'qty', width: 10, group: 'General', align: 'right' as const },
  { header: 'Retail Price (Rs.)', key: 'retailPrice', width: 18, group: 'General', align: 'right' as const, numFmt: '#,##0.00' },
  { header: 'Total Price WOST', key: 'totalPriceWost', width: 18, group: 'Sales', align: 'right' as const, numFmt: '#,##0.00' },
  { header: 'Discount Amount (Rs.)', key: 'discountAmount', width: 20, group: 'Sales', align: 'right' as const, numFmt: '#,##0.00' },
  { header: 'Value Excluding Sales Tax (Rs.)', key: 'valueExclTax', width: 25, group: 'Sales', align: 'right' as const, numFmt: '#,##0.00' },
  { header: 'Sales Tax Amount (Rs.)', key: 'salesTaxAmount', width: 20, group: 'Taxes', align: 'right' as const, numFmt: '#,##0.00' },
  { header: 'Total Tax (Rs.)', key: 'totalTax', width: 18, group: 'Taxes', align: 'right' as const, numFmt: '#,##0.00' },
  { header: 'Value Including Sales Tax (Rs.)', key: 'valueInclTax', width: 25, group: 'Taxes', align: 'right' as const, numFmt: '#,##0.00' },
];

@Processor('net-sales-summary-export')
export class NetSalesSummaryExportProcessor {
  private readonly logger = new Logger(NetSalesSummaryExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly exportHistoryService: ExportHistoryService,
  ) {
    if (process.platform === 'linux') {
      try {
        const logger = new Logger('NetSalesSummaryExportProcessor');
        logger.log('Checking and installing Chromium dependencies on Linux host...');
        const { exec } = require('child_process');
        exec(
          'apt-get update && apt-get install -y libatk1.0-0 libatk-bridge2.0-0 libcups2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpangocairo-1.0-0 libasound2 libnss3 libxshmfence1 libgtk-3-0',
          (err: any) => {
            if (err) {
              logger.warn(`Could not install Chromium dependencies automatically: ${err.message}. If not running as root, please install them manually.`);
            } else {
              logger.log('Chromium dependencies verified/installed successfully.');
            }
          }
        );
      } catch (e: any) {
        this.logger.warn(`Error trying to run chromium dependencies installer: ${e.message}`);
      }
    }
  }

  @Process({ concurrency: 1 })
  async handleExport(job: Job<NetSalesSummaryExportJobData>): Promise<void> {
    const {
      jobId, userId, tenantId, tenantDbUrl, locationId, startDate: startStr, endDate: endStr, cashierUserId, format, summaryOnly,
      showSalesperson, showYear, showMonth, showDay, showDocument,
      showBrand, showDivision, showSalesTax, showCategory, showGender, showSilhouette, showArticle, showVariant
    } = job.data;
    this.logger.log(`[NetSalesSummaryExport ${jobId}] Starting ${format.toUpperCase()} export for user ${userId}`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);
    const prismaMaster = new PrismaMasterService();
    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const ext = format === 'pdf' ? 'pdf' : 'xlsx';
    const filePath = path.join(exportDir, `export-${jobId}.${ext}`);

    try {
      await job.progress(5);

      const location = await prisma.location.findUnique({
        where: { id: locationId },
        select: { name: true },
      });
      const locationName = location?.name || 'Store';

      const now = new Date();
      const startDate = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate = endStr ? new Date(endStr) : new Date(now);
      endDate.setHours(23, 59, 59, 999);

      await job.progress(15);

      // Query sales items
      const orderItems = await prisma.salesOrderItem.findMany({
        where: {
          salesOrder: {
            locationId,
            status: { in: ['completed', 'partially_returned', 'refunded', 'exchanged'] },
            createdAt: { gte: startDate, lte: endDate },
            ...(cashierUserId ? { cashierUserId } : {}),
          },
        },
        include: {
          salesOrder: true,
          item: {
            include: {
              brand: true,
              division: true,
              category: true,
              gender: true,
              silhouette: true,
              size: true,
              color: true,
            },
          },
        },
      });

      await job.progress(35);

      const sSalesperson = showSalesperson === true;
      const sYear = showYear === true;
      const sMonth = showMonth === true;
      const sDay = showDay === true;
      const sDocument = showDocument === true;

      const sBrand = showBrand !== false;
      const sDivision = showDivision !== false;
      const sSalesTax = showSalesTax === true;
      const sCategory = showCategory !== false;
      const sGender = showGender !== false;
      const sSilhouette = showSilhouette !== false;
      const sArticle = showArticle !== false;
      const sVariant = showVariant !== undefined ? showVariant : !summaryOnly;

      const levels: string[] = [];
      if (sSalesperson) levels.push('salesperson');
      if (sYear) levels.push('year');
      if (sMonth) levels.push('month');
      if (sDay) levels.push('day');
      if (sDocument) levels.push('document');
      if (sBrand) levels.push('brand');
      if (sDivision) levels.push('division');
      if (sSalesTax) levels.push('salesTax');
      if (sCategory) levels.push('category');
      if (sGender) levels.push('gender');
      if (sSilhouette) levels.push('silhouette');
      if (sArticle) levels.push('article');
      if (sVariant) levels.push('variant');

      if (levels.length === 0) {
        levels.push('salesperson');
      }

      // Resolve cashier names if grouping by salesperson
      const cashierNameMap = new Map<string, string>();
      if (sSalesperson || levels.includes('salesperson')) {
        const cashierUserIds = [...new Set(orderItems.map(oi => oi.salesOrder?.cashierUserId).filter(Boolean))] as string[];
        const cashierUsers = cashierUserIds.length
            ? await prismaMaster.user.findMany({
                where: { id: { in: cashierUserIds } },
                select: { id: true, firstName: true, lastName: true },
              })
            : [];
        const cashierEmployees = cashierUserIds.length
            ? await prisma.employee.findMany({
                where: {
                    OR: [
                        { id: { in: cashierUserIds } },
                        { userId: { in: cashierUserIds } }
                    ]
                },
                select: { id: true, userId: true, employeeName: true }
            })
            : [];

        for (const u of cashierUsers) {
            cashierNameMap.set(u.id, `${u.firstName} ${u.lastName}`);
        }
        for (const emp of cashierEmployees) {
            if (emp.userId) cashierNameMap.set(emp.userId, emp.employeeName);
            cashierNameMap.set(emp.id, emp.employeeName);
        }
      }

      await job.progress(45);

      const root: any[] = [];

      const createEmptyTotals = () => ({
        qty: 0,
        totalRetailValue: 0,
        totalPriceWost: 0,
        discountAmount: 0,
        valueExclTax: 0,
        salesTaxAmount: 0,
        totalTax: 0,
        valueInclTax: 0,
      });

      const addTotals = (target: any, source: any) => {
        target.qty += source.qty;
        target.totalRetailValue += source.totalRetailValue;
        target.totalPriceWost += source.totalPriceWost;
        target.discountAmount += source.discountAmount;
        target.valueExclTax += source.valueExclTax;
        target.salesTaxAmount += source.salesTaxAmount;
        target.totalTax += source.totalTax;
        target.valueInclTax += source.valueInclTax;
      };

      for (const orderItem of orderItems) {
        if (!orderItem.item) continue;

        const qty = Number(orderItem.quantity || 0);
        const retailPrice = Number(orderItem.unitPrice || 0);
        const taxRate = Number(orderItem.taxPercent || 0);

        const taxDivisor = 1 + (taxRate / 100);
        const wostPerUnit = retailPrice / taxDivisor;
        const totalPriceWost = qty * wostPerUnit;
        const discountAmount = Number(orderItem.discountAmount || 0);
        const valueExclTax = totalPriceWost - discountAmount;
        const salesTaxAmount = Number(orderItem.taxAmount || 0);
        const totalTax = salesTaxAmount;
        const valueInclTax = valueExclTax + totalTax;

        const variantMetrics = {
          qty,
          totalRetailValue: qty * retailPrice,
          totalPriceWost,
          discountAmount,
          valueExclTax,
          salesTaxAmount,
          totalTax,
          valueInclTax,
        };

        let currentLevelNodes = root;
        for (let i = 0; i < levels.length; i++) {
          const levelName = levels[i];
          let nodeVal = '';
          let extraFields: any = {};

          if (levelName === 'salesperson') {
            const cid = orderItem.salesOrder?.cashierUserId || '';
            nodeVal = cid ? (cashierNameMap.get(cid) || 'Unknown Salesperson') : 'Unknown Salesperson';
          } else if (levelName === 'year') {
            nodeVal = orderItem.salesOrder ? String(orderItem.salesOrder.createdAt.getFullYear()) : 'Unknown Year';
          } else if (levelName === 'month') {
            if (orderItem.salesOrder) {
              const date = orderItem.salesOrder.createdAt;
              nodeVal = date.toLocaleString('default', { month: 'long', year: 'numeric' });
            } else {
              nodeVal = 'Unknown Month';
            }
          } else if (levelName === 'day') {
            if (orderItem.salesOrder) {
              const date = orderItem.salesOrder.createdAt;
              nodeVal = date.toLocaleDateString('default', { day: '2-digit', month: 'short', year: 'numeric' });
            } else {
              nodeVal = 'Unknown Day';
            }
          } else if (levelName === 'document') {
            nodeVal = orderItem.salesOrder ? `POS Sale - ${orderItem.salesOrder.orderNumber}` : 'Unknown Document';
          } else if (levelName === 'brand') {
            nodeVal = orderItem.item.brand?.name || 'No Brand';
          } else if (levelName === 'division') {
            nodeVal = orderItem.item.division?.name || 'No Division';
          } else if (levelName === 'salesTax') {
            const rate = Number(orderItem.taxPercent || 0);
            nodeVal = rate > 0 ? `${rate}% Tax` : 'No Tax';
          } else if (levelName === 'category') {
            nodeVal = orderItem.item.category?.name || 'No Category';
          } else if (levelName === 'gender') {
            nodeVal = orderItem.item.gender?.name || 'No Gender';
          } else if (levelName === 'silhouette') {
            nodeVal = orderItem.item.silhouette?.name || 'No Silhouette';
          } else if (levelName === 'article') {
            nodeVal = orderItem.item.sku;
            extraFields.sku = orderItem.item.sku;
            extraFields.articleName = orderItem.item.description || 'Unknown Article';
          } else if (levelName === 'variant') {
            nodeVal = `${orderItem.item.color?.name || 'Default'}-${orderItem.item.size?.name || 'Default'}`;
            extraFields.color = orderItem.item.color?.name || 'Default';
            extraFields.size = orderItem.item.size?.name || 'Default';
          }

          let existingNode = currentLevelNodes.find(n => n.level === levelName && n.value === nodeVal);
          if (!existingNode) {
            existingNode = {
              level: levelName,
              value: nodeVal,
              totals: createEmptyTotals(),
              ...extraFields,
              children: [],
            };
            currentLevelNodes.push(existingNode);
          }

          addTotals(existingNode.totals, variantMetrics);

          if (i < levels.length - 1) {
            currentLevelNodes = existingNode.children;
          }
        }
      }

      await job.progress(65);

      const grandTotals = createEmptyTotals();
      for (const node of root) {
        addTotals(grandTotals, node.totals);
      }

      await job.progress(80);

      if (format === 'pdf') {
        const fromDateStr = startDate.toLocaleDateString();
        const toDateStr = endDate.toLocaleDateString();
        const html = this.buildPdfHtml(root, locationName, fromDateStr, toDateStr, grandTotals, !!summaryOnly);

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

          let currentProgress = 80;
          const progressInterval = setInterval(() => {
            if (currentProgress < 94) {
              currentProgress += 1;
              job.progress(currentProgress).catch(() => {});
            }
          }, 3000);

          let pdfBuffer;
          try {
            pdfBuffer = await page.pdf({
              format: 'A4',
              landscape: true,
              margin: { top: '15mm', bottom: '15mm', left: '10mm', right: '10mm' },
              printBackground: true,
              displayHeaderFooter: true,
              headerTemplate: '<div style="font-size: 7px; width: 100%; text-align: right; padding-right: 15mm; color: #94a3b8;">Speed (Pvt.) Limited | Net Sales Summary Report</div>',
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
        // XLSX Format
        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
          filename: filePath,
          useStyles: true,
          useSharedStrings: false,
        });

        const ws = workbook.addWorksheet('Net Sales Summary', {
          pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
          views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }],
        });

        ws.columns = COLUMNS.map(c => ({ key: c.key, width: c.width }));

        // 1. Group Headers bands
        const groups: Record<string, { start: number; end: number }> = {};
        COLUMNS.forEach((col, idx) => {
          const n = idx + 1;
          if (!groups[col.group]) groups[col.group] = { start: n, end: n };
          else groups[col.group].end = n;
        });

        const groupRow = ws.getRow(1);
        COLUMNS.forEach((col, idx) => {
          const cell = groupRow.getCell(idx + 1);
          const { start } = groups[col.group];
          if (idx + 1 === start) cell.value = col.group.toUpperCase();
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${GROUP_COLORS[col.group] ?? '1E293B'}` } };
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          };
        });
        groupRow.height = 22;
        groupRow.commit();

        // 2. Column Headers
        const headerRow = ws.getRow(2);
        COLUMNS.forEach((col, idx) => {
          const cell = headerRow.getCell(idx + 1);
          cell.value = col.header;
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
          cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'medium', color: { argb: 'FF1E293B' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          };
        });
        headerRow.height = 22;
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
          indent: number;
          prefix: string;
        }> = {
          salesperson: { bgHex: '1E293B', fgHex: 'FFFFFF', fontSize: 10, bold: true, indent: 0, prefix: '' },
          year: { bgHex: '334155', fgHex: 'FFFFFF', fontSize: 9.5, bold: true, indent: 2, prefix: '' },
          month: { bgHex: '475569', fgHex: 'FFFFFF', fontSize: 9, bold: true, indent: 4, prefix: '' },
          day: { bgHex: '64748B', fgHex: 'FFFFFF', fontSize: 9, bold: true, indent: 6, prefix: '' },
          document: { bgHex: '94A3B8', fgHex: 'FFFFFF', fontSize: 9, bold: true, indent: 8, prefix: '' },
          brand: { bgHex: '1E293B', fgHex: 'FFFFFF', fontSize: 10, bold: true, indent: 0, prefix: 'BRAND: ' },
          division: { bgHex: '334155', fgHex: 'FFFFFF', fontSize: 9.5, bold: true, indent: 2, prefix: 'DIVISION: ' },
          salesTax: { bgHex: '475569', fgHex: 'FFFFFF', fontSize: 9, bold: true, indent: 4, prefix: 'TAX RATE: ' },
          category: { bgHex: '64748B', fgHex: 'FFFFFF', fontSize: 9, bold: true, indent: 6, prefix: 'CATEGORY: ' },
          gender: { bgHex: '94A3B8', fgHex: 'FFFFFF', fontSize: 9, bold: true, indent: 8, prefix: 'GENDER: ' },
          silhouette: { bgHex: 'CBD5E1', fgHex: '1E293B', fontSize: 9, bold: true, indent: 10, prefix: 'SILHOUETTE: ' },
          article: { bgHex: 'F1F5F9', fgHex: '1E293B', fontSize: 9, bold: true, indent: 12, prefix: 'SKU: ' },
          variant: { bgHex: 'FFFFFF', fgHex: '475569', fontSize: 9, bold: false, indent: 14, prefix: '' },
        };

        const writeNodeToExcel = (node: any) => {
          const style = LEVEL_EXCEL_STYLES[node.level] || LEVEL_EXCEL_STYLES.brand;
          
          let label = ' '.repeat(style.indent) + style.prefix;
          let sizeVal = '';
          
          if (node.level === 'article') {
            label = ' '.repeat(style.indent) + `SKU: ${node.sku} (${node.articleName})`;
            sizeVal = 'ALL SIZES';
          } else if (node.level === 'variant') {
            label = ' '.repeat(style.indent) + 'Variant Item';
            sizeVal = node.size;
          } else {
            label = ' '.repeat(style.indent) + style.prefix + node.value.toUpperCase();
          }

          const avgRetail = node.totals.qty > 0 ? (node.totals.totalRetailValue / node.totals.qty) : 0;
          
          const rowData = {
            sku: label,
            size: sizeVal,
            qty: node.totals.qty,
            retailPrice: avgRetail,
            totalPriceWost: node.totals.totalPriceWost,
            discountAmount: node.totals.discountAmount,
            valueExclTax: node.totals.valueExclTax,
            salesTaxAmount: node.totals.salesTaxAmount,
            totalTax: node.totals.totalTax,
            valueInclTax: node.totals.valueInclTax,
          };

          const row = ws.addRow(rowData);
          
          for (let colNum = 1; colNum <= COLUMNS.length; colNum++) {
            const cell = row.getCell(colNum);
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${style.bgHex}` } };
            cell.font = { bold: style.bold, size: style.fontSize, color: { argb: `FF${style.fgHex}` } };
            cell.border = borderThin;
            cell.alignment = colNum === 2 
              ? centerAlign 
              : (colNum === 1 ? leftAlign : rightAlign);
            
            // Format numbers
            const c = COLUMNS[colNum - 1];
            if (c.numFmt) {
              cell.numFmt = c.numFmt;
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

        // Add Grand Totals
        const totalRow = ws.addRow({
          sku: 'GRAND TOTAL',
          size: '',
          qty: grandTotals.qty,
          retailPrice: grandTotals.qty > 0 ? (grandTotals.totalRetailValue / grandTotals.qty) : 0,
          totalPriceWost: grandTotals.totalPriceWost,
          discountAmount: grandTotals.discountAmount,
          valueExclTax: grandTotals.valueExclTax,
          salesTaxAmount: grandTotals.salesTaxAmount,
          totalTax: grandTotals.totalTax,
          valueInclTax: grandTotals.valueInclTax,
        });

        totalRow.eachCell((cell, colNum) => {
          cell.font = { bold: true, size: 10, color: { argb: 'FF000000' } };
          cell.border = {
            top: { style: 'medium', color: { argb: 'FF1E293B' } },
            bottom: { style: 'double', color: { argb: 'FF1E293B' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          };
          cell.alignment = colNum === 2 ? centerAlign : (colNum === 1 ? leftAlign : rightAlign);
          
          const c = COLUMNS[colNum - 1];
          if (c.numFmt) {
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
        ? `net-sales-summary-report-${new Date().toISOString().slice(0, 10)}.pdf`
        : `net-sales-summary-report-${new Date().toISOString().slice(0, 10)}.xlsx`;

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
        title: 'Net Sales Summary Export Ready',
        message: `Your Net Sales Summary ${format.toUpperCase()} report has been processed successfully.`,
        category: 'export',
        priority: 'high',
        actionType: 'net-sales-summary-export.ready',
        actionPayload: JSON.stringify({ jobId }),
      });

      await job.progress(100);
      this.logger.log(`[NetSalesSummaryExport ${jobId}] Finished processing successfully`);
    } catch (err) {
      this.logger.error(`[NetSalesSummaryExport ${jobId}] Failed: ${err.message}`, err.stack);
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
    summaryOnly: boolean,
  ): string {
    let rowsHtml = '';
    const formatVal = (val: number) => val === 0 ? '-' : val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formatQty = (val: number) => val === 0 ? '-' : val.toString();

    const LEVEL_PDF_STYLES: Record<string, {
      className: string;
      indentStyles: string;
      prefix: string;
    }> = {
      salesperson: { className: 'brand-row', indentStyles: '', prefix: '' },
      year: { className: 'division-row', indentStyles: 'padding-left: 10px;', prefix: '' },
      month: { className: 'category-row', indentStyles: 'padding-left: 20px;', prefix: '' },
      day: { className: 'gender-row', indentStyles: 'padding-left: 30px;', prefix: '' },
      document: { className: 'silhouette-row', indentStyles: 'padding-left: 40px;', prefix: '' },
      brand: { className: 'brand-row', indentStyles: '', prefix: 'BRAND: ' },
      division: { className: 'division-row', indentStyles: 'padding-left: 10px;', prefix: 'DIVISION: ' },
      salesTax: { className: 'category-row', indentStyles: 'padding-left: 20px;', prefix: 'TAX RATE: ' },
      category: { className: 'category-row', indentStyles: 'padding-left: 30px;', prefix: 'CATEGORY: ' },
      gender: { className: 'gender-row', indentStyles: 'padding-left: 40px;', prefix: 'GENDER: ' },
      silhouette: { className: 'silhouette-row', indentStyles: 'padding-left: 50px;', prefix: 'SILHOUETTE: ' },
      article: { className: 'article-row', indentStyles: 'padding-left: 60px;', prefix: 'SKU: ' },
      variant: { className: 'variant-row', indentStyles: 'padding-left: 70px;', prefix: '' },
    };

    const buildHtmlRows = (node: any): string => {
      const style = LEVEL_PDF_STYLES[node.level] || LEVEL_PDF_STYLES.brand;
      let html = '';

      const avgRetail = node.totals.qty > 0 ? (node.totals.totalRetailValue / node.totals.qty) : 0;
      
      if (node.level === 'article') {
        html += `
          <tr class="${style.className}">
            <td style="${style.indentStyles}">SKU: ${node.sku} (${node.articleName})</td>
            <td class="center">ALL SIZES</td>
            <td class="num">${formatQty(node.totals.qty)}</td>
            <td class="num">${formatVal(avgRetail)}</td>
            <td class="num">${formatVal(node.totals.totalPriceWost)}</td>
            <td class="num">${formatVal(node.totals.discountAmount)}</td>
            <td class="num">${formatVal(node.totals.valueExclTax)}</td>
            <td class="num">${formatVal(node.totals.salesTaxAmount)}</td>
            <td class="num">${formatVal(node.totals.totalTax)}</td>
            <td class="num">${formatVal(node.totals.valueInclTax)}</td>
          </tr>
        `;
      } else if (node.level === 'variant') {
        html += `
          <tr class="${style.className}">
            <td style="${style.indentStyles} color: #64748b; font-style: italic;">&mdash; Variant Item</td>
            <td class="center">${node.size}</td>
            <td class="num">${formatQty(node.totals.qty)}</td>
            <td class="num">${formatVal(avgRetail)}</td>
            <td class="num">${formatVal(node.totals.totalPriceWost)}</td>
            <td class="num">${formatVal(node.totals.discountAmount)}</td>
            <td class="num">${formatVal(node.totals.valueExclTax)}</td>
            <td class="num">${formatVal(node.totals.salesTaxAmount)}</td>
            <td class="num">${formatVal(node.totals.totalTax)}</td>
            <td class="num">${formatVal(node.totals.valueInclTax)}</td>
          </tr>
        `;
      } else {
        html += `
          <tr class="${style.className}">
            <td style="${style.indentStyles}">${style.prefix}${node.value.toUpperCase()}</td>
            <td class="center">-</td>
            <td class="num">${formatQty(node.totals.qty)}</td>
            <td class="num">${formatVal(avgRetail)}</td>
            <td class="num">${formatVal(node.totals.totalPriceWost)}</td>
            <td class="num">${formatVal(node.totals.discountAmount)}</td>
            <td class="num">${formatVal(node.totals.valueExclTax)}</td>
            <td class="num">${formatVal(node.totals.salesTaxAmount)}</td>
            <td class="num">${formatVal(node.totals.totalTax)}</td>
            <td class="num">${formatVal(node.totals.valueInclTax)}</td>
          </tr>
        `;
      }
      
      if (node.children && node.children.length > 0) {
        for (const child of node.children) {
          html += buildHtmlRows(child);
        }
      }
      
      return html;
    };

    for (const rootNode of data) {
      rowsHtml += buildHtmlRows(rootNode);
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
            font-size: 7px;
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
            font-size: 14px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #0f172a;
          }
          .report-title {
            font-size: 11px;
            font-weight: 700;
            color: #475569;
            margin-top: 2px;
          }
          .meta-info {
            font-size: 8px;
            color: #64748b;
            margin-top: 4px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }
          tr {
            page-break-inside: avoid;
          }
          thead {
            display: table-header-group;
          }
          th {
            background-color: #334155;
            color: #ffffff;
            font-weight: 700;
            text-transform: uppercase;
            font-size: 6px;
            padding: 4px 3px;
            border: 1px solid #475569;
            text-align: center;
          }
          td {
            padding: 3px 2px;
            border: 1px solid #e2e8f0;
            vertical-align: middle;
            word-wrap: break-word;
          }
          td.num {
            text-align: right;
          }
          td.center {
            text-align: center;
          }
          
          /* Rows Styling */
          .brand-row { background-color: #1e293b; color: #ffffff; font-weight: bold; }
          .division-row { background-color: #334155; color: #ffffff; font-weight: bold; }
          .category-row { background-color: #475569; color: #ffffff; font-weight: bold; }
          .gender-row { background-color: #64748b; color: #ffffff; font-weight: bold; }
          .silhouette-row { background-color: #94a3b8; color: #ffffff; font-weight: bold; }
          .article-row { background-color: #f1f5f9; color: #1e293b; font-weight: bold; }
          .variant-row { background-color: #ffffff; color: #475569; }
          
          .grand-total-row {
            background-color: #cbd5e1;
            color: #0f172a;
            font-weight: bold;
            font-size: 8px;
            border-top: 2px solid #0f172a;
            border-bottom: 2px double #0f172a;
          }
        </style>
      </head>
      <body>
        <div class="header-block">
          <div class="company-name">Speed (Pvt.) Limited</div>
          <div class="report-title">Net Sales Summary Report</div>
          <div class="meta-info">
            <strong>Location:</strong> ${locationName} | 
            <strong>Period:</strong> ${fromDateStr} - ${toDateStr}
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width: 30%;">GPC / Category / Product</th>
              <th style="width: 8%;">Size</th>
              <th style="width: 5%;">Qty</th>
              <th style="width: 8%;">Retail Price</th>
              <th style="width: 9%;">Total WOST</th>
              <th style="width: 9%;">Discount</th>
              <th style="width: 9%;">Val Excl Tax</th>
              <th style="width: 11%;">Sales Tax</th>
              <th style="width: 11%;">Total Tax</th>
              <th style="width: 10%;">Val Incl Tax</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            <tr class="grand-total-row">
              <td>GRAND TOTAL</td>
              <td class="center">-</td>
              <td class="num">${formatQty(grandTotals.qty)}</td>
              <td class="num">${formatVal(grandTotals.qty > 0 ? (grandTotals.totalRetailValue / grandTotals.qty) : 0)}</td>
              <td class="num">${formatVal(grandTotals.totalPriceWost)}</td>
              <td class="num">${formatVal(grandTotals.discountAmount)}</td>
              <td class="num">${formatVal(grandTotals.valueExclTax)}</td>
              <td class="num">${formatVal(grandTotals.salesTaxAmount)}</td>
              <td class="num">${formatVal(grandTotals.totalTax)}</td>
              <td class="num">${formatVal(grandTotals.valueInclTax)}</td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `;
  }
}
