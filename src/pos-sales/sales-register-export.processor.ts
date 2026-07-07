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

export interface SalesRegisterExportJobData {
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
}

const COLUMNS = [
  { header: 'CM #', key: 'cmNo', width: 16 },
  { header: 'Date', key: 'date', width: 12 },
  { header: 'Gross Sale', key: 'grossSale', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Gross Sale WOST', key: 'grossSaleWost', width: 16, align: 'right', numFmt: '#,##0.00' },
  { header: 'Disc', key: 'disc', width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'S. Tax', key: 'sTax', width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'Net Sale', key: 'netSale', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Cash', key: 'cash', width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'PostEx', key: 'postex', width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'Leopard', key: 'leopard', width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'Card No.', key: 'cardNo', width: 12, align: 'center' },
  { header: 'Amount', key: 'cardAmount', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Alliance Detail / Remarks', key: 'allianceDetails', width: 35 },
  { header: 'Gift Voucher Amount', key: 'giftVoucherAmt', width: 16, align: 'right', numFmt: '#,##0.00' },
  { header: 'Gift Voucher', key: 'giftVoucherCode', width: 18 },
  { header: 'Credit Amount', key: 'creditAmt', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Credit Voucher', key: 'creditCode', width: 18 },
  { header: 'Claim Amount', key: 'claimAmt', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Claim Voucher', key: 'claimCode', width: 18 },
  { header: 'Corporate Amount', key: 'corporateAmt', width: 16, align: 'right', numFmt: '#,##0.00' },
  { header: 'Corporate Voucher', key: 'corporateCode', width: 18 },
  { header: 'Exchange Amount', key: 'exchangeAmt', width: 16, align: 'right', numFmt: '#,##0.00' },
  { header: 'Exchange Voucher', key: 'exchangeCode', width: 18 },
  { header: 'Manual Disc. %', key: 'manualDiscPct', width: 14, align: 'center' },
  { header: 'Manual Disc. Amt', key: 'manualDiscAmt', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Manual Disc. Note', key: 'manualDiscNote', width: 25 },
  { header: 'Override Disc. %', key: 'overrideDiscPct', width: 14, align: 'center' },
  { header: 'Override Disc. Note', key: 'overrideDiscNote', width: 30 },
];

@Processor('sales-register-export')
export class SalesRegisterExportProcessor {
  private readonly logger = new Logger(SalesRegisterExportProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly exportHistoryService: ExportHistoryService,
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
  async handleExport(job: Job<SalesRegisterExportJobData>): Promise<void> {
    const { jobId, userId, tenantId, tenantDbUrl, locationId, startDate: startStr, endDate: endStr, cashierUserId, format, search } = job.data;
    this.logger.log(`[SalesRegisterExport ${jobId}] Starting ${format.toUpperCase()} export`);

    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);
    const prismaMaster = new PrismaMasterService();
    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const ext = format === 'pdf' ? 'pdf' : 'xlsx';
    const filePath = path.join(exportDir, `export-${jobId}.${ext}`);

    try {
      await job.progress(10);

      const location = await prisma.location.findUnique({
        where: { id: locationId },
        select: { name: true },
      });
      const locationName = location?.name || 'Store';

      const now = new Date();
      const startDate = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate = endStr ? new Date(endStr) : new Date(now);
      endDate.setHours(23, 59, 59, 999);

      // Fetch Sales Orders using offset pagination to respect rules
      const records: any[] = [];
      let skip = 0;
      const CHUNK = 500;
      let hasMore = true;

      while (hasMore) {
        const chunk = await prisma.salesOrder.findMany({
          where: {
            locationId,
            status: { in: ['completed', 'partially_returned', 'refunded', 'exchanged'] },
            createdAt: { gte: startDate, lte: endDate },
            ...(cashierUserId ? { cashierUserId } : {}),
            ...(search ? { orderNumber: { contains: search, mode: 'insensitive' } } : {}),
          },
          include: {
            alliance: true,
            voucherRedemptions: {
              include: {
                voucher: true,
              },
            },
            items: {
              include: {
                item: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
          skip,
          take: CHUNK,
        });

        records.push(...chunk);
        skip += CHUNK;
        if (chunk.length < CHUNK) {
          hasMore = false;
        }
      }

      await job.progress(40);

      // Fetch claims & returns to construct negative documents
      const returnLedgerEntries = await prisma.stockLedger.findMany({
        where: {
          referenceType: { in: ['POS_RETURN', 'POS_REFUND'] },
          createdAt: { gte: startDate, lte: endDate },
          locationId,
        },
        include: {
          item: true,
        },
      });

      const referenceOrderIds = [...new Set(returnLedgerEntries.map(e => e.referenceId).filter(Boolean))];
      const referenceOrders = referenceOrderIds.length
        ? await prisma.salesOrder.findMany({
            where: {
              id: { in: referenceOrderIds },
              ...(cashierUserId ? { cashierUserId } : {}),
            },
            include: {
              items: { include: { item: true } },
              alliance: true,
              voucherRedemptions: { include: { voucher: true } },
            },
          })
        : [];

      const referenceOrderMap = new Map<string, any>();
      for (const o of referenceOrders) {
        referenceOrderMap.set(o.id, o);
      }

      await job.progress(60);

      // Map DB structures to flat Sales Register Rows
      const rows: any[] = [];

      // 1. Map Sales Orders
      for (const order of records) {
        let grossSale = 0;
        let grossSaleWost = 0;

        for (const item of order.items) {
          const qty = Number(item.quantity || 0);
          const price = Number(item.unitPrice || 0);
          const taxRate = Number(item.taxPercent || 0);

          grossSale += qty * price;
          grossSaleWost += qty * (price / (1 + taxRate / 100));
        }

        // Tenders
        let cash = Number(order.cashAmount || 0);
        let cardAmount = Number(order.cardAmount || 0);
        let postex = 0;
        let leopard = 0;

        const pm = order.paymentMethod?.toLowerCase();
        if (pm === 'postex') {
          postex = cardAmount || Number(order.grandTotal);
          cardAmount = 0;
        } else if (pm === 'leopard') {
          leopard = cardAmount || Number(order.grandTotal);
          cardAmount = 0;
        }

        let giftVoucherAmt = 0;
        let giftVoucherCodes: string[] = [];
        let creditAmt = 0;
        let creditCodes: string[] = [];
        let claimAmt = 0;
        let claimCodes: string[] = [];
        let corporateAmt = 0;
        let corporateCodes: string[] = [];
        let exchangeAmt = 0;
        let exchangeCodes: string[] = [];

        for (const red of order.voucherRedemptions) {
          const type = red.voucher?.voucherType;
          const code = red.voucher?.code || '';
          const amt = Number(red.amountUsed);

          if (type === 'GIFT' || type === 'OUTLET_GIFT') {
            giftVoucherAmt += amt;
            giftVoucherCodes.push(code);
          } else if (type === 'CREDIT') {
            creditAmt += amt;
            creditCodes.push(code);
          } else if (type === 'CLAIM') {
            claimAmt += amt;
            claimCodes.push(code);
          } else if (type === 'CORPORATE') {
            corporateAmt += amt;
            corporateCodes.push(code);
          } else if (type === 'EXCHANGE') {
            exchangeAmt += amt;
            exchangeCodes.push(code);
          }
        }

        // Extract Card Number from notes
        let cardNo = '';
        const notesStr = order.notes || '';
        const cardMatch = notesStr.match(/Card:\s*\*\*\*\*(\d{4})/i);
        if (cardMatch) {
          cardNo = cardMatch[1];
        }

        let allianceDetails = '';
        if (order.alliance) {
          allianceDetails = `${order.alliance.partnerName} (${order.alliance.discountPercent}%)`;
        }

        const overrideDiscPct = order.items
          .map((i: any) => i.overrideDiscountPercent ? `${i.overrideDiscountPercent}%` : null)
          .filter(Boolean)
          .join(', ');

        const overrideDiscNote = order.items
          .map((i: any) => i.overrideDiscountNote)
          .filter(Boolean)
          .join('; ');

        rows.push({
          id: order.id,
          cmNo: order.orderNumber,
          date: order.createdAt,
          grossSale,
          grossSaleWost,
          disc: Number(order.discountAmount || 0),
          sTax: Number(order.taxAmount || 0),
          netSale: Number(order.grandTotal),
          cash,
          postex,
          leopard,
          cardNo,
          cardAmount,
          allianceDetails,
          giftVoucherAmt,
          giftVoucherCode: giftVoucherCodes.join(', '),
          creditAmt,
          creditCode: creditCodes.join(', '),
          claimAmt,
          claimCode: claimCodes.join(', '),
          corporateAmt,
          corporateCode: corporateCodes.join(', '),
          exchangeAmt,
          exchangeCode: exchangeCodes.join(', '),
          manualDiscPct: order.globalDiscountPercent ? `${order.globalDiscountPercent}%` : '',
          manualDiscAmt: Number(order.globalDiscountAmount || 0),
          manualDiscNote: order.manualDiscountNote || '',
          overrideDiscPct,
          overrideDiscNote,
        });
      }

      // 2. Map Returns and Refunds
      const groupedReturns = new Map<string, any[]>();
      for (const entry of returnLedgerEntries) {
        if (!entry.referenceId) continue;
        const list = groupedReturns.get(entry.referenceId) || [];
        list.push(entry);
        groupedReturns.set(entry.referenceId, list);
      }

      for (const [refId, entries] of groupedReturns.entries()) {
        const order = referenceOrderMap.get(refId);
        if (!order) continue;

        let grossSale = 0;
        let grossSaleWost = 0;
        let disc = 0;
        let sTax = 0;

        for (const entry of entries) {
          const qty = Math.abs(Number(entry.qty));
          const orderItem = order.items.find((oi: any) => oi.itemId === entry.itemId);
          if (!orderItem) continue;

          const price = Number(orderItem.unitPrice || 0);
          const taxRate = Number(orderItem.taxPercent || 0);
          const itemQty = Number(orderItem.quantity || 1);

          grossSale += qty * price;
          grossSaleWost += qty * (price / (1 + taxRate / 100));
          disc += (qty / itemQty) * Number(orderItem.discountAmount || 0);
          sTax += (qty / itemQty) * Number(orderItem.taxAmount || 0);
        }

        const netSale = grossSaleWost - disc + sTax;

        // Tenders (negative value for returns)
        let cash = 0;
        let creditAmt = 0;
        let exchangeAmt = 0;

        const isRefund = entries[0].referenceType === 'POS_REFUND';
        if (isRefund) {
          cash = -netSale; // Refund returned as cash
        } else {
          // Exchange generates exchange voucher
          exchangeAmt = -netSale;
        }

        const docNum = isRefund
          ? (order.refundNumber || `Refund for ${order.orderNumber}`)
          : (order.returnNumber || `Return for ${order.orderNumber}`);

        rows.push({
          id: `${refId}-return`,
          cmNo: docNum,
          date: entries[0].createdAt,
          grossSale: -grossSale,
          grossSaleWost: -grossSaleWost,
          disc: -disc,
          sTax: -sTax,
          netSale: -netSale,
          cash,
          postex: 0,
          leopard: 0,
          cardNo: '',
          cardAmount: 0,
          allianceDetails: '',
          giftVoucherAmt: 0,
          giftVoucherCode: '',
          creditAmt,
          creditCode: '',
          claimAmt: 0,
          claimCode: '',
          corporateAmt: 0,
          corporateCode: '',
          exchangeAmt,
          exchangeCode: '',
          manualDiscPct: '',
          manualDiscAmt: 0,
          manualDiscNote: '',
          overrideDiscPct: '',
          overrideDiscNote: '',
        });
      }

      // Sort final rows by date
      rows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      // Compute Grand Totals
      const grandTotals = {
        grossSale: 0,
        grossSaleWost: 0,
        disc: 0,
        sTax: 0,
        netSale: 0,
        cash: 0,
        postex: 0,
        leopard: 0,
        cardAmount: 0,
        giftVoucherAmt: 0,
        creditAmt: 0,
        claimAmt: 0,
        corporateAmt: 0,
        exchangeAmt: 0,
        manualDiscAmt: 0,
      };

      for (const r of rows) {
        grandTotals.grossSale += r.grossSale;
        grandTotals.grossSaleWost += r.grossSaleWost;
        grandTotals.disc += r.disc;
        grandTotals.sTax += r.sTax;
        grandTotals.netSale += r.netSale;
        grandTotals.cash += r.cash;
        grandTotals.postex += r.postex;
        grandTotals.leopard += r.leopard;
        grandTotals.cardAmount += r.cardAmount;
        grandTotals.giftVoucherAmt += r.giftVoucherAmt;
        grandTotals.creditAmt += r.creditAmt;
        grandTotals.claimAmt += r.claimAmt;
        grandTotals.corporateAmt += r.corporateAmt;
        grandTotals.exchangeAmt += r.exchangeAmt;
        grandTotals.manualDiscAmt += r.manualDiscAmt;
      }

      await job.progress(80);

      if (format === 'pdf') {
        const fromDateStr = startDate.toLocaleDateString();
        const toDateStr = endDate.toLocaleDateString();
        const html = this.buildPdfHtml(rows, locationName, fromDateStr, toDateStr, grandTotals);

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
            headerTemplate: '<div style="font-size: 7px; width: 100%; text-align: right; padding-right: 15mm; color: #94a3b8;">Sales Register Report</div>',
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

        const ws = workbook.addWorksheet('Sales Register', {
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
          const rowData = {
            cmNo: r.cmNo,
            date: new Date(r.date).toLocaleDateString(),
            grossSale: r.grossSale,
            grossSaleWost: r.grossSaleWost,
            disc: r.disc,
            sTax: r.sTax,
            netSale: r.netSale,
            cash: r.cash,
            postex: r.postex,
            leopard: r.leopard,
            cardNo: r.cardNo,
            cardAmount: r.cardAmount,
            allianceDetails: r.allianceDetails,
            giftVoucherAmt: r.giftVoucherAmt,
            giftVoucherCode: r.giftVoucherCode,
            creditAmt: r.creditAmt,
            creditCode: r.creditCode,
            claimAmt: r.claimAmt,
            claimCode: r.claimCode,
            corporateAmt: r.corporateAmt,
            corporateCode: r.corporateCode,
            exchangeAmt: r.exchangeAmt,
            exchangeCode: r.exchangeCode,
            manualDiscPct: r.manualDiscPct,
            manualDiscAmt: r.manualDiscAmt,
            manualDiscNote: r.manualDiscNote,
            overrideDiscPct: r.overrideDiscPct,
            overrideDiscNote: r.overrideDiscNote,
          };

          const row = ws.addRow(rowData);
          for (let colNum = 1; colNum <= COLUMNS.length; colNum++) {
            const cell = row.getCell(colNum);
            cell.border = borderThin;
            cell.font = { size: 9 };
            const c = COLUMNS[colNum - 1];
            cell.alignment = {
              horizontal: c.align === 'right' ? 'right' : (c.align === 'center' ? 'center' : 'left'),
              vertical: 'middle',
            };
            if (c.numFmt) {
              cell.numFmt = c.numFmt;
            }
          }
          row.height = 20;
          row.commit();
        }

        // Add Grand Totals
        const totalRow = ws.addRow({
          cmNo: 'GRAND TOTAL',
          date: '',
          grossSale: grandTotals.grossSale,
          grossSaleWost: grandTotals.grossSaleWost,
          disc: grandTotals.disc,
          sTax: grandTotals.sTax,
          netSale: grandTotals.netSale,
          cash: grandTotals.cash,
          postex: grandTotals.postex,
          leopard: grandTotals.leopard,
          cardNo: '',
          cardAmount: grandTotals.cardAmount,
          allianceDetails: '',
          giftVoucherAmt: grandTotals.giftVoucherAmt,
          giftVoucherCode: '',
          creditAmt: grandTotals.creditAmt,
          creditCode: '',
          claimAmt: grandTotals.claimAmt,
          claimCode: '',
          corporateAmt: grandTotals.corporateAmt,
          corporateCode: '',
          exchangeAmt: grandTotals.exchangeAmt,
          exchangeCode: '',
          manualDiscPct: '',
          manualDiscAmt: grandTotals.manualDiscAmt,
          manualDiscNote: '',
          overrideDiscPct: '',
          overrideDiscNote: '',
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
        ? `sales-register-report-${new Date().toISOString().slice(0, 10)}.pdf`
        : `sales-register-report-${new Date().toISOString().slice(0, 10)}.xlsx`;

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
        title: 'Sales Register Export Ready',
        message: `Your Sales Register ${format.toUpperCase()} report has been processed successfully.`,
        category: 'export',
        priority: 'high',
        actionType: 'sales-register-export.ready',
        actionPayload: JSON.stringify({ jobId }),
      });

      await job.progress(100);
      this.logger.log(`[SalesRegisterExport ${jobId}] Finished processing successfully`);
    } catch (err) {
      this.logger.error(`[SalesRegisterExport ${jobId}] Failed: ${err.message}`, err.stack);
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
    grandTotals: any
  ): string {
    let rowsHtml = '';
    const formatVal = (val: number) => val === 0 ? '-' : val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    for (const r of data) {
      const dateFormatted = new Date(r.date).toLocaleDateString();
      rowsHtml += `
        <tr class="${r.cmNo.startsWith('SI-') ? '' : 'return-row'}">
          <td>${r.cmNo}</td>
          <td>${dateFormatted}</td>
          <td class="num">${formatVal(r.grossSale)}</td>
          <td class="num">${formatVal(r.grossSaleWost)}</td>
          <td class="num">${formatVal(r.disc)}</td>
          <td class="num">${formatVal(r.sTax)}</td>
          <td class="num font-bold">${formatVal(r.netSale)}</td>
          <td class="num">${formatVal(r.cash)}</td>
          <td class="num">${formatVal(r.postex)}</td>
          <td class="num">${formatVal(r.leopard)}</td>
          <td class="center">${r.cardNo || '-'}</td>
          <td class="num">${formatVal(r.cardAmount)}</td>
          <td class="alliance">${r.allianceDetails || '-'}</td>
          <td class="num">${formatVal(r.giftVoucherAmt)}</td>
          <td>${r.giftVoucherCode || '-'}</td>
          <td class="num">${formatVal(r.creditAmt)}</td>
          <td>${r.creditCode || '-'}</td>
          <td class="num">${formatVal(r.claimAmt)}</td>
          <td>${r.claimCode || '-'}</td>
          <td class="num">${formatVal(r.corporateAmt)}</td>
          <td>${r.corporateCode || '-'}</td>
          <td class="num">${formatVal(r.exchangeAmt)}</td>
          <td>${r.exchangeCode || '-'}</td>
          <td class="center">${r.manualDiscPct || '-'}</td>
          <td class="num">${formatVal(r.manualDiscAmt)}</td>
          <td>${r.manualDiscNote || '-'}</td>
          <td class="center">${r.overrideDiscPct || '-'}</td>
          <td>${r.overrideDiscNote || '-'}</td>
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
            font-size: 6px;
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
            font-size: 12px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #0f172a;
          }
          .report-title {
            font-size: 10px;
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
            font-size: 5px;
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
          td.alliance {
            font-size: 5px;
            color: #475569;
          }
          .return-row {
            background-color: #fef2f2;
            color: #991b1b;
          }
          .grand-total-row {
            background-color: #cbd5e1;
            color: #0f172a;
            font-weight: bold;
            font-size: 7px;
            border-top: 2px solid #0f172a;
            border-bottom: 2px double #0f172a;
          }
        </style>
      </head>
      <body>
        <div class="header-block">
          <div class="company-name">Speed (Pvt.) Limited</div>
          <div class="report-title">Sales Register Report</div>
          <div class="meta-info">
            <strong>Location:</strong> ${locationName} | 
            <strong>Period:</strong> ${fromDateStr} - ${toDateStr}
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>CM #</th>
              <th>Date</th>
              <th>Gross Sale</th>
              <th>Gross WOST</th>
              <th>Disc</th>
              <th>S. Tax</th>
              <th>Net Sale</th>
              <th>Cash</th>
              <th>PostEx</th>
              <th>Leopard</th>
              <th>Card No.</th>
              <th>Card Amt</th>
              <th>Alliance details</th>
              <th>Gift Amt</th>
              <th>Gift Voucher</th>
              <th>Credit Amt</th>
              <th>Credit Code</th>
              <th>Claim Amt</th>
              <th>Claim Code</th>
              <th>Corp Amt</th>
              <th>Corp Code</th>
              <th>Exch Amt</th>
              <th>Exch Code</th>
              <th>Man %</th>
              <th>Man Amt</th>
              <th>Man Note</th>
              <th>Ovr %</th>
              <th>Ovr Note</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            <tr class="grand-total-row">
              <td colspan="2">GRAND TOTAL</td>
              <td class="num">${formatVal(grandTotals.grossSale)}</td>
              <td class="num">${formatVal(grandTotals.grossSaleWost)}</td>
              <td class="num">${formatVal(grandTotals.disc)}</td>
              <td class="num">${formatVal(grandTotals.sTax)}</td>
              <td class="num">${formatVal(grandTotals.netSale)}</td>
              <td class="num">${formatVal(grandTotals.cash)}</td>
              <td class="num">${formatVal(grandTotals.postex)}</td>
              <td class="num">${formatVal(grandTotals.leopard)}</td>
              <td class="center">-</td>
              <td class="num">${formatVal(grandTotals.cardAmount)}</td>
              <td>-</td>
              <td class="num">${formatVal(grandTotals.giftVoucherAmt)}</td>
              <td>-</td>
              <td class="num">${formatVal(grandTotals.creditAmt)}</td>
              <td>-</td>
              <td class="num">${formatVal(grandTotals.claimAmt)}</td>
              <td>-</td>
              <td class="num">${formatVal(grandTotals.corporateAmt)}</td>
              <td>-</td>
              <td class="num">${formatVal(grandTotals.exchangeAmt)}</td>
              <td>-</td>
              <td class="center">-</td>
              <td class="num">${formatVal(grandTotals.manualDiscAmt)}</td>
              <td>-</td>
              <td class="center">-</td>
              <td>-</td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `;
  }
}
