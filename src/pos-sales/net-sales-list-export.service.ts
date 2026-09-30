import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as readline from 'readline';
import * as ExcelJS from 'exceljs';
import { promisify } from 'util';
import { pipeline, PassThrough } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { UploadService } from '../upload/upload.service';
import { ExportHistoryService } from '../warehouse/export-history/export-history.service';
import { ReportPreviewCleanupService } from '../common/services/report-preview-cleanup.service';

const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

export type NetSalesDocType = 'SALE' | 'RETURN';
export type NetSalesFilterDocType = 'ALL' | 'SALES_ONLY' | 'RETURNS_ONLY';

export interface NetSalesListTotals {
  totalDocuments: number;
  salesOrderCount: number;
  returnCount: number;

  totalItemsSold: number;
  totalItemsReturned: number;
  netItems: number;

  grossSalesAmount: number;
  grossReturnAmount: number;
  netGrossAmount: number;

  wostSalesAmount: number;
  wostReturnAmount: number;
  netWostAmount: number;

  discountSalesAmount: number;
  discountReturnAmount: number;
  netDiscountAmount: number;

  discountWostSalesAmount: number;
  discountWostReturnAmount: number;
  netDiscountWostAmount: number;

  amountAfterDiscount: number;

  taxSalesAmount: number;
  taxReturnAmount: number;
  netTaxAmount: number;

  netSalesAmount: number;
  netReturnAmount: number;
  totalNetAmount: number;

  cashSale: number;
  cashRefund: number;
  netCash: number;

  cardSale: number;
  cardRefund: number;
  netCard: number;

  creditSale: number;

  giftVoucherAmount: number;
  giftVoucherCorporate: number;

  exchangeVoucherRedeemed: number;
  exchangeVoucherIssued: number;
  netExchangeVoucher: number;

  creditVoucherRedeemed: number;
  creditVoucherIssued: number;
  netCreditVoucher: number;

  claimVoucherRedeemed: number;
  claimVoucherIssued: number;
  netClaimVoucher: number;

  rewardVoucherAmount: number;
}

export interface NetSalesListLineItem {
  id: string;
  docType: NetSalesDocType;
  docNumber: string;
  refDocNumber?: string;
  sku: string;
  barCode: string;
  description: string;
  sizeName: string;
  colorName: string;
  quantity: number;
  unitPrice: number;
  priceWost: number;
  valueExcl: number;
  discountPercent: number;
  discountAmount: number;
  discountAmountWost: number;
  amountAfterDiscount: number;
  taxPercent: number;
  taxAmount: number;
  lineTotal: number;
  returnReason?: string;
}

export interface NetSalesListDocumentNode {
  id: string;
  docType: NetSalesDocType;
  docNumber: string;
  refDocNumber?: string;
  subTypeLabel: string;
  createdAt: string;
  locationId?: string;
  locationName: string;
  cashierName: string;
  customerName: string;
  customerPhone?: string;
  customerCnic?: string;
  customerCode?: string;
  paymentMethod: string;
  merchant?: string;
  fbrInvoiceNumber?: string;
  fbrStatus?: string;
  notes?: string;
  totals: {
    totalItems: number;
    grossAmount: number;
    wostAmount: number;
    discountAmount: number;
    discountWostAmount: number;
    amountAfterDiscount: number;
    taxAmount: number;
    netAmount: number;

    cashAmount: number;
    cardAmount: number;
    creditSaleAmount: number;
    giftVoucherAmount: number;
    exchangeVoucherAmount: number;
    creditVoucherAmount: number;
    claimVoucherAmount: number;
    rewardVoucherAmount: number;
    corporateVoucherAmount: number;
  };
  items: NetSalesListLineItem[];
  tenderDetails?: any;
  discountDetails?: any;
  voucherDetails?: {
    code: string;
    faceValue: number;
    voucherType?: string;
  };
}

export interface NetSalesListLocationNode {
  locationKey: string;
  locationId?: string;
  locationName: string;
  documents: NetSalesListDocumentNode[];
  totals: NetSalesListTotals;
}

export interface NetSalesListFlatRecord {
  id: string;
  docType: NetSalesDocType;
  docNumber: string;
  refDocNumber?: string;
  subTypeLabel: string;
  docDate: string;
  locationName: string;
  locationId?: string;
  cashierName: string;
  customerName: string;
  customerPhone?: string;
  customerCnic?: string;
  customerCode?: string;
  paymentMethod: string;
  merchant?: string;
  fbrInvoiceNumber?: string;
  fbrStatus?: string;
  notes?: string;
  sku: string;
  barCode: string;
  description: string;
  sizeName: string;
  colorName: string;
  quantity: number;
  unitPrice: number;
  priceWost: number;
  valueExcl: number;
  discountPercent: number;
  discountAmount: number;
  discountAmountWost: number;
  amountAfterDiscount: number;
  taxPercent: number;
  taxAmount: number;
  lineTotal: number;
  cashSale: number;
  cashRefund: number;
  cardSale: number;
  cardRefund: number;
  creditSale: number;
  giftVoucher: number;
  exchangeVoucher: number;
  creditVoucher: number;
  claimVoucher: number;
  rewardVoucher: number;
  returnReason?: string;
}

export interface NetSalesListReportResult {
  reportType: 'merged' | 'separate';
  dateRange: { start?: string; end?: string };
  locationNames: string;
  locations: NetSalesListLocationNode[];
  grandTotals: NetSalesListTotals;
  documents: NetSalesListDocumentNode[];
  flatItems: NetSalesListFlatRecord[];
}

export interface NetSalesListPreviewJobData {
  jobId: string;
  tenantId: string;
  tenantDbUrl: string;
  userId: string;
  locationId?: string;
  locationIds?: string[];
  startDate?: string;
  endDate?: string;
  cashierUserId?: string;
  docTypeFilter?: NetSalesFilterDocType;
  reportType?: 'merged' | 'separate';
  search?: string;
  paymentModeGroup?: string;
  minAmount?: number;
  maxAmount?: number;
  fbrOnly?: boolean;
  fiscalYear?: string;
  year?: number | string;
}

export interface NetSalesListExportJobData extends NetSalesListPreviewJobData {
  format: 'xlsx' | 'pdf';
  exportType?: 'flat' | 'hierarchical';
}

export interface QueueNetSalesListExportOptions {
  userId: string;
  format: 'xlsx' | 'pdf';
  locationId?: string;
  locationIds?: string[];
  startDate?: string;
  endDate?: string;
  cashierUserId?: string;
  docTypeFilter?: NetSalesFilterDocType;
  reportType?: 'merged' | 'separate';
  search?: string;
  paymentModeGroup?: string;
  minAmount?: number;
  maxAmount?: number;
  fbrOnly?: boolean;
  exportType?: 'flat' | 'hierarchical';
  fiscalYear?: string;
  year?: number | string;
}

@Injectable()
export class NetSalesListExportService {
  private readonly logger = new Logger(NetSalesListExportService.name);
  private readonly previewStorageDir = path.join(
    process.cwd(),
    'uploads',
    'report-previews',
  );

  constructor(
    @InjectQueue('net-sales-list-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly prismaMaster: PrismaMasterService,
    private readonly uploadService: UploadService,
    private readonly exportHistoryService: ExportHistoryService,
    private readonly previewCleanupService: ReportPreviewCleanupService,
  ) {
    if (!fs.existsSync(this.previewStorageDir)) {
      fs.mkdirSync(this.previewStorageDir, { recursive: true });
    }
  }

  private readonly cancelledPreviewJobIds = new Set<string>();

  isJobCancelled(jobId?: string): boolean {
    if (!jobId) return false;
    return this.cancelledPreviewJobIds.has(jobId);
  }

  async queueReportPreview(opts: {
    userId: string;
    locationId?: string;
    locationIds?: string[];
    startDate?: string;
    endDate?: string;
    cashierUserId?: string;
    docTypeFilter?: NetSalesFilterDocType;
    reportType?: 'merged' | 'separate';
    search?: string;
    paymentModeGroup?: string;
    minAmount?: number;
    maxAmount?: number;
    fbrOnly?: boolean;
    fiscalYear?: string;
    year?: number | string;
  }): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

    if (opts.userId) {
      try {
        const [waiting, active] = await Promise.all([
          this.exportQueue.getWaiting(),
          this.exportQueue.getActive(),
        ]);
        for (const wJob of waiting) {
          if (
            wJob.data?.userId === opts.userId &&
            wJob.name === 'generate-net-sales-list-preview'
          ) {
            await wJob.remove();
          }
        }
        for (const aJob of active) {
          if (
            aJob.data?.userId === opts.userId &&
            aJob.name === 'generate-net-sales-list-preview'
          ) {
            if (aJob.data?.jobId) {
              this.cancelledPreviewJobIds.add(aJob.data.jobId);
            }
          }
        }
      } catch (err: any) {
        this.logger.warn(
          `Failed to prune superseded preview jobs for user ${opts.userId}: ${err.message}`,
        );
      }
    }

    await this.exportQueue.add(
      'generate-net-sales-list-preview',
      {
        jobId,
        tenantId,
        tenantDbUrl,
        ...opts,
      },
      {
        jobId,
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 1,
      },
    );

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
    const job = await this.exportQueue.getJob(jobId);
    if (!job) {
      const jsonPath = path.join(
        this.previewStorageDir,
        `net-sales-list-preview-${jobId}.json.gz`,
      );
      const ndjsonPath = path.join(
        this.previewStorageDir,
        `net-sales-list-preview-${jobId}.ndjson.gz`,
      );
      if (fs.existsSync(jsonPath) || fs.existsSync(ndjsonPath)) {
        return {
          status: 'completed',
          state: 'completed',
          progress: 100,
          message: 'Preview generation complete',
          queuePosition: 0,
          waitingCount: 0,
        };
      }
      return {
        status: 'not_found',
        state: 'not_found',
        progress: 0,
        message: 'Job not found',
        queuePosition: 0,
        waitingCount: 0,
      };
    }

    const state = await job.getState();
    const progressData = job.progress();
    let progress = 0;
    let message = 'Processing preview...';

    if (typeof progressData === 'number') {
      progress = progressData;
    } else if (progressData && typeof progressData === 'object') {
      progress = (progressData as any).percent ?? 0;
      message = (progressData as any).message ?? message;
    }

    let queuePosition = 0;
    let waitingCount = 0;
    if (state === 'waiting') {
      const waitingJobs = await this.exportQueue.getWaiting();
      waitingCount = waitingJobs.length;
      const idx = waitingJobs.findIndex((j) => j.id === job.id);
      queuePosition = idx !== -1 ? idx + 1 : 1;
      message = `Waiting in queue (position ${queuePosition} of ${waitingCount})...`;
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

  getPreviewFilePath(jobId: string): string {
    const jsonPath = path.join(
      this.previewStorageDir,
      `net-sales-list-preview-${jobId}.json.gz`,
    );
    if (fs.existsSync(jsonPath)) return jsonPath;
    const ndjsonPath = path.join(
      this.previewStorageDir,
      `net-sales-list-preview-${jobId}.ndjson.gz`,
    );
    if (fs.existsSync(ndjsonPath)) return ndjsonPath;
    return jsonPath;
  }

  getPreviewNdjsonFilePath(jobId: string): string {
    return path.join(
      this.previewStorageDir,
      `net-sales-list-preview-${jobId}.ndjson.gz`,
    );
  }

  async saveReportPreviewResult(
    jobId: string,
    result: NetSalesListReportResult,
  ): Promise<void> {
    const jsonPath = path.join(
      this.previewStorageDir,
      `net-sales-list-preview-${jobId}.json.gz`,
    );
    const jsonStr = JSON.stringify(result);
    const compressed = await gzipAsync(Buffer.from(jsonStr, 'utf8'));
    await fs.promises.writeFile(jsonPath, compressed);
  }

  async getReportPreviewResult(
    jobId: string,
  ): Promise<NetSalesListReportResult | null> {
    const jsonPath = path.join(
      this.previewStorageDir,
      `net-sales-list-preview-${jobId}.json.gz`,
    );
    if (fs.existsSync(jsonPath)) {
      const compressed = await fs.promises.readFile(jsonPath);
      const decompressed = await gunzipAsync(compressed);
      const parsed = JSON.parse(decompressed.toString('utf8'));
      return parsed.data || parsed;
    }

    const ndjsonPath = path.join(
      this.previewStorageDir,
      `net-sales-list-preview-${jobId}.ndjson.gz`,
    );
    if (!fs.existsSync(ndjsonPath)) {
      return null;
    }

    return new Promise<NetSalesListReportResult | null>((resolve) => {
      const gz = fs.createReadStream(ndjsonPath);
      const gunzip = zlib.createGunzip();
      const rl = readline.createInterface({ input: gz.pipe(gunzip) });

      let meta: any = {};
      const allDocuments: any[] = [];
      let grandTotals: any = {};
      const PREVIEW_LIMIT = 5000;

      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          if (line.includes('"type":"meta"')) {
            meta = JSON.parse(line);
          } else if (line.includes('"type":"totals"')) {
            grandTotals = JSON.parse(line).grandTotals || {};
          } else if (line.includes('"type":"documents"')) {
            if (allDocuments.length < PREVIEW_LIMIT) {
              const obj = JSON.parse(line);
              if (Array.isArray(obj.documents)) {
                const remaining = PREVIEW_LIMIT - allDocuments.length;
                allDocuments.push(...obj.documents.slice(0, remaining));
              }
            }
          }
        } catch {
          // ignore
        }
      });

      rl.on('close', () => {
        resolve({
          reportType: meta.reportType || 'merged',
          dateRange: meta.dateRange || {},
          locationNames: meta.locationNames || '',
          locations: meta.locations || [],
          grandTotals,
          documents: allDocuments,
          flatItems: [],
        });
      });

      gz.on('error', () => resolve(null));
      gunzip.on('error', () => resolve(null));
    });
  }

  createEmptyTotals(): NetSalesListTotals {
    return {
      totalDocuments: 0,
      salesOrderCount: 0,
      returnCount: 0,
      totalItemsSold: 0,
      totalItemsReturned: 0,
      netItems: 0,
      grossSalesAmount: 0,
      grossReturnAmount: 0,
      netGrossAmount: 0,
      wostSalesAmount: 0,
      wostReturnAmount: 0,
      netWostAmount: 0,
      discountSalesAmount: 0,
      discountReturnAmount: 0,
      netDiscountAmount: 0,
      discountWostSalesAmount: 0,
      discountWostReturnAmount: 0,
      netDiscountWostAmount: 0,
      amountAfterDiscount: 0,
      taxSalesAmount: 0,
      taxReturnAmount: 0,
      netTaxAmount: 0,
      netSalesAmount: 0,
      netReturnAmount: 0,
      totalNetAmount: 0,
      cashSale: 0,
      cashRefund: 0,
      netCash: 0,
      cardSale: 0,
      cardRefund: 0,
      netCard: 0,
      creditSale: 0,
      giftVoucherAmount: 0,
      giftVoucherCorporate: 0,
      exchangeVoucherRedeemed: 0,
      exchangeVoucherIssued: 0,
      netExchangeVoucher: 0,
      creditVoucherRedeemed: 0,
      creditVoucherIssued: 0,
      netCreditVoucher: 0,
      claimVoucherRedeemed: 0,
      claimVoucherIssued: 0,
      netClaimVoucher: 0,
      rewardVoucherAmount: 0,
    };
  }

  async generateNetSalesListReportDataInternal(
    prisma: PrismaService,
    opts: {
      locationId?: string;
      locationIds?: string[];
      startDate?: string;
      endDate?: string;
      cashierUserId?: string;
      docTypeFilter?: NetSalesFilterDocType;
      reportType?: 'merged' | 'separate';
      search?: string;
      paymentModeGroup?: string;
      minAmount?: number;
      maxAmount?: number;
      fbrOnly?: boolean;
      fiscalYear?: string;
      year?: number | string;
      previewJobId?: string;
      isAborted?: () => boolean;
      onProgress?: (percent: number, message: string) => Promise<void> | void;
    },
  ): Promise<NetSalesListReportResult> {
    const {
      locationId,
      locationIds,
      startDate: startStr,
      endDate: endStr,
      cashierUserId,
      docTypeFilter = 'ALL',
      reportType = 'merged',
      search,
      paymentModeGroup,
      minAmount,
      maxAmount,
      fbrOnly,
      fiscalYear,
      year,
      onProgress,
    } = opts;

    const now = new Date();
    const parseLocalDate = (
      dateStr: string | undefined,
      isEndOfDay = false,
    ): Date => {
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

    let startDate: Date;
    let endDate: Date;

    if (
      fiscalYear === '2026-2027' ||
      fiscalYear === '26-27' ||
      fiscalYear === 'fy-26-27' ||
      fiscalYear === 'current'
    ) {
      startDate = new Date(Date.UTC(2026, 6, 1, 0, 0, 0, 0));
      endDate = new Date(Date.UTC(2027, 5, 30, 23, 59, 59, 999));
    } else if (
      fiscalYear === '2025-2026' ||
      fiscalYear === '25-26' ||
      fiscalYear === 'fy-25-26' ||
      fiscalYear === 'previous'
    ) {
      startDate = new Date(Date.UTC(2025, 6, 1, 0, 0, 0, 0));
      endDate = new Date(Date.UTC(2026, 5, 30, 23, 59, 59, 999));
    } else if (fiscalYear === 'all-time') {
      startDate = new Date(Date.UTC(2020, 0, 1, 0, 0, 0, 0));
      endDate = new Date(Date.UTC(2035, 11, 31, 23, 59, 59, 999));
    } else if (year) {
      const yr = typeof year === 'string' ? parseInt(year, 10) : year;
      const targetYear = !isNaN(yr) && yr > 2000 ? yr : now.getFullYear();
      startDate = new Date(Date.UTC(targetYear, 0, 1, 0, 0, 0, 0));
      endDate = new Date(Date.UTC(targetYear, 11, 31, 23, 59, 59, 999));
    } else if (startStr || endStr) {
      startDate = parseLocalDate(startStr, false);
      endDate = parseLocalDate(endStr, true);
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
    }

    if (endDate > now) {
      endDate = now;
    }

    const locIds =
      locationIds && locationIds.length > 0
        ? locationIds
        : locationId
          ? locationId
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
    const locationWhere =
      locIds.length > 1
        ? { in: locIds }
        : locIds.length === 1
          ? locIds[0]
          : undefined;

    await onProgress?.(10, 'Loading store metadata and users...');

    const [allLocations, cashiersList, allSizes, allColors, allMerchants] =
      await Promise.all([
        prisma.location.findMany({
          select: { id: true, name: true, code: true },
        }),
        this.prismaMaster.user.findMany({
          select: { id: true, firstName: true, lastName: true },
        }),
        prisma.size.findMany({ select: { id: true, name: true } }),
        prisma.color.findMany({ select: { id: true, name: true } }),
        prisma.merchantConfig.findMany({
          select: { id: true, bankName: true, description: true },
        }),
      ]);

    const locationMap = new Map<string, string>();
    for (const l of allLocations) locationMap.set(l.id, l.name);

    const cashierMap = new Map<string, string>();
    for (const u of cashiersList)
      cashierMap.set(
        u.id,
        `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Cashier',
      );

    const sizeMap = new Map<string, string>();
    for (const s of allSizes) sizeMap.set(s.id, s.name);

    const colorMap = new Map<string, string>();
    for (const c of allColors) colorMap.set(c.id, c.name);

    const merchantMap = new Map<string, string>();
    for (const m of allMerchants) {
      const label =
        m.bankName ||
        (m.description
          ? m.description.split('|')[1]?.trim() || m.description
          : '');
      merchantMap.set(m.id, label);
    }

    let locationNames = 'All Outlets (Stores)';
    if (locIds.length > 0) {
      const locs = allLocations.filter((l) => locIds.includes(l.id));
      locationNames = locs.map((l) => l.name).join(', ');
    }

    const fetchSales = docTypeFilter !== 'RETURNS_ONLY';
    const fetchReturns = docTypeFilter !== 'SALES_ONLY';

    const documents: NetSalesListDocumentNode[] = [];
    const flatItems: NetSalesListFlatRecord[] = [];
    const grandTotals = this.createEmptyTotals();

    // ──────────────────────────────────────────────────────────────────────────
    // 1. QUERY & PROCESS SALES ORDERS
    // ──────────────────────────────────────────────────────────────────────────
    if (fetchSales) {
      await onProgress?.(20, 'Querying sales orders from database...');

      const salesWhere: any = {
        orderNumber: { not: { startsWith: 'RET-' } },
        status: {
          notIn: [
            'hold',
            'hold_expired',
            'hold_cancelled',
            'voided',
            'cancelled',
            'VOIDED',
            'CANCELLED',
            'draft',
            'DRAFT',
          ],
        },
        createdAt: { gte: startDate, lte: endDate },
      };

      if (locationWhere) salesWhere.locationId = locationWhere;
      if (cashierUserId) salesWhere.cashierUserId = cashierUserId;
      if (fbrOnly) salesWhere.fbrInvoiceNumber = { not: null };
      if (paymentModeGroup) {
        salesWhere.paymentMethod = {
          equals: paymentModeGroup,
          mode: 'insensitive',
        };
      }
      if (minAmount !== undefined || maxAmount !== undefined) {
        salesWhere.grandTotal = {};
        if (minAmount !== undefined)
          salesWhere.grandTotal.gte = Number(minAmount);
        if (maxAmount !== undefined)
          salesWhere.grandTotal.lte = Number(maxAmount);
      }
      if (search && search.trim()) {
        const s = search.trim();
        salesWhere.OR = [
          { orderNumber: { contains: s, mode: 'insensitive' } },
          { fbrInvoiceNumber: { contains: s, mode: 'insensitive' } },
          { customer: { name: { contains: s, mode: 'insensitive' } } },
          { customer: { contactNo: { contains: s, mode: 'insensitive' } } },
        ];
      }

      const totalSalesOrders = await prisma.salesOrder.count({
        where: salesWhere,
      });
      const CHUNK_SIZE = 1500;
      let processedSales = 0;

      while (processedSales < totalSalesOrders) {
        if (opts.isAborted?.()) throw new Error('JOB_ABORTED');

        const orders = await prisma.salesOrder.findMany({
          where: salesWhere,
          skip: processedSales,
          take: CHUNK_SIZE,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            orderNumber: true,
            createdAt: true,
            locationId: true,
            cashierUserId: true,
            paymentMethod: true,
            tenderType: true,
            subtotal: true,
            discountAmount: true,
            manualDiscountNote: true,
            globalDiscountPercent: true,
            globalDiscountAmount: true,
            taxAmount: true,
            grandTotal: true,
            cashAmount: true,
            cardAmount: true,
            voucherAmount: true,
            notes: true,
            merchantId: true,
            merchant: { select: { bankName: true, description: true } },
            alliance: {
              select: {
                partnerName: true,
                code: true,
                discountPercent: true,
                description: true,
              },
            },
            promo: {
              select: { name: true, code: true, type: true, value: true },
            },
            coupon: {
              select: {
                code: true,
                description: true,
                discountType: true,
                discountValue: true,
              },
            },
            fbrInvoiceNumber: true,
            fbrStatus: true,
            customer: {
              select: {
                id: true,
                name: true,
                contactNo: true,
                traderId: true,
                subCode: true,
                cnicNo: true,
                address: true,
                email: true,
              },
            },
            voucherRedemptions: {
              select: {
                amountUsed: true,
                voucher: {
                  select: {
                    code: true,
                    voucherType: true,
                    faceValue: true,
                    cardholderName: true,
                    cardLast4: true,
                    slipNo: true,
                    description: true,
                  },
                },
              },
            },
            items: {
              select: {
                id: true,
                quantity: true,
                unitPrice: true,
                discountPercent: true,
                discountAmount: true,
                overrideDiscountPercent: true,
                overrideDiscountNote: true,
                taxPercent: true,
                taxAmount: true,
                lineTotal: true,
                item: {
                  select: {
                    sku: true,
                    barCode: true,
                    description: true,
                    sizeId: true,
                    colorId: true,
                  },
                },
              },
            },
          },
        });

        for (const o of orders) {
          const notesStr = o.notes || '';
          const locName =
            (o.locationId && locationMap.get(o.locationId)) || 'Main Store';
          let cashierName =
            (o.cashierUserId && cashierMap.get(o.cashierUserId)) || 'Cashier';
          if (cashierName === 'Cashier' && notesStr) {
            const spMatch = notesStr.match(
              /(?:SalesPerson|Cashier):\s*([^|\]]+)/i,
            );
            if (spMatch) cashierName = spMatch[1].trim();
          }
          let custName = o.customer?.name || 'Walk-in Customer';
          if (custName === 'Walk-in Customer' && notesStr) {
            const custMatch = notesStr.match(
              /(?:Customer|CustomerName):\s*([^|\]]+)/i,
            );
            if (custMatch) custName = custMatch[1].trim();
          }

          // Line items computation — matches sales-list-export.service.ts transformSingleOrder
          const docItems: NetSalesListLineItem[] = [];
          let docQty = 0;
          let orderRetailGross = 0;
          let orderComputedWost = 0;
          let orderRetailDisc = 0;
          let orderComputedDiscWost = 0;
          let docTax = 0;
          let docNet = 0;

          const orderWost = Number(o.subtotal || 0);
          const orderDiscWost = Number(o.discountAmount || 0);

          for (const it of o.items) {
            const qty = Number(it.quantity) || 1;
            const unitPrice = Number(it.unitPrice) || 0;
            const lineRetailGross = unitPrice * qty;
            orderRetailGross += lineRetailGross;

            const priceWost = unitPrice / 1.18;
            const valueExcl = priceWost * qty;

            const rawDiscAmt = Number(it.discountAmount || 0);
            const discPct = Number(
              it.discountPercent ||
                (lineRetailGross > 0 && rawDiscAmt > 0
                  ? (rawDiscAmt / valueExcl) * 100
                  : 0),
            );

            let discAmtWost = 0;
            let discAmtRetail = 0;

            if (discPct > 0) {
              discAmtRetail =
                Math.round(lineRetailGross * (discPct / 100) * 100) / 100;
              discAmtWost = Math.round(valueExcl * (discPct / 100) * 100) / 100;
            } else if (rawDiscAmt > 0) {
              discAmtWost = rawDiscAmt;
              discAmtRetail = Math.round(rawDiscAmt * 1.18 * 100) / 100;
            }

            orderRetailDisc += discAmtRetail;
            orderComputedWost += valueExcl;
            orderComputedDiscWost += discAmtWost;

            const amountAfterDiscount = Math.max(0, valueExcl - discAmtWost);
            const taxPercent = Number(it.taxPercent || 18);
            const taxAmount = Number(
              it.taxAmount ||
                Math.round(amountAfterDiscount * (taxPercent / 100) * 100) /
                  100,
            );
            const lineTotal = Number(
              it.lineTotal || lineRetailGross - discAmtRetail,
            );

            docQty += qty;
            docTax += taxAmount;
            docNet += lineTotal;

            const sizeName = it.item?.sizeId
              ? sizeMap.get(it.item.sizeId) || ''
              : '';
            const colorName = it.item?.colorId
              ? colorMap.get(it.item.colorId) || ''
              : '';

            docItems.push({
              id: it.id,
              docType: 'SALE',
              docNumber: o.orderNumber,
              sku: it.item?.sku || it.item?.barCode || 'NO-SKU',
              barCode: it.item?.barCode || it.item?.sku || '-',
              description: it.item?.description || it.item?.sku || 'Article',
              sizeName,
              colorName,
              quantity: qty,
              unitPrice,
              priceWost,
              valueExcl,
              discountPercent: discPct,
              discountAmount: discAmtRetail,
              discountAmountWost: discAmtWost,
              amountAfterDiscount,
              taxPercent,
              taxAmount,
              lineTotal,
            });
          }

          const orderNet = Number(
            o.grandTotal !== null && o.grandTotal !== undefined
              ? o.grandTotal
              : docNet,
          );
          const orderTax = Number(
            o.taxAmount !== null && o.taxAmount !== undefined
              ? o.taxAmount
              : docTax,
          );

          if (docItems.length === 0) {
            const grossWostFallback =
              orderWost > 0 ? orderWost : orderNet / 1.18;
            const retailGrossFallback = grossWostFallback * 1.18;
            docItems.push({
              id: o.id,
              docType: 'SALE',
              docNumber: o.orderNumber,
              sku: '-',
              barCode: '-',
              description: 'Sales Order Summary Record',
              sizeName: '',
              colorName: '',
              quantity: 1,
              unitPrice: retailGrossFallback,
              priceWost: grossWostFallback,
              valueExcl: grossWostFallback,
              discountPercent: 0,
              discountAmount: 0,
              discountAmountWost: 0,
              amountAfterDiscount: grossWostFallback,
              taxPercent: 18,
              taxAmount: orderTax,
              lineTotal: orderNet,
            });
            docQty = 1;
            orderRetailGross = retailGrossFallback;
            orderComputedWost = grossWostFallback;
          }

          // Use order-level WOST (subtotal) with fallback to computed — same as sales-list
          const grossWost =
            orderWost > 0
              ? orderWost
              : orderComputedWost > 0
                ? orderComputedWost
                : orderNet / 1.18;
          const retailGross =
            orderRetailGross > 0 ? orderRetailGross : grossWost * 1.18;
          const totalDiscWost =
            orderDiscWost > 0 ? orderDiscWost : orderComputedDiscWost;
          const totalDiscRetail =
            orderRetailDisc > 0 ? orderRetailDisc : totalDiscWost * 1.18;
          const totalAmtAfterDisc = Math.max(0, grossWost - totalDiscWost);
          const docGross = retailGross;
          const docWost = grossWost;
          const docDiscount = totalDiscRetail;
          const docDiscountWost = totalDiscWost;

          // Full tender extraction
          let balance = 0;
          let cashSale = Number(o.cashAmount || 0);
          let cardSale = Number(o.cardAmount || 0);
          let cashReturn = 0;
          let giftVoucher = 0;
          let creditVoucher = 0;
          let exchangeVoucher = 0;
          let claimVoucher = 0;
          let corporateVoucher = 0;
          let rewardVoucher = 0;

          let giftMatch = false;
          let credVouchMatch = false;
          let exMatch = false;
          let clmMatch = false;
          let corpMatch = false;
          let rewMatch = false;

          if (notesStr) {
            const balanceMatch = notesStr.match(
              /\[Credit Sale\] Balance:\s*(-?[\d.]+)/i,
            );
            if (balanceMatch) balance = Number(balanceMatch[1]);

            const cashRetMatch = notesStr.match(
              /\[Cash Return\] Amount:\s*([\d.]+)/i,
            );
            if (cashRetMatch) cashReturn = Number(cashRetMatch[1]);

            if (cashSale === 0) {
              const cashMatch =
                notesStr.match(/\[Cash Sale\] Amount:\s*([\d.]+)/i) ||
                notesStr.match(/(?:cash|cashsale):\s*([\d.]+)/i);
              if (cashMatch) cashSale = Number(cashMatch[1]);
            }
            if (cardSale === 0) {
              const cardMatch =
                notesStr.match(/\[Card Sale\] Amount:\s*([\d.]+)/i) ||
                notesStr.match(/(?:card|cardsale):\s*([\d.]+)/i);
              if (cardMatch) cardSale = Number(cardMatch[1]);
            }

            const ex = notesStr.match(
              /\[Exchange Voucher\] Amount:\s*([\d.]+)/i,
            );
            if (ex) {
              exchangeVoucher = Number(ex[1]);
              exMatch = true;
            }

            const clm = notesStr.match(/\[Claim Voucher\] Amount:\s*([\d.]+)/i);
            if (clm) {
              claimVoucher = Number(clm[1]);
              clmMatch = true;
            }

            const corp = notesStr.match(
              /\[Corporate Voucher\] Amount:\s*([\d.]+)/i,
            );
            if (corp) {
              corporateVoucher = Number(corp[1]);
              corpMatch = true;
            }

            const gift = notesStr.match(/\[Gift Voucher\] Amount:\s*([\d.]+)/i);
            if (gift) {
              giftVoucher = Number(gift[1]);
              giftMatch = true;
            }

            const rew =
              notesStr.match(/\[Reward Voucher\] Amount:\s*([\d.]+)/i) ||
              notesStr.match(/\[Reward Voucher\].*?Amount:\s*([\d.]+)/i);
            if (rew) {
              rewardVoucher = Number(rew[1]);
              rewMatch = true;
            }

            const credV = notesStr.match(
              /\[Credit Voucher\] Amount:\s*([\d.]+)/i,
            );
            if (credV) {
              creditVoucher = Number(credV[1]);
              credVouchMatch = true;
            }
          }

          if (
            balance === 0 &&
            (o.paymentMethod === 'credit_account' ||
              o.tenderType === 'credit_account' ||
              o.paymentMethod === 'credit')
          ) {
            balance = Number(o.grandTotal);
          }
          if (
            rewardVoucher === 0 &&
            (o.paymentMethod === 'reward_voucher' ||
              o.tenderType === 'reward_voucher')
          ) {
            rewardVoucher = Number(o.grandTotal);
          }

          let creditSale =
            balance > 0
              ? balance
              : o.paymentMethod === 'credit_account' ||
                  o.tenderType === 'credit_account' ||
                  o.paymentMethod === 'credit'
                ? Number(o.grandTotal)
                : 0;

          for (const red of o.voucherRedemptions || []) {
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

          const totalRedeemedVoucher =
            giftVoucher +
            creditVoucher +
            exchangeVoucher +
            claimVoucher +
            corporateVoucher +
            rewardVoucher;
          const orderVoucherAmt = Number(o.voucherAmount || 0);
          if (orderVoucherAmt > totalRedeemedVoucher && notesStr) {
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

          const totalTenders =
            cashSale +
            cardSale +
            giftVoucher +
            creditVoucher +
            exchangeVoucher +
            claimVoucher +
            corporateVoucher +
            rewardVoucher +
            creditSale;
          const payMethod = (o.paymentMethod || 'CASH').toUpperCase();
          const paid = Number(o.grandTotal || docNet);
          if (totalTenders === 0) {
            if (payMethod.includes('CARD') || payMethod.includes('BANK'))
              cardSale = paid;
            else if (payMethod.includes('CREDIT')) creditSale = paid;
            else if (payMethod.includes('VOUCHER')) creditVoucher = paid;
            else cashSale = paid;
          }

          let merchantName =
            (o.merchantId && merchantMap.get(o.merchantId)) ||
            o.merchant?.bankName ||
            '-';
          if ((merchantName === '-' || !merchantName) && notesStr) {
            const merchMatch = notesStr.match(
              /(?:Bank|Merchant|Card\s*Name|Cardholder):\s*([^|\],(]+)/i,
            );
            if (merchMatch) merchantName = merchMatch[1].trim();
          }
          merchantName = merchantName || '-';

          const docNode: NetSalesListDocumentNode = {
            id: o.id,
            docType: 'SALE',
            docNumber: o.orderNumber,
            subTypeLabel: 'Sales Invoice',
            createdAt: o.createdAt.toISOString(),
            locationId: o.locationId || undefined,
            locationName: locName,
            cashierName,
            customerName: custName,
            customerPhone: o.customer?.contactNo || undefined,
            customerCnic: o.customer?.cnicNo || undefined,
            customerCode:
              o.customer?.traderId || o.customer?.subCode || undefined,
            paymentMethod: o.paymentMethod || 'CASH',
            merchant: merchantName !== '-' ? merchantName : undefined,
            fbrInvoiceNumber: o.fbrInvoiceNumber || undefined,
            fbrStatus: (o as any).fbrStatus || undefined,
            notes: o.notes || undefined,
            totals: {
              totalItems: docQty,
              grossAmount: docGross,
              wostAmount: docWost,
              discountAmount: docDiscount,
              discountWostAmount: docDiscountWost,
              amountAfterDiscount: totalAmtAfterDisc,
              taxAmount: orderTax,
              netAmount: orderNet,
              cashAmount: cashSale,
              cardAmount: cardSale,
              creditSaleAmount: creditSale,
              giftVoucherAmount: giftVoucher,
              exchangeVoucherAmount: exchangeVoucher,
              creditVoucherAmount: creditVoucher,
              claimVoucherAmount: claimVoucher,
              rewardVoucherAmount: rewardVoucher,
              corporateVoucherAmount: corporateVoucher,
            },
            items: docItems,
          };

          documents.push(docNode);

          // Update grand totals
          grandTotals.totalDocuments += 1;
          grandTotals.salesOrderCount += 1;
          grandTotals.totalItemsSold += docQty;
          grandTotals.grossSalesAmount += docGross;
          grandTotals.wostSalesAmount += docWost;
          grandTotals.discountSalesAmount += docDiscount;
          grandTotals.discountWostSalesAmount += docDiscountWost;
          grandTotals.taxSalesAmount += orderTax;
          grandTotals.netSalesAmount += orderNet;

          grandTotals.cashSale += cashSale;
          grandTotals.cardSale += cardSale;
          grandTotals.creditSale += creditSale;
          grandTotals.giftVoucherAmount += giftVoucher;
          grandTotals.giftVoucherCorporate += corporateVoucher;
          grandTotals.exchangeVoucherRedeemed += exchangeVoucher;
          grandTotals.creditVoucherRedeemed += creditVoucher;
          grandTotals.claimVoucherRedeemed += claimVoucher;
          grandTotals.rewardVoucherAmount += rewardVoucher;
        }

        processedSales += orders.length;
        const pct =
          20 + Math.floor((processedSales / (totalSalesOrders || 1)) * 35);
        await onProgress?.(
          pct,
          `Processed ${processedSales} of ${totalSalesOrders} sales orders...`,
        );
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 2. QUERY & PROCESS POS RETURNS
    // ──────────────────────────────────────────────────────────────────────────
    if (fetchReturns) {
      await onProgress?.(
        55,
        'Querying return and refund records from database...',
      );

      const returnWhere: any = {
        createdAt: { gte: startDate, lte: endDate },
      };

      if (locationWhere) returnWhere.locationId = locationWhere;
      if (cashierUserId) returnWhere.cashierUserId = cashierUserId;

      const totalReturns = await prisma.posReturn.count({ where: returnWhere });
      const RETURN_CHUNK_SIZE = 1500;
      let processedReturns = 0;

      while (processedReturns < totalReturns) {
        if (opts.isAborted?.()) throw new Error('JOB_ABORTED');

        const returns = await prisma.posReturn.findMany({
          where: returnWhere,
          skip: processedReturns,
          take: RETURN_CHUNK_SIZE,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          include: {
            salesOrder: {
              select: {
                id: true,
                orderNumber: true,
                notes: true,
                paymentMethod: true,
                fbrInvoiceNumber: true,
                locationId: true,
                cashierUserId: true,
                customer: {
                  select: {
                    id: true,
                    name: true,
                    contactNo: true,
                    cnicNo: true,
                    email: true,
                    address: true,
                    traderId: true,
                    subCode: true,
                  },
                },
              },
            },
            customer: {
              select: {
                id: true,
                name: true,
                contactNo: true,
                cnicNo: true,
                email: true,
                address: true,
                traderId: true,
                subCode: true,
              },
            },
            originalCustomer: {
              select: {
                id: true,
                name: true,
                contactNo: true,
                cnicNo: true,
                email: true,
                address: true,
                traderId: true,
                subCode: true,
              },
            },
            items: {
              include: {
                item: {
                  select: {
                    id: true,
                    sku: true,
                    barCode: true,
                    description: true,
                    sizeId: true,
                    colorId: true,
                  },
                },
              },
            },
            voucher: true,
          },
        });

        for (const ret of returns) {
          const cust =
            ret.customer || ret.originalCustomer || ret.salesOrder?.customer;
          const locId = ret.locationId || ret.salesOrder?.locationId;
          const locName = (locId && locationMap.get(locId)) || 'Main Store';
          const cashUserId = ret.cashierUserId || ret.salesOrder?.cashierUserId;
          const cashierName =
            (cashUserId && cashierMap.get(cashUserId)) || 'Cashier';
          const custName = cust?.name || 'Walk-in Customer';

          const vType = (ret.voucher?.voucherType || '').toUpperCase();
          const rType = (ret.returnType || '').toUpperCase();
          const rMode = (ret.refundMode || '').toUpperCase();
          const retNotes = ret.reason || ret.salesOrder?.notes || '';

          let subType: 'EXCHANGE_SR' | 'REFUND_RF' | 'CLAIM_CLM' =
            'EXCHANGE_SR';
          let subTypeLabel = 'Sales Return / Exchange (SR)';

          if (vType === 'CLAIM' || /claim|defect|_clm/i.test(retNotes)) {
            subType = 'CLAIM_CLM';
            subTypeLabel = 'Warranty Claim (CLM)';
          } else if (
            rType === 'REFUND' ||
            rMode === 'CASH' ||
            vType === 'REFUND' ||
            vType === 'CREDIT' ||
            /refund|_rf/i.test(retNotes)
          ) {
            subType = 'REFUND_RF';
            subTypeLabel = 'Cash/Card Refund (RF)';
          }

          // Line items computation for returns — matches sales-return-list-export.service.ts
          const docItems: NetSalesListLineItem[] = [];
          let retQty = 0;
          let retGross = 0;
          let retWost = 0;
          let retDiscount = 0;
          let retDiscountWost = 0;
          let retTax = 0;
          let retNet = 0;

          for (const it of ret.items) {
            const qty = Number(it.quantity) || 1;
            const unitPrice = Number(
              (it as any).originalUnitPrice ||
                (it as any).refundPerUnit ||
                (it as any).originalPaidPerUnit ||
                0,
            );
            const unitPriceWost = Number(
              ((it as any).unitPriceWost
                ? Number((it as any).unitPriceWost)
                : unitPrice / 1.18
              ).toFixed(2),
            );
            const valExcl = Number(
              ((it as any).lineTotalWost
                ? Number((it as any).lineTotalWost)
                : qty * unitPriceWost
              ).toFixed(2),
            );
            const disc = Number(
              it.discountPercent
                ? (unitPrice * qty * Number(it.discountPercent)) / 100
                : 0,
            );
            const discWost = Number(
              ((it as any).discountWost
                ? Number((it as any).discountWost)
                : disc / 1.18
              ).toFixed(2),
            );
            const amtAfterDisc = Number(
              Math.max(0, valExcl - discWost).toFixed(2),
            );
            const tax = Number(it.taxAmount || 0);
            const lineTotal = Number(
              it.lineTotal || unitPrice * qty - disc + tax,
            );

            retQty += qty;
            retGross += unitPrice * qty;
            retWost += valExcl;
            retDiscount += disc;
            retDiscountWost += discWost;
            retTax += tax;
            retNet += lineTotal;

            const sizeName = it.item?.sizeId
              ? sizeMap.get(it.item.sizeId) || ''
              : '';
            const colorName = it.item?.colorId
              ? colorMap.get(it.item.colorId) || ''
              : '';

            // Note: In Net Sales List, return items carry NEGATIVE values for Net calculations
            docItems.push({
              id: it.id,
              docType: 'RETURN',
              docNumber: ret.returnNumber,
              refDocNumber: ret.salesOrder?.orderNumber || '',
              sku: it.item?.sku || it.item?.barCode || 'NO-SKU',
              barCode: it.item?.barCode || it.item?.sku || '-',
              description: it.item?.description || 'Return Article',
              sizeName,
              colorName,
              quantity: -qty,
              unitPrice,
              priceWost: unitPriceWost,
              valueExcl: -valExcl,
              discountPercent: Number(it.discountPercent) || 0,
              discountAmount: -disc,
              discountAmountWost: -discWost,
              amountAfterDiscount: -amtAfterDisc,
              taxPercent: Number(it.taxPercent) || 0,
              taxAmount: -tax,
              lineTotal: -lineTotal,
              returnReason: (it as any).reason || ret.reason || undefined,
            });
          }

          if (docItems.length === 0) {
            const totalRefAmt = Number(ret.totalRefundAmount || 0);
            const wostAmt = Number(
              (ret as any).subtotalWost || (totalRefAmt / 1.18).toFixed(2),
            );
            retQty = 1;
            retGross = totalRefAmt;
            retWost = wostAmt;
            retNet = totalRefAmt;

            docItems.push({
              id: ret.id,
              docType: 'RETURN',
              docNumber: ret.returnNumber,
              refDocNumber: ret.salesOrder?.orderNumber || '',
              sku: '-',
              barCode: '-',
              description: 'Return Summary Record',
              sizeName: '',
              colorName: '',
              quantity: -1,
              unitPrice: totalRefAmt,
              priceWost: Number((totalRefAmt / 1.18).toFixed(2)),
              valueExcl: -wostAmt,
              discountPercent: 0,
              discountAmount: 0,
              discountAmountWost: 0,
              amountAfterDiscount: -wostAmt,
              taxPercent: 0,
              taxAmount: -Number(ret.taxAmount || 0),
              lineTotal: -totalRefAmt,
              returnReason: ret.reason || undefined,
            });
          }

          // Refund breakdown
          const totalRefundAmt = Number(ret.totalRefundAmount || retNet);
          const cashRefund =
            ret.refundMode === 'CASH' || rMode === 'CASH' ? totalRefundAmt : 0;
          const cardRefund =
            rMode === 'CARD' ||
            rMode === 'CREDIT_CARD' ||
            rMode === 'DEBIT_CARD'
              ? totalRefundAmt
              : 0;
          const voucherIssuedAmt =
            ret.refundMode === 'VOUCHER' ||
            ret.refundMode === 'EXCHANGE_VOUCHER' ||
            ret.voucher
              ? Number(ret.voucher?.faceValue || totalRefundAmt)
              : 0;

          // Route voucher amount by subType — matches sales-return-list-export.service.ts
          const exchangeVoucherIssued =
            subType === 'EXCHANGE_SR' ? voucherIssuedAmt : 0;
          const creditVoucherIssued =
            subType === 'REFUND_RF' ? voucherIssuedAmt : 0;
          const claimVoucherIssued =
            subType === 'CLAIM_CLM' ? voucherIssuedAmt : 0;
          const rewardVoucherIssued = 0;

          // Fallback: if no cash/card/voucher detected, default by subType
          let finalCashRefund = cashRefund;
          let finalExchangeVoucherIssued = exchangeVoucherIssued;
          if (cashRefund === 0 && cardRefund === 0 && voucherIssuedAmt === 0) {
            if (subType === 'REFUND_RF') {
              finalCashRefund = totalRefundAmt;
            } else {
              finalExchangeVoucherIssued = totalRefundAmt;
            }
          }

          const docNode: NetSalesListDocumentNode = {
            id: ret.id,
            docType: 'RETURN',
            docNumber: ret.returnNumber,
            refDocNumber: ret.salesOrder?.orderNumber || undefined,
            subTypeLabel,
            createdAt: ret.createdAt.toISOString(),
            locationId: locId || undefined,
            locationName: locName,
            cashierName,
            customerName: custName,
            customerPhone: cust?.contactNo || undefined,
            customerCnic: cust?.cnicNo || undefined,
            customerCode: cust?.traderId || cust?.subCode || undefined,
            paymentMethod: `Refund: ${ret.refundMode || rMode || subType}`,
            fbrInvoiceNumber: ret.salesOrder?.fbrInvoiceNumber || undefined,
            notes: ret.reason || ret.salesOrder?.notes || undefined,
            totals: {
              totalItems: -retQty,
              grossAmount: -retGross,
              wostAmount: -retWost,
              discountAmount: -retDiscount,
              discountWostAmount: -retDiscountWost,
              amountAfterDiscount: -Number(
                Math.max(0, retWost - retDiscountWost).toFixed(2),
              ),
              taxAmount: -retTax,
              netAmount: -totalRefundAmt,
              cashAmount: -finalCashRefund,
              cardAmount: -cardRefund,
              creditSaleAmount: 0,
              giftVoucherAmount: 0,
              exchangeVoucherAmount: -finalExchangeVoucherIssued,
              creditVoucherAmount: -creditVoucherIssued,
              claimVoucherAmount: -claimVoucherIssued,
              rewardVoucherAmount: -rewardVoucherIssued,
              corporateVoucherAmount: 0,
            },
            items: docItems,
            voucherDetails: ret.voucher
              ? {
                  code: ret.voucher.code,
                  faceValue: Number(ret.voucher.faceValue) || 0,
                  voucherType: ret.voucher.voucherType,
                }
              : undefined,
          };

          documents.push(docNode);

          // Update grand totals
          grandTotals.totalDocuments += 1;
          grandTotals.returnCount += 1;
          grandTotals.totalItemsReturned += retQty;
          grandTotals.grossReturnAmount += retGross;
          grandTotals.wostReturnAmount += retWost;
          grandTotals.discountReturnAmount += retDiscount;
          grandTotals.discountWostReturnAmount += retDiscountWost;
          grandTotals.taxReturnAmount += retTax;
          grandTotals.netReturnAmount += totalRefundAmt;

          grandTotals.cashRefund += finalCashRefund;
          grandTotals.cardRefund += cardRefund;
          grandTotals.exchangeVoucherIssued += finalExchangeVoucherIssued;
          grandTotals.creditVoucherIssued += creditVoucherIssued;
          grandTotals.claimVoucherIssued += claimVoucherIssued;
        }

        processedReturns += returns.length;
        const pct =
          55 + Math.floor((processedReturns / (totalReturns || 1)) * 25);
        await onProgress?.(
          pct,
          `Processed ${processedReturns} of ${totalReturns} return documents...`,
        );
      }

      // 2b. Fetch and process PosClaim records (warranty / defect claims)
      await onProgress?.(80, 'Querying warranty and defect claim records...');
      const claimWhere: any = {
        createdAt: { gte: startDate, lte: endDate },
      };
      if (locationWhere) {
        claimWhere.salesOrder = { locationId: locationWhere };
      }
      if (cashierUserId) {
        claimWhere.salesOrder = {
          ...(claimWhere.salesOrder || {}),
          cashierUserId,
        };
      }

      const claims = await prisma.posClaim.findMany({
        where: claimWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          salesOrder: {
            select: {
              id: true,
              orderNumber: true,
              locationId: true,
              cashierUserId: true,
              customer: {
                select: {
                  id: true,
                  name: true,
                  contactNo: true,
                  cnicNo: true,
                  subCode: true,
                  traderId: true,
                  address: true,
                  email: true,
                },
              },
            },
          },
          voucher: {
            select: {
              id: true,
              code: true,
              voucherType: true,
              faceValue: true,
              isRedeemed: true,
              description: true,
            },
          },
          items: {
            include: {
              item: {
                select: {
                  id: true,
                  sku: true,
                  barCode: true,
                  description: true,
                  sizeId: true,
                  colorId: true,
                },
              },
            },
          },
        },
      });

      for (const clm of claims) {
        if (documents.some((d) => d.docNumber === clm.claimNumber)) continue;

        const cust = clm.salesOrder?.customer;
        const voucher = clm.voucher;
        const approvedAmt = Number(
          clm.approvedAmount || clm.claimedAmount || 0,
        );

        const docItems: NetSalesListLineItem[] = [];
        let claimQty = 0;

        for (const it of clm.items || []) {
          const qty = it.claimedQty || 1;
          const unitPrice = Number(it.unitPaidPrice || 0);
          const unitPriceWost = Number((unitPrice / 1.18).toFixed(2));
          const valExcl = Number((qty * unitPriceWost).toFixed(2));
          const lineTotal = Number(it.claimedAmount || qty * unitPrice);

          claimQty += qty;
          const sizeName = it.item?.sizeId
            ? sizeMap.get(it.item.sizeId) || ''
            : '';
          const colorName = it.item?.colorId
            ? colorMap.get(it.item.colorId) || ''
            : '';

          docItems.push({
            id: it.id,
            docType: 'RETURN',
            docNumber: clm.claimNumber,
            refDocNumber: clm.salesOrder?.orderNumber || '',
            sku: it.item?.sku || it.item?.barCode || 'NO-SKU',
            barCode: it.item?.barCode || it.item?.sku || '-',
            description: it.item?.description || 'Claim Article',
            sizeName,
            colorName,
            quantity: -qty,
            unitPrice,
            priceWost: unitPriceWost,
            valueExcl: -valExcl,
            discountPercent: 0,
            discountAmount: 0,
            discountAmountWost: 0,
            amountAfterDiscount: -valExcl,
            taxPercent: 0,
            taxAmount: 0,
            lineTotal: -lineTotal,
            returnReason: it.reviewNotes || clm.reasonNotes || undefined,
          });
        }

        if (docItems.length === 0) {
          docItems.push({
            id: clm.id,
            docType: 'RETURN',
            docNumber: clm.claimNumber,
            refDocNumber: clm.salesOrder?.orderNumber || '',
            sku: '-',
            barCode: '-',
            description: 'Claim Record',
            sizeName: '',
            colorName: '',
            quantity: -1,
            unitPrice: approvedAmt,
            priceWost: Number((approvedAmt / 1.18).toFixed(2)),
            valueExcl: -Number((approvedAmt / 1.18).toFixed(2)),
            discountPercent: 0,
            discountAmount: 0,
            discountAmountWost: 0,
            amountAfterDiscount: -Number((approvedAmt / 1.18).toFixed(2)),
            taxPercent: 0,
            taxAmount: 0,
            lineTotal: -approvedAmt,
            returnReason: clm.reasonNotes || undefined,
          });
          claimQty = 1;
        }

        const valExcl = Number((approvedAmt / 1.18).toFixed(2));
        const voucherIssuedAmt = voucher
          ? Number(voucher.faceValue)
          : approvedAmt;

        const locId = clm.salesOrder?.locationId;
        const locName = locId
          ? locationMap.get(locId) || 'Main Store'
          : 'Main Store';
        const cashierName = clm.salesOrder?.cashierUserId
          ? cashierMap.get(clm.salesOrder.cashierUserId) || 'Cashier'
          : 'Cashier';

        const docNode: NetSalesListDocumentNode = {
          id: clm.id,
          docType: 'RETURN',
          docNumber: clm.claimNumber,
          refDocNumber: clm.salesOrder?.orderNumber || undefined,
          subTypeLabel: 'Warranty Claim (CLM)',
          createdAt: clm.createdAt.toISOString(),
          locationId: locId || undefined,
          locationName: locName,
          cashierName,
          customerName: cust?.name || 'Walk-in Customer',
          customerPhone: cust?.contactNo || undefined,
          customerCnic: cust?.cnicNo || undefined,
          customerCode: cust?.subCode || cust?.traderId || undefined,
          paymentMethod: 'Claim Voucher',
          notes: clm.reasonNotes || undefined,
          totals: {
            totalItems: -claimQty,
            grossAmount: -approvedAmt,
            wostAmount: -valExcl,
            discountAmount: 0,
            discountWostAmount: 0,
            amountAfterDiscount: -valExcl,
            taxAmount: 0,
            netAmount: -approvedAmt,
            cashAmount: 0,
            cardAmount: 0,
            creditSaleAmount: 0,
            giftVoucherAmount: 0,
            exchangeVoucherAmount: 0,
            creditVoucherAmount: 0,
            claimVoucherAmount: -voucherIssuedAmt,
            rewardVoucherAmount: 0,
            corporateVoucherAmount: 0,
          },
          items: docItems,
          voucherDetails: voucher
            ? {
                code: voucher.code,
                faceValue: Number(voucher.faceValue) || 0,
                voucherType: voucher.voucherType,
              }
            : undefined,
        };

        documents.push(docNode);

        grandTotals.totalDocuments += 1;
        grandTotals.returnCount += 1;
        grandTotals.totalItemsReturned += claimQty;
        grandTotals.grossReturnAmount += approvedAmt;
        grandTotals.wostReturnAmount += valExcl;
        grandTotals.netReturnAmount += approvedAmt;
        grandTotals.claimVoucherIssued += voucherIssuedAmt;
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3. COMPUTE FINAL NET BALANCES & GRAND TOTALS
    // ──────────────────────────────────────────────────────────────────────────
    await onProgress?.(88, 'Aggregating net sales and grouping by store...');

    grandTotals.netItems =
      grandTotals.totalItemsSold - grandTotals.totalItemsReturned;
    grandTotals.netGrossAmount =
      grandTotals.grossSalesAmount - grandTotals.grossReturnAmount;
    grandTotals.netWostAmount =
      grandTotals.wostSalesAmount - grandTotals.wostReturnAmount;
    grandTotals.netDiscountAmount =
      grandTotals.discountSalesAmount - grandTotals.discountReturnAmount;
    grandTotals.netDiscountWostAmount =
      grandTotals.discountWostSalesAmount -
      grandTotals.discountWostReturnAmount;
    grandTotals.amountAfterDiscount = Math.max(
      0,
      grandTotals.netWostAmount - grandTotals.netDiscountWostAmount,
    );
    grandTotals.netTaxAmount =
      grandTotals.taxSalesAmount - grandTotals.taxReturnAmount;
    grandTotals.totalNetAmount =
      grandTotals.netSalesAmount - grandTotals.netReturnAmount;

    grandTotals.netCash = grandTotals.cashSale - grandTotals.cashRefund;
    grandTotals.netCard = grandTotals.cardSale - grandTotals.cardRefund;
    grandTotals.netExchangeVoucher =
      grandTotals.exchangeVoucherRedeemed - grandTotals.exchangeVoucherIssued;
    grandTotals.netCreditVoucher =
      grandTotals.creditVoucherRedeemed - grandTotals.creditVoucherIssued;
    grandTotals.netClaimVoucher =
      grandTotals.claimVoucherRedeemed - grandTotals.claimVoucherIssued;

    // Sort documents chronologically descending
    documents.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    // Group documents into location nodes
    const locationNodeMap = new Map<string, NetSalesListLocationNode>();
    for (const doc of documents) {
      const locKey = doc.locationId || 'default-store';
      if (!locationNodeMap.has(locKey)) {
        locationNodeMap.set(locKey, {
          locationKey: locKey,
          locationId: doc.locationId,
          locationName: doc.locationName,
          documents: [],
          totals: this.createEmptyTotals(),
        });
      }

      const locNode = locationNodeMap.get(locKey)!;
      locNode.documents.push(doc);

      const t = locNode.totals;
      t.totalDocuments += 1;
      if (doc.docType === 'SALE') {
        t.salesOrderCount += 1;
        t.totalItemsSold += doc.totals.totalItems;
        t.grossSalesAmount += doc.totals.grossAmount;
        t.wostSalesAmount += doc.totals.wostAmount;
        t.discountSalesAmount += doc.totals.discountAmount;
        t.discountWostSalesAmount += doc.totals.discountWostAmount;
        t.taxSalesAmount += doc.totals.taxAmount;
        t.netSalesAmount += doc.totals.netAmount;
        t.cashSale += doc.totals.cashAmount;
        t.cardSale += doc.totals.cardAmount;
        t.creditSale += doc.totals.creditSaleAmount;
        t.giftVoucherAmount += doc.totals.giftVoucherAmount;
        t.exchangeVoucherRedeemed += doc.totals.exchangeVoucherAmount;
        t.creditVoucherRedeemed += doc.totals.creditVoucherAmount;
        t.claimVoucherRedeemed += doc.totals.claimVoucherAmount;
        t.rewardVoucherAmount += doc.totals.rewardVoucherAmount;
        t.giftVoucherCorporate += doc.totals.corporateVoucherAmount;
      } else {
        t.returnCount += 1;
        t.totalItemsReturned += Math.abs(doc.totals.totalItems);
        t.grossReturnAmount += Math.abs(doc.totals.grossAmount);
        t.wostReturnAmount += Math.abs(doc.totals.wostAmount);
        t.discountReturnAmount += Math.abs(doc.totals.discountAmount);
        t.discountWostReturnAmount += Math.abs(doc.totals.discountWostAmount);
        t.taxReturnAmount += Math.abs(doc.totals.taxAmount);
        t.netReturnAmount += Math.abs(doc.totals.netAmount);
        t.cashRefund += Math.abs(doc.totals.cashAmount);
        t.cardRefund += Math.abs(doc.totals.cardAmount);
        t.exchangeVoucherIssued += Math.abs(doc.totals.exchangeVoucherAmount);
        t.creditVoucherIssued += Math.abs(doc.totals.creditVoucherAmount);
        t.claimVoucherIssued += Math.abs(doc.totals.claimVoucherAmount);
      }

      t.netItems = t.totalItemsSold - t.totalItemsReturned;
      t.netGrossAmount = t.grossSalesAmount - t.grossReturnAmount;
      t.netWostAmount = t.wostSalesAmount - t.wostReturnAmount;
      t.netDiscountAmount = t.discountSalesAmount - t.discountReturnAmount;
      t.netDiscountWostAmount =
        t.discountWostSalesAmount - t.discountWostReturnAmount;
      t.amountAfterDiscount = Math.max(
        0,
        t.netWostAmount - t.netDiscountWostAmount,
      );
      t.netTaxAmount = t.taxSalesAmount - t.taxReturnAmount;
      t.totalNetAmount = t.netSalesAmount - t.netReturnAmount;
      t.netCash = t.cashSale - t.cashRefund;
      t.netCard = t.cardSale - t.cardRefund;
      t.netExchangeVoucher =
        t.exchangeVoucherRedeemed - t.exchangeVoucherIssued;
      t.netCreditVoucher = t.creditVoucherRedeemed - t.creditVoucherIssued;
      t.netClaimVoucher = t.claimVoucherRedeemed - t.claimVoucherIssued;

      // Populate flatItems for grid view
      for (const item of doc.items) {
        flatItems.push({
          id: `${doc.id}-${item.id}`,
          docType: doc.docType,
          docNumber: doc.docNumber,
          refDocNumber: doc.refDocNumber,
          subTypeLabel: doc.subTypeLabel,
          docDate: doc.createdAt,
          locationName: doc.locationName,
          locationId: doc.locationId,
          cashierName: doc.cashierName,
          customerName: doc.customerName,
          customerPhone: doc.customerPhone,
          customerCnic: doc.customerCnic,
          customerCode: doc.customerCode,
          paymentMethod: doc.paymentMethod,
          merchant: doc.merchant,
          fbrInvoiceNumber: doc.fbrInvoiceNumber,
          fbrStatus: doc.fbrStatus,
          notes: doc.notes,
          sku: item.sku,
          barCode: item.barCode,
          description: item.description,
          sizeName: item.sizeName,
          colorName: item.colorName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          priceWost: item.priceWost,
          valueExcl: item.valueExcl,
          discountPercent: item.discountPercent,
          discountAmount: item.discountAmount,
          discountAmountWost: item.discountAmountWost,
          amountAfterDiscount: item.amountAfterDiscount,
          taxPercent: item.taxPercent,
          taxAmount: item.taxAmount,
          lineTotal: item.lineTotal,
          cashSale: doc.docType === 'SALE' ? doc.totals.cashAmount : 0,
          cashRefund:
            doc.docType === 'RETURN' ? Math.abs(doc.totals.cashAmount) : 0,
          cardSale: doc.docType === 'SALE' ? doc.totals.cardAmount : 0,
          cardRefund:
            doc.docType === 'RETURN' ? Math.abs(doc.totals.cardAmount) : 0,
          creditSale: doc.totals.creditSaleAmount,
          giftVoucher: doc.totals.giftVoucherAmount,
          exchangeVoucher: doc.totals.exchangeVoucherAmount,
          creditVoucher: doc.totals.creditVoucherAmount,
          claimVoucher: doc.totals.claimVoucherAmount,
          rewardVoucher: doc.totals.rewardVoucherAmount,
          returnReason: item.returnReason,
        });
      }
    }

    const locations = Array.from(locationNodeMap.values()).sort((a, b) =>
      a.locationName.localeCompare(b.locationName),
    );

    const result: NetSalesListReportResult = {
      reportType,
      dateRange: { start: startDate.toISOString(), end: endDate.toISOString() },
      locationNames,
      locations,
      grandTotals,
      documents,
      flatItems,
    };

    // Save streaming ndjson.gz and json.gz
    if (opts.previewJobId) {
      await onProgress?.(95, 'Writing and compressing report preview file...');
      await this.saveReportPreviewResult(opts.previewJobId, result);
    }

    return result;
  }

  async queueReportExport(
    opts: QueueNetSalesListExportOptions,
  ): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const ext = opts.format === 'pdf' ? 'pdf' : 'xlsx';

    await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName: `net-sales-list-report-${jobId}.${ext}`,
        filePath: path.join(
          'uploads',
          'exports',
          `net-sales-list-${jobId}.${ext}`,
        ),
        moduleName: 'POS_NET_SALES_LIST_EXPORT',
        status: 'PENDING',
      },
    });

    await this.exportQueue.add(
      'generate-net-sales-list-export',
      {
        ...opts,
        jobId,
        tenantId,
        tenantDbUrl,
      },
      {
        jobId,
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 1,
      },
    );

    return { jobId };
  }

  async getExportJobStatus(jobId: string): Promise<any> {
    const history = await this.prisma.exportHistory.findUnique({
      where: { id: jobId },
    });
    if (history) {
      return {
        jobId: history.id,
        status: history.status,
        progress:
          history.status === 'COMPLETED'
            ? 100
            : history.status === 'FAILED'
              ? 0
              : 50,
        fileUrl: history.filePath,
        downloadUrl: history.filePath,
        errorMessage: (history as any).errorMessage,
        fileName: history.fileName,
      };
    }

    const job = await this.exportQueue.getJob(jobId);
    if (!job) throw new NotFoundException('Export job not found');
    const state = await job.getState();
    const progress = job.progress();
    return {
      jobId: job.id,
      status: state,
      progress:
        typeof progress === 'number'
          ? progress
          : ((progress as any)?.percent ?? 0),
      failedReason: job.failedReason,
    };
  }

  async registerClientGeneratedExport(
    prismaClient: PrismaService,
    userId: string,
    payload: {
      fileBase64: string;
      fileName: string;
      mimeType: string;
      exportFormat?: 'xlsx' | 'pdf';
      metadata?: any;
    },
  ) {
    const { fileBase64, fileName, mimeType } = payload;
    const jobId = uuidv4();
    const buffer = Buffer.from(fileBase64, 'base64');
    const uploadsDir = path.join(process.cwd(), 'uploads', 'exports');
    if (!fs.existsSync(uploadsDir))
      fs.mkdirSync(uploadsDir, { recursive: true });
    const localFilePath = path.join(uploadsDir, `${jobId}-${fileName}`);
    await fs.promises.writeFile(localFilePath, buffer);

    await prismaClient.exportHistory.create({
      data: {
        id: jobId,
        userId,
        fileName,
        filePath: localFilePath,
        fileSize: buffer.length,
        moduleName: 'POS_NET_SALES_LIST_EXPORT',
        status: 'PENDING',
      },
    });

    const downloadUrl = await this.exportHistoryService.completeAndUploadExport(
      prismaClient,
      jobId,
      localFilePath,
      fileName,
      mimeType,
    );

    return { jobId, fileUrl: downloadUrl, downloadUrl, status: 'COMPLETED' };
  }
}
