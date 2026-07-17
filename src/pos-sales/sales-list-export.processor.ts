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

interface SalesListExportJobData {
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
}

const COLUMNS = [
  { header: 'Date & Time', key: 'date', width: 22, align: 'center' },
  { header: 'Invoice #', key: 'invoiceNo', width: 14, align: 'left' },
  { header: 'NetTotal', key: 'netTotal', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Balance', key: 'balance', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Cash', key: 'tenderCash', width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'Card', key: 'tenderCard', width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'Reward Voucher', key: 'tenderRewardVoucher', width: 15, align: 'right', numFmt: '#,##0.00' },
  { header: 'On Credit', key: 'tenderOnCredit', width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'Gift Voucher', key: 'tenderGiftVoucher', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Credit Voucher', key: 'tenderCreditVoucher', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Exchange Voucher', key: 'tenderExchangeVoucher', width: 16, align: 'right', numFmt: '#,##0.00' },
  { header: 'Claim Voucher', key: 'tenderClaimVoucher', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Corporate Gift Voucher', key: 'tenderCorporateVoucher', width: 18, align: 'right', numFmt: '#,##0.00' },
  { header: 'Issued Gift', key: 'issuedGiftVoucher', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Issued Credit', key: 'issuedCreditVoucher', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Return', key: 'returnAmount', width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'FBR', key: 'fbr', width: 10, align: 'center', numFmt: '#,##0' },
  { header: 'Net Sale', key: 'netSale', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Tender Documents', key: 'tenderDocuments', width: 28, align: 'left' }
];

@Processor('sales-list-export')
export class SalesListExportProcessor {
  private readonly logger = new Logger(SalesListExportProcessor.name);

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
  async handleExport(job: Job<SalesListExportJobData>): Promise<void> {
    const {
      jobId,
      userId,
      tenantId,
      tenantDbUrl,
      locationId,
      startDate: startStr,
      endDate: endStr,
      cashierUserId,
      format,
      search,
      paymentModeGroup,
      minAmount,
      maxAmount,
      fbrOnly,
    } = job.data;
    this.logger.log(`[SalesListExport ${jobId}] Starting ${format.toUpperCase()} export`);

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

      // ── Step 1: Fetch and page through orders using offset pagination ──
      const orders: any[] = [];
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
          },
          orderBy: { createdAt: 'asc' },
          skip,
          take: CHUNK,
        });

        orders.push(...chunk);
        skip += CHUNK;
        hasMore = chunk.length === CHUNK;
      }

      await job.progress(40);

      // ── Step 2: Fetch return stock ledger entries ──
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

      const referenceOrderIds = [
        ...new Set(returnLedgerEntries.map((e) => e.referenceId).filter(Boolean)),
      ];

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

      // Fetch all issued vouchers
      const allOrderIds = [
        ...orders.map((o) => o.id),
        ...referenceOrderIds,
      ];
      const issuedVouchers = allOrderIds.length
        ? await prisma.voucher.findMany({
            where: {
              sourceOrderId: { in: allOrderIds },
              isDeleted: false,
            },
          })
        : [];

      const issuedVoucherMap = new Map<string, any[]>();
      for (const v of issuedVouchers) {
        if (!v.sourceOrderId) continue;
        const list = issuedVoucherMap.get(v.sourceOrderId) || [];
        list.push(v);
        issuedVoucherMap.set(v.sourceOrderId, list);
      }

      const rows: any[] = [];

      // Helper to parse tender documents (Auth, Bin, last 4 digits)
      const parseTenderDocs = (notes: string | null, alliance: any): string => {
        if (!notes) return '';
        
        const cardMatch = notes.match(/Card:\s*\*\*\*\*(\d{4})/i);
        const cardLast4 = cardMatch ? cardMatch[1] : '';
        
        const slipMatch = notes.match(/Slip:\s*(\w+)/i);
        const authId = slipMatch ? slipMatch[1] : '';
        
        const binMatch = notes.match(/BIN:\s*(\d+)/i);
        const binNumber = binMatch ? binMatch[1] : '';

        if (authId && cardLast4) {
          if (binNumber) {
            const formattedBin = binNumber.length >= 6 
              ? (binNumber.slice(0, 4) + '-' + binNumber.slice(4)) 
              : binNumber;
            return `${authId},${formattedBin}**-****-${cardLast4}`;
          }
          return `${authId},****-****-${cardLast4}`;
        }
        return cardLast4 || authId || '';
      };

      // ── Process Orders ──
      for (const order of orders) {
        const notesStr = order.notes || '';
        const fbr = order.fbrInvoiceNumber ? 1 : 0;
        const netSale = Number(order.grandTotal) - fbr;

        let balance = 0;
        const balanceMatch = notesStr.match(/\[Credit Sale\] Balance:\s*([\d.]+)/i);
        if (balanceMatch) {
          balance = Number(balanceMatch[1]);
        } else if (order.paymentMethod === 'credit_account' || order.tenderType === 'credit_account') {
          balance = Number(order.grandTotal);
        }

        let cash = Number(order.cashAmount || 0);
        let card = Number(order.cardAmount || 0);
        let onCredit = balance;
        let rewardVoucher = 0;
        
        let giftVoucher = 0;
        let creditVoucher = 0;
        let exchangeVoucher = 0;
        let claimVoucher = 0;
        let corporateVoucher = 0;

        for (const red of order.voucherRedemptions) {
          const type = red.voucher?.voucherType;
          const amt = Number(red.amountUsed);

          if (type === 'GIFT' || type === 'OUTLET_GIFT') {
            giftVoucher += amt;
          } else if (type === 'CREDIT' || type === 'REFUND') {
            creditVoucher += amt;
          } else if (type === 'CLAIM') {
            claimVoucher += amt;
          } else if (type === 'CORPORATE') {
            corporateVoucher += amt;
          } else if (type === 'EXCHANGE') {
            exchangeVoucher += amt;
          }
        }

        let issuedGift = 0;
        let issuedCredit = 0;

        const orderIssued = issuedVoucherMap.get(order.id) || [];
        for (const iv of orderIssued) {
          const type = iv.voucherType;
          const faceVal = Number(iv.faceValue || 0);

          if (type === 'GIFT' || type === 'CORPORATE' || type === 'OUTLET_GIFT') {
            issuedGift += faceVal;
          } else if (type === 'CREDIT' || type === 'EXCHANGE' || type === 'REFUND') {
            issuedCredit += faceVal;
          }
        }

        const tenderDocs = parseTenderDocs(notesStr, order.alliance);

        rows.push({
          id: order.id,
          invoiceNo: order.orderNumber,
          date: order.createdAt,
          netTotal: Number(order.grandTotal),
          balance,
          tenderCash: cash,
          tenderCard: card,
          tenderRewardVoucher: rewardVoucher,
          tenderOnCredit: onCredit,
          tenderGiftVoucher: giftVoucher,
          tenderCreditVoucher: creditVoucher,
          tenderExchangeVoucher: exchangeVoucher,
          tenderClaimVoucher: claimVoucher,
          tenderCorporateVoucher: corporateVoucher,
          issuedGiftVoucher: issuedGift,
          issuedCreditVoucher: issuedCredit,
          returnAmount: 0,
          fbr,
          netSale,
          tenderDocuments: tenderDocs,
        });
      }

      // ── Process Returns ──
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

        let cash = 0;
        let exchangeVoucher = 0;

        const isRefund = entries[0].referenceType === 'POS_REFUND';
        if (isRefund) {
          cash = -netSale;
        } else {
          exchangeVoucher = -netSale;
        }

        const docNum = isRefund
          ? (order.refundNumber || `Refund for ${order.orderNumber}`)
          : (order.returnNumber || `Return for ${order.orderNumber}`);

        let issuedGift = 0;
        let issuedCredit = 0;

        const returnIssued = issuedVoucherMap.get(refId) || [];
        for (const iv of returnIssued) {
          const type = iv.voucherType;
          const faceVal = Number(iv.faceValue || 0);

          if (type === 'GIFT' || type === 'CORPORATE' || type === 'OUTLET_GIFT') {
            issuedGift += faceVal;
          } else if (type === 'CREDIT' || type === 'EXCHANGE' || type === 'REFUND') {
            issuedCredit += faceVal;
          }
        }

        rows.push({
          id: `${refId}-return`,
          invoiceNo: docNum,
          date: entries[0].createdAt,
          netTotal: -netSale,
          balance: 0,
          tenderCash: cash,
          tenderCard: 0,
          tenderRewardVoucher: 0,
          tenderOnCredit: 0,
          tenderGiftVoucher: 0,
          tenderCreditVoucher: 0,
          tenderExchangeVoucher: exchangeVoucher,
          tenderClaimVoucher: 0,
          tenderCorporateVoucher: 0,
          issuedGiftVoucher: issuedGift,
          issuedCreditVoucher: issuedCredit,
          returnAmount: -netSale,
          fbr: 0,
          netSale: -netSale,
          tenderDocuments: '',
        });
      }

      let filteredRows = rows;

      if (paymentModeGroup) {
        filteredRows = filteredRows.filter((r) => {
          if (paymentModeGroup === 'cash') return r.tenderCash !== 0;
          if (paymentModeGroup === 'card') return r.tenderCard !== 0;
          if (paymentModeGroup === 'credit') return r.tenderOnCredit !== 0 || r.balance !== 0;
          if (paymentModeGroup === 'voucher') {
            return (
              r.tenderGiftVoucher !== 0 ||
              r.tenderCreditVoucher !== 0 ||
              r.tenderExchangeVoucher !== 0 ||
              r.tenderClaimVoucher !== 0 ||
              r.tenderCorporateVoucher !== 0
            );
          }
          if (paymentModeGroup === 'return') return r.returnAmount !== 0;
          return true;
        });
      }

      if (minAmount !== undefined && minAmount !== null) {
        filteredRows = filteredRows.filter((r) => Math.abs(r.netTotal) >= Number(minAmount));
      }
      if (maxAmount !== undefined && maxAmount !== null) {
        filteredRows = filteredRows.filter((r) => Math.abs(r.netTotal) <= Number(maxAmount));
      }
      if (fbrOnly) {
        filteredRows = filteredRows.filter((r) => r.fbr === 1);
      }

      filteredRows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      // ── Compute Grand Totals ──
      const grandTotals = {
        netTotal: 0,
        balance: 0,
        tenderCash: 0,
        tenderCard: 0,
        tenderRewardVoucher: 0,
        tenderOnCredit: 0,
        tenderGiftVoucher: 0,
        tenderCreditVoucher: 0,
        tenderExchangeVoucher: 0,
        tenderClaimVoucher: 0,
        tenderCorporateVoucher: 0,
        issuedGiftVoucher: 0,
        issuedCreditVoucher: 0,
        returnAmount: 0,
        fbr: 0,
        netSale: 0,
      };

      for (const r of filteredRows) {
        grandTotals.netTotal += r.netTotal;
        grandTotals.balance += r.balance;
        grandTotals.tenderCash += r.tenderCash;
        grandTotals.tenderCard += r.tenderCard;
        grandTotals.tenderRewardVoucher += r.tenderRewardVoucher;
        grandTotals.tenderOnCredit += r.tenderOnCredit;
        grandTotals.tenderGiftVoucher += r.tenderGiftVoucher;
        grandTotals.tenderCreditVoucher += r.tenderCreditVoucher;
        grandTotals.tenderExchangeVoucher += r.tenderExchangeVoucher;
        grandTotals.tenderClaimVoucher += r.tenderClaimVoucher;
        grandTotals.tenderCorporateVoucher += r.tenderCorporateVoucher;
        grandTotals.issuedGiftVoucher += r.issuedGiftVoucher;
        grandTotals.issuedCreditVoucher += r.issuedCreditVoucher;
        grandTotals.returnAmount += r.returnAmount;
        grandTotals.fbr += r.fbr;
        grandTotals.netSale += r.netSale;
      }

      await job.progress(80);

      if (format === 'pdf') {
        const fromDateStr = startDate.toLocaleDateString();
        const toDateStr = endDate.toLocaleDateString();
        const html = this.buildPdfHtml(filteredRows, locationName, fromDateStr, toDateStr, grandTotals);

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
            headerTemplate: '<div style="font-size: 7px; width: 100%; text-align: right; padding-right: 15mm; color: #94a3b8;">Sales List Report</div>',
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

        const ws = workbook.addWorksheet('Sales List', {
          pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
        });

        ws.columns = COLUMNS.map(c => ({ key: c.key, width: c.width }));

        // Row 1: Merged Group Headers
        const groupRow = ws.getRow(1);
        ws.mergeCells('A1:D1');
        groupRow.getCell(1).value = 'Sale';
        
        ws.mergeCells('E1:M1');
        groupRow.getCell(5).value = 'Tender';
        
        ws.mergeCells('N1:O1');
        groupRow.getCell(14).value = 'Issued';
        
        ['A1', 'E1', 'N1'].forEach(cellRef => {
          const cell = ws.getCell(cellRef);
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });
        groupRow.height = 24;
        groupRow.commit();

        // Row 2: Detailed Column Headers
        const headerRow = ws.getRow(2);
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

        for (const r of filteredRows) {
          const rowData = {
            date: new Date(r.date).toLocaleString(),
            invoiceNo: r.invoiceNo,
            netTotal: r.netTotal,
            balance: r.balance,
            tenderCash: r.tenderCash,
            tenderCard: r.tenderCard,
            tenderRewardVoucher: r.tenderRewardVoucher,
            tenderOnCredit: r.tenderOnCredit,
            tenderGiftVoucher: r.tenderGiftVoucher,
            tenderCreditVoucher: r.tenderCreditVoucher,
            tenderExchangeVoucher: r.tenderExchangeVoucher,
            tenderClaimVoucher: r.tenderClaimVoucher,
            tenderCorporateVoucher: r.tenderCorporateVoucher,
            issuedGiftVoucher: r.issuedGiftVoucher,
            issuedCreditVoucher: r.issuedCreditVoucher,
            returnAmount: r.returnAmount,
            fbr: r.fbr,
            netSale: r.netSale,
            tenderDocuments: r.tenderDocuments,
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
          date: 'GRAND TOTAL',
          invoiceNo: '',
          netTotal: grandTotals.netTotal,
          balance: grandTotals.balance,
          tenderCash: grandTotals.tenderCash,
          tenderCard: grandTotals.tenderCard,
          tenderRewardVoucher: grandTotals.tenderRewardVoucher,
          tenderOnCredit: grandTotals.tenderOnCredit,
          tenderGiftVoucher: grandTotals.tenderGiftVoucher,
          tenderCreditVoucher: grandTotals.tenderCreditVoucher,
          tenderExchangeVoucher: grandTotals.tenderExchangeVoucher,
          tenderClaimVoucher: grandTotals.tenderClaimVoucher,
          tenderCorporateVoucher: grandTotals.tenderCorporateVoucher,
          issuedGiftVoucher: grandTotals.issuedGiftVoucher,
          issuedCreditVoucher: grandTotals.issuedCreditVoucher,
          returnAmount: grandTotals.returnAmount,
          fbr: grandTotals.fbr,
          netSale: grandTotals.netSale,
          tenderDocuments: '',
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
        ? `sales-list-report-${new Date().toISOString().slice(0, 10)}.pdf`
        : `sales-list-report-${new Date().toISOString().slice(0, 10)}.xlsx`;

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
        title: 'Sales List Export Ready',
        message: `Your POS Sales List ${format.toUpperCase()} report has been processed successfully.`,
        category: 'export',
        priority: 'high',
        actionType: 'sales-list-export.ready',
        actionPayload: JSON.stringify({ jobId }),
      });

      await job.progress(100);
      this.logger.log(`[SalesListExport ${jobId}] Finished processing successfully`);
    } catch (err) {
      this.logger.error(`[SalesListExport ${jobId}] Failed: ${err.message}`, err.stack);
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
      const dateFormatted = new Date(r.date).toLocaleString();
      rowsHtml += `
        <tr class="${r.returnAmount !== 0 ? 'return-row' : ''}">
          <td class="center">${dateFormatted}</td>
          <td>${r.invoiceNo}</td>
          <td class="num font-bold">${formatVal(r.netTotal)}</td>
          <td class="num">${formatVal(r.balance)}</td>
          <td class="num">${formatVal(r.tenderCash)}</td>
          <td class="num">${formatVal(r.tenderCard)}</td>
          <td class="num">${formatVal(r.tenderRewardVoucher)}</td>
          <td class="num">${formatVal(r.tenderOnCredit)}</td>
          <td class="num">${formatVal(r.tenderGiftVoucher)}</td>
          <td class="num">${formatVal(r.tenderCreditVoucher)}</td>
          <td class="num">${formatVal(r.tenderExchangeVoucher)}</td>
          <td class="num">${formatVal(r.tenderClaimVoucher)}</td>
          <td class="num">${formatVal(r.tenderCorporateVoucher)}</td>
          <td class="num">${formatVal(r.issuedGiftVoucher)}</td>
          <td class="num">${formatVal(r.issuedCreditVoucher)}</td>
          <td class="num">${formatVal(r.returnAmount)}</td>
          <td class="center">${r.fbr}</td>
          <td class="num font-bold">${formatVal(r.netSale)}</td>
          <td>${r.tenderDocuments || '-'}</td>
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
            font-size: 5px;
            padding: 3px 2px;
            border: 1px solid #475569;
            text-align: center;
          }
          th.group-header {
            background-color: #0f172a;
            font-size: 6px;
            border: 1px solid #1e293b;
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
          .return-row {
            background-color: #fef2f2;
            color: #991b1b;
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
          <div class="report-title">Sales List Report</div>
          <div class="meta-info">
            <strong>Location:</strong> ${locationName} | 
            <strong>Period:</strong> ${fromDateStr} - ${toDateStr}
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th colspan="4" class="group-header">Sale</th>
              <th colspan="9" class="group-header">Tender</th>
              <th colspan="2" class="group-header">Issued</th>
              <th colspan="4" class="group-header">&nbsp;</th>
            </tr>
            <tr>
              <th>Date & Time</th>
              <th>Invoice #</th>
              <th>NetTotal</th>
              <th>Balance</th>
              <th>Cash</th>
              <th>Card</th>
              <th>Reward Voucher</th>
              <th>On Credit</th>
              <th>Gift Voucher</th>
              <th>Credit Voucher</th>
              <th>Exchange Voucher</th>
              <th>Claim Voucher</th>
              <th>Corporate Voucher</th>
              <th>Gift Voucher</th>
              <th>Credit Voucher</th>
              <th>Return</th>
              <th>FBR</th>
              <th>Net Sale</th>
              <th>Tender Documents</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            <tr class="grand-total-row">
              <td colspan="2">GRAND TOTAL</td>
              <td class="num">${formatVal(grandTotals.netTotal)}</td>
              <td class="num">${formatVal(grandTotals.balance)}</td>
              <td class="num">${formatVal(grandTotals.tenderCash)}</td>
              <td class="num">${formatVal(grandTotals.tenderCard)}</td>
              <td class="num">${formatVal(grandTotals.tenderRewardVoucher)}</td>
              <td class="num">${formatVal(grandTotals.tenderOnCredit)}</td>
              <td class="num">${formatVal(grandTotals.tenderGiftVoucher)}</td>
              <td class="num">${formatVal(grandTotals.tenderCreditVoucher)}</td>
              <td class="num">${formatVal(grandTotals.tenderExchangeVoucher)}</td>
              <td class="num">${formatVal(grandTotals.tenderClaimVoucher)}</td>
              <td class="num">${formatVal(grandTotals.tenderCorporateVoucher)}</td>
              <td class="num">${formatVal(grandTotals.issuedGiftVoucher)}</td>
              <td class="num">${formatVal(grandTotals.issuedCreditVoucher)}</td>
              <td class="num">${formatVal(grandTotals.returnAmount)}</td>
              <td class="center">${grandTotals.fbr}</td>
              <td class="num font-bold">${formatVal(grandTotals.netSale)}</td>
              <td>&nbsp;</td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `;
  }
}
