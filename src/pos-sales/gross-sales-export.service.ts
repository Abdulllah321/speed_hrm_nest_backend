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

// ─── Gross Sales Return Interfaces ──────────────────────────────────────────

export interface GrossSalesReturnTotals {
  returnCount: number;
  totalItems: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  taxAmount: number;
  cashAmount: number;
  cardAmount: number;
  voucherAmount: number;
}

export interface GrossSalesReturnLineItem {
  id: string;
  returnNumber: string;
  orderNumber: string;
  sku: string;
  barCode: string;
  description: string;
  categoryName: string;
  brandName: string;
  sizeName: string;
  colorName: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxAmount: number;
  subTotal: number;
}

export interface GrossSalesReturnNode {
  id: string;
  returnNumber: string;
  orderNumber: string;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  cashierName: string;
  paymentMethod: string;
  fbrInvoiceNumber: string;
  fbrStatus: string;
  totals: GrossSalesReturnTotals;
  items: GrossSalesReturnLineItem[];
}

export interface GrossSalesReturnLocationNode {
  locationKey: string;
  locationId?: string;
  locationName: string;
  returns: GrossSalesReturnNode[];
  totals: GrossSalesReturnTotals;
}

export interface GrossSalesReturnFlatRecord {
  locationName: string;
  returnNumber: string;
  orderNumber: string;
  returnDate: string;
  cashierName: string;
  customerName: string;
  customerPhone: string;
  paymentMethod: string;
  fbrInvoiceNumber: string;
  fbrStatus: string;
  sku: string;
  barCode: string;
  description: string;
  categoryName: string;
  brandName: string;
  sizeName: string;
  colorName: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxAmount: number;
  subTotal: number;
  returnGrossAmount: number;
  returnDiscountAmount: number;
  returnNetAmount: number;
  returnTaxAmount: number;
}

export interface GrossSalesReturnReportResult {
  reportType: 'merged' | 'separate';
  locations?: GrossSalesReturnLocationNode[];
  returns: GrossSalesReturnNode[];
  flatItems: GrossSalesReturnFlatRecord[];
  grandTotals: GrossSalesReturnTotals;
  dateRange: { startDate?: string; endDate?: string };
  locationNames: string;
}

// ─── Gross Sales Summary Interfaces ────────────────────────────────────────

export interface GrossSalesSummaryTotals {
  orderCount: number;
  totalItems: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  taxAmount: number;
}

export interface GrossSalesSummaryLineItem {
  id: string;
  sku: string;
  barCode: string;
  description: string;
  categoryName: string;
  brandName: string;
  sizeName: string;
  colorName: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxAmount: number;
  subTotal: number;
}

export interface GrossSalesSummaryCategoryNode {
  categoryName: string;
  brandName: string;
  totals: GrossSalesSummaryTotals;
  items: GrossSalesSummaryLineItem[];
}

export interface GrossSalesSummaryLocationNode {
  locationKey: string;
  locationId?: string;
  locationName: string;
  categories: GrossSalesSummaryCategoryNode[];
  totals: GrossSalesSummaryTotals;
}

export interface GrossSalesSummaryFlatRecord {
  locationName: string;
  categoryName: string;
  brandName: string;
  sku: string;
  barCode: string;
  description: string;
  sizeName: string;
  colorName: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxAmount: number;
  subTotal: number;
}

export interface GrossSalesSummaryReportResult {
  reportType: 'merged' | 'separate';
  locations?: GrossSalesSummaryLocationNode[];
  categories: GrossSalesSummaryCategoryNode[];
  flatItems: GrossSalesSummaryFlatRecord[];
  grandTotals: GrossSalesSummaryTotals;
  dateRange: { startDate?: string; endDate?: string };
  locationNames: string;
}

export interface QueueGrossSalesExportOptions {
  userId: string;
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
  showBrand?: boolean;
  showDivision?: boolean;
  showCategory?: boolean;
  showGender?: boolean;
  showSilhouette?: boolean;
  showArticle?: boolean;
  showVariant?: boolean;
  showInvoices?: boolean;
  reportType: 'summary' | 'return';
}

@Injectable()
export class GrossSalesExportService {
  private readonly logger = new Logger(GrossSalesExportService.name);
  private readonly previewStorageDir = path.join(process.cwd(), 'uploads', 'report-previews');

  constructor(
    @InjectQueue('gross-sales-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly prismaMaster: PrismaMasterService,
    private readonly uploadService: UploadService,
    private readonly exportHistoryService: ExportHistoryService,
  ) {
    if (!fs.existsSync(this.previewStorageDir)) {
      fs.mkdirSync(this.previewStorageDir, { recursive: true });
    }
  }

  // ─── Gross Sales Return Preview Methods ───────────────────────────────────

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
      'generate-gross-sales-return-preview',
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

    this.logger.log(`[GrossSalesReturnReport] Queued preview job ${jobId} for user ${opts.userId}`);
    return { jobId };
  }

  // ─── Gross Sales Summary Preview Methods ──────────────────────────────────

  async queueSummaryReportPreview(opts: {
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
      'generate-gross-sales-summary-preview',
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
        jobId: `preview-summary-${jobId}`,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
        timeout: 60 * 60 * 1000,
      },
    );

    this.logger.log(`[GrossSalesSummaryReport] Queued preview job ${jobId} for user ${opts.userId}`);
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
    const job = await this.exportQueue.getJob(`preview-${jobId}`) ||
      await this.exportQueue.getJob(`preview-summary-${jobId}`) ||
      await this.exportQueue.getJob(jobId);
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
      const idx = allJobs.findIndex((j) => j.id?.toString().includes(jobId));
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

  async saveReportPreviewResult(jobId: string, result: any): Promise<void> {
    const jsonStr = JSON.stringify(result);
    const compressed = await gzipAsync(Buffer.from(jsonStr, 'utf8'));
    const filePath = path.join(this.previewStorageDir, `gross-sales-preview-${jobId}.json.gz`);
    await fs.promises.writeFile(filePath, compressed);
  }

  async getReportPreviewResult(jobId: string): Promise<any | null> {
    const filePath = path.join(this.previewStorageDir, `gross-sales-preview-${jobId}.json.gz`);
    if (!fs.existsSync(filePath)) {
      // Fallback check for old name pattern
      const oldPath = path.join(this.previewStorageDir, `gross-sales-return-preview-${jobId}.json.gz`);
      if (!fs.existsSync(oldPath)) return null;
      const comp = await fs.promises.readFile(oldPath);
      const decomp = await gunzipAsync(comp);
      return JSON.parse(decomp.toString('utf8'));
    }
    const compressed = await fs.promises.readFile(filePath);
    const decompressed = await gunzipAsync(compressed);
    return JSON.parse(decompressed.toString('utf8'));
  }

  async generateGrossSalesReturnReportDataInternal(
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
  ): Promise<GrossSalesReturnReportResult> {
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

    await onProgress?.(30, 'Querying POS sales return records from database...');

    const where: any = {
      OR: [
        { returnNumber: { not: null } },
        { refundNumber: { not: null } },
      ],
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
        { returnNumber: { contains: s, mode: 'insensitive' } },
        { refundNumber: { contains: s, mode: 'insensitive' } },
        { orderNumber: { contains: s, mode: 'insensitive' } },
        { fbrInvoiceNumber: { contains: s, mode: 'insensitive' } },
        { customer: { name: { contains: s, mode: 'insensitive' } } },
        { customer: { contactNo: { contains: s, mode: 'insensitive' } } },
      ];
    }

    let rawReturnOrders = await prisma.salesOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { name: true, contactNo: true } },
        items: {
          include: {
            item: {
              select: {
                description: true,
                sku: true,
                barCode: true,
                category: { select: { name: true } },
                brand: { select: { name: true } },
                size: { select: { name: true } },
                color: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    // Fallback: Check stockLedger for POS_RETURN / POS_REFUND entries
    if (rawReturnOrders.length === 0) {
      const ledgerReturns = await prisma.stockLedger.findMany({
        where: {
          referenceType: { in: ['POS_RETURN', 'POS_REFUND'] },
          createdAt: { gte: startDate, lte: endDate },
        },
        select: { referenceId: true },
        distinct: ['referenceId'],
      });

      const returnOrderIds = ledgerReturns.map((l) => l.referenceId).filter((id): id is string => Boolean(id));

      if (returnOrderIds.length > 0) {
        const orderWhere: any = { id: { in: returnOrderIds } };
        if (locationWhere) orderWhere.locationId = locationWhere;
        if (cashierUserId) orderWhere.cashierUserId = cashierUserId;

        rawReturnOrders = await prisma.salesOrder.findMany({
          where: orderWhere,
          orderBy: { createdAt: 'desc' },
          include: {
            customer: { select: { name: true, contactNo: true } },
            items: {
              include: {
                item: {
                  select: {
                    description: true,
                    sku: true,
                    barCode: true,
                    category: { select: { name: true } },
                    brand: { select: { name: true } },
                    size: { select: { name: true } },
                    color: { select: { name: true } },
                  },
                },
              },
            },
          },
        });
      }
    }

    await onProgress?.(70, 'Building sales return register matrix...');

    const createEmptyTotals = (): GrossSalesReturnTotals => ({
      returnCount: 0,
      totalItems: 0,
      grossAmount: 0,
      discountAmount: 0,
      netAmount: 0,
      taxAmount: 0,
      cashAmount: 0,
      cardAmount: 0,
      voucherAmount: 0,
    });

    const addTotals = (target: GrossSalesReturnTotals, source: GrossSalesReturnTotals) => {
      target.returnCount += source.returnCount;
      target.totalItems += source.totalItems;
      target.grossAmount += source.grossAmount;
      target.discountAmount += source.discountAmount;
      target.netAmount += source.netAmount;
      target.taxAmount += source.taxAmount;
      target.cashAmount += source.cashAmount;
      target.cardAmount += source.cardAmount;
      target.voucherAmount += source.voucherAmount;
    };

    const grandTotals = createEmptyTotals();
    const flatItems: GrossSalesReturnFlatRecord[] = [];
    const returnNodes: GrossSalesReturnNode[] = [];
    const locationNodesMap = new Map<string, GrossSalesReturnLocationNode>();

    for (const order of rawReturnOrders) {
      const locName = order.locationId ? locationMap.get(order.locationId) || 'Main Outlet' : 'Main Outlet';
      const cashierName = order.cashierUserId ? cashierMap.get(order.cashierUserId) || 'Cashier' : 'Cashier';
      const custName = order.customer?.name || 'Walk-in Customer';
      const custPhone = order.customer?.contactNo || '-';
      const payMethod = (order.paymentMethod || 'CASH').toUpperCase();
      const fbrInv = order.fbrInvoiceNumber || '-';
      const fbrStatus = order.fbrStatus || 'NONE';
      const rawRetNo = order.returnNumber || order.refundNumber || `SR-${order.orderNumber.replace(/^SO-/, '')}`;
      const retNo = (rawRetNo.startsWith('SR-') || rawRetNo.startsWith('RF-') || rawRetNo.startsWith('RET-'))
        ? rawRetNo
        : `SR-${rawRetNo}`;

      const gross = Number(order.subtotal || 0);
      const disc = Number(order.discountAmount || 0);
      const net = Number(order.grandTotal || 0);
      const tax = Number(order.taxAmount || 0);

      let cashAmt = Number(order.cashAmount || 0);
      let cardAmt = Number(order.cardAmount || 0);
      let voucherAmt = Number(order.voucherAmount || 0);

      if (cashAmt === 0 && cardAmt === 0 && voucherAmt === 0) {
        if (payMethod.includes('CASH')) cashAmt = net;
        else if (payMethod.includes('CARD') || payMethod.includes('BANK')) cardAmt = net;
        else voucherAmt = net;
      }

      const lineItems: GrossSalesReturnLineItem[] = (order.items || []).map((item) => ({
        id: item.id,
        returnNumber: retNo,
        orderNumber: order.orderNumber,
        sku: item.item?.sku || item.item?.barCode || 'NO-SKU',
        barCode: item.item?.barCode || item.item?.sku || '-',
        description: item.item?.description || item.item?.sku || 'Article',
        categoryName: item.item?.category?.name || 'Default',
        brandName: item.item?.brand?.name || 'Default',
        sizeName: item.item?.size?.name || 'Default',
        colorName: item.item?.color?.name || 'Default',
        quantity: Number(item.quantity || 0),
        unitPrice: Number(item.unitPrice || 0),
        discountAmount: Number(item.discountAmount || 0),
        taxAmount: Number(item.taxAmount || 0),
        subTotal: Number(item.lineTotal || 0),
      }));

      const totalItemsCount = lineItems.reduce((acc, i) => acc + i.quantity, 0);

      const orderTotals: GrossSalesReturnTotals = {
        returnCount: 1,
        totalItems: totalItemsCount,
        grossAmount: gross,
        discountAmount: disc,
        netAmount: net,
        taxAmount: tax,
        cashAmount: cashAmt,
        cardAmount: cardAmt,
        voucherAmount: voucherAmt,
      };

      addTotals(grandTotals, orderTotals);

      const retNode: GrossSalesReturnNode = {
        id: order.id,
        returnNumber: retNo,
        orderNumber: order.orderNumber,
        createdAt: order.createdAt.toISOString(),
        customerName: custName,
        customerPhone: custPhone,
        cashierName,
        paymentMethod: payMethod,
        fbrInvoiceNumber: fbrInv,
        fbrStatus,
        totals: orderTotals,
        items: lineItems,
      };

      returnNodes.push(retNode);

      for (const line of lineItems) {
        flatItems.push({
          locationName: locName,
          returnNumber: retNo,
          orderNumber: order.orderNumber,
          returnDate: order.createdAt.toISOString(),
          cashierName,
          customerName: custName,
          customerPhone: custPhone,
          paymentMethod: payMethod,
          fbrInvoiceNumber: fbrInv,
          fbrStatus,
          sku: line.sku,
          barCode: line.barCode,
          description: line.description,
          categoryName: line.categoryName,
          brandName: line.brandName,
          sizeName: line.sizeName,
          colorName: line.colorName,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountAmount: line.discountAmount,
          taxAmount: line.taxAmount,
          subTotal: line.subTotal,
          returnGrossAmount: gross,
          returnDiscountAmount: disc,
          returnNetAmount: net,
          returnTaxAmount: tax,
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
            returns: [],
            totals: createEmptyTotals(),
          };
          locationNodesMap.set(locKey, locNode);
        }
        locNode.returns.push(retNode);
        addTotals(locNode.totals, orderTotals);
      }
    }

    await onProgress?.(100, 'Sales Return Register computation complete!');

    return {
      reportType,
      locations: isSeparate ? Array.from(locationNodesMap.values()) : undefined,
      returns: returnNodes,
      flatItems,
      grandTotals,
      dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
      locationNames,
    };
  }

  // ─── Gross Sales Summary Computation Engine ───────────────────────────────

  async generateGrossSalesSummaryReportDataInternal(
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
  ): Promise<GrossSalesSummaryReportResult> {
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

    await onProgress?.(15, 'Loading outlet metadata & category structures...');

    const allLocations = await prisma.location.findMany({ select: { id: true, name: true } });
    const locationMap = new Map<string, string>();
    for (const l of allLocations) locationMap.set(l.id, l.name);

    let locationNames = '';
    if (locIds.length > 0) {
      const locs = allLocations.filter((l) => locIds.includes(l.id));
      locationNames = locs.map((l) => l.name).join(', ');
    }
    if (!locationNames) locationNames = 'All Outlets (Stores)';

    await onProgress?.(35, 'Querying POS sales order items for gross sales summary...');

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
        { customer: { name: { contains: s, mode: 'insensitive' } } },
      ];
    }

    const rawOrders = await prisma.salesOrder.findMany({
      where,
      include: {
        items: {
          include: {
            item: {
              select: {
                description: true,
                sku: true,
                barCode: true,
                category: { select: { name: true } },
                brand: { select: { name: true } },
                size: { select: { name: true } },
                color: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    await onProgress?.(70, 'Building Gross Sales Category & Outlet hierarchy matrix...');

    const createEmptyTotals = (): GrossSalesSummaryTotals => ({
      orderCount: 0,
      totalItems: 0,
      grossAmount: 0,
      discountAmount: 0,
      netAmount: 0,
      taxAmount: 0,
    });

    const addTotals = (target: GrossSalesSummaryTotals, source: GrossSalesSummaryTotals) => {
      target.orderCount += source.orderCount;
      target.totalItems += source.totalItems;
      target.grossAmount += source.grossAmount;
      target.discountAmount += source.discountAmount;
      target.netAmount += source.netAmount;
      target.taxAmount += source.taxAmount;
    };

    const grandTotals = createEmptyTotals();
    const flatItems: GrossSalesSummaryFlatRecord[] = [];

    // Grouping structure: Category -> CategoryNode
    const globalCategoryNodesMap = new Map<string, GrossSalesSummaryCategoryNode>();
    const locationNodesMap = new Map<string, GrossSalesSummaryLocationNode>();

    for (const order of rawOrders) {
      const locName = order.locationId ? locationMap.get(order.locationId) || 'Main Outlet' : 'Main Outlet';
      const locKey = order.locationId ? `loc:${order.locationId}` : 'main-outlet';

      let locNode = locationNodesMap.get(locKey);
      if (isSeparate && !locNode) {
        locNode = {
          locationKey: locKey,
          locationId: order.locationId || undefined,
          locationName: locName,
          categories: [],
          totals: createEmptyTotals(),
        };
        locationNodesMap.set(locKey, locNode);
      }

      for (const item of order.items) {
        const catName = item.item?.category?.name || 'Unassigned Category';
        const brandName = item.item?.brand?.name || 'Default Brand';
        const qty = Number(item.quantity || 0);
        const unitPrice = Number(item.unitPrice || 0);
        const gross = unitPrice * qty;
        const disc = Number(item.discountAmount || 0);
        const subTotal = Number(item.lineTotal || 0);
        const tax = Number(item.taxAmount || 0);

        const lineTotals: GrossSalesSummaryTotals = {
          orderCount: 1,
          totalItems: qty,
          grossAmount: gross,
          discountAmount: disc,
          netAmount: subTotal,
          taxAmount: tax,
        };

        addTotals(grandTotals, lineTotals);

        const lineItemNode: GrossSalesSummaryLineItem = {
          id: item.id,
          sku: item.item?.sku || item.item?.barCode || 'NO-SKU',
          barCode: item.item?.barCode || item.item?.sku || '-',
          description: item.item?.description || item.item?.sku || 'Article',
          categoryName: catName,
          brandName,
          sizeName: item.item?.size?.name || 'Default',
          colorName: item.item?.color?.name || 'Default',
          quantity: qty,
          unitPrice,
          discountAmount: disc,
          taxAmount: tax,
          subTotal,
        };

        flatItems.push({
          locationName: locName,
          categoryName: catName,
          brandName,
          sku: lineItemNode.sku,
          barCode: lineItemNode.barCode,
          description: lineItemNode.description,
          sizeName: lineItemNode.sizeName,
          colorName: lineItemNode.colorName,
          quantity: qty,
          unitPrice,
          discountAmount: disc,
          taxAmount: tax,
          subTotal,
        });

        // Add to global merged map
        let globalCat = globalCategoryNodesMap.get(catName);
        if (!globalCat) {
          globalCat = {
            categoryName: catName,
            brandName,
            totals: createEmptyTotals(),
            items: [],
          };
          globalCategoryNodesMap.set(catName, globalCat);
        }
        globalCat.items.push(lineItemNode);
        addTotals(globalCat.totals, lineTotals);

        // Add to location map if separate
        if (isSeparate && locNode) {
          let locCat = locNode.categories.find((c) => c.categoryName === catName);
          if (!locCat) {
            locCat = {
              categoryName: catName,
              brandName,
              totals: createEmptyTotals(),
              items: [],
            };
            locNode.categories.push(locCat);
          }
          locCat.items.push(lineItemNode);
          addTotals(locCat.totals, lineTotals);
          addTotals(locNode.totals, lineTotals);
        }
      }
    }

    await onProgress?.(100, 'Gross Sales Summary computation complete!');

    return {
      reportType,
      locations: isSeparate ? Array.from(locationNodesMap.values()) : undefined,
      categories: Array.from(globalCategoryNodesMap.values()),
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
        moduleName: 'GROSS_SALES_SUMMARY',
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

  async queueExport(opts: QueueGrossSalesExportOptions): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const store = PrismaService.asyncLocalStorage.getStore();
    const tenantId = store?.tenantId ?? this.prisma.getTenantId() ?? '';
    const companyId = store?.companyId ?? tenantId;
    const tenantDbUrl = store?.dbUrl ?? this.prisma.getTenantDbUrl() ?? '';
    const ext = opts.format === 'pdf' ? 'pdf' : 'xlsx';
    const prefix = opts.reportType === 'return' ? 'gross-sales-return' : 'gross-sales-summary';

    await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName: `${prefix}-${new Date().toISOString().slice(0, 10)}.${ext}`,
        filePath: path.join('uploads', 'exports', `export-${jobId}.${ext}`),
        moduleName: opts.reportType === 'return' ? 'GROSS_SALES_RETURN' : 'GROSS_SALES_SUMMARY',
        status: 'PENDING',
      },
    });

    await this.exportQueue.add(
      {
        jobId,
        userId: opts.userId,
        tenantId,
        companyId,
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
        showBrand: opts.showBrand,
        showDivision: opts.showDivision,
        showCategory: opts.showCategory,
        showGender: opts.showGender,
        showSilhouette: opts.showSilhouette,
        showArticle: opts.showArticle,
        showVariant: opts.showVariant,
        showInvoices: opts.showInvoices,
        reportType: opts.reportType,
      },
      {
        jobId,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
        timeout: 2 * 60 * 60 * 1000,
      },
    );

    this.logger.log(`[GrossSalesExport] Queued job ${jobId} for user ${opts.userId} (type: ${opts.reportType}, format: ${opts.format})`);
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
      throw new NotFoundException(`Export record ${jobId} not found`);
    }

    try {
      await this.prisma.exportHistory.update({
        where: { id: jobId },
        data: { downloadCount: { increment: 1 } },
      });
    } catch (err: any) {
      this.logger.warn(`Could not update export download count for ${jobId}: ${err.message}`);
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
      throw new NotFoundException('Export file not found.');
    }

    const stat = fs.statSync(filePath);
    const stream = fs.createReadStream(filePath);
    const isPdf = record.fileName.endsWith('.pdf');

    res.header('Content-Type', isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename="${record.fileName}"`);
    res.header('Content-Length', stat.size);
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(stream);
  }
}
