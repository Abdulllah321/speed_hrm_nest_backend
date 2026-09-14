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

import { SalesListExportService } from './sales-list-export.service';

interface SalesListExportJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  locationId?: string;
  locationIds?: string[];
  startDate?: string;
  endDate?: string;
  cashierUserId?: string;
  format: 'xlsx' | 'pdf';
  search?: string;
  paymentModeGroup?: string;
  minAmount?: number;
  maxAmount?: number;
  fbrOnly?: boolean;
  exportType?: 'flat' | 'hierarchical';
}

export interface SalesListPreviewJobData {
  jobId: string;
  userId: string;
  tenantId: string;
  tenantDbUrl: string;
  locationId?: string;
  startDate?: string;
  endDate?: string;
  cashierUserId?: string;
  reportType?: 'merged' | 'separate';
  search?: string;
  paymentModeGroup?: string;
  minAmount?: number;
  maxAmount?: number;
  fbrOnly?: boolean;
  fiscalYear?: string;
  year?: number | string;
}

const FLAT_COLUMNS = [
  { header: 'Outlet / Location', key: 'locationName', width: 22, align: 'left' },
  { header: 'Invoice #', key: 'orderNumber', width: 16, align: 'left' },
  { header: 'Order Date', key: 'orderDate', width: 18, align: 'center' },
  { header: 'Cashier', key: 'cashierName', width: 16, align: 'left' },
  { header: 'Customer', key: 'customerName', width: 18, align: 'left' },
  { header: 'Phone', key: 'customerPhone', width: 14, align: 'left' },
  { header: 'Payment Mode', key: 'paymentMethod', width: 14, align: 'center' },
  { header: 'Merchant', key: 'merchant', width: 16, align: 'left' },
  { header: 'FBR Inv #', key: 'fbrInvoiceNumber', width: 16, align: 'left' },
  { header: 'FBR Status', key: 'fbrStatus', width: 12, align: 'center' },
  { header: 'SKU', key: 'sku', width: 16, align: 'left' },
  { header: 'Barcode', key: 'barCode', width: 16, align: 'left' },
  { header: 'Description', key: 'description', width: 26, align: 'left' },
  { header: 'Size', key: 'sizeName', width: 10, align: 'center' },
  { header: 'Color', key: 'colorName', width: 12, align: 'center' },
  { header: 'Quantity', key: 'quantity', width: 10, align: 'right', numFmt: '#,##0' },
  { header: 'Unit Price', key: 'unitPrice', width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'Discount', key: 'discountAmount', width: 12, align: 'right', numFmt: '#,##0.00' },
  { header: 'SubTotal', key: 'subTotal', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Order Gross', key: 'orderGrossAmount', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Order Net', key: 'orderNetAmount', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Cash Sale', key: 'cashSale', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Cash Return', key: 'cashReturn', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Card Sale', key: 'cardSale', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Credit Sale', key: 'creditSale', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Gift Voucher', key: 'giftVoucherAmount', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Credit Voucher', key: 'creditVoucherAmount', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Exchange Voucher', key: 'exchangeVoucherAmount', width: 16, align: 'right', numFmt: '#,##0.00' },
  { header: 'Claim Voucher', key: 'claimVoucherAmount', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Corporate Voucher', key: 'giftVoucherCorporate', width: 16, align: 'right', numFmt: '#,##0.00' },
  { header: 'Credit Issued', key: 'creditVoucherIssuedAmount', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'Reward Voucher', key: 'rewardVoucherAmount', width: 14, align: 'right', numFmt: '#,##0.00' },
  { header: 'On Credit', key: 'onCreditAmount', width: 14, align: 'right', numFmt: '#,##0.00' },
];

const COLUMNS = [
  { header: 'Date & Time', key: 'date', width: 22, align: 'center' },
  { header: 'Invoice #', key: 'invoiceNo', width: 14, align: 'left' },
  { header: 'Location', key: 'location', width: 18, align: 'left' },
  { header: 'Cashier', key: 'cashier', width: 14, align: 'left' },
  { header: 'Customer', key: 'customer', width: 16, align: 'left' },
  { header: 'Merchant', key: 'merchant', width: 16, align: 'left' },
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
    private readonly salesListExportService: SalesListExportService,
  ) {
    if (process.platform === 'linux') {
      try {
        const { exec } = require('child_process');
        exec(
          'apt-get update && apt-get install -y libatk1.0-0 libatk-bridge2.0-0 libcups2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpangocairo-1.0-0 libasound2 libnss3 libxshmfence1 libgtk-3-0',
          () => { }
        );
      } catch (e: any) {
        this.logger.warn(`Error installing Chromium dependencies: ${e.message}`);
      }
    }
  }

  @Process('generate-sales-list-preview')
  async handleGeneratePreview(job: Job<SalesListPreviewJobData>): Promise<void> {
    const {
      jobId,
      tenantId,
      tenantDbUrl,
      locationId,
      startDate,
      endDate,
      cashierUserId,
      reportType = 'merged',
      search,
      paymentModeGroup,
      minAmount,
      maxAmount,
      fbrOnly,
      fiscalYear,
      year,
    } = job.data;

    const prisma = (tenantId && tenantDbUrl)
      ? PrismaService.getTenantClient(tenantId, tenantDbUrl)
      : new PrismaService({ tenantId, tenantDbUrl } as any);

    try {
      this.logger.log(`[SalesListPreview ${jobId}] Starting background sales-list preview computation`);
      await job.progress({ percent: 10, message: 'Queueing sales list preview computation task...' });

      const onProgress = async (percent: number, message: string) => {
        if (this.salesListExportService.isJobCancelled(jobId)) {
          throw new Error('JOB_CANCELLED');
        }
        await job.progress({ percent: Math.min(95, Math.max(10, percent)), message });
      };

      const result = await this.salesListExportService.generateSalesListReportDataInternal(
        prisma as any,
        {
          locationId,
          startDate,
          endDate,
          cashierUserId,
          reportType,
          search,
          paymentModeGroup,
          minAmount,
          maxAmount,
          fbrOnly,
          fiscalYear,
          year,
          previewJobId: jobId,
          isAborted: () => this.salesListExportService.isJobCancelled(jobId),
          onProgress,
        },
      );

      await this.salesListExportService.saveReportPreviewResult(jobId, result);
      await job.progress({ percent: 100, message: 'Sales list preview calculation completed.' });
      this.logger.log(`[SalesListPreview] Successfully completed and stored preview job ${jobId}`);
    } catch (err: any) {
      if (err.message === 'JOB_CANCELLED') {
        this.logger.log(`[SalesListPreview ${jobId}] Job was superseded or cancelled.`);
        return;
      }
      this.logger.error(`[SalesListPreview ${jobId}] Exception in background computation: ${err.message}`, err.stack);
      throw err;
    }
  }

  @Process('generate-sales-list-export')
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
      exportType = 'hierarchical',
    } = job.data;

    const prisma = (tenantId && tenantDbUrl)
      ? PrismaService.getTenantClient(tenantId, tenantDbUrl)
      : new PrismaService({ tenantId, tenantDbUrl } as any);
    const prismaMaster = new PrismaMasterService();
    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    const ext = format === 'pdf' ? 'pdf' : 'xlsx';
    const filePath = path.join(exportDir, `export-${jobId}.${ext}`);

    try {
      await job.progress({ percent: 5, message: 'Initializing export worker & loading metadata...' });

      const [allLocations, cashiersList] = await Promise.all([
        prisma.location.findMany({ select: { id: true, name: true } }),
        prismaMaster.user.findMany({ select: { id: true, firstName: true, lastName: true } }),
      ]);

      const locationMap = new Map<string, string>();
      for (const l of allLocations) locationMap.set(l.id, l.name);

      const cashierMap = new Map<string, string>();
      for (const u of cashiersList) cashierMap.set(u.id, `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Cashier');

      const locationName = (job.data.locationIds && job.data.locationIds.length > 0)
        ? job.data.locationIds.map((id) => locationMap.get(id) || id).join(', ')
        : locationId
        ? locationMap.get(locationId) || 'Store'
        : 'All Outlets (Stores)';

      const now = new Date();
      const startDate = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate = endStr ? new Date(endStr) : new Date(now);
      endDate.setHours(23, 59, 59, 999);

      const where: any = {
        status: { notIn: ['hold', 'hold_expired', 'hold_cancelled', 'voided', 'cancelled', 'VOIDED', 'CANCELLED', 'draft', 'DRAFT'] },
        createdAt: { gte: startDate, lte: endDate },
      };

      if (job.data.locationIds && job.data.locationIds.length > 0) {
        where.locationId = { in: job.data.locationIds };
      } else if (locationId) {
        where.locationId = locationId;
      }
      if (cashierUserId) where.cashierUserId = cashierUserId;
      if (fbrOnly) where.fbrInvoiceNumber = { not: null };
      if (paymentModeGroup) where.paymentMethod = { equals: paymentModeGroup, mode: 'insensitive' };
      if (minAmount !== undefined || maxAmount !== undefined) {
        where.grandTotal = {};
        if (minAmount !== undefined) where.grandTotal.gte = Number(minAmount);
        if (maxAmount !== undefined) where.grandTotal.lte = Number(maxAmount);
      }
      if (search && search.trim()) {
        const s = search.trim();
        where.OR = [
          { orderNumber: { contains: s, mode: 'insensitive' } },
          { fbrInvoiceNumber: { contains: s, mode: 'insensitive' } },
          { customer: { name: { contains: s, mode: 'insensitive' } } },
          { customer: { contactNo: { contains: s, mode: 'insensitive' } } },
        ];
      }

      await job.progress({ percent: 10, message: 'Counting matching records in database...' });
      const totalOrdersCount = await prisma.salesOrder.count({ where });

      const isFlat = exportType === 'flat';

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

      const grandTotals = {
        orderCount: 0,
        totalItems: 0,
        grossAmount: 0,
        discountAmount: 0,
        netAmount: 0,
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

      if (format === 'xlsx') {
        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
          filename: filePath,
          useStyles: true,
          useSharedStrings: false,
        });

        const activeCols = isFlat ? FLAT_COLUMNS : COLUMNS;
        const ws = workbook.addWorksheet(isFlat ? 'Sales Line Items' : 'Sales Invoices', {
          pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
        });

        ws.columns = activeCols.map((c) => ({ key: c.key, width: c.width }));

        // Header Row
        const headerRow = ws.getRow(1);
        activeCols.forEach((col, idx) => {
          const cell = headerRow.getCell(idx + 1);
          cell.value = col.header;
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
          cell.alignment = {
            horizontal: col.align === 'right' ? 'right' : col.align === 'center' ? 'center' : 'left',
            vertical: 'middle',
          };
        });
        headerRow.height = 24;
        headerRow.commit();

        const borderThin = {
          top: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
        };

        const CHUNK = 1000;
        let processedOrders = 0;

        for (let skip = 0; skip < totalOrdersCount; skip += CHUNK) {
          const chunkOrders = await prisma.salesOrder.findMany({
            where,
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            skip,
            take: CHUNK,
            include: {
              customer: { select: { name: true, contactNo: true } },
              alliance: true,
              merchant: true,
              voucherRedemptions: {
                include: {
                  voucher: true,
                },
              },
              items: {
                include: {
                  item: {
                    select: {
                      sku: true,
                      barCode: true,
                      description: true,
                      size: { select: { name: true } },
                      color: { select: { name: true } },
                    },
                  },
                },
              },
            },
          });

          if (chunkOrders.length === 0) break;

          for (const order of chunkOrders) {
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
            let cashReturn = 0;

            const cashRetMatch = notesStr.match(/\[Cash Return\] Amount:\s*([\d.]+)/i);
            if (cashRetMatch) cashReturn = Number(cashRetMatch[1]);

            if (cash === 0) {
              const cashMatch = notesStr.match(/\[Cash Sale\] Amount:\s*([\d.]+)/i) || notesStr.match(/(?:cash|cashsale):\s*([\d.]+)/i);
              if (cashMatch) cash = Number(cashMatch[1]);
            }
            if (card === 0) {
              const cardMatch = notesStr.match(/\[Card Sale\] Amount:\s*([\d.]+)/i) || notesStr.match(/(?:card|cardsale):\s*([\d.]+)/i);
              if (cardMatch) card = Number(cardMatch[1]);
            }

            let giftVoucher = 0;
            let creditVoucher = 0;
            let exchangeVoucher = 0;
            let claimVoucher = 0;
            let corporateVoucher = 0;
            let rewardVoucher = 0;

            const exMatch = notesStr.match(/\[Exchange Voucher\] Amount:\s*([\d.]+)/i);
            if (exMatch) exchangeVoucher = Number(exMatch[1]);

            const clmMatch = notesStr.match(/\[Claim Voucher\] Amount:\s*([\d.]+)/i);
            if (clmMatch) claimVoucher = Number(clmMatch[1]);

            const corpMatch = notesStr.match(/\[Corporate Voucher\] Amount:\s*([\d.]+)/i);
            if (corpMatch) corporateVoucher = Number(corpMatch[1]);

            const giftMatch = notesStr.match(/\[Gift Voucher\] Amount:\s*([\d.]+)/i);
            if (giftMatch) giftVoucher = Number(giftMatch[1]);

            const rewMatch = notesStr.match(/\[Reward Voucher\] Amount:\s*([\d.]+)/i) || notesStr.match(/\[Reward Voucher\].*?Amount:\s*([\d.]+)/i);
            if (rewMatch) {
              rewardVoucher = Number(rewMatch[1]);
            } else if (order.paymentMethod === 'reward_voucher' || order.tenderType === 'reward_voucher') {
              rewardVoucher = Number(order.grandTotal);
            }

            const credVouchMatch = notesStr.match(/\[Credit Voucher\] Amount:\s*([\d.]+)/i);
            if (credVouchMatch) creditVoucher = Number(credVouchMatch[1]);

            for (const red of (order.voucherRedemptions || [])) {
              const type = red.voucher?.voucherType;
              const amt = Number(red.amountUsed);

              if (type === 'GIFT' || type === 'OUTLET_GIFT') {
                if (!giftMatch) giftVoucher += amt;
              } else if (type === 'CREDIT' || type === 'REFUND') {
                if (!credVouchMatch) creditVoucher += amt;
              } else if (type === 'CLAIM') {
                if (!clmMatch) claimVoucher += amt;
              } else if (type === 'CORPORATE') {
                if (!corpMatch) corporateVoucher += amt;
              } else if (type === 'EXCHANGE') {
                if (!exMatch) exchangeVoucher += amt;
              } else if (type === 'REWARD') {
                if (!rewMatch) rewardVoucher += amt;
              }
            }

            const totalRedeemedVoucher = giftVoucher + creditVoucher + exchangeVoucher + claimVoucher + corporateVoucher + rewardVoucher;
            const orderVoucherAmt = Number(order.voucherAmount || 0);
            if (orderVoucherAmt > totalRedeemedVoucher) {
              const remVoucher = orderVoucherAmt - totalRedeemedVoucher;
              if (notesStr.match(/ExVoucher|Exchange|EXC-/i)) {
                exchangeVoucher += remVoucher;
              } else if (notesStr.match(/Claim|CLM-/i)) {
                claimVoucher += remVoucher;
              } else if (notesStr.match(/Corporate/i)) {
                corporateVoucher += remVoucher;
              } else if (notesStr.match(/Gift/i)) {
                giftVoucher += remVoucher;
              } else if (notesStr.match(/Reward/i)) {
                rewardVoucher += remVoucher;
              } else {
                creditVoucher += remVoucher;
              }
            }

            const totalTenders = cash + card + giftVoucher + creditVoucher + exchangeVoucher + claimVoucher + corporateVoucher + rewardVoucher + onCredit;
            if (totalTenders === 0) {
              const payMethod = (order.paymentMethod || 'cash').toLowerCase();
              if (payMethod.includes('cash')) cash = Number(order.grandTotal);
              else if (payMethod.includes('card') || payMethod.includes('bank')) card = Number(order.grandTotal);
              else if (payMethod.includes('credit')) {
                onCredit = Number(order.grandTotal);
              } else if (payMethod.includes('voucher')) {
                creditVoucher = Number(order.grandTotal);
              } else {
                cash = Number(order.grandTotal);
              }
            }

            let issuedGift = 0;
            let issuedCredit = 0;

            const issuedMatch = notesStr.match(/\[Credit Voucher Issued\] Amount:\s*([\d.]+)/i);
            if (issuedMatch) {
              issuedCredit = Number(issuedMatch[1]);
            }


            const tenderDocs = parseTenderDocs(notesStr, order.alliance);

            let merchantName = (order as any).merchant?.bankName || ((order as any).merchant?.description ? (order as any).merchant.description.split('|')[1]?.trim() || (order as any).merchant.description : '');
            if (!merchantName && notesStr) {
              const merchMatch = notesStr.match(/(?:Bank|Merchant|Card\s*Name|Cardholder):\s*([^|\],]+)/i);
              if (merchMatch) merchantName = merchMatch[1].trim();
            }
            if (!merchantName && order.alliance?.partnerName) {
              merchantName = order.alliance.partnerName;
            }
            merchantName = merchantName || '-';

            const locName = order.locationId ? locationMap.get(order.locationId) || 'Main Outlet' : 'Main Outlet';
            const cashierName = order.cashierUserId ? cashierMap.get(order.cashierUserId) || 'Cashier' : 'Cashier';
            const customerName = order.customer?.name || 'Walk-in Customer';
            const customerPhone = order.customer?.contactNo || '-';
            const orderGrandTotal = Number(order.grandTotal || 0);
            const orderSubtotal = Number(order.subtotal || 0);
            const orderDisc = Number(order.discountAmount || 0);

            grandTotals.orderCount += 1;
            grandTotals.grossAmount += orderSubtotal;
            grandTotals.discountAmount += orderDisc;
            grandTotals.netAmount += orderGrandTotal;
            grandTotals.balance += balance;
            grandTotals.tenderCash += cash;
            grandTotals.tenderCard += card;
            grandTotals.tenderRewardVoucher += rewardVoucher;
            grandTotals.tenderOnCredit += onCredit;
            grandTotals.tenderGiftVoucher += giftVoucher;
            grandTotals.tenderCreditVoucher += creditVoucher;
            grandTotals.tenderExchangeVoucher += exchangeVoucher;
            grandTotals.tenderClaimVoucher += claimVoucher;
            grandTotals.tenderCorporateVoucher += corporateVoucher;
            grandTotals.issuedGiftVoucher += issuedGift;
            grandTotals.issuedCreditVoucher += issuedCredit;
            grandTotals.fbr += fbr;
            grandTotals.netSale += netSale;

            if (isFlat) {
              for (const item of (order.items || [])) {
                const itemQty = Number(item.quantity || 0);
                const itemPrice = Number(item.unitPrice || 0);
                const itemDisc = Number(item.discountAmount || 0);
                const itemSub = Number(item.lineTotal || 0);
                const ratio = orderGrandTotal > 0 ? (itemSub / orderGrandTotal) : 0;

                grandTotals.totalItems += itemQty;

                const flatRowData: any = {
                  locationName: locName,
                  orderNumber: order.orderNumber,
                  orderDate: new Date(order.createdAt).toLocaleString(),
                  cashierName,
                  customerName,
                  customerPhone,
                  paymentMethod: (order.paymentMethod || 'CASH').toUpperCase(),
                  merchant: merchantName,
                  fbrInvoiceNumber: order.fbrInvoiceNumber || '-',
                  fbrStatus: order.fbrStatus || 'NONE',
                  sku: item.item?.sku || item.item?.barCode || 'NO-SKU',
                  barCode: item.item?.barCode || item.item?.sku || '-',
                  description: item.item?.description || item.item?.sku || 'Article',
                  sizeName: item.item?.size?.name || 'Default',
                  colorName: item.item?.color?.name || 'Default',
                  quantity: itemQty,
                  unitPrice: itemPrice,
                  discountAmount: itemDisc,
                  subTotal: itemSub,
                  orderGrossAmount: orderSubtotal,
                  orderNetAmount: orderGrandTotal,
                  cashSale: cash * ratio,
                  cashReturn: cashReturn * ratio,
                  cardSale: card * ratio,
                  creditSale: (balance > 0 ? balance : onCredit) * ratio,
                  giftVoucherAmount: giftVoucher * ratio,
                  creditVoucherAmount: creditVoucher * ratio,
                  exchangeVoucherAmount: exchangeVoucher * ratio,
                  claimVoucherAmount: claimVoucher * ratio,
                  giftVoucherCorporate: corporateVoucher * ratio,
                  creditVoucherIssuedAmount: issuedCredit * ratio,
                  rewardVoucherAmount: rewardVoucher * ratio,
                  onCreditAmount: onCredit * ratio,
                };

                const row = ws.addRow(flatRowData);
                row.height = 18;
                row.commit();
              }
            } else {
              const orderItemsCount = (order.items || []).reduce((acc: number, i: any) => acc + Number(i.quantity || 0), 0);
              grandTotals.totalItems += orderItemsCount;

              const matrixRowData: any = {
                date: new Date(order.createdAt).toLocaleString(),
                invoiceNo: order.orderNumber,
                location: locName,
                cashier: cashierName,
                customer: customerName,
                merchant: merchantName,
                netTotal: orderGrandTotal,
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
                returnAmount: cashReturn,
                fbr,
                netSale,
                tenderDocuments: tenderDocs,
              };

              const row = ws.addRow(matrixRowData);
              row.height = 18;
              row.commit();
            }
          }

          processedOrders += chunkOrders.length;
          const pct = Math.min(92, Math.round(15 + (processedOrders / Math.max(1, totalOrdersCount)) * 75));
          await job.progress({
            percent: pct,
            message: `Exported ${processedOrders.toLocaleString()} of ${totalOrdersCount.toLocaleString()} orders (${pct}%)...`,
          });
        }

        // Add Grand Totals Footer Row
        const totalRowData = isFlat
          ? {
              locationName: 'GRAND TOTAL',
              quantity: grandTotals.totalItems,
              discountAmount: grandTotals.discountAmount,
              subTotal: grandTotals.netAmount,
              orderGrossAmount: grandTotals.grossAmount,
              orderNetAmount: grandTotals.netAmount,
              cashSale: grandTotals.tenderCash,
              cashReturn: grandTotals.returnAmount,
              cardSale: grandTotals.tenderCard,
              creditSale: grandTotals.balance,
              giftVoucherAmount: grandTotals.tenderGiftVoucher,
              creditVoucherAmount: grandTotals.tenderCreditVoucher,
              exchangeVoucherAmount: grandTotals.tenderExchangeVoucher,
              claimVoucherAmount: grandTotals.tenderClaimVoucher,
              giftVoucherCorporate: grandTotals.tenderCorporateVoucher,
              creditVoucherIssuedAmount: grandTotals.issuedCreditVoucher,
              rewardVoucherAmount: grandTotals.tenderRewardVoucher,
              onCreditAmount: grandTotals.tenderOnCredit,
            }
          : {
              date: 'GRAND TOTAL',
              invoiceNo: `${grandTotals.orderCount.toLocaleString()} Orders`,
              location: '',
              cashier: '',
              customer: `${grandTotals.totalItems.toLocaleString()} Items`,
              merchant: '',
              netTotal: grandTotals.netAmount,
              balance: grandTotals.balance,
              tenderCash: grandTotals.tenderCash,
              tenderCard: grandTotals.tenderCard,
              tenderRewardVoucher: grandTotals.tenderRewardVoucher,
              tenderOnCredit: grandTotals.tenderOnCredit,
              tenderGiftVoucher: grandTotals.tenderGiftVoucher,
              tenderCreditVoucher: grandTotals.tenderCreditVoucher,
              exchangeVoucher: grandTotals.tenderExchangeVoucher,
              claimVoucher: grandTotals.tenderClaimVoucher,
              tenderCorporateVoucher: grandTotals.tenderCorporateVoucher,
              issuedGiftVoucher: grandTotals.issuedGiftVoucher,
              issuedCreditVoucher: grandTotals.issuedCreditVoucher,
              returnAmount: grandTotals.returnAmount,
              fbr: grandTotals.fbr,
              netSale: grandTotals.netSale,
              tenderDocuments: '',
            };

        const totalRow = ws.addRow(totalRowData);
        totalRow.height = 24;
        totalRow.commit();

        await workbook.commit();
      } else {
        // PDF format capped at 2,000 for DOM safety
        const pdfLimit = 2000;
        const pdfOrders = await prisma.salesOrder.findMany({
          where,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: pdfLimit,
          include: {
            customer: { select: { name: true, contactNo: true } },
            alliance: true,
            merchant: true,
            items: true,
          },
        });

        const fromDateStr = startDate.toLocaleDateString();
        const toDateStr = endDate.toLocaleDateString();
        const html = this.buildPdfHtml(pdfOrders, locationName, fromDateStr, toDateStr, grandTotals);

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
