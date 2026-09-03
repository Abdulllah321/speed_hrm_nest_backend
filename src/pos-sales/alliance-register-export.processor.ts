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

export interface AllianceRegisterExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  locationId?: string;
  startDate?: string;
  endDate?: string;
  cashierUserId?: string;
  format: 'xlsx' | 'pdf';
  search?: string;
}

const COLUMNS = [
  { header: 'Sales Tax Invoice', key: 'invoiceNo',      width: 22 },
  { header: 'Date',              key: 'date',            width: 12 },
  { header: 'Time',              key: 'time',            width: 10 },
  { header: 'Retail Price',      key: 'retailPrice',     width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Retail Price WOST', key: 'retailWost',      width: 16, align: 'right', numFmt: '#,##0.00' },
  { header: 'Discount',          key: 'discount',        width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'S. Tax',            key: 'sTax',            width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'Net Sale',          key: 'netSale',         width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Cash Sale',         key: 'cashSale',        width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'Cash Return',       key: 'cashReturn',      width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'Card Sale',         key: 'cardSale',        width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'Credit Sale',       key: 'creditSale',      width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'Gift Voucher',      key: 'giftVoucherAmount', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Credit Voucher',    key: 'creditVoucherAmount', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Exchange Voucher',  key: 'exchangeVoucherAmount', width: 16, align: 'right', numFmt: '#,##0.00' },
  { header: 'Claim Voucher',     key: 'claimVoucherAmount', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Corporate Voucher', key: 'giftVoucherCorporate', width: 16, align: 'right', numFmt: '#,##0.00' },
  { header: 'Credit Issued',     key: 'creditVoucherIssuedAmount', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Reward Voucher',    key: 'rewardVoucherAmount', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'On Credit',         key: 'onCreditAmount',  width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'BIN No.',           key: 'binNo',           width: 18 },
  { header: 'Card No.',          key: 'cardNo',          width: 12, align: 'center' },
  { header: 'Card Name',         key: 'cardName',        width: 20 },
  { header: 'Auth ID',           key: 'authId',          width: 14, align: 'center' },
  { header: 'Alliance Option',   key: 'allianceOption',  width: 40 },
  { header: 'Remarks',           key: 'remarks',         width: 35 },
  { header: 'Gift Voucher No.',  key: 'giftVoucherCode', width: 18 },
  { header: 'Credit Voucher No.', key: 'creditCode',      width: 18 },
  { header: 'Claim Voucher No.',  key: 'claimCode',       width: 18 },
  { header: 'Credit Issued No.', key: 'creditVoucherIssued', width: 22 },
];

// ─── Helper to parse alliance metadata from the notes field ──────────────────
function parseAllianceNotes(notes: string | null, order?: any) {
  const notesStr = notes || '';
  const binMatch     = notesStr.match(/BIN:\s*([\d\-]+)/i);
  const slipMatch    = notesStr.match(/(?:Slip|Auth\s*ID|Auth|Approval):\s*([a-zA-Z0-9]+)/i);
  const cardMatch    = notesStr.match(/(?:Card|Last4|CardLast4|Card#):\s*(?:\*{4})?(\d{4})/i);
  const cardholderMatch = notesStr.match(/(?:Cardholder|Card\s*Name|Bank|Card\s*Type):\s*([^|\],]+)/i);

  let binNumber = binMatch ? binMatch[1] : '';
  if (!binNumber && order?.alliance?.binNumbers && Array.isArray(order.alliance.binNumbers) && order.alliance.binNumbers.length > 0) {
    binNumber = order.alliance.binNumbers[0];
  }

  const authId = slipMatch ? slipMatch[1] : '';
  const cardLast4 = cardMatch ? cardMatch[1] : '';
  let cardName = cardholderMatch ? cardholderMatch[1].trim() : '';
  if (!cardName) {
    cardName = order?.merchant?.bankName || order?.alliance?.partnerName || '';
  }

  return {
    binNumber,
    binNo: binNumber,
    authId,
    cardLast4,
    cardNo: cardLast4,
    cardName,
  };
}

@Processor('alliance-register-export')
export class AllianceRegisterExportProcessor {
  private readonly logger = new Logger(AllianceRegisterExportProcessor.name);

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
  async handleExport(job: Job<AllianceRegisterExportJobData>): Promise<void> {
    const {
      jobId, userId, tenantId, tenantDbUrl,
      locationId, startDate: startStr, endDate: endStr,
      cashierUserId, format, search,
    } = job.data;

    this.logger.log(`[AllianceRegisterExport ${jobId}] Starting ${format.toUpperCase()} export`);

    const prisma        = new PrismaService({ tenantId, tenantDbUrl } as any);
    const prismaMaster  = new PrismaMasterService();
    const exportDir     = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const ext      = format === 'pdf' ? 'pdf' : 'xlsx';
    const filePath = path.join(exportDir, `export-${jobId}.${ext}`);

    try {
      await job.progress(10);

      // ── Location info ─────────────────────────────────────────
      let locationName = 'All Outlets';
      let locFilter: any = {};

      if (locationId && locationId !== 'all') {
        const locIds = locationId.split(',').map((s) => s.trim()).filter(Boolean);
        if (locIds.length === 1) {
          const location = await prisma.location.findUnique({
            where: { id: locIds[0] },
            select: { name: true },
          });
          locationName = location?.name || 'Store';
          locFilter = { locationId: locIds[0] };
        } else if (locIds.length > 1) {
          const locs = await prisma.location.findMany({
            where: { id: { in: locIds } },
            select: { name: true },
          });
          locationName = locs.map((l) => l.name).join(', ') || `${locIds.length} Outlets`;
          locFilter = { locationId: { in: locIds } };
        }
      }

      const now       = new Date();
      const startDate = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate   = endStr ? new Date(endStr) : new Date(now);
      endDate.setHours(23, 59, 59, 999);

      // ── Fetch alliance-only sales orders (offset pagination per architecture rules) ──
      const records: any[] = [];
      let skip = 0;
      const CHUNK = 500;
      let hasMore = true;

      while (hasMore) {
        const chunk = await prisma.salesOrder.findMany({
          where: {
            ...locFilter,
            status: { in: ['completed', 'partially_returned'] },
            createdAt: { gte: startDate, lte: endDate },
            // Alliance filter: pure alliance OR manual-with-alliance
            OR: [
              { allianceId: { not: null } },
              { manualDiscountNote: { contains: '[Manual Alliance]', mode: 'insensitive' } },
            ],
            ...(cashierUserId ? { cashierUserId } : {}),
            ...(search ? { orderNumber: { contains: search, mode: 'insensitive' } } : {}),
          },
          include: {
            alliance: true,
            items: true,
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

        records.push(...chunk);
        skip += CHUNK;
        if (chunk.length < CHUNK) hasMore = false;
      }

      const orderIds = records.map((o) => o.id);
      const issuedVouchers = orderIds.length > 0
        ? await prisma.voucher.findMany({
            where: {
              sourceOrderId: { in: orderIds },
              isDeleted: false,
            },
          })
        : [];

      const issuedVouchersMap = new Map<string, any[]>();
      for (const v of issuedVouchers) {
        if (v.sourceOrderId) {
          const list = issuedVouchersMap.get(v.sourceOrderId) || [];
          list.push(v);
          issuedVouchersMap.set(v.sourceOrderId, list);
        }
      }

      await job.progress(50);

      // ── Map to report rows ───────────────────────────────────
      const rows: any[] = [];

      for (const order of records) {
        // Retail Price = sum of (unitPrice × qty) — with tax included
        let retailPrice = 0;
        for (const item of order.items) {
          retailPrice += Number(item.unitPrice || 0) * Number(item.quantity || 1);
        }

        const notesStr = order.notes || '';
        // Parse BIN / Auth ID / Card Last 4 / Card Name from notes & relations
        const { binNo, authId, cardLast4, cardName } = parseAllianceNotes(notesStr, order);

        // Alliance Option label
        let allianceOption = '';
        if (order.alliance) {
          const pct = Number(order.alliance.discountPercent);
          const cap = order.alliance.maxDiscount ? ` cap ${Number(order.alliance.maxDiscount).toLocaleString()}` : '';
          const bin = binNo ? ` | BIN: ${binNo}` : '';
          allianceOption = `${order.alliance.partnerName} ${pct}%${cap}${bin}`;
        } else if (order.manualDiscountNote) {
          // Manual alliance: strip the prefix tag and show note
          allianceOption = order.manualDiscountNote.replace(/\[Manual Alliance\]/gi, '').trim();
        }

        // Balance / OnCredit
        let balance = 0;
        const balanceMatch = notesStr.match(/\[Credit Sale\] Balance:\s*([\d.]+)/i);
        if (balanceMatch) {
          balance = Number(balanceMatch[1]);
        } else if (order.paymentMethod === 'credit_account' || order.tenderType === 'credit_account') {
          balance = Number(order.grandTotal);
        }

        let cashSale = Number(order.cashAmount || 0);
        let cardSale = Number(order.cardAmount || 0);
        let onCreditAmount = balance;
        let creditSale = (balance > 0 || order.paymentMethod === 'credit_account' || order.tenderType === 'credit_account') ? Number(order.grandTotal) : 0;
        let cashReturn = 0;

        if (cashSale === 0) {
          const cashMatch = notesStr.match(/(?:cash|cashsale):\s*([\d.]+)/i);
          if (cashMatch) cashSale = Number(cashMatch[1]);
        }
        if (cardSale === 0) {
          const cardMatch = notesStr.match(/(?:card|cardsale):\s*([\d.]+)/i);
          if (cardMatch) cardSale = Number(cardMatch[1]);
        }

        let rewardVoucherAmount = 0;
        if (order.paymentMethod === 'reward_voucher' || order.tenderType === 'reward_voucher') {
          rewardVoucherAmount = Number(order.grandTotal);
        } else if (notesStr.includes('[Reward Voucher]')) {
          const amtMatch = notesStr.match(/\[Reward Voucher\].*?Amount:\s*([\d.]+)/i);
          if (amtMatch) {
            rewardVoucherAmount = Number(amtMatch[1]);
          }
        }

        // Vouchers Used / Redeemed mapping
        let giftVoucherAmt = 0;
        let giftVoucherCode = '';
        let creditAmt = 0;
        let creditCode = '';
        let claimAmt = 0;
        let claimCode = '';
        let corporateAmt = 0;
        let corporateCode = '';
        let exchangeAmt = 0;
        let exchangeCode = '';

        const giftCodes: string[] = [];
        const creditCodes: string[] = [];
        const claimCodes: string[] = [];
        const corpCodes: string[] = [];
        const exchCodes: string[] = [];

        for (const red of order.voucherRedemptions || []) {
          const type = red.voucher?.voucherType;
          const code = red.voucher?.code || '';
          const amt = Number(red.amountUsed);

          if (type === 'GIFT' || type === 'OUTLET_GIFT') {
            giftVoucherAmt += amt;
            giftCodes.push(code);
          } else if (type === 'CREDIT' || type === 'REFUND') {
            creditAmt += amt;
            creditCodes.push(code);
          } else if (type === 'CLAIM') {
            claimAmt += amt;
            claimCodes.push(code);
          } else if (type === 'CORPORATE') {
            corporateAmt += amt;
            corpCodes.push(code);
          } else if (type === 'EXCHANGE') {
            exchangeAmt += amt;
            exchCodes.push(code);
          } else if (type === 'REWARD') {
            rewardVoucherAmount += amt;
          }
        }

        // Unallocated voucher amount fallback
        const totalRedeemedVoucher = giftVoucherAmt + creditAmt + exchangeAmt + claimAmt + corporateAmt + rewardVoucherAmount;
        const orderVoucherAmt = Number(order.voucherAmount || 0);
        if (orderVoucherAmt > totalRedeemedVoucher) {
          const remVoucher = orderVoucherAmt - totalRedeemedVoucher;
          if (notesStr.match(/ExVoucher|Exchange|EXC-/i)) {
            exchangeAmt += remVoucher;
          } else if (notesStr.match(/Claim|CLM-/i)) {
            claimAmt += remVoucher;
          } else if (notesStr.match(/Corporate/i)) {
            corporateAmt += remVoucher;
          } else if (notesStr.match(/Gift/i)) {
            giftVoucherAmt += remVoucher;
          } else if (notesStr.match(/Reward/i)) {
            rewardVoucherAmount += remVoucher;
          } else {
            creditAmt += remVoucher;
          }
        }

        giftVoucherCode = giftCodes.join(', ');
        creditCode = creditCodes.join(', ');
        claimCode = claimCodes.join(', ');
        corporateCode = corpCodes.join(', ');
        exchangeCode = exchCodes.join(', ');

        // Fallback if all tenders are 0
        const totalTenders = cashSale + cardSale + giftVoucherAmt + creditAmt + exchangeAmt + claimAmt + corporateAmt + rewardVoucherAmount + onCreditAmount;
        if (totalTenders === 0) {
          const payMethod = (order.paymentMethod || 'cash').toLowerCase();
          if (payMethod.includes('cash')) cashSale = Number(order.grandTotal);
          else if (payMethod.includes('card') || payMethod.includes('bank')) cardSale = Number(order.grandTotal);
          else if (payMethod.includes('credit')) {
            creditSale = Number(order.grandTotal);
            onCreditAmount = Number(order.grandTotal);
          } else if (payMethod.includes('voucher')) {
            creditAmt = Number(order.grandTotal);
          } else {
            cashSale = Number(order.grandTotal);
          }
        }

        // Credit Voucher Issued mapping
        const orderIssued = issuedVouchersMap.get(order.id) || [];
        const creditVoucherIssued = orderIssued.map(v => v.code).join(', ');
        let creditVoucherIssuedAmt = 0;
        for (const iv of orderIssued) {
          const type = iv.voucherType;
          const faceVal = Number(iv.faceValue || 0);
          if (type === 'CREDIT' || type === 'EXCHANGE' || type === 'REFUND') {
            creditVoucherIssuedAmt += faceVal;
          }
        }

        const createdAt = new Date(order.createdAt);

        rows.push({
          invoiceNo:     order.orderNumber,
          date:          createdAt.toLocaleDateString('en-PK', { day: '2-digit', month: '2-digit', year: 'numeric' }),
          time:          createdAt.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: false }),
          retailPrice,
          retailWost:    Number(order.subtotal || 0),
          discount:      Number(order.discountAmount || 0),
          sTax:          Number(order.taxAmount || 0),
          netSale:       Number(order.grandTotal || 0),
          cash:          cashSale,
          card:          cardSale,
          cashSale,
          cashReturn,
          cardSale,
          creditSale,
          giftVoucherAmount: giftVoucherAmt,
          creditVoucherAmount: creditAmt,
          exchangeVoucherAmount: exchangeAmt,
          claimVoucherAmount: claimAmt,
          giftVoucherCorporate: corporateAmt,
          creditVoucherIssuedAmount: creditVoucherIssuedAmt,
          rewardVoucherAmount,
          onCreditAmount,
          binNo,
          prefixCardNo:  binNo,
          authId,
          cardNo:        cardLast4,
          cardLast4,
          cardName,
          allianceOption,
          remarks:       order.manualDiscountNote || order.notes || '',
          giftVoucherCode,
          giftVoucherAmt,
          creditCode,
          creditAmt,
          claimCode,
          claimAmt,
          corporateCode,
          corporateAmt,
          exchangeCode,
          exchangeAmt,
          creditVoucherIssued,
          creditVoucherIssuedAmt,
          // raw date for sorting
          _createdAt:    createdAt,
        });
      }

      // Sort by date ascending
      rows.sort((a, b) => a._createdAt.getTime() - b._createdAt.getTime());

      // ── Grand totals ─────────────────────────────────────────
      const grandTotals = rows.reduce(
        (acc, r) => {
          acc.retailPrice += r.retailPrice;
          acc.retailWost  += r.retailWost;
          acc.discount    += r.discount;
          acc.sTax        += r.sTax;
          acc.netSale     += r.netSale;
          acc.cash        += r.cash;
          acc.card        += r.card;
          acc.cashSale    += r.cashSale;
          acc.cashReturn  += r.cashReturn;
          acc.cardSale    += r.cardSale;
          acc.creditSale  += r.creditSale;
          acc.giftVoucherAmount += r.giftVoucherAmount;
          acc.creditVoucherAmount += r.creditVoucherAmount;
          acc.exchangeVoucherAmount += r.exchangeVoucherAmount;
          acc.claimVoucherAmount += r.claimVoucherAmount;
          acc.giftVoucherCorporate += r.giftVoucherCorporate;
          acc.creditVoucherIssuedAmount += r.creditVoucherIssuedAmount;
          acc.rewardVoucherAmount += r.rewardVoucherAmount;
          acc.onCreditAmount += r.onCreditAmount;
          acc.giftVoucherAmt += r.giftVoucherAmt;
          acc.creditAmt      += r.creditAmt;
          acc.claimAmt       += r.claimAmt;
          acc.corporateAmt   += r.corporateAmt;
          acc.exchangeAmt    += r.exchangeAmt;
          acc.creditVoucherIssuedAmt += r.creditVoucherIssuedAmt;
          return acc;
        },
        {
          retailPrice: 0, retailWost: 0, discount: 0, sTax: 0, netSale: 0, cash: 0, card: 0,
          cashSale: 0, cashReturn: 0, cardSale: 0, creditSale: 0,
          giftVoucherAmount: 0, creditVoucherAmount: 0, exchangeVoucherAmount: 0, claimVoucherAmount: 0,
          giftVoucherCorporate: 0, creditVoucherIssuedAmount: 0, rewardVoucherAmount: 0, onCreditAmount: 0,
          giftVoucherAmt: 0, creditAmt: 0, claimAmt: 0, corporateAmt: 0, exchangeAmt: 0, creditVoucherIssuedAmt: 0
        },
      );

      await job.progress(75);

      // ── Generate file ─────────────────────────────────────────
      if (format === 'pdf') {
        const fromDateStr = startDate.toLocaleDateString();
        const toDateStr   = endDate.toLocaleDateString();
        const html        = this.buildPdfHtml(rows, locationName, fromDateStr, toDateStr, grandTotals);

        const launchArgs = process.platform === 'linux'
          ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--no-zygote']
          : [];

        const browser = await puppeteer.launch({ headless: true, args: launchArgs });

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
            headerTemplate: '<div style="font-size: 7px; width: 100%; text-align: right; padding-right: 15mm; color: #94a3b8;">Alliance Register Report</div>',
            footerTemplate: '<div style="font-size: 7px; width: 100%; text-align: center; color: #94a3b8;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
          });

          fs.writeFileSync(filePath, pdfBuffer);
        } finally {
          await browser.close();
        }
      } else {
        // ── XLSX ─────────────────────────────────────────────────
        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
          filename: filePath,
          useStyles: true,
          useSharedStrings: false,
        });

        const ws = workbook.addWorksheet('Alliance Register', {
          pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
        });

        ws.columns = COLUMNS.map(c => ({ key: c.key, width: c.width }));

        // Header row
        const headerRow = ws.getRow(1);
        COLUMNS.forEach((col, idx) => {
          const cell = headerRow.getCell(idx + 1);
          cell.value     = col.header;
          cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
          cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
          cell.alignment = {
            horizontal: col.align === 'right' ? 'right' : col.align === 'center' ? 'center' : 'left',
            vertical: 'middle',
            wrapText: false,
          };
        });
        headerRow.height = 26;
        headerRow.commit();

        const borderThin = {
          top:    { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
          left:   { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
          right:  { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
        };

        for (const r of rows) {
          const rowData = {
            invoiceNo:    r.invoiceNo,
            date:         r.date,
            time:         r.time,
            retailPrice:  r.retailPrice,
            retailWost:   r.retailWost,
            discount:     r.discount,
            sTax:         r.sTax,
            netSale:      r.netSale,
            cashSale:     r.cashSale,
            cashReturn:   r.cashReturn,
            cardSale:     r.cardSale,
            creditSale:   r.creditSale,
            giftVoucherAmount: r.giftVoucherAmount,
            creditVoucherAmount: r.creditVoucherAmount,
            exchangeVoucherAmount: r.exchangeVoucherAmount,
            claimVoucherAmount: r.claimVoucherAmount,
            giftVoucherCorporate: r.giftVoucherCorporate,
            creditVoucherIssuedAmount: r.creditVoucherIssuedAmount,
            rewardVoucherAmount: r.rewardVoucherAmount,
            onCreditAmount: r.onCreditAmount,
            binNo:        r.binNo || r.prefixCardNo || '',
            cardNo:       r.cardNo || '',
            cardName:     r.cardName || '',
            authId:       r.authId || '',
            allianceOption: r.allianceOption,
            remarks:      r.remarks,
            giftVoucherCode: r.giftVoucherCode,
            creditCode:   r.creditCode,
            claimCode:    r.claimCode,
            creditVoucherIssued: r.creditVoucherIssued,
          };

          const row = ws.addRow(rowData);
          for (let colNum = 1; colNum <= COLUMNS.length; colNum++) {
            const cell = row.getCell(colNum);
            cell.border = borderThin;
            cell.font   = { size: 9 };
            const c = COLUMNS[colNum - 1];
            cell.alignment = {
              horizontal: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left',
              vertical: 'middle',
            };
            if (c.numFmt) cell.numFmt = c.numFmt;
          }
          row.height = 20;
          row.commit();
        }

        // Grand Totals row
        const totalRow = ws.addRow({
          invoiceNo:     'GRAND TOTAL',
          date:          '',
          time:          '',
          retailPrice:   grandTotals.retailPrice,
          retailWost:    grandTotals.retailWost,
          discount:      grandTotals.discount,
          sTax:          grandTotals.sTax,
          netSale:       grandTotals.netSale,
          cashSale:      grandTotals.cashSale,
          cashReturn:    grandTotals.cashReturn,
          cardSale:      grandTotals.cardSale,
          creditSale:    grandTotals.creditSale,
          giftVoucherAmount: grandTotals.giftVoucherAmount,
          creditVoucherAmount: grandTotals.creditVoucherAmount,
          exchangeVoucherAmount: grandTotals.exchangeVoucherAmount,
          claimVoucherAmount: grandTotals.claimVoucherAmount,
          giftVoucherCorporate: grandTotals.giftVoucherCorporate,
          creditVoucherIssuedAmount: grandTotals.creditVoucherIssuedAmount,
          rewardVoucherAmount: grandTotals.rewardVoucherAmount,
          onCreditAmount: grandTotals.onCreditAmount,
          binNo:         '',
          cardNo:        '',
          cardName:      '',
          authId:        '',
          allianceOption: `${rows.length} transaction(s)`,
          remarks:       '',
          giftVoucherCode: '',
          creditCode:   '',
          claimCode:    '',
          creditVoucherIssued: '',
        });

        for (let colNum = 1; colNum <= COLUMNS.length; colNum++) {
          const cell = totalRow.getCell(colNum);
          cell.font   = { bold: true, size: 9.5, color: { argb: 'FF0F172A' } };
          cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCBDCF5' } };
          cell.border = {
            top:    { style: 'medium', color: { argb: 'FF1E3A5F' } },
            bottom: { style: 'double', color: { argb: 'FF1E3A5F' } },
            left:   { style: 'thin',   color: { argb: 'FFCBD5E1' } },
            right:  { style: 'thin',   color: { argb: 'FFCBD5E1' } },
          };
          const c = COLUMNS[colNum - 1];
          cell.alignment = {
            horizontal: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left',
            vertical: 'middle',
          };
          if (c.numFmt) cell.numFmt = c.numFmt;
        }
        totalRow.height = 24;
        totalRow.commit();

        await workbook.commit();
      }

      await job.progress(95);

      const mimeType = format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const fileName = format === 'pdf'
        ? `alliance-register-report-${new Date().toISOString().slice(0, 10)}.pdf`
        : `alliance-register-report-${new Date().toISOString().slice(0, 10)}.xlsx`;

      await this.exportHistoryService.completeAndUploadExport(
        prisma,
        jobId,
        filePath,
        fileName,
        mimeType,
      );

      await this.notificationsService.create({
        userId,
        title: 'Alliance Register Export Ready',
        message: `Your Alliance Register ${format.toUpperCase()} report has been processed successfully.`,
        category: 'export',
        priority: 'high',
        actionType: 'alliance-register-export.ready',
        actionPayload: JSON.stringify({ jobId }),
      });

      await job.progress(100);
      this.logger.log(`[AllianceRegisterExport ${jobId}] Finished processing successfully`);
    } catch (err) {
      this.logger.error(`[AllianceRegisterExport ${jobId}] Failed: ${err.message}`, err.stack);
      await this.exportHistoryService.failExport(prisma, jobId);
      throw err;
    } finally {
      await prismaMaster.$disconnect();
    }
  }

  // ─── PDF HTML Builder ───────────────────────────────────────────────────────
  private buildPdfHtml(
    data: any[],
    locationName: string,
    fromDateStr: string,
    toDateStr: string,
    grandTotals: any,
  ): string {
    const formatVal = (val: number) =>
      val === 0
        ? '-'
        : val.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    let rowsHtml = '';
    for (const r of data) {
      rowsHtml += `
        <tr>
          <td>${r.invoiceNo}</td>
          <td class="center">${r.date}</td>
          <td class="center">${r.time}</td>
          <td class="num">${formatVal(r.retailPrice)}</td>
          <td class="num">${formatVal(r.retailWost)}</td>
          <td class="num disc">${r.discount > 0 ? formatVal(r.discount) : '-'}</td>
          <td class="num">${formatVal(r.sTax)}</td>
          <td class="num bold">${formatVal(r.netSale)}</td>
          <td class="num">${r.cashSale > 0 ? formatVal(r.cashSale) : '-'}</td>
          <td class="num disc">${r.cashReturn > 0 ? formatVal(r.cashReturn) : '-'}</td>
          <td class="num">${r.cardSale > 0 ? formatVal(r.cardSale) : '-'}</td>
          <td class="num">${r.creditSale > 0 ? formatVal(r.creditSale) : '-'}</td>
          <td class="num">${r.giftVoucherAmount > 0 ? formatVal(r.giftVoucherAmount) : '-'}</td>
          <td class="num">${r.creditVoucherAmount > 0 ? formatVal(r.creditVoucherAmount) : '-'}</td>
          <td class="num">${r.exchangeVoucherAmount > 0 ? formatVal(r.exchangeVoucherAmount) : '-'}</td>
          <td class="num">${r.claimVoucherAmount > 0 ? formatVal(r.claimVoucherAmount) : '-'}</td>
          <td class="num">${r.giftVoucherCorporate > 0 ? formatVal(r.giftVoucherCorporate) : '-'}</td>
          <td class="num disc">${r.creditVoucherIssuedAmount > 0 ? formatVal(r.creditVoucherIssuedAmount) : '-'}</td>
          <td class="num">${r.rewardVoucherAmount > 0 ? formatVal(r.rewardVoucherAmount) : '-'}</td>
          <td class="num">${r.onCreditAmount > 0 ? formatVal(r.onCreditAmount) : '-'}</td>
          <td class="center mono">${r.binNo || r.prefixCardNo || '-'}</td>
          <td class="center mono">${r.cardNo || '-'}</td>
          <td class="alliance">${r.cardName || '-'}</td>
          <td class="center mono">${r.authId || '-'}</td>
          <td class="alliance">${r.allianceOption || '-'}</td>
          <td class="remarks">${r.remarks || '-'}</td>
          <td class="mono">${r.giftVoucherCode || '-'}</td>
          <td class="mono">${r.creditCode || '-'}</td>
          <td class="mono">${r.claimCode || '-'}</td>
          <td class="mono">${r.creditVoucherIssued || '-'}</td>
        </tr>
      `;
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #0f172a;
            font-size: 5px;
            margin: 0;
            padding: 0;
            background: #ffffff;
          }
          .header-block {
            border-bottom: 2px solid #1e3a5f;
            padding-bottom: 6px;
            margin-bottom: 8px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
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
            color: #1e3a5f;
            margin-top: 2px;
          }
          .meta-info {
            font-size: 6.5px;
            color: #475569;
            margin-top: 3px;
          }
          .badge {
            display: inline-block;
            background: #1e3a5f;
            color: #fff;
            font-size: 5px;
            font-weight: 700;
            padding: 1px 4px;
            border-radius: 2px;
            letter-spacing: 0.3px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }

          thead { display: table-header-group; }
          th {
            background-color: #1e3a5f;
            color: #ffffff;
            font-weight: 700;
            text-transform: uppercase;
            font-size: 4px;
            padding: 3px 1px;
            border: 0.5px solid #2d5a8e;
            text-align: center;
          }
          td {
            padding: 2px 1px;
            border: 0.5px solid #e2e8f0;
            vertical-align: middle;
            word-wrap: break-word;
            font-size: 4px;
          }
          td.num   { text-align: right; }
          td.center { text-align: center; }
          td.mono  { font-family: monospace; font-size: 3.5px; }
          td.disc  { color: #b91c1c; }
          td.bold  { font-weight: 700; }
          td.alliance, td.remarks {
            font-size: 3.8px;
            color: #1e3a5f;
          }
          tr { page-break-inside: auto; }
          tr.header-row { page-break-inside: avoid; }
          tr:nth-child(even) { background-color: #f8faff; }
          .grand-total-row {
            background-color: #cbdcf5 !important;
            color: #0f172a;
            font-weight: bold;
            font-size: 4.5px;
            border-top: 1.5px solid #1e3a5f;
            border-bottom: 1.5px double #1e3a5f;
          }
        </style>
      </head>
      <body>
        <div class="header-block">
          <div>
            <div class="company-name">Speed (Pvt.) Limited</div>
            <div class="report-title">Alliance Register Report</div>
            <div class="meta-info">
              <strong>Location:</strong> ${locationName} &nbsp;|&nbsp;
              <strong>Period:</strong> ${fromDateStr} &ndash; ${toDateStr} &nbsp;|&nbsp;
              <strong>Total:</strong> ${data.length} transaction(s)
            </div>
          </div>
          <div>
            <span class="badge">ALLIANCE SALES ONLY</span>
          </div>
        </div>
        <table>
          <thead>
            <tr class="header-row">
              <th>Sales Tax Invoice</th>
              <th>Date</th>
              <th>Time</th>
              <th>Retail Price</th>
              <th>Retail WOST</th>
              <th>Discount</th>
              <th>S. Tax</th>
              <th>Net Sale</th>
              <th>Cash Sale</th>
              <th>Cash Return</th>
              <th>Card Sale</th>
              <th>Credit Sale</th>
              <th>Gift Voucher</th>
              <th>Credit Voucher</th>
              <th>Exchange Voucher</th>
              <th>Claim Voucher</th>
              <th>Corp Voucher</th>
              <th>Credit Issued</th>
              <th>Reward Voucher</th>
              <th>On Credit</th>
              <th>BIN No.</th>
              <th>Card No.</th>
              <th>Card Name</th>
              <th>Auth ID</th>
              <th>Alliance Option</th>
              <th>Remarks</th>
              <th>Gift Voucher No.</th>
              <th>Credit Voucher No.</th>
              <th>Claim Voucher No.</th>
              <th>Credit Issued</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            <tr class="grand-total-row">
              <td colspan="3">GRAND TOTAL (${data.length} txns)</td>
              <td class="num">${formatVal(grandTotals.retailPrice)}</td>
              <td class="num">${formatVal(grandTotals.retailWost)}</td>
              <td class="num disc">${formatVal(grandTotals.discount)}</td>
              <td class="num">${formatVal(grandTotals.sTax)}</td>
              <td class="num bold">${formatVal(grandTotals.netSale)}</td>
              <td class="num">${formatVal(grandTotals.cashSale)}</td>
              <td class="num disc">${formatVal(grandTotals.cashReturn)}</td>
              <td class="num">${formatVal(grandTotals.cardSale)}</td>
              <td class="num">${formatVal(grandTotals.creditSale)}</td>
              <td class="num">${formatVal(grandTotals.giftVoucherAmount)}</td>
              <td class="num">${formatVal(grandTotals.creditVoucherAmount)}</td>
              <td class="num">${formatVal(grandTotals.exchangeVoucherAmount)}</td>
              <td class="num">${formatVal(grandTotals.claimVoucherAmount)}</td>
              <td class="num">${formatVal(grandTotals.giftVoucherCorporate)}</td>
              <td class="num disc">${formatVal(grandTotals.creditVoucherIssuedAmount)}</td>
              <td class="num">${formatVal(grandTotals.rewardVoucherAmount)}</td>
              <td class="num">${formatVal(grandTotals.onCreditAmount)}</td>
              <td>-</td>
              <td>-</td>
              <td>-</td>
              <td>-</td>
              <td>-</td>
              <td>-</td>
              <td>-</td>
              <td>-</td>
              <td>-</td>
              <td>-</td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `;
  }
}
