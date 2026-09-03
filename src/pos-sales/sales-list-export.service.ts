import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { UploadService } from '../upload/upload.service';
import { ExportHistoryService } from '../warehouse/export-history/export-history.service';

const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

export interface SalesListTotals {
  orderCount: number;
  totalItems: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  taxAmount: number;
  paidAmount: number;
  cashAmount: number;
  cardAmount: number;
  walletAmount: number;
  creditAmount: number;
  // Requested breakdown columns
  cashSale: number;
  cashReturn: number;
  cardSale: number;
  creditSale: number;
  giftVoucherAmount: number;
  creditVoucherAmount: number;
  exchangeVoucherAmount: number;
  claimVoucherAmount: number;
  giftVoucherCorporate: number;
  creditVoucherIssuedAmount: number;
  rewardVoucherAmount: number;
  onCreditAmount: number;
}

export interface SalesListLineItem {
  id: string;
  orderNumber: string;
  sku: string;
  barCode: string;
  description: string;
  sizeName: string;
  colorName: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  subTotal: number;
}

export interface SalesListInvoiceNode {
  id: string;
  orderNumber: string;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  cashierName: string;
  paymentMethod: string;
  merchant?: string;
  fbrInvoiceNumber: string;
  fbrStatus: string;
  totals: SalesListTotals;
  items: SalesListLineItem[];
}

export interface SalesListLocationNode {
  locationKey: string;
  locationId?: string;
  locationName: string;
  invoices: SalesListInvoiceNode[];
  totals: SalesListTotals;
}

export interface SalesListFlatRecord {
  locationName: string;
  orderNumber: string;
  orderDate: string;
  cashierName: string;
  customerName: string;
  customerPhone: string;
  paymentMethod: string;
  merchant?: string;
  fbrInvoiceNumber: string;
  fbrStatus: string;
  sku: string;
  barCode: string;
  description: string;
  sizeName: string;
  colorName: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  subTotal: number;
  orderGrossAmount: number;
  orderDiscountAmount: number;
  orderNetAmount: number;
  orderTaxAmount: number;
  cashSale: number;
  cashReturn: number;
  cardSale: number;
  creditSale: number;
  giftVoucherAmount: number;
  creditVoucherAmount: number;
  exchangeVoucherAmount: number;
  claimVoucherAmount: number;
  giftVoucherCorporate: number;
  creditVoucherIssuedAmount: number;
  rewardVoucherAmount: number;
  onCreditAmount: number;
}

export interface SalesListReportResult {
  reportType: 'merged' | 'separate';
  locations?: SalesListLocationNode[];
  invoices: SalesListInvoiceNode[];
  flatItems: SalesListFlatRecord[];
  grandTotals: SalesListTotals;
  dateRange: { startDate?: string; endDate?: string };
  locationNames: string;
}

export interface QueueSalesListExportOptions {
  userId: string;
  locationId?: string;
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

@Injectable()
export class SalesListExportService {
  private readonly logger = new Logger(SalesListExportService.name);
  private readonly previewStorageDir = path.join(process.cwd(), 'uploads', 'report-previews');

  constructor(
    @InjectQueue('sales-list-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly prismaMaster: PrismaMasterService,
    private readonly uploadService: UploadService,
    private readonly exportHistoryService: ExportHistoryService,
  ) {
    if (!fs.existsSync(this.previewStorageDir)) {
      fs.mkdirSync(this.previewStorageDir, { recursive: true });
    }
  }

  async queueReportPreview(opts: {
    userId: string;
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
  }): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

    await this.exportQueue.add(
      'generate-sales-list-preview',
      {
        jobId,
        userId: opts.userId,
        tenantId,
        tenantDbUrl,
        locationId: opts.locationId,
        startDate: opts.startDate,
        endDate: opts.endDate,
        cashierUserId: opts.cashierUserId,
        reportType: opts.reportType || 'merged',
        search: opts.search,
        paymentModeGroup: opts.paymentModeGroup,
        minAmount: opts.minAmount,
        maxAmount: opts.maxAmount,
        fbrOnly: opts.fbrOnly,
      },
      {
        jobId: `preview-${jobId}`,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
        timeout: 60 * 60 * 1000,
      },
    );

    this.logger.log(`[SalesListReport] Queued preview job ${jobId} for user ${opts.userId}`);
    return { jobId };
  }

  async getJobQueueStatus(jobId: string): Promise<{
    status: string;
    state: string;
    progress: number;
    message: string;
    queuePosition: number;
    waitingCount: number;
    failedReason?: string;
  }> {
    const job = await this.exportQueue.getJob(`preview-${jobId}`) || await this.exportQueue.getJob(jobId);
    if (!job) {
      return { status: 'unknown', state: 'unknown', progress: 0, message: '', queuePosition: 0, waitingCount: 0 };
    }

    const state = await job.getState();
    const progressRaw = job.progress();
    let progress = 0;
    let message = '';

    if (typeof progressRaw === 'number') {
      progress = progressRaw;
    } else if (typeof progressRaw === 'object' && progressRaw !== null) {
      progress = (progressRaw as any).percent || 0;
      message = (progressRaw as any).message || '';
    }

    let queuePosition = 0;
    let waitingCount = 0;

    if (state === 'waiting' || state === 'delayed') {
      const [waiting, active] = await Promise.all([
        this.exportQueue.getWaiting(),
        this.exportQueue.getActive(),
      ]);
      waitingCount = waiting.length;
      const allJobs = [...active, ...waiting];
      const idx = allJobs.findIndex((j) => j.id?.toString() === `preview-${jobId}` || j.id?.toString() === jobId);
      queuePosition = idx >= 0 ? idx + 1 : 1;
    }

    return {
      status: state,
      state,
      progress,
      message,
      queuePosition,
      waitingCount,
      failedReason: job.failedReason,
    };
  }

  async saveReportPreviewResult(jobId: string, result: SalesListReportResult): Promise<void> {
    const jsonStr = JSON.stringify(result);
    const compressed = await gzipAsync(Buffer.from(jsonStr, 'utf8'));
    const filePath = path.join(this.previewStorageDir, `sales-list-preview-${jobId}.json.gz`);
    await fs.promises.writeFile(filePath, compressed);
  }

  async getReportPreviewResult(jobId: string): Promise<SalesListReportResult | null> {
    const filePath = path.join(this.previewStorageDir, `sales-list-preview-${jobId}.json.gz`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const compressed = await fs.promises.readFile(filePath);
    const decompressed = await gunzipAsync(compressed);
    return JSON.parse(decompressed.toString('utf8'));
  }

  async generateSalesListReportDataInternal(
    prisma: PrismaService,
    opts: {
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
      onProgress?: (percent: number, message: string) => Promise<void> | void;
    },
  ): Promise<SalesListReportResult> {
    const {
      locationId,
      startDate: startStr,
      endDate: endStr,
      cashierUserId,
      reportType = 'merged',
      search,
      paymentModeGroup,
      minAmount,
      maxAmount,
      fbrOnly,
      onProgress,
    } = opts;

    const isSeparate = reportType === 'separate';
    const now = new Date();

    const parseLocalDate = (dateStr: string | undefined, isEndOfDay = false): Date => {
      if (!dateStr) {
        if (isEndOfDay) {
          const d = new Date(now);
          d.setHours(23, 59, 59, 999);
          return d;
        } else {
          return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        }
      }
      if (dateStr.includes('T') || dateStr.includes('Z')) {
        const d = new Date(dateStr);
        if (isEndOfDay && !dateStr.includes('T23:59:59')) {
          d.setHours(23, 59, 59, 999);
        }
        return d;
      }
      const timePart = isEndOfDay ? 'T23:59:59.999' : 'T00:00:00.000';
      return new Date(`${dateStr}${timePart}`);
    };

    const startDate = parseLocalDate(startStr, false);
    const endDate = parseLocalDate(endStr, true);

    const locIds = locationId ? locationId.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const locationWhere = locIds.length > 1 ? { in: locIds } : locIds.length === 1 ? locIds[0] : undefined;

    await onProgress?.(15, 'Loading outlet metadata & cashier user profiles...');

    const [allLocations, cashiersList] = await Promise.all([
      prisma.location.findMany({ select: { id: true, name: true } }),
      this.prismaMaster.user.findMany({ select: { id: true, firstName: true, lastName: true } }),
    ]);

    const locationMap = new Map<string, string>();
    for (const l of allLocations) locationMap.set(l.id, l.name);

    const cashierMap = new Map<string, string>();
    for (const u of cashiersList) cashierMap.set(u.id, `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Cashier');

    let locationNames = '';
    if (locIds.length > 0) {
      const locs = allLocations.filter((l) => locIds.includes(l.id));
      locationNames = locs.map((l) => l.name).join(', ');
    }
    if (!locationNames) locationNames = 'All Outlets (Stores)';

    await onProgress?.(30, 'Querying POS sales invoices from database...');

    const where: any = {
      status: { notIn: ['hold', 'hold_expired', 'hold_cancelled'] },
      createdAt: { gte: startDate, lte: endDate },
    };

    if (locationWhere) where.locationId = locationWhere;
    if (cashierUserId) where.cashierUserId = cashierUserId;
    if (fbrOnly) where.fbrInvoiceNumber = { not: null };

    if (paymentModeGroup) {
      where.paymentMethod = { equals: paymentModeGroup, mode: 'insensitive' };
    }

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

    const rawOrders = await prisma.salesOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
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
                description: true,
                sku: true,
                barCode: true,
                size: { select: { name: true } },
                color: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    // Query issued vouchers for these orders
    const orderIds = rawOrders.map((o) => o.id);
    const issuedVouchers = orderIds.length
      ? await prisma.voucher.findMany({
          where: {
            sourceOrderId: { in: orderIds },
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

    await onProgress?.(70, 'Building sales invoice hierarchy matrix...');

    const createEmptyTotals = (): SalesListTotals => ({
      orderCount: 0,
      totalItems: 0,
      grossAmount: 0,
      discountAmount: 0,
      netAmount: 0,
      taxAmount: 0,
      paidAmount: 0,
      cashAmount: 0,
      cardAmount: 0,
      walletAmount: 0,
      creditAmount: 0,
      cashSale: 0,
      cashReturn: 0,
      cardSale: 0,
      creditSale: 0,
      giftVoucherAmount: 0,
      creditVoucherAmount: 0,
      exchangeVoucherAmount: 0,
      claimVoucherAmount: 0,
      giftVoucherCorporate: 0,
      creditVoucherIssuedAmount: 0,
      rewardVoucherAmount: 0,
      onCreditAmount: 0,
    });

    const addTotals = (target: SalesListTotals, source: SalesListTotals) => {
      target.orderCount += source.orderCount;
      target.totalItems += source.totalItems;
      target.grossAmount += source.grossAmount;
      target.discountAmount += source.discountAmount;
      target.netAmount += source.netAmount;
      target.taxAmount += source.taxAmount;
      target.paidAmount += source.paidAmount;
      target.cashAmount += source.cashAmount;
      target.cardAmount += source.cardAmount;
      target.walletAmount += source.walletAmount;
      target.creditAmount += source.creditAmount;
      target.cashSale += source.cashSale;
      target.cashReturn += source.cashReturn;
      target.cardSale += source.cardSale;
      target.creditSale += source.creditSale;
      target.giftVoucherAmount += source.giftVoucherAmount;
      target.creditVoucherAmount += source.creditVoucherAmount;
      target.exchangeVoucherAmount += source.exchangeVoucherAmount;
      target.claimVoucherAmount += source.claimVoucherAmount;
      target.giftVoucherCorporate += source.giftVoucherCorporate;
      target.creditVoucherIssuedAmount += source.creditVoucherIssuedAmount;
      target.rewardVoucherAmount += source.rewardVoucherAmount;
      target.onCreditAmount += source.onCreditAmount;
    };

    const grandTotals = createEmptyTotals();
    const flatItems: SalesListFlatRecord[] = [];
    const invoiceNodes: SalesListInvoiceNode[] = [];
    const locationNodesMap = new Map<string, SalesListLocationNode>();

    for (const order of rawOrders) {
      const locName = order.locationId ? locationMap.get(order.locationId) || 'Main Outlet' : 'Main Outlet';
      const cashierName = order.cashierUserId ? cashierMap.get(order.cashierUserId) || 'Cashier' : 'Cashier';
      const custName = order.customer?.name || 'Walk-in Customer';
      const custPhone = order.customer?.contactNo || '-';
      const payMethod = (order.paymentMethod || 'CASH').toUpperCase();
      const fbrInv = order.fbrInvoiceNumber || '-';
      const fbrStatus = order.fbrStatus || 'NONE';

      const gross = Number(order.subtotal || 0);
      const disc = Number(order.discountAmount || 0);
      const net = Number(order.grandTotal || 0);
      const tax = Number(order.taxAmount || 0);
      const paid = net;

      const notesStr = order.notes || '';

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

      // Extract tender amounts from notes if not present in separate columns
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

      let giftVoucherAmount = 0;
      let creditVoucherAmount = 0;
      let exchangeVoucherAmount = 0;
      let claimVoucherAmount = 0;
      let giftVoucherCorporate = 0;

      for (const red of (order.voucherRedemptions || [])) {
        const type = red.voucher?.voucherType;
        const amt = Number(red.amountUsed);

        if (type === 'GIFT' || type === 'OUTLET_GIFT') {
          giftVoucherAmount += amt;
        } else if (type === 'CREDIT' || type === 'REFUND') {
          creditVoucherAmount += amt;
        } else if (type === 'CLAIM') {
          claimVoucherAmount += amt;
        } else if (type === 'CORPORATE') {
          giftVoucherCorporate += amt;
        } else if (type === 'EXCHANGE') {
          exchangeVoucherAmount += amt;
        } else if (type === 'REWARD') {
          rewardVoucherAmount += amt;
        }
      }

      // If voucherAmount was stored on order but not broken down in voucherRedemptions
      const totalRedeemedVoucher = giftVoucherAmount + creditVoucherAmount + exchangeVoucherAmount + claimVoucherAmount + giftVoucherCorporate + rewardVoucherAmount;
      const orderVoucherAmt = Number(order.voucherAmount || 0);
      if (orderVoucherAmt > totalRedeemedVoucher) {
        const remVoucher = orderVoucherAmt - totalRedeemedVoucher;
        if (notesStr.match(/ExVoucher|Exchange|EXC-/i)) {
          exchangeVoucherAmount += remVoucher;
        } else if (notesStr.match(/Claim|CLM-/i)) {
          claimVoucherAmount += remVoucher;
        } else if (notesStr.match(/Corporate/i)) {
          giftVoucherCorporate += remVoucher;
        } else if (notesStr.match(/Gift/i)) {
          giftVoucherAmount += remVoucher;
        } else if (notesStr.match(/Reward/i)) {
          rewardVoucherAmount += remVoucher;
        } else {
          creditVoucherAmount += remVoucher;
        }
      }

      let creditVoucherIssuedAmount = 0;
      const orderIssued = issuedVoucherMap.get(order.id) || [];
      for (const iv of orderIssued) {
        const type = iv.voucherType;
        const faceVal = Number(iv.faceValue || 0);

        if (type === 'CREDIT' || type === 'EXCHANGE' || type === 'REFUND') {
          creditVoucherIssuedAmount += faceVal;
        }
      }

      // Fallback if amounts were completely 0 and no split amounts were provided
      const totalTenders = cashSale + cardSale + giftVoucherAmount + creditVoucherAmount + exchangeVoucherAmount + claimVoucherAmount + giftVoucherCorporate + rewardVoucherAmount + onCreditAmount;
      if (totalTenders === 0) {
        if (payMethod.includes('CASH')) cashSale = paid;
        else if (payMethod.includes('CARD') || payMethod.includes('BANK')) cardSale = paid;
        else if (payMethod.includes('CREDIT')) {
          creditSale = paid;
          onCreditAmount = paid;
        } else if (payMethod.includes('VOUCHER')) {
          creditVoucherAmount = paid;
        } else {
          cashSale = paid;
        }
      }

      let cashAmt = cashSale;
      let cardAmt = cardSale;
      let walletAmt = giftVoucherAmount + creditVoucherAmount + exchangeVoucherAmount + claimVoucherAmount + giftVoucherCorporate + rewardVoucherAmount;
      let creditAmt = onCreditAmount;

      const lineItems: SalesListLineItem[] = (order.items || []).map((item) => ({
        id: item.id,
        orderNumber: order.orderNumber,
        sku: item.item?.sku || item.item?.barCode || 'NO-SKU',
        barCode: item.item?.barCode || item.item?.sku || '-',
        description: item.item?.description || item.item?.sku || 'Article',
        sizeName: item.item?.size?.name || 'Default',
        colorName: item.item?.color?.name || 'Default',
        quantity: Number(item.quantity || 0),
        unitPrice: Number(item.unitPrice || 0),
        discountAmount: Number(item.discountAmount || 0),
        subTotal: Number(item.lineTotal || 0),
      }));

      const totalItemsCount = lineItems.reduce((acc, i) => acc + i.quantity, 0);

      let merchantName = (order as any).merchant?.bankName || ((order as any).merchant?.description ? (order as any).merchant.description.split('|')[1]?.trim() || (order as any).merchant.description : '');
      if (!merchantName && notesStr) {
        const merchMatch = notesStr.match(/(?:Bank|Merchant|Card\s*Name|Cardholder):\s*([^|\],]+)/i);
        if (merchMatch) merchantName = merchMatch[1].trim();
      }
      if (!merchantName && order.alliance?.partnerName) {
        merchantName = order.alliance.partnerName;
      }
      merchantName = merchantName || '-';

      const orderTotals: SalesListTotals = {
        orderCount: 1,
        totalItems: totalItemsCount,
        grossAmount: gross,
        discountAmount: disc,
        netAmount: net,
        taxAmount: tax,
        paidAmount: paid,
        cashAmount: cashAmt,
        cardAmount: cardAmt,
        walletAmount: walletAmt,
        creditAmount: creditAmt,
        cashSale,
        cashReturn,
        cardSale,
        creditSale,
        giftVoucherAmount,
        creditVoucherAmount,
        exchangeVoucherAmount,
        claimVoucherAmount,
        giftVoucherCorporate,
        creditVoucherIssuedAmount,
        rewardVoucherAmount,
        onCreditAmount,
      };

      addTotals(grandTotals, orderTotals);

      const invNode: SalesListInvoiceNode = {
        id: order.id,
        orderNumber: order.orderNumber,
        createdAt: order.createdAt.toISOString(),
        customerName: custName,
        customerPhone: custPhone,
        cashierName,
        paymentMethod: payMethod,
        merchant: merchantName,
        fbrInvoiceNumber: fbrInv,
        fbrStatus,
        totals: orderTotals,
        items: lineItems,
      };

      invoiceNodes.push(invNode);

      for (const line of lineItems) {
        flatItems.push({
          locationName: locName,
          orderNumber: order.orderNumber,
          orderDate: order.createdAt.toISOString(),
          cashierName,
          customerName: custName,
          customerPhone: custPhone,
          paymentMethod: payMethod,
          merchant: merchantName,
          fbrInvoiceNumber: fbrInv,
          fbrStatus,
          sku: line.sku,
          barCode: line.barCode,
          description: line.description,
          sizeName: line.sizeName,
          colorName: line.colorName,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountAmount: line.discountAmount,
          subTotal: line.subTotal,
          orderGrossAmount: gross,
          orderDiscountAmount: disc,
          orderNetAmount: net,
          orderTaxAmount: tax,
          cashSale,
          cashReturn,
          cardSale,
          creditSale,
          giftVoucherAmount,
          creditVoucherAmount,
          exchangeVoucherAmount,
          claimVoucherAmount,
          giftVoucherCorporate,
          creditVoucherIssuedAmount,
          rewardVoucherAmount,
          onCreditAmount,
        });
      }

      if (isSeparate) {
        const locKey = order.locationId ? `loc:${order.locationId}` : 'main-outlet';
        let locNode = locationNodesMap.get(locKey);
        if (!locNode) {
          locNode = {
            locationKey: locKey,
            locationId: order.locationId || undefined,
            locationName: locName,
            invoices: [],
            totals: createEmptyTotals(),
          };
          locationNodesMap.set(locKey, locNode);
        }
        locNode.invoices.push(invNode);
        addTotals(locNode.totals, orderTotals);
      }
    }

    await onProgress?.(100, 'Sales List report computation complete!');

    return {
      reportType,
      locations: isSeparate ? Array.from(locationNodesMap.values()) : undefined,
      invoices: invoiceNodes,
      flatItems,
      grandTotals,
      dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
      locationNames,
    };
  }

  async registerClientGeneratedExport(
    prisma: PrismaService,
    userId: string,
    opts: {
      fileName: string;
      fileBase64: string;
      mimeType: string;
    },
  ): Promise<{ jobId: string; downloadUrl: string }> {
    const jobId = uuidv4();
    const fileBuffer = Buffer.from(opts.fileBase64, 'base64');
    const localDir = path.join(process.cwd(), 'uploads', 'exports');
    await fs.promises.mkdir(localDir, { recursive: true });
    const localPath = path.join(localDir, `${jobId}-${opts.fileName}`);
    await fs.promises.writeFile(localPath, fileBuffer);

    await prisma.exportHistory.create({
      data: {
        id: jobId,
        userId,
        fileName: opts.fileName,
        filePath: localPath,
        moduleName: 'SALES_LIST_REPORT',
        status: 'PENDING',
      },
    });

    const downloadUrl = await this.exportHistoryService.completeAndUploadExport(
      prisma,
      jobId,
      localPath,
      opts.fileName,
      opts.mimeType,
    );

    return { jobId, downloadUrl };
  }

  async queueExport(opts: QueueSalesListExportOptions): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const ext = opts.format === 'pdf' ? 'pdf' : 'xlsx';

    await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName: `sales-list-${new Date().toISOString().slice(0, 10)}.${ext}`,
        filePath: path.join('uploads', 'exports', `export-${jobId}.${ext}`),
        moduleName: 'SALES_LIST_REPORT',
        status: 'PENDING',
      },
    });

    await this.exportQueue.add(
      {
        jobId,
        userId: opts.userId,
        tenantId,
        tenantDbUrl,
        locationId: opts.locationId,
        startDate: opts.startDate,
        endDate: opts.endDate,
        cashierUserId: opts.cashierUserId,
        format: opts.format,
        search: opts.search,
        paymentModeGroup: opts.paymentModeGroup,
        minAmount: opts.minAmount,
        maxAmount: opts.maxAmount,
        fbrOnly: opts.fbrOnly,
      },
      {
        jobId,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
        timeout: 2 * 60 * 60 * 1000,
      },
    );

    this.logger.log(`[SalesListExport] Queued job ${jobId} for user ${opts.userId} (format: ${opts.format})`);
    return { jobId };
  }

  async getJobStatus(jobId: string): Promise<{ state: string; progress: number }> {
    const job = await this.exportQueue.getJob(jobId);
    if (!job) throw new NotFoundException(`Export job ${jobId} not found`);
    const state = await job.getState();
    const progress = typeof job.progress() === 'number' ? (job.progress() as number) : 0;
    return { state, progress };
  }

  async streamExportFile(jobId: string, res: any): Promise<void> {
    const record = await this.prisma.exportHistory.findUnique({
      where: { id: jobId },
      select: { fileName: true, filePath: true },
    });

    if (!record) {
      throw new NotFoundException(`Export record ${jobId} not found in database`);
    }

    try {
      await this.prisma.exportHistory.update({
        where: { id: jobId },
        data: {
          downloadCount: { increment: 1 },
        },
      });
    } catch (err: any) {
      this.logger.warn(`Could not update export history download count for job ${jobId}: ${err.message}`);
    }

    if (record.filePath.startsWith('s3://')) {
      const s3Key = record.filePath.replace('s3://', '');
      const signedUrl = await this.uploadService.getSignedUrlForDownload(s3Key);
      return res.redirect(signedUrl, 302);
    }

    if (record.filePath.startsWith('http://') || record.filePath.startsWith('https://')) {
      return res.redirect(record.filePath, 302);
    }

    const filePath = path.join(process.cwd(), record.filePath);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Export file not found. It may have expired or the job is still running.');
    }

    const stat = fs.statSync(filePath);

    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      this.logger.error(`[SalesListExport] Stream error: ${err.message}`);
    });

    const isPdf = record.fileName.endsWith('.pdf');
    res.header('Content-Type', isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename="${record.fileName}"`);
    res.header('Content-Length', stat.size);
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(stream);
  }
}
