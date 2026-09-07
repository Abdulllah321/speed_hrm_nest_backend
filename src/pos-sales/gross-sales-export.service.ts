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
  wostAmount: number;
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
  divisionName: string;
  genderName: string;
  silhouetteName: string;
  sizeName: string;
  colorName: string;
  quantity: number;
  unitPrice: number;
  wostAmount: number;
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
  divisionName: string;
  genderName: string;
  silhouetteName: string;
  sizeName: string;
  colorName: string;
  quantity: number;
  unitPrice: number;
  wostAmount: number;
  discountAmount: number;
  taxAmount: number;
  subTotal: number;
  returnGrossAmount: number;
  returnWostAmount: number;
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
  wostAmount: number;
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
  divisionName: string;
  genderName: string;
  silhouetteName: string;
  sizeName: string;
  colorName: string;
  quantity: number;
  unitPrice: number;
  wostAmount: number;
  discountAmount: number;
  taxAmount: number;
  subTotal: number;
}

export interface GrossSalesSummaryCategoryNode {
  categoryName: string;
  brandName: string;
  divisionName?: string;
  genderName?: string;
  silhouetteName?: string;
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
  divisionName: string;
  genderName: string;
  silhouetteName: string;
  sku: string;
  barCode: string;
  description: string;
  sizeName: string;
  colorName: string;
  quantity: number;
  unitPrice: number;
  wostAmount: number;
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

    const posReturnWhere: any = {
      createdAt: { gte: startDate, lte: endDate },
    };

    if (locationWhere) posReturnWhere.locationId = locationWhere;
    if (cashierUserId) {
      posReturnWhere.OR = [
        { cashierUserId },
        { salesOrder: { cashierUserId } },
      ];
    }
    if (fbrOnly) {
      posReturnWhere.salesOrder = {
        ...(posReturnWhere.salesOrder || {}),
        fbrInvoiceNumber: { not: null },
      };
    }
    if (paymentModeGroup && paymentModeGroup !== 'all') {
      posReturnWhere.refundMode = { equals: paymentModeGroup, mode: 'insensitive' };
    }
    if (minAmount !== undefined || maxAmount !== undefined) {
      posReturnWhere.totalRefundAmount = {};
      if (minAmount !== undefined) posReturnWhere.totalRefundAmount.gte = Number(minAmount);
      if (maxAmount !== undefined) posReturnWhere.totalRefundAmount.lte = Number(maxAmount);
    }

    const posReturns = await (prisma as any).posReturn.findMany({
      where: posReturnWhere,
      include: {
        salesOrder: {
          include: {
            customer: { select: { name: true, contactNo: true } },
          },
        },
        customer: { select: { name: true, contactNo: true } },
        originalCustomer: { select: { name: true, contactNo: true } },
        voucher: true,
        items: {
          include: {
            item: {
              include: {
                category: { select: { name: true } },
                brand: { select: { name: true } },
                division: { select: { name: true } },
                gender: { select: { name: true } },
                silhouette: { select: { name: true } },
                size: { select: { name: true } },
                color: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Also fetch any stockLedger return entries to ensure complete coverage (and catch any unlinked returns)
    const returnLedgerEntries = await (prisma as any).stockLedger.findMany({
      where: {
        referenceType: { in: ['POS_RETURN', 'POS_REFUND'] },
        createdAt: { gte: startDate, lte: endDate },
        ...(locationWhere ? { locationId: locationWhere } : {}),
      },
      include: {
        item: {
          include: {
            category: { select: { name: true } },
            brand: { select: { name: true } },
            division: { select: { name: true } },
            gender: { select: { name: true } },
            silhouette: { select: { name: true } },
            size: { select: { name: true } },
            color: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const handledPosReturnIds = new Set<string>(posReturns.map((r: any) => r.id));
    const handledSalesOrderIds = new Set<string>(posReturns.map((r: any) => r.salesOrderId).filter(Boolean));

    // Find any orphan stock ledger return entries that don't belong to already loaded posReturns
    const orphanEntries = returnLedgerEntries.filter((e: any) => 
      !handledPosReturnIds.has(e.referenceId) && !handledSalesOrderIds.has(e.referenceId)
    );

    let orphanSourceOrders: any[] = [];
    if (orphanEntries.length > 0) {
      const orphanRefIds = [...new Set(orphanEntries.map((e: any) => e.referenceId).filter(Boolean))] as string[];
      orphanSourceOrders = await (prisma as any).salesOrder.findMany({
        where: { id: { in: orphanRefIds } },
        include: {
          customer: { select: { name: true, contactNo: true } },
          items: true,
        },
      });
    }
    const orphanOrderMap = new Map<string, any>(orphanSourceOrders.map((o: any) => [o.id, o]));

    await onProgress?.(70, 'Building sales return register matrix...');

    const createEmptyTotals = (): GrossSalesReturnTotals => ({
      returnCount: 0,
      totalItems: 0,
      grossAmount: 0,
      wostAmount: 0,
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
      target.wostAmount += source.wostAmount;
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

    // 1. Process first-class PosReturn records
    for (const ret of posReturns) {
      const sampleLocId = ret.locationId || ret.salesOrder?.locationId;
      const locName = sampleLocId ? locationMap.get(sampleLocId) || 'Main Outlet' : 'Main Outlet';
      const locKey = sampleLocId ? `loc:${sampleLocId}` : 'main-outlet';
      const cashierId = ret.cashierUserId || ret.salesOrder?.cashierUserId;
      const cashierName = cashierId ? cashierMap.get(cashierId) || 'Cashier' : 'Cashier';
      const sourceOrder = ret.salesOrder;
      const custName = ret.customer?.name || ret.originalCustomer?.name || sourceOrder?.customer?.name || 'Walk-in Customer';
      const custPhone = ret.customer?.contactNo || ret.originalCustomer?.contactNo || sourceOrder?.customer?.contactNo || '-';
      const payMethod = ret.refundMode || ret.returnType || ret.voucher?.voucherType || 'VOUCHER';
      const fbrInv = sourceOrder?.fbrInvoiceNumber || '-';
      const fbrStatus = sourceOrder?.fbrInvoiceNumber ? 'FBR' : 'NONE';
      const retNo = ret.returnNumber || (ret.voucher?.code) || `SR-${ret.id.slice(0, 8)}`;
      const orderNo = sourceOrder?.orderNumber || '-';

      if (search) {
        const q = search.toLowerCase();
        const matchesRet = retNo.toLowerCase().includes(q);
        const matchesOrd = orderNo.toLowerCase().includes(q);
        const matchesCust = custName.toLowerCase().includes(q) || custPhone.includes(q);
        const matchesItems = ret.items.some((it: any) => 
          (it.item?.sku && it.item.sku.toLowerCase().includes(q)) ||
          (it.item?.barCode && it.item.barCode.toLowerCase().includes(q)) ||
          (it.item?.description && it.item.description.toLowerCase().includes(q))
        );
        if (!matchesRet && !matchesOrd && !matchesCust && !matchesItems) {
          continue;
        }
      }

      const lineItems: GrossSalesReturnLineItem[] = ret.items.map((it: any) => {
        const qty = Math.abs(Number(it.quantity || 1));
        const unitPrice = Number(it.originalUnitPrice || it.originalPaidPerUnit || 0);
        const wostAmount = Number(it.lineTotalWost) !== 0 
          ? Number(it.lineTotalWost) 
          : Math.round(Number(it.unitPriceWost || 0) * qty * 100) / 100;
        const discountAmount = Number(it.discountWost || 0);
        const taxAmount = Number(it.taxAmount || 0);
        const subTotal = Number(it.lineTotal || 0);

        return {
          id: String(it.id),
          returnNumber: retNo,
          orderNumber: orderNo,
          sku: it.item?.sku || it.item?.barCode || 'NO-SKU',
          barCode: it.item?.barCode || it.item?.sku || '-',
          description: it.item?.description || it.item?.sku || 'Article',
          categoryName: it.item?.category?.name || 'Default',
          brandName: it.item?.brand?.name || 'Default',
          divisionName: it.item?.division?.name || 'Default',
          genderName: it.item?.gender?.name || 'Default',
          silhouetteName: it.item?.silhouette?.name || 'Default',
          sizeName: it.item?.size?.name || 'Default',
          colorName: it.item?.color?.name || 'Default',
          quantity: qty,
          unitPrice,
          wostAmount,
          discountAmount,
          taxAmount,
          subTotal,
        };
      });

      const totalItemsCount = lineItems.reduce((acc, i) => acc + i.quantity, 0);
      const gross = lineItems.reduce((acc, i) => acc + (i.unitPrice * i.quantity), 0);
      const wost = Number(ret.subtotalWost) !== 0 ? Number(ret.subtotalWost) : lineItems.reduce((acc, i) => acc + i.wostAmount, 0);
      const disc = Number(ret.discountWost) !== 0 ? Number(ret.discountWost) : lineItems.reduce((acc, i) => acc + i.discountAmount, 0);
      const tax = Number(ret.taxAmount) !== 0 ? Number(ret.taxAmount) : lineItems.reduce((acc, i) => acc + i.taxAmount, 0);
      const net = Number(ret.totalRefundAmount) !== 0 ? Number(ret.totalRefundAmount) : (Number(ret.voucher?.faceValue) || lineItems.reduce((acc, i) => acc + i.subTotal, 0));

      const isCash = ret.refundMode === 'CASH';
      const isCard = ret.refundMode === 'CARD';

      const orderTotals: GrossSalesReturnTotals = {
        returnCount: 1,
        totalItems: totalItemsCount,
        grossAmount: gross,
        wostAmount: wost,
        discountAmount: disc,
        netAmount: net,
        taxAmount: tax,
        cashAmount: isCash ? net : 0,
        cardAmount: isCard ? net : 0,
        voucherAmount: (!isCash && !isCard) ? net : 0,
      };

      addTotals(grandTotals, orderTotals);

      const retNode: GrossSalesReturnNode = {
        id: ret.id,
        returnNumber: retNo,
        orderNumber: orderNo,
        createdAt: ret.createdAt ? new Date(ret.createdAt).toISOString() : new Date().toISOString(),
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
          orderNumber: orderNo,
          returnDate: retNode.createdAt,
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
          divisionName: line.divisionName,
          genderName: line.genderName,
          silhouetteName: line.silhouetteName,
          sizeName: line.sizeName,
          colorName: line.colorName,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          wostAmount: line.wostAmount,
          discountAmount: line.discountAmount,
          taxAmount: line.taxAmount,
          subTotal: line.subTotal,
          returnGrossAmount: gross,
          returnWostAmount: wost,
          returnDiscountAmount: disc,
          returnNetAmount: net,
          returnTaxAmount: tax,
        });
      }

      if (isSeparate) {
        let locNode = locationNodesMap.get(locKey);
        if (!locNode) {
          locNode = {
            locationKey: locKey,
            locationId: sampleLocId || undefined,
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

    // 2. Process any orphan stock ledger return entries (if any)
    if (orphanEntries.length > 0) {
      const entriesByVoucherMap = new Map<string, typeof orphanEntries>();
      for (const entry of orphanEntries) {
        const vKey = entry.referenceId || `entry-${entry.id}`;
        if (!entriesByVoucherMap.has(vKey)) {
          entriesByVoucherMap.set(vKey, []);
        }
        entriesByVoucherMap.get(vKey)!.push(entry);
      }

      for (const [vKey, entries] of entriesByVoucherMap.entries()) {
        const sampleEntry = entries[0];
        const sourceOrder = orphanOrderMap.get(vKey);
        const locName = sampleEntry.locationId ? locationMap.get(sampleEntry.locationId) || 'Main Outlet' : 'Main Outlet';
        const locKey = sampleEntry.locationId ? `loc:${sampleEntry.locationId}` : 'main-outlet';
        const cashierName = sourceOrder?.cashierUserId ? cashierMap.get(sourceOrder.cashierUserId) || 'Cashier' : 'Cashier';
        const custName = sourceOrder?.customer?.name || 'Walk-in Customer';
        const custPhone = sourceOrder?.customer?.contactNo || '-';
        const payMethod = 'RETURN';
        const fbrInv = sourceOrder?.fbrInvoiceNumber || '-';
        const fbrStatus = sourceOrder?.fbrInvoiceNumber ? 'FBR' : 'NONE';
        const retNo = sourceOrder?.returnNumber || `SR-${vKey.slice(0, 8)}`;
        const orderNo = sourceOrder?.orderNumber || '-';

        const lineItems: GrossSalesReturnLineItem[] = entries.map((entry) => {
          const originalOi = sourceOrder?.items?.find((oi: any) => oi.itemId === entry.itemId);
          const qty = Math.abs(Number(entry.qty || 1));
          const unitPrice = originalOi ? Number(originalOi.unitPrice || 0) : Number(entry.item.unitPrice || 0);
          const taxPercent = originalOi ? Number((originalOi as any).taxPercent || 0) : 18;
          const calculatedTaxPct = taxPercent > 0 ? taxPercent : 18;
          const taxDivisor = 1 + calculatedTaxPct / 100;

          const wostPerUnit = unitPrice / taxDivisor;
          const wostAmount = Math.round(wostPerUnit * qty * 100) / 100;
          const originalQty = originalOi ? Number(originalOi.quantity || 1) : 1;
          const discPerUnit = originalOi ? Number(originalOi.discountAmount || 0) / originalQty : 0;
          const discountAmount = Math.round(discPerUnit * qty * 100) / 100;

          const valueExSalesTax = Math.round((wostAmount - discountAmount) * 100) / 100;
          const taxPerUnit = originalOi ? Number(originalOi.taxAmount || 0) / originalQty : 0;
          const taxAmount = originalOi
            ? Math.round(taxPerUnit * qty * 100) / 100
            : Math.round((valueExSalesTax * (calculatedTaxPct / 100)) * 100) / 100;

          const subTotal = Math.round((valueExSalesTax + taxAmount) * 100) / 100;

          return {
            id: String(entry.id),
            returnNumber: retNo,
            orderNumber: orderNo,
            sku: entry.item.sku || entry.item.barCode || 'NO-SKU',
            barCode: entry.item.barCode || entry.item.sku || '-',
            description: entry.item.description || entry.item.sku || 'Article',
            categoryName: entry.item.category?.name || 'Default',
            brandName: entry.item.brand?.name || 'Default',
            divisionName: entry.item.division?.name || 'Default',
            genderName: entry.item.gender?.name || 'Default',
            silhouetteName: entry.item.silhouette?.name || 'Default',
            sizeName: entry.item.size?.name || 'Default',
            colorName: entry.item.color?.name || 'Default',
            quantity: qty,
            unitPrice,
            wostAmount,
            discountAmount,
            taxAmount,
            subTotal,
          };
        });

        const totalItemsCount = lineItems.reduce((acc, i) => acc + i.quantity, 0);
        const gross = lineItems.reduce((acc, i) => acc + (i.unitPrice * i.quantity), 0);
        const wost = lineItems.reduce((acc, i) => acc + i.wostAmount, 0);
        const disc = lineItems.reduce((acc, i) => acc + i.discountAmount, 0);
        const tax = lineItems.reduce((acc, i) => acc + i.taxAmount, 0);
        const net = lineItems.reduce((acc, i) => acc + i.subTotal, 0);

        const orderTotals: GrossSalesReturnTotals = {
          returnCount: 1,
          totalItems: totalItemsCount,
          grossAmount: gross,
          wostAmount: wost,
          discountAmount: disc,
          netAmount: net,
          taxAmount: tax,
          cashAmount: 0,
          cardAmount: 0,
          voucherAmount: net,
        };

        addTotals(grandTotals, orderTotals);

        const retNode: GrossSalesReturnNode = {
          id: vKey,
          returnNumber: retNo,
          orderNumber: orderNo,
          createdAt: sampleEntry.createdAt.toISOString(),
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
            orderNumber: orderNo,
            returnDate: retNode.createdAt,
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
            divisionName: line.divisionName,
            genderName: line.genderName,
            silhouetteName: line.silhouetteName,
            sizeName: line.sizeName,
            colorName: line.colorName,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            wostAmount: line.wostAmount,
            discountAmount: line.discountAmount,
            taxAmount: line.taxAmount,
            subTotal: line.subTotal,
            returnGrossAmount: gross,
            returnWostAmount: wost,
            returnDiscountAmount: disc,
            returnNetAmount: net,
            returnTaxAmount: tax,
          });
        }

        if (isSeparate) {
          let locNode = locationNodesMap.get(locKey);
          if (!locNode) {
            locNode = {
              locationKey: locKey,
              locationId: sampleEntry.locationId || undefined,
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
      status: { in: ['completed', 'partially_returned', 'exchanged', 'posted', 'returned', 'refunded'] },
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
                division: { select: { name: true } },
                gender: { select: { name: true } },
                silhouette: { select: { name: true } },
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
      wostAmount: 0,
      discountAmount: 0,
      netAmount: 0,
      taxAmount: 0,
    });

    const addTotals = (target: GrossSalesSummaryTotals, source: GrossSalesSummaryTotals) => {
      target.orderCount += source.orderCount;
      target.totalItems += source.totalItems;
      target.grossAmount += source.grossAmount;
      target.wostAmount += source.wostAmount;
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
        const qty = Number(item.quantity || 0);
        if (qty <= 0) continue;

        const catName = item.item?.category?.name || 'Unassigned Category';
        const brandName = item.item?.brand?.name || 'Default Brand';
        const divisionName = item.item?.division?.name || 'Default Division';
        const genderName = item.item?.gender?.name || 'Default Gender';
        const silhouetteName = item.item?.silhouette?.name || 'Default Silhouette';
        const unitPrice = Number(item.unitPrice || 0);
        const disc = Number(item.discountAmount || 0);
        const tax = Number(item.taxAmount || 0);
        const taxPercent = Number((item as any).taxPercent || (item as any).taxRate || 0);

        const calculatedTaxPct = taxPercent > 0
          ? taxPercent
          : (tax > 0 && (Number(item.lineTotal || 0) - tax) > 0
              ? Math.round((tax / (Number(item.lineTotal || 0) - tax)) * 100 * 100) / 100
              : (tax > 0 ? 18 : 0));
        const taxDivisor = 1 + calculatedTaxPct / 100;

        const wostPerUnit = unitPrice / taxDivisor;
        const wostAmount = Math.round(wostPerUnit * qty * 100) / 100;
        const valueExSalesTax = Math.round((wostAmount - disc) * 100) / 100;
        const taxAmount = tax > 0 ? tax : Math.round((valueExSalesTax * (calculatedTaxPct / 100)) * 100) / 100;
        const valueInclSalesTax = Math.round((valueExSalesTax + taxAmount) * 100) / 100;

        const gross = unitPrice * qty;
        const subTotal = valueInclSalesTax;

        const lineTotals: GrossSalesSummaryTotals = {
          orderCount: 1,
          totalItems: qty,
          grossAmount: gross,
          wostAmount,
          discountAmount: disc,
          netAmount: subTotal,
          taxAmount: taxAmount,
        };

        addTotals(grandTotals, lineTotals);

        const lineItemNode: GrossSalesSummaryLineItem = {
          id: item.id,
          sku: item.item?.sku || item.item?.barCode || 'NO-SKU',
          barCode: item.item?.barCode || item.item?.sku || '-',
          description: item.item?.description || item.item?.sku || 'Article',
          categoryName: catName,
          brandName,
          divisionName,
          genderName,
          silhouetteName,
          sizeName: item.item?.size?.name || 'Default',
          colorName: item.item?.color?.name || 'Default',
          quantity: qty,
          unitPrice,
          wostAmount,
          discountAmount: disc,
          taxAmount: tax,
          subTotal,
        };

        flatItems.push({
          locationName: locName,
          categoryName: catName,
          brandName,
          divisionName,
          genderName,
          silhouetteName,
          sku: lineItemNode.sku,
          barCode: lineItemNode.barCode,
          description: lineItemNode.description,
          sizeName: lineItemNode.sizeName,
          colorName: lineItemNode.colorName,
          quantity: qty,
          unitPrice,
          wostAmount,
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
