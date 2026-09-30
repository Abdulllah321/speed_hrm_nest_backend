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

export interface SalesListTotals {
  orderCount: number;
  totalItems: number;
  grossAmount: number;
  wostAmount?: number;
  discountAmount: number;
  discountWostAmount?: number;
  amountAfterDiscount?: number;
  netAmount: number;
  taxAmount: number;
  paidAmount: number;
  cashAmount: number;
  cardAmount: number;
  walletAmount: number;
  creditAmount: number;
  // Breakdown columns (11 distinct channels)
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
}

export interface SalesListDiscountDetails {
  hasOverrideDiscount: boolean;
  overrideDiscountItemsCount: number;
  overrideDiscountNotes?: string[];
  overrideDiscountPercents?: number[];
  hasManualDiscount: boolean;
  manualDiscountType?: 'PERCENT' | 'FLAT_PKR' | 'MIXED';
  manualDiscountPercent?: number;
  manualDiscountAmount?: number;
  manualDiscountNote?: string;
  alliance?: {
    partnerName: string;
    code: string;
    discountPercent: number;
    description?: string;
  };
  promo?: {
    name: string;
    code: string;
    type: string;
    value: number;
  };
  coupon?: {
    code: string;
    description?: string;
    discountType: string;
    discountValue: number;
  };
  retailDiscount: number;
  wostDiscount: number;
}

export interface SalesListCustomerDetails {
  id?: string;
  name: string;
  phone?: string;
  cnic?: string;
  code?: string;
  email?: string;
  address?: string;
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
  priceWost: number;
  valueExcl?: number;
  discountPercent: number;
  discountAmount: number;
  discountAmountWost: number;
  amountAfterDiscount?: number;
  hasOverrideDiscount: boolean;
  overrideDiscountPercent?: number;
  overrideDiscountNote?: string;
  taxPercent: number;
  taxAmount: number;
  lineTotal: number;
  subTotal?: number;
  valueIncl?: number;
}

export interface CardTenderInfo {
  merchant?: string;
  cardholderName?: string;
  cardLast4?: string;
  authId?: string;
  binNo?: string;
  amount?: number;
}

export interface VoucherTenderInfo {
  code: string;
  amount: number;
  description?: string;
  companyName?: string;
  remarks?: string;
  voucherType?: string;
  paymentMode?: string;
  cardholderName?: string;
  cardLast4?: string;
  slipNo?: string;
}

export interface SalesListTenderDetails {
  card?: CardTenderInfo;
  giftVouchers?: VoucherTenderInfo[];
  exchangeVouchers?: VoucherTenderInfo[];
  claimVouchers?: VoucherTenderInfo[];
  creditVouchers?: VoucherTenderInfo[];
  corporateVouchers?: VoucherTenderInfo[];
  rewardVouchers?: VoucherTenderInfo[];
  creditSale?: {
    customerName?: string;
    customerPhone?: string;
    balance?: number;
  };
  creditIssued?: VoucherTenderInfo[];
  cashReturn?: {
    amount?: number;
    reason?: string;
  };
}

export interface SalesListInvoiceNode {
  id: string;
  orderNumber: string;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  customerCnic?: string;
  customerCode?: string;
  cashierName: string;
  cashierUserId?: string;
  locationId?: string;
  locationName?: string;
  paymentMethod: string;
  merchant?: string;
  fbrInvoiceNumber: string;
  fbrStatus: string;
  notes?: string;
  totals: SalesListTotals;
  items: SalesListLineItem[];
  discountDetails?: SalesListDiscountDetails;
  customerDetails?: SalesListCustomerDetails;
  tenderDetails?: SalesListTenderDetails;
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
  customerCnic?: string;
  customerCode?: string;
  paymentMethod: string;
  merchant?: string;
  fbrInvoiceNumber: string;
  fbrStatus: string;
  orderNotes?: string;
  sku: string;
  barCode: string;
  description: string;
  sizeName: string;
  colorName: string;
  quantity: number;
  unitPrice: number;
  priceWost?: number;
  discountPercent?: number;
  discountAmount: number;
  discountAmountWost?: number;
  hasOverrideDiscount?: boolean;
  overrideDiscountPercent?: number;
  overrideDiscountNote?: string;
  manualDiscountNote?: string;
  manualDiscountType?: string;
  manualDiscountPercent?: number;
  manualDiscountAmount?: number;
  alliancePartner?: string;
  allianceCode?: string;
  promoCode?: string;
  couponCode?: string;
  voucherCodes?: string;
  cardLast4?: string;
  cardSlipNo?: string;
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
}

export interface SalesListReportResult {
  reportType: 'merged' | 'separate';
  locations?: SalesListLocationNode[];
  invoices: SalesListInvoiceNode[];
  flatItems?: SalesListFlatRecord[];
  grandTotals: SalesListTotals;
  dateRange: { startDate?: string; endDate?: string };
  locationNames: string;
}

export interface QueueSalesListExportOptions {
  userId: string;
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
  }): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

    // Clean up previous obsolete preview jobs of the same user so the queue is never flooded
    if (opts.userId) {
      try {
        const [waitingJobs, activeJobs] = await Promise.all([
          this.exportQueue.getWaiting(),
          this.exportQueue.getActive(),
        ]);

        for (const wJob of waitingJobs) {
          if (wJob.data?.userId === opts.userId && wJob.name === 'generate-sales-list-preview') {
            if (wJob.data?.jobId) {
              await this.previewCleanupService.deletePreviewByJobId(wJob.data.jobId);
            }
            await wJob.remove();
          }
        }
        for (const aJob of activeJobs) {
          if (aJob.data?.userId === opts.userId && aJob.name === 'generate-sales-list-preview') {
            this.cancelledPreviewJobIds.add(aJob.data?.jobId);
            if (aJob.data?.jobId) {
              await this.previewCleanupService.deletePreviewByJobId(aJob.data.jobId);
            }
          }
        }
      } catch (err: any) {
        this.logger.warn(`Failed cleaning up obsolete preview jobs: ${err.message}`);
      }
    }

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
        fiscalYear: opts.fiscalYear,
        year: opts.year,
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

  getPreviewFilePath(jobId: string): string {
    const jsonPath = path.join(this.previewStorageDir, `sales-list-preview-${jobId}.json.gz`);
    if (fs.existsSync(jsonPath)) return jsonPath;
    const ndjsonPath = path.join(this.previewStorageDir, `sales-list-preview-${jobId}.ndjson.gz`);
    if (fs.existsSync(ndjsonPath)) return ndjsonPath;
    return jsonPath;
  }

  getPreviewNdjsonFilePath(jobId: string): string {
    return path.join(this.previewStorageDir, `sales-list-preview-${jobId}.ndjson.gz`);
  }

  async saveReportPreviewResult(jobId: string, result: SalesListReportResult): Promise<void> {
    const jsonPath = path.join(this.previewStorageDir, `sales-list-preview-${jobId}.json.gz`);
    const jsonStr = JSON.stringify(result);
    const compressed = await gzipAsync(Buffer.from(jsonStr, 'utf8'));
    await fs.promises.writeFile(jsonPath, compressed);
  }

  async savePreviewResult(jobId: string, result: SalesListReportResult): Promise<void> {
    return this.saveReportPreviewResult(jobId, result);
  }

  async getReportPreviewResult(jobId: string): Promise<SalesListReportResult | null> {
    const jsonPath = path.join(this.previewStorageDir, `sales-list-preview-${jobId}.json.gz`);
    if (fs.existsSync(jsonPath)) {
      const compressed = await fs.promises.readFile(jsonPath);
      const decompressed = await gunzipAsync(compressed);
      const parsed = JSON.parse(decompressed.toString('utf8'));
      return parsed.data || parsed;
    }

    const ndjsonPath = path.join(this.previewStorageDir, `sales-list-preview-${jobId}.ndjson.gz`);
    if (!fs.existsSync(ndjsonPath)) {
      return null;
    }

    // Fast stream reader for ndjson.gz with preview sampling (up to 5,000 invoices)
    return new Promise<SalesListReportResult | null>((resolve) => {
      const gz = fs.createReadStream(ndjsonPath);
      const gunzip = zlib.createGunzip();
      const rl = readline.createInterface({ input: gz.pipe(gunzip) });

      let meta: any = {};
      const allInvoices: any[] = [];
      let grandTotals: any = {};
      const PREVIEW_LIMIT = 5000;

      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          if (line.includes('"type":"meta"')) {
            meta = JSON.parse(line);
          } else if (line.includes('"type":"totals"')) {
            grandTotals = JSON.parse(line).grandTotals || {};
          } else if (line.includes('"type":"invoices"')) {
            if (allInvoices.length < PREVIEW_LIMIT) {
              const obj = JSON.parse(line);
              if (Array.isArray(obj.invoices)) {
                const remaining = PREVIEW_LIMIT - allInvoices.length;
                allInvoices.push(...obj.invoices.slice(0, remaining));
              }
            }
          }
        } catch {
          // ignore malformed line
        }
      });

      rl.on('close', () => {
        resolve({
          reportType: meta.reportType || 'merged',
          dateRange: meta.dateRange || {},
          locationNames: meta.locationNames || '',
          locations: meta.locations || [],
          grandTotals,
          invoices: allInvoices,
          flatItems: [],
        });
      });

      gz.on('error', () => resolve(null));
      gunzip.on('error', () => resolve(null));
    });
  }

  async computeReportData(
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
      fiscalYear?: string;
      year?: number | string;
      onProgress?: (percent: number, message: string) => Promise<void> | void;
    },
    prismaClient?: PrismaService,
  ): Promise<SalesListReportResult> {
    const prisma = prismaClient || this.prisma;
    return this.generateSalesListReportDataInternal(prisma, opts);
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
      fiscalYear?: string;
      year?: number | string;
      previewJobId?: string;
      isAborted?: () => boolean;
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
      fiscalYear,
      year,
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

    // Determine Pakistan Fiscal Year bounds: July 1 to June 30
    const getFiscalYearBounds = (fyStr?: string): { start: Date; end: Date } => {
      let startYear: number;
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth(); // 0 = Jan, 6 = July
      const defaultStartYear = currentMonth >= 6 ? currentYear : currentYear - 1;

      if (!fyStr || fyStr === 'current' || fyStr === 'current_fiscal') {
        startYear = defaultStartYear;
      } else if (fyStr === 'previous' || fyStr === 'previous_fiscal') {
        startYear = defaultStartYear - 1;
      } else {
        const match = fyStr.match(/(\d{4})/);
        startYear = match ? parseInt(match[1], 10) : defaultStartYear;
      }

      const start = new Date(Date.UTC(startYear, 6, 1, 0, 0, 0, 0));
      const end = new Date(Date.UTC(startYear + 1, 5, 30, 23, 59, 59, 999));
      return { start, end };
    };

    let startDate: Date;
    let endDate: Date;

    if (fiscalYear) {
      const bounds = getFiscalYearBounds(fiscalYear);
      startDate = bounds.start;
      endDate = bounds.end;
    } else if (year) {
      const yr = typeof year === 'string' ? parseInt(year, 10) : year;
      const targetYear = !isNaN(yr) && yr > 2000 ? yr : now.getFullYear();
      startDate = new Date(Date.UTC(targetYear, 0, 1, 0, 0, 0, 0));
      endDate = new Date(Date.UTC(targetYear, 11, 31, 23, 59, 59, 999));
    } else if (startStr || endStr) {
      startDate = parseLocalDate(startStr, false);
      endDate = parseLocalDate(endStr, true);
    } else {
      const bounds = getFiscalYearBounds('current');
      startDate = bounds.start;
      endDate = bounds.end;
    }

    if (endDate > now) {
      endDate = now;
    }

    const locIds = locationId ? locationId.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const locationWhere = locIds.length > 1 ? { in: locIds } : locIds.length === 1 ? locIds[0] : undefined;

    await onProgress?.(15, 'Loading outlet metadata & cashier user profiles...');

    const [allLocations, cashiersList, allSizes, allColors, allMerchants] = await Promise.all([
      prisma.location.findMany({ select: { id: true, name: true } }),
      this.prismaMaster.user.findMany({ select: { id: true, firstName: true, lastName: true } }),
      prisma.size.findMany({ select: { id: true, name: true } }),
      prisma.color.findMany({ select: { id: true, name: true } }),
      prisma.merchantConfig.findMany({ select: { id: true, bankName: true, description: true } }),
    ]);

    const locationMap = new Map<string, string>();
    for (const l of allLocations) locationMap.set(l.id, l.name);

    const cashierMap = new Map<string, string>();
    for (const u of cashiersList) cashierMap.set(u.id, `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Cashier');

    const sizeMap = new Map<string, string>();
    for (const s of allSizes) sizeMap.set(s.id, s.name);

    const colorMap = new Map<string, string>();
    for (const c of allColors) colorMap.set(c.id, c.name);

    const merchantMap = new Map<string, string>();
    for (const m of allMerchants) {
      const label = m.bankName || (m.description ? m.description.split('|')[1]?.trim() || m.description : '');
      merchantMap.set(m.id, label);
    }

    let locationNames = '';
    if (locIds.length > 0) {
      const locs = allLocations.filter((l) => locIds.includes(l.id));
      locationNames = locs.map((l) => l.name).join(', ');
    }
    if (!locationNames) locationNames = 'All Outlets (Stores)';

    const where: any = {
      orderNumber: { not: { startsWith: 'RET-' } },
      status: { notIn: ['hold', 'hold_expired', 'hold_cancelled', 'voided', 'cancelled', 'VOIDED', 'CANCELLED', 'draft', 'DRAFT'] },
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


    await onProgress?.(25, 'Counting matching sales orders...');
    const totalOrdersCount = await prisma.salesOrder.count({ where });

    const createEmptyTotals = (): SalesListTotals => ({
      orderCount: 0,
      totalItems: 0,
      grossAmount: 0,
      wostAmount: 0,
      discountAmount: 0,
      discountWostAmount: 0,
      amountAfterDiscount: 0,
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
    });

    const addTotals = (target: SalesListTotals, source: SalesListTotals) => {
      target.orderCount += source.orderCount;
      target.totalItems += source.totalItems;
      target.grossAmount += source.grossAmount;
      target.wostAmount = (target.wostAmount || 0) + (source.wostAmount || (source.grossAmount ? source.grossAmount / 1.18 : 0));
      target.discountAmount += source.discountAmount;
      target.discountWostAmount = (target.discountWostAmount || 0) + (source.discountWostAmount || (source.discountAmount ? source.discountAmount / 1.18 : 0));
      target.amountAfterDiscount = (target.amountAfterDiscount || 0) + (source.amountAfterDiscount || Math.max(0, (source.wostAmount || source.grossAmount / 1.18) - (source.discountWostAmount || source.discountAmount / 1.18)));
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
    };

    const transformSingleOrder = (
      order: any,
      orderIssued: any[],
    ): { invNode: SalesListInvoiceNode; orderTotals: SalesListTotals } => {
      const notesStr = order.notes || '';
      let cashierName = order.cashierUserId ? cashierMap.get(order.cashierUserId) || 'Cashier' : 'Cashier';
      if (cashierName === 'Cashier' && notesStr) {
        const spMatch = notesStr.match(/(?:SalesPerson|Cashier):\s*([^|\]]+)/i);
        if (spMatch) cashierName = spMatch[1].trim();
      }
      let custName = order.customer?.name || 'Walk-in Customer';
      if (custName === 'Walk-in Customer' && notesStr) {
        const custMatch = notesStr.match(/(?:Customer|CustomerName):\s*([^|\]]+)/i);
        if (custMatch) custName = custMatch[1].trim();
      }
      const custPhone = order.customer?.contactNo || '-';
      const custCnic = order.customer?.cnicNo || undefined;
      const custCode = order.customer?.traderId || order.customer?.subCode || undefined;
      const payMethod = (order.paymentMethod || 'CASH').toUpperCase();
      const fbrInv = order.fbrInvoiceNumber || '-';
      const fbrStatus = order.fbrStatus || 'NONE';

      const orderWost = Number(order.subtotal || 0);
      const orderDiscWost = Number(order.discountAmount || 0);
      const net = Number(order.grandTotal || 0);
      const tax = Number(order.taxAmount || 0);
      const paid = net;

      // Fast-path tender extraction
      let balance = 0;
      let cashSale = Number(order.cashAmount || 0);
      let cardSale = Number(order.cardAmount || 0);
      let cashReturn = 0;
      let giftVoucherAmount = 0;
      let creditVoucherAmount = 0;
      let exchangeVoucherAmount = 0;
      let claimVoucherAmount = 0;
      let giftVoucherCorporate = 0;
      let rewardVoucherAmount = 0;

      let giftMatch = false;
      let credVouchMatch = false;
      let exMatch = false;
      let clmMatch = false;
      let corpMatch = false;
      let rewMatch = false;

      if (notesStr) {
        const balanceMatch = notesStr.match(/\[Credit Sale\] Balance:\s*(-?[\d.]+)/i);
        if (balanceMatch) balance = Number(balanceMatch[1]);

        const cashRetMatch = notesStr.match(/\[Cash Return\] Amount:\s*([\d.]+)/i);
        if (cashRetMatch) cashReturn = Number(cashRetMatch[1]);

        if (cashSale === 0) {
          const cashMatch = notesStr.match(/\[Cash Sale\] Amount:\s*([\d.]+)/i) || notesStr.match(/(?:cash|cashsale):\s*([\d.]+)/i);
          if (cashMatch) cashSale = Number(cashMatch[1]);
        }
        if (cardSale === 0) {
          const cardMatch = notesStr.match(/\[Card Sale\] Amount:\s*([\d.]+)/i) || notesStr.match(/(?:card|cardsale):\s*([\d.]+)/i);
          if (cardMatch) cardSale = Number(cardMatch[1]);
        }

        const ex = notesStr.match(/\[Exchange Voucher\] Amount:\s*([\d.]+)/i);
        if (ex) {
          exchangeVoucherAmount = Number(ex[1]);
          exMatch = true;
        }

        const clm = notesStr.match(/\[Claim Voucher\] Amount:\s*([\d.]+)/i);
        if (clm) {
          claimVoucherAmount = Number(clm[1]);
          clmMatch = true;
        }

        const corp = notesStr.match(/\[Corporate Voucher\] Amount:\s*([\d.]+)/i);
        if (corp) {
          giftVoucherCorporate = Number(corp[1]);
          corpMatch = true;
        }

        const gift = notesStr.match(/\[Gift Voucher\] Amount:\s*([\d.]+)/i);
        if (gift) {
          giftVoucherAmount = Number(gift[1]);
          giftMatch = true;
        }

        const rew = notesStr.match(/\[Reward Voucher\] Amount:\s*([\d.]+)/i) || notesStr.match(/\[Reward Voucher\].*?Amount:\s*([\d.]+)/i);
        if (rew) {
          rewardVoucherAmount = Number(rew[1]);
          rewMatch = true;
        }

        const credV = notesStr.match(/\[Credit Voucher\] Amount:\s*([\d.]+)/i);
        if (credV) {
          creditVoucherAmount = Number(credV[1]);
          credVouchMatch = true;
        }
      }

      if (balance === 0 && (order.paymentMethod === 'credit_account' || order.tenderType === 'credit_account' || order.paymentMethod === 'credit')) {
        balance = Number(order.grandTotal);
      }
      if (rewardVoucherAmount === 0 && (order.paymentMethod === 'reward_voucher' || order.tenderType === 'reward_voucher')) {
        rewardVoucherAmount = Number(order.grandTotal);
      }

      let creditSale = balance > 0 ? balance : ((order.paymentMethod === 'credit_account' || order.tenderType === 'credit_account' || order.paymentMethod === 'credit') ? Number(order.grandTotal) : 0);

      for (const red of (order.voucherRedemptions || [])) {
        const type = red.voucher?.voucherType;
        const amt = Number(red.amountUsed);

        if (type === 'GIFT' || type === 'OUTLET_GIFT') {
          if (!giftMatch) giftVoucherAmount += amt;
        } else if (type === 'CREDIT' || type === 'REFUND') {
          if (!credVouchMatch) creditVoucherAmount += amt;
        } else if (type === 'CLAIM') {
          if (!clmMatch) claimVoucherAmount += amt;
        } else if (type === 'CORPORATE') {
          if (!corpMatch) giftVoucherCorporate += amt;
        } else if (type === 'EXCHANGE') {
          if (!exMatch) exchangeVoucherAmount += amt;
        } else if (type === 'REWARD') {
          if (!rewMatch) rewardVoucherAmount += amt;
        }
      }

      const totalRedeemedVoucher = giftVoucherAmount + creditVoucherAmount + exchangeVoucherAmount + claimVoucherAmount + giftVoucherCorporate + rewardVoucherAmount;
      const orderVoucherAmt = Number(order.voucherAmount || 0);
      if (orderVoucherAmt > totalRedeemedVoucher && notesStr) {
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
      if (notesStr) {
        const issuedMatch = notesStr.match(/\[Credit Voucher Issued\] Amount:\s*([\d.]+)/i);
        if (issuedMatch) {
          creditVoucherIssuedAmount = Number(issuedMatch[1]);
        }
      }
      for (const iv of orderIssued) {
        const type = iv.voucherType;
        const faceVal = Number(iv.faceValue || 0);

        if (type === 'CREDIT' || type === 'REFUND') {
          creditVoucherIssuedAmount += faceVal;
        }
      }

      const totalTenders = cashSale + cardSale + giftVoucherAmount + creditVoucherAmount + exchangeVoucherAmount + claimVoucherAmount + giftVoucherCorporate + rewardVoucherAmount + creditSale;
      if (totalTenders === 0) {
        if (payMethod.includes('CASH')) cashSale = paid;
        else if (payMethod.includes('CARD') || payMethod.includes('BANK')) cardSale = paid;
        else if (payMethod.includes('CREDIT')) {
          creditSale = paid;
        } else if (payMethod.includes('VOUCHER')) {
          creditVoucherAmount = paid;
        } else {
          cashSale = paid;
        }
      }

      let cashAmt = cashSale;
      let cardAmt = cardSale;
      let walletAmt = giftVoucherAmount + creditVoucherAmount + exchangeVoucherAmount + claimVoucherAmount + giftVoucherCorporate + rewardVoucherAmount;
      let creditAmt = creditSale;

      // Line Items with full discount & WOST calculations
      const overrideDiscountNotes: string[] = [];
      const overrideDiscountPercents: number[] = [];
      let overrideDiscountItemsCount = 0;
      let orderRetailGross = 0;
      let orderRetailDisc = 0;
      let orderComputedWost = 0;
      let orderComputedDiscWost = 0;

      const lineItems: SalesListLineItem[] = (order.items || []).map((item: any) => {
        const unitPrice = Number(item.unitPrice || 0);
        const qty = Number(item.quantity || 0);
        const lineRetailGross = unitPrice * qty;
        orderRetailGross += lineRetailGross;

        const priceWost = unitPrice / 1.18;
        const valueExcl = priceWost * qty;

        const rawDiscAmt = Number(item.discountAmount || 0);
        const discPct = Number(item.discountPercent || (lineRetailGross > 0 && rawDiscAmt > 0 ? (rawDiscAmt / valueExcl) * 100 : 0));

        let discAmtWost = 0;
        let discAmtRetail = 0;

        if (discPct > 0) {
          discAmtRetail = Math.round((lineRetailGross * (discPct / 100)) * 100) / 100;
          discAmtWost = Math.round((valueExcl * (discPct / 100)) * 100) / 100;
        } else if (rawDiscAmt > 0) {
          discAmtWost = rawDiscAmt;
          discAmtRetail = Math.round(rawDiscAmt * 1.18 * 100) / 100;
        }

        orderRetailDisc += discAmtRetail;
        orderComputedWost += valueExcl;
        orderComputedDiscWost += discAmtWost;

        const overrideDiscPct = item.overrideDiscountPercent !== null && item.overrideDiscountPercent !== undefined ? Number(item.overrideDiscountPercent) : undefined;
        const overrideDiscNote = item.overrideDiscountNote || undefined;
        const hasOverride = (overrideDiscPct !== undefined && overrideDiscPct > 0) || Boolean(overrideDiscNote);

        if (hasOverride) {
          overrideDiscountItemsCount++;
          if (overrideDiscNote) overrideDiscountNotes.push(overrideDiscNote);
          if (overrideDiscPct !== undefined) overrideDiscountPercents.push(overrideDiscPct);
        }

        const amountAfterDiscount = Math.max(0, valueExcl - discAmtWost);
        const taxPercent = Number(item.taxPercent || 18);
        const taxAmount = Number(item.taxAmount || Math.round(amountAfterDiscount * (taxPercent / 100) * 100) / 100);
        const lineTotal = Number(item.lineTotal || (lineRetailGross - discAmtRetail));
        const valueIncl = lineTotal;

        return {
          id: item.id,
          orderNumber: order.orderNumber,
          sku: item.item?.sku || item.item?.barCode || 'NO-SKU',
          barCode: item.item?.barCode || item.item?.sku || '-',
          description: item.item?.description || item.item?.sku || 'Article',
          sizeName: (item.item?.sizeId && sizeMap.get(item.item.sizeId)) || 'Default',
          colorName: (item.item?.colorId && colorMap.get(item.item.colorId)) || 'Default',
          quantity: qty,
          unitPrice,
          priceWost,
          valueExcl,
          discountPercent: discPct,
          discountAmount: discAmtRetail,
          discountAmountWost: discAmtWost,
          amountAfterDiscount,
          hasOverrideDiscount: hasOverride,
          overrideDiscountPercent: overrideDiscPct,
          overrideDiscountNote: overrideDiscNote,
          taxPercent,
          taxAmount,
          lineTotal,
          subTotal: lineTotal,
          valueIncl,
        };
      });

      const totalItemsCount = lineItems.reduce((acc, i) => acc + i.quantity, 0);

      const grossWost = orderWost > 0 ? orderWost : (orderComputedWost > 0 ? orderComputedWost : net / 1.18);
      const retailGross = orderRetailGross > 0 ? orderRetailGross : (grossWost * 1.18);
      const totalDiscWost = orderDiscWost > 0 ? orderDiscWost : orderComputedDiscWost;
      const totalDiscRetail = orderRetailDisc > 0 ? orderRetailDisc : (totalDiscWost * 1.18);
      const totalAmtAfterDisc = Math.max(0, grossWost - totalDiscWost);

      let merchantName = (order.merchantId && merchantMap.get(order.merchantId)) || order.merchant?.bankName || '-';
      if ((merchantName === '-' || !merchantName) && notesStr) {
        const merchMatch = notesStr.match(/(?:Bank|Merchant|Card\s*Name|Cardholder):\s*([^|\],(]+)/i);
        if (merchMatch) merchantName = merchMatch[1].trim();
      }
      merchantName = merchantName || '-';

      const orderTotals: SalesListTotals = {
        orderCount: 1,
        totalItems: totalItemsCount,
        grossAmount: retailGross,
        wostAmount: grossWost,
        discountAmount: totalDiscRetail,
        discountWostAmount: totalDiscWost,
        amountAfterDiscount: totalAmtAfterDisc,
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
      };

      // Card Tender Info
      let cardInfo: CardTenderInfo | undefined;
      if (cardSale > 0) {
        let cardholderName: string | undefined;
        const chMatch = notesStr.match(/(?:Cardholder|Card\s*Name|Holder):\s*([^|\],]+)/i);
        if (chMatch) cardholderName = chMatch[1].trim();

        let cardLast4: string | undefined;
        const cMatch = notesStr.match(/(?:Card|Last4|CardLast4|Card#):\s*(?:\*{4})?(\d{4})/i);
        if (cMatch) {
          cardLast4 = cMatch[1];
        } else {
          const remMatch = notesStr.match(/Remarks:\s*(\d{4})(?:-\d+-\d+)?;/i);
          if (remMatch) cardLast4 = remMatch[1];
        }

        let authId: string | undefined;
        const authMatch = notesStr.match(/(?:Slip|Auth|AuthID|Approval|ApprovalCode):\s*([A-Za-z0-9]+)/i);
        if (authMatch) {
          authId = authMatch[1];
        } else {
          const remSlipMatch = notesStr.match(/Remarks:\s*\d{4}-\d+-(\d+);/i);
          if (remSlipMatch) authId = remSlipMatch[1];
        }

        let binNo: string | undefined;
        const binMatch = notesStr.match(/BIN:\s*(\d+)/i);
        if (binMatch) binNo = binMatch[1];

        cardInfo = {
          merchant: merchantName !== '-' ? merchantName : undefined,
          cardholderName,
          cardLast4,
          authId,
          binNo,
          amount: cardSale,
        };
      }

      // Voucher Tender Lists
      const giftVouchersList: VoucherTenderInfo[] = [];
      const giftReds = (order.voucherRedemptions || []).filter((r: any) => r.voucher?.voucherType === 'GIFT' || r.voucher?.voucherType === 'OUTLET_GIFT');
      for (const gr of giftReds) {
        giftVouchersList.push({
          code: gr.voucher?.code || 'GFT-VOUCHER',
          amount: Number(gr.amountUsed || 0),
          description: gr.voucher?.description || undefined,
          voucherType: gr.voucher?.voucherType || 'GIFT',
          cardholderName: gr.voucher?.cardholderName || undefined,
          cardLast4: gr.voucher?.cardLast4 || undefined,
          slipNo: gr.voucher?.slipNo || undefined,
        });
      }
      if (giftVouchersList.length === 0 && giftVoucherAmount > 0) {
        const gCodeMatch = notesStr.match(/GiftVoucherRef:\s*([^|\],]+)/i);
        giftVouchersList.push({
          code: gCodeMatch ? gCodeMatch[1].trim() : 'GIFT-VOUCHER',
          amount: giftVoucherAmount,
        });
      }

      const exchangeVouchersList: VoucherTenderInfo[] = [];
      const exReds = (order.voucherRedemptions || []).filter((r: any) => r.voucher?.voucherType === 'EXCHANGE');
      for (const er of exReds) {
        exchangeVouchersList.push({
          code: er.voucher?.code || 'EXC-VOUCHER',
          amount: Number(er.amountUsed || 0),
          description: er.voucher?.description || undefined,
          voucherType: 'EXCHANGE',
        });
      }
      if (exchangeVouchersList.length === 0 && exchangeVoucherAmount > 0) {
        const exRefMatch = notesStr.match(/ExVoucherRef:\s*([^|\],]+)/i);
        exchangeVouchersList.push({
          code: exRefMatch ? exRefMatch[1].trim() : 'EXCHANGE-VOUCHER',
          amount: exchangeVoucherAmount,
        });
      }

      const claimVouchersList: VoucherTenderInfo[] = [];
      const clmReds = (order.voucherRedemptions || []).filter((r: any) => r.voucher?.voucherType === 'CLAIM');
      for (const cr of clmReds) {
        claimVouchersList.push({
          code: cr.voucher?.code || 'CLM-VOUCHER',
          amount: Number(cr.amountUsed || 0),
          description: cr.voucher?.description || undefined,
          voucherType: 'CLAIM',
        });
      }
      if (claimVouchersList.length === 0 && claimVoucherAmount > 0) {
        const clmRefMatch = notesStr.match(/ClaimVoucherRef:\s*([^|\],]+)/i);
        claimVouchersList.push({
          code: clmRefMatch ? clmRefMatch[1].trim() : 'CLAIM-VOUCHER',
          amount: claimVoucherAmount,
        });
      }

      const creditVouchersList: VoucherTenderInfo[] = [];
      const credReds = (order.voucherRedemptions || []).filter((r: any) => r.voucher?.voucherType === 'CREDIT' || r.voucher?.voucherType === 'REFUND');
      for (const cr of credReds) {
        creditVouchersList.push({
          code: cr.voucher?.code || 'CRD-VOUCHER',
          amount: Number(cr.amountUsed || 0),
          description: cr.voucher?.description || undefined,
          voucherType: cr.voucher?.voucherType || 'CREDIT',
        });
      }
      if (creditVouchersList.length === 0 && creditVoucherAmount > 0) {
        const crRefMatch = notesStr.match(/CreditVoucherRef:\s*([^|\],]+)/i);
        creditVouchersList.push({
          code: crRefMatch ? crRefMatch[1].trim() : 'CREDIT-VOUCHER',
          amount: creditVoucherAmount,
        });
      }

      const corporateVouchersList: VoucherTenderInfo[] = [];
      const corpReds = (order.voucherRedemptions || []).filter((r: any) => r.voucher?.voucherType === 'CORPORATE');
      for (const cr of corpReds) {
        corporateVouchersList.push({
          code: cr.voucher?.code || 'CORP-VOUCHER',
          amount: Number(cr.amountUsed || 0),
          companyName: cr.voucher?.companyName || undefined,
          voucherType: 'CORPORATE',
        });
      }
      if (corporateVouchersList.length === 0 && giftVoucherCorporate > 0) {
        const corpRefMatch = notesStr.match(/CorporateRef:\s*([^|\],]+)/i);
        corporateVouchersList.push({
          code: corpRefMatch ? corpRefMatch[1].trim() : 'CORPORATE-VOUCHER',
          amount: giftVoucherCorporate,
        });
      }

      const rewardVouchersList: VoucherTenderInfo[] = [];
      const rewReds = (order.voucherRedemptions || []).filter((r: any) => r.voucher?.voucherType === 'REWARD');
      for (const rr of rewReds) {
        rewardVouchersList.push({
          code: rr.voucher?.code || 'REWARD-VOUCHER',
          amount: Number(rr.amountUsed || 0),
          description: rr.voucher?.description || undefined,
          voucherType: 'REWARD',
        });
      }
      if (rewardVouchersList.length === 0 && rewardVoucherAmount > 0) {
        const rewNotesMatch = notesStr.match(/\[Reward Voucher\]\s*([^|\],]+)/i);
        rewardVouchersList.push({
          code: 'REWARD-VOUCHER',
          amount: rewardVoucherAmount,
          remarks: rewNotesMatch ? rewNotesMatch[1].trim() : undefined,
        });
      }

      const creditSaleInfo = creditSale > 0 ? {
        customerName: custName !== 'Walk-in Customer' ? custName : undefined,
        customerPhone: custPhone !== '-' ? custPhone : undefined,
        balance: creditSale,
      } : undefined;

      const creditIssuedList: VoucherTenderInfo[] = [];
      for (const iv of orderIssued) {
        creditIssuedList.push({
          code: iv.code,
          amount: Number(iv.faceValue || 0),
          description: iv.description || undefined,
          voucherType: iv.voucherType,
        });
      }
      if (creditIssuedList.length === 0 && creditVoucherIssuedAmount > 0) {
        creditIssuedList.push({
          code: 'ISSUED-CREDIT-VOUCHER',
          amount: creditVoucherIssuedAmount,
        });
      }

      const cashReturnInfo = cashReturn > 0 ? {
        amount: cashReturn,
        reason: 'Cash returned during invoice settlement',
      } : undefined;

      const tenderDetails: SalesListTenderDetails = {
        card: cardInfo,
        giftVouchers: giftVouchersList.length > 0 ? giftVouchersList : undefined,
        exchangeVouchers: exchangeVouchersList.length > 0 ? exchangeVouchersList : undefined,
        claimVouchers: claimVouchersList.length > 0 ? claimVouchersList : undefined,
        creditVouchers: creditVouchersList.length > 0 ? creditVouchersList : undefined,
        corporateVouchers: corporateVouchersList.length > 0 ? corporateVouchersList : undefined,
        rewardVouchers: rewardVouchersList.length > 0 ? rewardVouchersList : undefined,
        creditSale: creditSaleInfo,
        creditIssued: creditIssuedList.length > 0 ? creditIssuedList : undefined,
        cashReturn: cashReturnInfo,
      };

      // Rich Discount Details
      const manualDiscountPercent = order.globalDiscountPercent ? Number(order.globalDiscountPercent) : undefined;
      const manualDiscountAmount = order.globalDiscountAmount ? Number(order.globalDiscountAmount) : undefined;
      const manualDiscountNote = order.manualDiscountNote || undefined;
      const hasManualDiscount = Boolean(manualDiscountNote || manualDiscountPercent || manualDiscountAmount);
      const manualDiscountType: 'PERCENT' | 'FLAT_PKR' | 'MIXED' | undefined = hasManualDiscount
        ? (manualDiscountPercent && manualDiscountAmount ? 'MIXED' : manualDiscountPercent ? 'PERCENT' : 'FLAT_PKR')
        : undefined;

      let alliance: any = undefined;
      if (order.alliance) {
        alliance = {
          partnerName: order.alliance.partnerName,
          code: order.alliance.code,
          discountPercent: Number(order.alliance.discountPercent || 0),
          description: order.alliance.description || undefined,
        };
      }

      let promo: any = undefined;
      if (order.promo) {
        promo = {
          name: order.promo.name,
          code: order.promo.code,
          type: order.promo.type,
          value: Number(order.promo.value || 0),
        };
      }

      let coupon: any = undefined;
      if (order.coupon) {
        coupon = {
          code: order.coupon.code,
          description: order.coupon.description || undefined,
          discountType: order.coupon.discountType,
          discountValue: Number(order.coupon.discountValue || 0),
        };
      }

      const discountDetails: SalesListDiscountDetails = {
        hasOverrideDiscount: overrideDiscountItemsCount > 0,
        overrideDiscountItemsCount,
        overrideDiscountNotes: overrideDiscountNotes.length > 0 ? overrideDiscountNotes : undefined,
        overrideDiscountPercents: overrideDiscountPercents.length > 0 ? overrideDiscountPercents : undefined,
        hasManualDiscount,
        manualDiscountType,
        manualDiscountPercent,
        manualDiscountAmount,
        manualDiscountNote,
        alliance,
        promo,
        coupon,
        retailDiscount: totalDiscRetail,
        wostDiscount: totalDiscWost,
      };

      // Rich Customer Profile
      const customerDetails: SalesListCustomerDetails = {
        id: order.customer?.id,
        name: custName,
        phone: custPhone !== '-' ? custPhone : undefined,
        cnic: custCnic,
        code: custCode,
        address: order.customer?.address || undefined,
        email: order.customer?.email || undefined,
      };

      const locName = (order.locationId && locationMap.get(order.locationId)) || order.location?.name || 'All Locations';

      const invNode: SalesListInvoiceNode = {
        id: order.id,
        orderNumber: order.orderNumber,
        createdAt: order.createdAt.toISOString(),
        customerName: custName,
        customerPhone: custPhone,
        customerCnic: custCnic,
        customerCode: custCode,
        cashierName,
        cashierUserId: order.cashierUserId || undefined,
        locationId: order.locationId || undefined,
        locationName: locName,
        paymentMethod: payMethod,
        merchant: merchantName,
        fbrInvoiceNumber: fbrInv,
        fbrStatus,
        notes: notesStr || undefined,
        totals: orderTotals,
        items: lineItems,
        discountDetails,
        customerDetails,
        tenderDetails,
      };

      return { invNode, orderTotals };
    };

    const grandTotals = createEmptyTotals();
    const locationNodesMap = new Map<string, SalesListLocationNode>();
    const inMemoryInvoices: SalesListInvoiceNode[] = [];

    const isDirectDiskStream = Boolean(opts.previewJobId);
    let gzipStream: zlib.Gzip | null = null;
    let writeStream: fs.WriteStream | null = null;
    let streamPromise: Promise<void> | null = null;

    const safeWrite = async (chunk: string): Promise<void> => {
      if (!gzipStream) return;
      if (!gzipStream.write(chunk)) {
        await new Promise((r) => gzipStream!.once('drain', r));
      }
    };

    if (isDirectDiskStream) {
      const filePath = this.getPreviewNdjsonFilePath(opts.previewJobId!);
      gzipStream = zlib.createGzip({ level: 6 });
      writeStream = fs.createWriteStream(filePath);

      streamPromise = new Promise<void>((resolve, reject) => {
        pipeline(gzipStream!, writeStream!, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Line 1: Meta header written immediately
      const metaLine = JSON.stringify({
        type: 'meta',
        reportType,
        dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
        locationNames,
        locations: allLocations,
        totalInvoices: totalOrdersCount,
      }) + '\n';
      await safeWrite(metaLine);
    }

    let processedOrders = 0;
    let lastReportedPct = 0;

    if (totalOrdersCount > 0) {
      const CHUNK = 2500;

      while (true) {
        if (opts.isAborted?.() || (opts.previewJobId && this.isJobCancelled(opts.previewJobId))) {
          if (gzipStream) {
            gzipStream.destroy();
          }
          throw new Error('JOB_CANCELLED');
        }

        const chunkOrders: any[] = await prisma.salesOrder.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: processedOrders,
          take: CHUNK,
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
            alliance: { select: { partnerName: true, code: true, discountPercent: true, description: true } },
            promo: { select: { name: true, code: true, type: true, value: true } },
            coupon: { select: { code: true, description: true, discountType: true, discountValue: true } },
            fbrInvoiceNumber: true,
            fbrStatus: true,
            customer: { select: { id: true, name: true, contactNo: true, traderId: true, subCode: true, cnicNo: true, address: true, email: true } },
            voucherRedemptions: {
              select: {
                amountUsed: true,
                voucher: {
                  select: {
                    id: true,
                    code: true,
                    voucherType: true,
                    faceValue: true,
                    description: true,
                    companyName: true,
                    paymentMode: true,
                    cardholderName: true,
                    cardLast4: true,
                    slipNo: true,
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
                    id: true,
                    description: true,
                    sku: true,
                    barCode: true,
                    sizeId: true,
                    colorId: true,
                  },
                },
              },
            },
          },
        });

        if (!chunkOrders.length) break;

        const chunkInvoiceNodes: SalesListInvoiceNode[] = [];
        for (const order of chunkOrders) {
          const { invNode, orderTotals } = transformSingleOrder(order, []);
          addTotals(grandTotals, orderTotals);

          const locKey = order.locationId ? `loc:${order.locationId}` : 'main-outlet';
          let locNode = locationNodesMap.get(locKey);
          if (!locNode) {
            locNode = {
              locationKey: locKey,
              locationId: order.locationId || undefined,
              locationName: invNode.locationName || (order.locationId ? locationMap.get(order.locationId) : undefined) || 'Main Outlet',
              invoices: [],
              totals: createEmptyTotals(),
            };
            locationNodesMap.set(locKey, locNode);
          }
          addTotals(locNode.totals, orderTotals);

          if (isDirectDiskStream) {
            chunkInvoiceNodes.push(invNode);
            if (inMemoryInvoices.length < 5000) {
              inMemoryInvoices.push(invNode);
            }
          } else {
            inMemoryInvoices.push(invNode);
          }
        }

        // If direct disk streaming, write chunked invoice batches to gzip and free memory immediately
        if (isDirectDiskStream && chunkInvoiceNodes.length > 0) {
          const SUB_CHUNK = 250;
          for (let sub = 0; sub < chunkInvoiceNodes.length; sub += SUB_CHUNK) {
            const batch = chunkInvoiceNodes.slice(sub, sub + SUB_CHUNK);
            const chunkLine = JSON.stringify({
              type: 'invoices',
              startIndex: processedOrders + sub,
              count: batch.length,
              invoices: batch,
            }) + '\n';
            await safeWrite(chunkLine);
          }
          chunkInvoiceNodes.length = 0; // Discard immediately from memory
        }

        processedOrders += chunkOrders.length;
        const pct = Math.min(95, Math.round(25 + (processedOrders / totalOrdersCount) * 70));
        if (pct - lastReportedPct >= 2 || processedOrders === totalOrdersCount) {
          lastReportedPct = pct;
          await onProgress?.(pct, `Processed ${processedOrders.toLocaleString()} of ${totalOrdersCount.toLocaleString()} invoices (${pct}%)...`);
        }
        await new Promise((res) => setImmediate(res));

        if (chunkOrders.length < CHUNK) break;
      }
    }

    if (isDirectDiskStream && gzipStream) {
      // Final Line: Verified Grand Totals
      const totalsLine = JSON.stringify({
        type: 'totals',
        grandTotals,
        totalInvoices: totalOrdersCount,
        done: true,
      }) + '\n';
      await safeWrite(totalsLine);

      gzipStream.end();
      await streamPromise;
    }

    await onProgress?.(100, 'Sales List report computation complete!');

    return {
      reportType,
      locations: Array.from(locationNodesMap.values()),
      invoices: inMemoryInvoices,
      flatItems: [],
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
        locationIds: opts.locationIds,
        startDate: opts.startDate,
        endDate: opts.endDate,
        cashierUserId: opts.cashierUserId,
        format: opts.format,
        search: opts.search,
        paymentModeGroup: opts.paymentModeGroup,
        minAmount: opts.minAmount,
        maxAmount: opts.maxAmount,
        fbrOnly: opts.fbrOnly,
        exportType: opts.exportType || 'hierarchical',
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

  async getJobStatus(jobId: string): Promise<{ state: string; progress: number; message?: string }> {
    const job = await this.exportQueue.getJob(jobId);
    if (!job) throw new NotFoundException(`Export job ${jobId} not found`);
    const state = await job.getState();
    const rawProg: any = job.progress();
    const progress = typeof rawProg === 'number' ? rawProg : typeof rawProg === 'object' && rawProg?.percent !== undefined ? Number(rawProg.percent) : 0;
    const message = typeof rawProg === 'object' && rawProg?.message ? String(rawProg.message) : undefined;
    return { state, progress, message };
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
      const signedUrl = await this.uploadService.getSignedUrlForDownload(s3Key, record.fileName);
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

  async streamFilteredPreviewExcel(
    jobId: string,
    options: {
      exportType?: 'flat' | 'hierarchical';
      search?: string;
      paymentMode?: string;
      fbrOnly?: boolean;
      locationId?: string;
      cashierId?: string;
    },
    res: any,
  ): Promise<void> {
    const ndjsonPath = this.getPreviewNdjsonFilePath(jobId);
    const jsonPath = path.join(this.previewStorageDir, `sales-list-preview-${jobId}.json.gz`);
    
    let targetFilePath = '';
    if (fs.existsSync(ndjsonPath)) {
      targetFilePath = ndjsonPath;
    } else if (fs.existsSync(jsonPath)) {
      targetFilePath = jsonPath;
    } else {
      throw new NotFoundException('Sales list preview result not found or expired');
    }

    const exportType = options.exportType || 'flat';
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `sales-list-${exportType}-${dateStr}.xlsx`;

    const passThrough = new PassThrough();
    if (typeof res.header === 'function') {
      res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.header('Content-Disposition', `attachment; filename="${fileName}"`);
      res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (typeof res.setHeader === 'function') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }

    if (typeof res.send === 'function') {
      res.send(passThrough);
    } else if (typeof res.pipe === 'function') {
      passThrough.pipe(res);
    }

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: passThrough,
      useStyles: true,
      useSharedStrings: false,
    });

    const sheet = workbook.addWorksheet(exportType === 'flat' ? 'Flat Items' : 'Invoices');

    if (exportType === 'flat') {
      sheet.columns = [
        { header: 'Outlet / Location', key: 'locationName', width: 22 },
        { header: 'Invoice #', key: 'orderNumber', width: 16 },
        { header: 'Order Date', key: 'orderDate', width: 20 },
        { header: 'Cashier', key: 'cashierName', width: 16 },
        { header: 'Customer', key: 'customerName', width: 18 },
        { header: 'Phone', key: 'customerPhone', width: 14 },
        { header: 'CNIC', key: 'customerCnic', width: 16 },
        { header: 'Customer Code', key: 'customerCode', width: 14 },
        { header: 'Payment Mode', key: 'paymentMethod', width: 14 },
        { header: 'Merchant', key: 'merchant', width: 16 },
        { header: 'FBR Inv #', key: 'fbrInvoiceNumber', width: 16 },
        { header: 'FBR Status', key: 'fbrStatus', width: 12 },
        { header: 'Order Notes', key: 'orderNotes', width: 20 },
        { header: 'SKU', key: 'sku', width: 16 },
        { header: 'Barcode', key: 'barCode', width: 16 },
        { header: 'Description', key: 'description', width: 26 },
        { header: 'Size', key: 'sizeName', width: 10 },
        { header: 'Color', key: 'colorName', width: 12 },
        { header: 'Quantity', key: 'quantity', width: 10 },
        { header: 'Unit Price', key: 'unitPrice', width: 12 },
        { header: 'Unit Price WOST', key: 'priceWost', width: 14 },
        { header: 'Value Excl.', key: 'valueExcl', width: 14 },
        { header: 'Discount %', key: 'discountPercent', width: 11 },
        { header: 'Discount', key: 'discountAmount', width: 12 },
        { header: 'Discount WOST', key: 'discountAmountWost', width: 13 },
        { header: 'Amount After Discount', key: 'amountAfterDiscount', width: 18 },
        { header: 'Sales Tax', key: 'taxAmount', width: 12 },
        { header: 'Value Incl. (SubTotal)', key: 'subTotal', width: 18 },
        { header: 'Cash Sale', key: 'cashSale', width: 14 },
        { header: 'Cash Return', key: 'cashReturn', width: 14 },
        { header: 'Card Sale', key: 'cardSale', width: 14 },
        { header: 'Credit Sale', key: 'creditSale', width: 14 },
        { header: 'Gift Voucher', key: 'giftVoucherAmount', width: 14 },
        { header: 'Credit Voucher', key: 'creditVoucherAmount', width: 14 },
        { header: 'Exchange Voucher', key: 'exchangeVoucherAmount', width: 16 },
        { header: 'Claim Voucher', key: 'claimVoucherAmount', width: 14 },
        { header: 'Corporate Voucher', key: 'giftVoucherCorporate', width: 16 },
        { header: 'Credit Issued', key: 'creditVoucherIssuedAmount', width: 14 },
        { header: 'Reward Voucher', key: 'rewardVoucherAmount', width: 14 },
        { header: 'Override Note', key: 'overrideDiscountNote', width: 20 },
        { header: 'Manual Disc Note', key: 'manualDiscountNote', width: 20 },
        { header: 'Manual Disc Type', key: 'manualDiscountType', width: 16 },
        { header: 'Alliance Partner', key: 'alliancePartner', width: 18 },
        { header: 'Coupon / Promo', key: 'promoCoupon', width: 16 },
        { header: 'Voucher Numbers', key: 'voucherCodes', width: 24 },
        { header: 'Card Details', key: 'cardDetails', width: 22 },
      ];
    } else {
      sheet.columns = [
        { header: 'Invoice #', key: 'invoiceNo', width: 16 },
        { header: 'Date & Time', key: 'date', width: 20 },
        { header: 'Customer', key: 'customer', width: 18 },
        { header: 'Phone', key: 'phone', width: 14 },
        { header: 'CNIC', key: 'cnic', width: 16 },
        { header: 'Customer Code', key: 'customerCode', width: 14 },
        { header: 'Cashier', key: 'cashier', width: 16 },
        { header: 'Payment Mode', key: 'paymentMethod', width: 14 },
        { header: 'Merchant', key: 'merchant', width: 16 },
        { header: 'FBR Inv #', key: 'fbr', width: 16 },
        { header: 'Order Notes', key: 'orderNotes', width: 20 },
        { header: 'Discount Audit / Notes', key: 'discountNotes', width: 30 },
        { header: 'Alliance Partner', key: 'alliancePartner', width: 18 },
        { header: 'Promo / Coupon', key: 'promoCoupon', width: 16 },
        { header: 'Vouchers Redeemed', key: 'vouchersList', width: 28 },
        { header: 'Card Details', key: 'tenderCardDetails', width: 24 },
        { header: 'Quantity', key: 'quantity', width: 10 },
        { header: 'Unit Price (Avg)', key: 'unitPriceAvg', width: 16 },
        { header: 'Unit Price WOST (Avg)', key: 'unitPriceWost', width: 18 },
        { header: 'Value Excl.', key: 'valueExcl', width: 14 },
        { header: 'Discount', key: 'discountTotal', width: 14 },
        { header: 'Discount WOST', key: 'discountWost', width: 14 },
        { header: 'Amount After Discount', key: 'amountAfterDiscount', width: 18 },
        { header: 'Sales Tax', key: 'salesTax', width: 12 },
        { header: 'Value Incl. (Net Revenue)', key: 'netTotal', width: 18 },
        { header: 'Cash Sale', key: 'tenderCash', width: 12 },
        { header: 'Cash Return', key: 'returnAmount', width: 12 },
        { header: 'Card Sale', key: 'tenderCard', width: 12 },
        { header: 'Credit Sale', key: 'tenderCreditSale', width: 14 },
        { header: 'Gift Voucher', key: 'tenderGiftVoucher', width: 14 },
        { header: 'Credit Voucher', key: 'tenderCreditVoucher', width: 14 },
        { header: 'Exchange Voucher', key: 'tenderExchangeVoucher', width: 16 },
        { header: 'Claim Voucher', key: 'tenderClaimVoucher', width: 14 },
        { header: 'Corporate Voucher', key: 'tenderCorporateVoucher', width: 18 },
        { header: 'Credit Issued', key: 'creditVoucherIssued', width: 14 },
        { header: 'Reward Voucher', key: 'tenderRewardVoucher', width: 15 },
      ];
    }

    // Filter Predicates
    const q = (options.search || '').trim().toLowerCase();
    const pMode = options.paymentMode && options.paymentMode !== 'all' ? options.paymentMode.toUpperCase() : null;
    const isFbrOnly = options.fbrOnly === true;
    const locSet = options.locationId && options.locationId !== 'all'
      ? new Set(options.locationId.split(',').map((s) => s.trim().toLowerCase()))
      : null;
    const cashierFilter = options.cashierId && options.cashierId !== 'all'
      ? options.cashierId.trim().toLowerCase()
      : null;

    let totalQty = 0;
    let totalValExcl = 0;
    let totalDiscount = 0;
    let totalDiscWost = 0;
    let totalAmtAfterDisc = 0;
    let totalTax = 0;
    let totalNet = 0;
    let totalCash = 0;
    let totalCashReturn = 0;
    let totalCard = 0;
    let totalCredit = 0;
    let totalGiftVoucher = 0;
    let totalCreditVoucher = 0;
    let totalExchangeVoucher = 0;
    let totalClaimVoucher = 0;
    let totalCorporateVoucher = 0;
    let totalCreditIssued = 0;
    let totalRewardVoucher = 0;

    const fileStream = fs.createReadStream(targetFilePath);
    const gunzip = zlib.createGunzip();
    const lineReader = readline.createInterface({
      input: fileStream.pipe(gunzip),
      crlfDelay: Infinity,
    });

    for await (const line of lineReader) {
      if (!line || !line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        let invoicesToProcess: any[] = [];
        
        if (parsed.type === 'invoices' && Array.isArray(parsed.invoices)) {
          invoicesToProcess = parsed.invoices;
        } else if (Array.isArray(parsed.invoices)) {
          invoicesToProcess = parsed.invoices;
        } else if (parsed.data && Array.isArray(parsed.data.invoices)) {
          invoicesToProcess = parsed.data.invoices;
        } else if (parsed.orderNumber) {
          invoicesToProcess = [parsed];
        }

        for (const inv of invoicesToProcess) {
          if (!inv) continue;

          // Location filter
          if (locSet) {
            const locId = (inv.locationId || '').toLowerCase();
            const locName = (inv.locationName || '').toLowerCase();
            if (!locSet.has(locId) && !locSet.has(locName)) continue;
          }
          // Cashier filter
          if (cashierFilter) {
            const cId = (inv.cashierUserId || '').toLowerCase();
            const cName = (inv.cashierName || '').toLowerCase();
            if (cId !== cashierFilter && cName !== cashierFilter) continue;
          }
          // Payment mode filter
          if (pMode && (inv.paymentMethod || '').toUpperCase() !== pMode) continue;
          // FBR Only
          if (isFbrOnly && (!inv.fbrInvoiceNumber || inv.fbrInvoiceNumber === '-' || inv.fbrInvoiceNumber.trim() === '')) continue;
          // Search query
          if (q) {
            const matchesHeader =
              (inv.orderNumber || '').toLowerCase().includes(q) ||
              (inv.customerName || '').toLowerCase().includes(q) ||
              (inv.customerPhone || '').toLowerCase().includes(q) ||
              (inv.customerCnic || '').toLowerCase().includes(q) ||
              (inv.cashierName || '').toLowerCase().includes(q) ||
              (inv.fbrInvoiceNumber || '').toLowerCase().includes(q);

            const matchesItems = (inv.items || []).some((it: any) =>
              (it.sku || '').toLowerCase().includes(q) ||
              (it.barCode || '').toLowerCase().includes(q) ||
              (it.description || '').toLowerCase().includes(q)
            );

            if (!matchesHeader && !matchesItems) continue;
          }

          const t = inv.totals || {};

          // Extract voucher summary strings
          const allVouchers = [
            ...(inv.tenderDetails?.giftVouchers || []),
            ...(inv.tenderDetails?.creditVouchers || []),
            ...(inv.tenderDetails?.exchangeVouchers || []),
            ...(inv.tenderDetails?.claimVouchers || []),
            ...(inv.tenderDetails?.corporateVouchers || []),
            ...(inv.tenderDetails?.rewardVouchers || []),
          ];
          const voucherCodesStr = allVouchers.map((v) => `${v.code} (Rs. ${Number(v.amount || 0).toLocaleString()})`).join(', ');

          // Extract card summary string
          const card = inv.tenderDetails?.card;
          const cardDetailsStr = card ? `${card.merchant || inv.merchant || 'Card'} ${card.cardLast4 ? `**** ${card.cardLast4}` : ''} ${card.authId ? `Slip: ${card.authId}` : ''}`.trim() : '-';

          // Extract discount summary notes
          const discNotesArr: string[] = [];
          if (inv.discountDetails?.overrideDiscountNotes?.length) {
            discNotesArr.push(`Override: ${inv.discountDetails.overrideDiscountNotes.join(', ')}`);
          }
          if (inv.discountDetails?.manualDiscountNote) {
            discNotesArr.push(`Manual: ${inv.discountDetails.manualDiscountNote} (${inv.discountDetails.manualDiscountType || 'Flat'})`);
          }
          if (inv.discountDetails?.alliance) {
            discNotesArr.push(`Alliance: ${inv.discountDetails.alliance.partnerName} (${inv.discountDetails.alliance.discountPercent}%)`);
          }
          if (inv.discountDetails?.promo) {
            discNotesArr.push(`Promo: ${inv.discountDetails.promo.name} (${inv.discountDetails.promo.code})`);
          }
          if (inv.discountDetails?.coupon) {
            discNotesArr.push(`Coupon: ${inv.discountDetails.coupon.code}`);
          }
          const discNotesStr = discNotesArr.join(' | ') || (t.discountAmount ? 'Line Discounts' : '-');

          if (exportType === 'flat') {
            const items = inv.items && inv.items.length > 0 ? inv.items : [{
              sku: '-',
              barCode: '-',
              description: 'Invoice Summary',
              quantity: t.totalItems || 1,
              unitPrice: (t.grossAmount || (t.wostAmount ? t.wostAmount * 1.18 : 0)),
              priceWost: (t.wostAmount || (t.grossAmount ? t.grossAmount / 1.18 : 0)),
              valueExcl: (t.wostAmount || (t.grossAmount ? t.grossAmount / 1.18 : 0)),
              discountAmount: t.discountAmount || 0,
              discountAmountWost: t.discountWostAmount || 0,
              amountAfterDiscount: t.amountAfterDiscount || 0,
              taxAmount: t.taxAmount || 0,
              lineTotal: t.netAmount || 0,
              valueIncl: t.netAmount || 0,
            }];

            for (const item of items) {
              const qty = Number(item.quantity || 0);
              const unitPrice = Number(item.unitPrice || 0);
              const unitPriceWost = item.priceWost !== undefined ? item.priceWost : (unitPrice / 1.18);
              const valExcl = Number((item.valueExcl !== undefined ? item.valueExcl : qty * unitPriceWost).toFixed(2));
              const disc = Number(item.discountAmount || 0);
              const discWost = Number((item.discountAmountWost !== undefined ? item.discountAmountWost : (disc / 1.18)).toFixed(2));
              const amtAfterDisc = Number((item.amountAfterDiscount !== undefined ? item.amountAfterDiscount : Math.max(0, valExcl - discWost)).toFixed(2));
              const tax = Number(item.taxAmount || 0);
              const subTotal = Number(item.lineTotal || item.subTotal || (unitPrice * qty - disc + tax));

              totalQty += qty;
              totalValExcl += valExcl;
              totalDiscount += disc;
              totalDiscWost += discWost;
              totalAmtAfterDisc += amtAfterDisc;
              totalTax += tax;
              totalNet += subTotal;
              totalCash += Number(t.cashSale || 0);
              totalCashReturn += Number(t.cashReturn || 0);
              totalCard += Number(t.cardSale || 0);
              totalCredit += Number(t.creditSale || 0);
              totalGiftVoucher += Number(t.giftVoucherAmount || 0);
              totalCreditVoucher += Number(t.creditVoucherAmount || 0);
              totalExchangeVoucher += Number(t.exchangeVoucherAmount || 0);
              totalClaimVoucher += Number(t.claimVoucherAmount || 0);
              totalCorporateVoucher += Number(t.giftVoucherCorporate || 0);
              totalCreditIssued += Number(t.creditVoucherIssuedAmount || 0);
              totalRewardVoucher += Number(t.rewardVoucherAmount || 0);

              const row = sheet.addRow({
                locationName: inv.locationName || '-',
                orderNumber: inv.orderNumber,
                orderDate: inv.createdAt ? new Date(inv.createdAt).toISOString().replace('T', ' ').slice(0, 19) : '-',
                cashierName: inv.cashierName || '-',
                customerName: inv.customerName || 'Walk-in',
                customerPhone: inv.customerPhone || '-',
                customerCnic: inv.customerCnic || '-',
                customerCode: inv.customerCode || '-',
                paymentMethod: inv.paymentMethod || '-',
                merchant: inv.merchant || '-',
                fbrInvoiceNumber: inv.fbrInvoiceNumber || '-',
                fbrStatus: inv.fbrStatus || '-',
                orderNotes: inv.notes || '-',
                sku: item.sku || '-',
                barCode: item.barCode || '-',
                description: item.description || '-',
                sizeName: item.sizeName || '-',
                colorName: item.colorName || '-',
                quantity: qty,
                unitPrice: unitPrice,
                priceWost: Number(unitPriceWost.toFixed(2)),
                valueExcl: valExcl,
                discountPercent: item.discountPercent || 0,
                discountAmount: disc,
                discountAmountWost: discWost,
                amountAfterDiscount: amtAfterDisc,
                taxAmount: tax,
                subTotal: subTotal,
                cashSale: Number(t.cashSale || 0),
                cashReturn: Number(t.cashReturn || 0),
                cardSale: Number(t.cardSale || 0),
                creditSale: Number(t.creditSale || 0),
                giftVoucherAmount: Number(t.giftVoucherAmount || 0),
                creditVoucherAmount: Number(t.creditVoucherAmount || 0),
                exchangeVoucherAmount: Number(t.exchangeVoucherAmount || 0),
                claimVoucherAmount: Number(t.claimVoucherAmount || 0),
                giftVoucherCorporate: Number(t.giftVoucherCorporate || 0),
                creditVoucherIssuedAmount: Number(t.creditVoucherIssuedAmount || 0),
                rewardVoucherAmount: Number(t.rewardVoucherAmount || 0),
                overrideDiscountNote: item.overrideDiscountNote || (item.overrideDiscountPercent ? `${item.overrideDiscountPercent}% Override` : '-'),
                manualDiscountNote: inv.discountDetails?.manualDiscountNote || '-',
                manualDiscountType: inv.discountDetails?.manualDiscountType || '-',
                alliancePartner: inv.discountDetails?.alliance ? `${inv.discountDetails.alliance.partnerName} (${inv.discountDetails.alliance.discountPercent}%)` : '-',
                promoCoupon: inv.discountDetails?.coupon?.code || inv.discountDetails?.promo?.code || '-',
                voucherCodes: voucherCodesStr || '-',
                cardDetails: cardDetailsStr,
              });
              row.commit();
            }
          } else {
            const qty = Number(t.totalItems || 0);
            const gross = Number(t.grossAmount || 0);
            const unitPriceAvg = qty > 0 ? Number((gross / qty).toFixed(2)) : 0;
            const valExcl = Number((t.wostAmount !== undefined ? t.wostAmount : (gross / 1.18)).toFixed(2));
            const unitPriceWost = qty > 0 ? Number((valExcl / qty).toFixed(2)) : 0;
            const disc = Number(t.discountAmount || 0);
            const discWost = Number((t.discountWostAmount !== undefined ? t.discountWostAmount : (inv.discountDetails?.wostDiscount || disc / 1.18)).toFixed(2));
            const amtAfterDisc = Number((t.amountAfterDiscount !== undefined ? t.amountAfterDiscount : Math.max(0, valExcl - discWost)).toFixed(2));
            const tax = Number(t.taxAmount || 0);
            const net = Number(t.netAmount || 0);

            totalQty += qty;
            totalValExcl += valExcl;
            totalDiscount += disc;
            totalDiscWost += discWost;
            totalAmtAfterDisc += amtAfterDisc;
            totalTax += tax;
            totalNet += net;
            totalCash += Number(t.cashSale || 0);
            totalCashReturn += Number(t.cashReturn || 0);
            totalCard += Number(t.cardSale || 0);
            totalCredit += Number(t.creditSale || 0);
            totalGiftVoucher += Number(t.giftVoucherAmount || 0);
            totalCreditVoucher += Number(t.creditVoucherAmount || 0);
            totalExchangeVoucher += Number(t.exchangeVoucherAmount || 0);
            totalClaimVoucher += Number(t.claimVoucherAmount || 0);
            totalCorporateVoucher += Number(t.giftVoucherCorporate || 0);
            totalCreditIssued += Number(t.creditVoucherIssuedAmount || 0);
            totalRewardVoucher += Number(t.rewardVoucherAmount || 0);

            const row = sheet.addRow({
              invoiceNo: inv.orderNumber,
              date: inv.createdAt ? new Date(inv.createdAt).toISOString().replace('T', ' ').slice(0, 19) : '-',
              customer: inv.customerName || 'Walk-in',
              phone: inv.customerPhone || '-',
              cnic: inv.customerCnic || '-',
              customerCode: inv.customerCode || '-',
              cashier: inv.cashierName || '-',
              paymentMethod: inv.paymentMethod || '-',
              merchant: inv.merchant || '-',
              fbr: inv.fbrInvoiceNumber || '-',
              orderNotes: inv.notes || '-',
              discountNotes: discNotesStr,
              alliancePartner: inv.discountDetails?.alliance ? `${inv.discountDetails.alliance.partnerName} (${inv.discountDetails.alliance.discountPercent}%)` : '-',
              promoCoupon: inv.discountDetails?.coupon?.code || inv.discountDetails?.promo?.code || '-',
              vouchersList: voucherCodesStr || '-',
              tenderCardDetails: cardDetailsStr,
              quantity: qty,
              unitPriceAvg: unitPriceAvg,
              unitPriceWost: unitPriceWost,
              valueExcl: valExcl,
              discountTotal: disc,
              discountWost: discWost,
              amountAfterDiscount: amtAfterDisc,
              salesTax: tax,
              netTotal: net,
              tenderCash: Number(t.cashSale || 0),
              returnAmount: Number(t.cashReturn || 0),
              tenderCard: Number(t.cardSale || 0),
              tenderCreditSale: Number(t.creditSale || 0),
              tenderGiftVoucher: Number(t.giftVoucherAmount || 0),
              tenderCreditVoucher: Number(t.creditVoucherAmount || 0),
              tenderExchangeVoucher: Number(t.exchangeVoucherAmount || 0),
              tenderClaimVoucher: Number(t.claimVoucherAmount || 0),
              tenderCorporateVoucher: Number(t.giftVoucherCorporate || 0),
              creditVoucherIssued: Number(t.creditVoucherIssuedAmount || 0),
              tenderRewardVoucher: Number(t.rewardVoucherAmount || 0),
            });
            row.commit();
          }
        }
      } catch (e) {
        // Skip unparseable lines
      }
    }

    // Totals Summary Row
    if (exportType === 'flat') {
      const summaryRow = sheet.addRow({
        locationName: 'GRAND TOTAL',
        quantity: totalQty,
        unitPrice: '',
        priceWost: '',
        valueExcl: totalValExcl,
        discountPercent: '',
        discountAmount: totalDiscount,
        discountAmountWost: totalDiscWost,
        amountAfterDiscount: totalAmtAfterDisc,
        taxAmount: totalTax,
        subTotal: totalNet,
        cashSale: totalCash,
        cashReturn: totalCashReturn,
        cardSale: totalCard,
        creditSale: totalCredit,
        giftVoucherAmount: totalGiftVoucher,
        creditVoucherAmount: totalCreditVoucher,
        exchangeVoucherAmount: totalExchangeVoucher,
        claimVoucherAmount: totalClaimVoucher,
        giftVoucherCorporate: totalCorporateVoucher,
        creditVoucherIssuedAmount: totalCreditIssued,
        rewardVoucherAmount: totalRewardVoucher,
      });
      summaryRow.font = { bold: true };
      summaryRow.commit();
    } else {
      const summaryRow = sheet.addRow({
        invoiceNo: 'GRAND TOTAL',
        quantity: totalQty,
        unitPriceAvg: totalQty > 0 ? Number(((totalValExcl * 1.18) / totalQty).toFixed(2)) : 0,
        unitPriceWost: totalQty > 0 ? Number((totalValExcl / totalQty).toFixed(2)) : 0,
        valueExcl: totalValExcl,
        discountTotal: totalDiscount,
        discountWost: totalDiscWost,
        amountAfterDiscount: totalAmtAfterDisc,
        salesTax: totalTax,
        netTotal: totalNet,
        tenderCash: totalCash,
        returnAmount: totalCashReturn,
        tenderCard: totalCard,
        tenderCreditSale: totalCredit,
        tenderGiftVoucher: totalGiftVoucher,
        tenderCreditVoucher: totalCreditVoucher,
        tenderExchangeVoucher: totalExchangeVoucher,
        tenderClaimVoucher: totalClaimVoucher,
        tenderCorporateVoucher: totalCorporateVoucher,
        creditVoucherIssued: totalCreditIssued,
        tenderRewardVoucher: totalRewardVoucher,
      });
      summaryRow.font = { bold: true };
      summaryRow.commit();
    }

    sheet.commit();
    await workbook.commit();
  }
}
