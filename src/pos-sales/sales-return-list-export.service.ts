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

export type ReturnSubType = 'EXCHANGE_SR' | 'REFUND_RF' | 'CLAIM_CLM' | 'ALL';

export interface SalesReturnTotals {
  returnCount: number;
  totalItems: number;
  grossAmount: number;
  wostAmount: number;
  discountAmount: number;
  discountWostAmount: number;
  amountAfterDiscount: number;
  taxAmount: number;
  netAmount: number;
  cashRefund: number;
  cardRefund: number;
  voucherIssuedAmount: number;
  exchangeVoucherAmount: number;
  creditVoucherAmount: number;
  claimVoucherAmount: number;
  rewardVoucherAmount: number;
}

export interface SalesReturnCustomerDetails {
  id?: string | null;
  name: string;
  phone?: string | null;
  cnic?: string | null;
  code?: string | null;
  email?: string | null;
  address?: string | null;
}

export interface SalesReturnVoucherDetails {
  id?: string;
  code: string;
  voucherType: string;
  faceValue: number;
  isRedeemed?: boolean;
  description?: string;
}

export interface SalesReturnLineItem {
  id: string;
  returnNumber: string;
  originalOrderNumber?: string;
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

export interface SalesReturnNode {
  id: string;
  returnNumber: string;
  originalOrderNumber: string;
  createdAt: string;
  subType: 'EXCHANGE_SR' | 'REFUND_RF' | 'CLAIM_CLM';
  subTypeLabel: string;
  customerName: string;
  customerPhone: string;
  customerCnic?: string;
  customerCode?: string;
  cashierName: string;
  cashierUserId?: string;
  locationId?: string;
  locationName?: string;
  refundMode: string;
  reason?: string;
  claimStatus?: string;
  voucherCode?: string;
  voucherAmount?: number;
  totals: SalesReturnTotals;
  items: SalesReturnLineItem[];
  customerDetails?: SalesReturnCustomerDetails;
  voucherDetails?: SalesReturnVoucherDetails;
}

export interface SalesReturnLocationNode {
  locationKey: string;
  locationId?: string;
  locationName: string;
  returns: SalesReturnNode[];
  totals: SalesReturnTotals;
}

export interface SalesReturnFlatRecord {
  id: string;
  returnNumber: string;
  originalOrderNumber: string;
  returnDate: string;
  subType: 'EXCHANGE_SR' | 'REFUND_RF' | 'CLAIM_CLM';
  subTypeLabel: string;
  locationName: string;
  locationId?: string;
  cashierName: string;
  customerName: string;
  customerPhone: string;
  customerCnic?: string;
  customerCode?: string;
  refundMode: string;
  returnReason: string;
  claimStatus?: string;
  voucherCode: string;
  voucherAmount: number;
  voucherType?: string;
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
  cashRefund: number;
  cardRefund: number;
  voucherIssuedAmount: number;
}

export interface SalesReturnListReportResult {
  reportType: 'merged' | 'separate';
  locations?: SalesReturnLocationNode[];
  returns: SalesReturnNode[];
  flatItems?: SalesReturnFlatRecord[];
  grandTotals: SalesReturnTotals;
  dateRange: { startDate?: string; endDate?: string };
  locationNames: string;
}

export interface QueueSalesReturnListExportOptions {
  userId: string;
  locationId?: string;
  locationIds?: string[];
  startDate?: string;
  endDate?: string;
  cashierUserId?: string;
  format: 'xlsx' | 'pdf';
  search?: string;
  subType?: ReturnSubType;
  refundMode?: string;
  exportType?: 'flat' | 'hierarchical';
}

@Injectable()
export class SalesReturnListExportService {
  private readonly logger = new Logger(SalesReturnListExportService.name);
  private readonly previewStorageDir = path.join(
    process.cwd(),
    'uploads',
    'report-previews',
  );

  constructor(
    @InjectQueue('sales-return-list-export')
    private readonly exportQueue: Queue,
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
    subType?: ReturnSubType;
    refundMode?: string;
    fiscalYear?: string;
    year?: number | string;
  }): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

    // Clean up previous obsolete preview jobs of the same user
    if (opts.userId) {
      try {
        const [waitingJobs, activeJobs] = await Promise.all([
          this.exportQueue.getWaiting(),
          this.exportQueue.getActive(),
        ]);

        for (const wJob of waitingJobs) {
          if (
            wJob.data?.userId === opts.userId &&
            wJob.name === 'generate-sales-return-list-preview'
          ) {
            if (wJob.data?.jobId) {
              await this.previewCleanupService.deletePreviewByJobId(
                wJob.data.jobId,
              );
            }
            await wJob.remove();
          }
        }
        for (const aJob of activeJobs) {
          if (
            aJob.data?.userId === opts.userId &&
            aJob.name === 'generate-sales-return-list-preview'
          ) {
            this.cancelledPreviewJobIds.add(aJob.data?.jobId);
            if (aJob.data?.jobId) {
              await this.previewCleanupService.deletePreviewByJobId(
                aJob.data.jobId,
              );
            }
          }
        }
      } catch (err: any) {
        this.logger.warn(
          `Failed cleaning up obsolete preview jobs: ${err.message}`,
        );
      }
    }

    await this.exportQueue.add(
      'generate-sales-return-list-preview',
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
        subType: opts.subType || 'ALL',
        refundMode: opts.refundMode,
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

    this.logger.log(
      `[SalesReturnList] Queued preview job ${jobId} for user ${opts.userId}`,
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
    const job =
      (await this.exportQueue.getJob(`preview-${jobId}`)) ||
      (await this.exportQueue.getJob(jobId));
    if (!job) {
      return {
        status: 'unknown',
        state: 'unknown',
        progress: 0,
        message: '',
        queuePosition: 0,
        waitingCount: 0,
      };
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
      const idx = allJobs.findIndex(
        (j) =>
          j.id?.toString() === `preview-${jobId}` || j.id?.toString() === jobId,
      );
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
    const jsonPath = path.join(
      this.previewStorageDir,
      `sales-return-list-preview-${jobId}.json.gz`,
    );
    if (fs.existsSync(jsonPath)) return jsonPath;
    const ndjsonPath = path.join(
      this.previewStorageDir,
      `sales-return-list-preview-${jobId}.ndjson.gz`,
    );
    if (fs.existsSync(ndjsonPath)) return ndjsonPath;
    return jsonPath;
  }

  getPreviewNdjsonFilePath(jobId: string): string {
    return path.join(
      this.previewStorageDir,
      `sales-return-list-preview-${jobId}.ndjson.gz`,
    );
  }

  async saveReportPreviewResult(
    jobId: string,
    result: SalesReturnListReportResult,
  ): Promise<void> {
    const jsonPath = path.join(
      this.previewStorageDir,
      `sales-return-list-preview-${jobId}.json.gz`,
    );
    const jsonStr = JSON.stringify(result);
    const compressed = await gzipAsync(Buffer.from(jsonStr, 'utf8'));
    await fs.promises.writeFile(jsonPath, compressed);
  }

  async getReportPreviewResult(
    jobId: string,
  ): Promise<SalesReturnListReportResult | null> {
    const jsonPath = path.join(
      this.previewStorageDir,
      `sales-return-list-preview-${jobId}.json.gz`,
    );
    if (fs.existsSync(jsonPath)) {
      const compressed = await fs.promises.readFile(jsonPath);
      const decompressed = await gunzipAsync(compressed);
      const parsed = JSON.parse(decompressed.toString('utf8'));
      return parsed.data || parsed;
    }

    const ndjsonPath = path.join(
      this.previewStorageDir,
      `sales-return-list-preview-${jobId}.ndjson.gz`,
    );
    if (!fs.existsSync(ndjsonPath)) {
      return null;
    }

    // Fast stream reader for ndjson.gz
    return new Promise<SalesReturnListReportResult | null>((resolve) => {
      const gz = fs.createReadStream(ndjsonPath);
      const gunzip = zlib.createGunzip();
      const rl = readline.createInterface({ input: gz.pipe(gunzip) });

      let meta: any = {};
      const allReturns: any[] = [];
      let grandTotals: any = {};
      const PREVIEW_LIMIT = 5000;

      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          if (line.includes('"type":"meta"')) {
            meta = JSON.parse(line);
          } else if (line.includes('"type":"totals"')) {
            grandTotals = JSON.parse(line).grandTotals || {};
          } else if (line.includes('"type":"returns"')) {
            if (allReturns.length < PREVIEW_LIMIT) {
              const obj = JSON.parse(line);
              if (Array.isArray(obj.returns)) {
                const remaining = PREVIEW_LIMIT - allReturns.length;
                allReturns.push(...obj.returns.slice(0, remaining));
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
          returns: allReturns,
          flatItems: [],
        });
      });

      gz.on('error', () => resolve(null));
      gunzip.on('error', () => resolve(null));
    });
  }

  async generateSalesReturnListReportDataInternal(
    prisma: PrismaService,
    opts: {
      locationId?: string;
      locationIds?: string[];
      startDate?: string;
      endDate?: string;
      cashierUserId?: string;
      reportType?: 'merged' | 'separate';
      search?: string;
      subType?: ReturnSubType;
      refundMode?: string;
      exportType?: 'flat' | 'hierarchical';
      fiscalYear?: string;
      year?: number | string;
      previewJobId?: string;
      isAborted?: () => boolean;
      onProgress?: (percent: number, message: string) => Promise<void>;
    },
  ): Promise<SalesReturnListReportResult> {
    const { onProgress } = opts;
    await onProgress?.(10, 'Loading store & cashier metadata...');

    const [allLocations, cashiersList] = await Promise.all([
      prisma.location.findMany({
        select: { id: true, name: true, code: true },
      }),
      this.prismaMaster.user.findMany({
        select: { id: true, firstName: true, lastName: true },
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

    let locationNames = 'All Outlets (Stores)';
    if (opts.locationIds && opts.locationIds.length > 0) {
      locationNames = opts.locationIds
        .map((id) => locationMap.get(id) || id)
        .join(', ');
    } else if (opts.locationId) {
      locationNames = locationMap.get(opts.locationId) || 'Store';
    }

    let startDate: Date;
    let endDate: Date;

    if (opts.startDate && opts.endDate) {
      startDate = new Date(opts.startDate);
      endDate = new Date(opts.endDate);
      if (isNaN(startDate.getTime())) startDate = new Date(2026, 6, 1);
      if (isNaN(endDate.getTime()))
        endDate = new Date(2027, 5, 30, 23, 59, 59, 999);
    } else if (
      opts.fiscalYear === '2026-2027' ||
      opts.fiscalYear === '26-27' ||
      opts.fiscalYear === 'fy-26-27' ||
      opts.fiscalYear === 'current' ||
      opts.fiscalYear === 'fy-current'
    ) {
      startDate = new Date(2026, 6, 1);
      endDate = new Date(2027, 5, 30, 23, 59, 59, 999);
    } else if (
      opts.fiscalYear === '2025-2026' ||
      opts.fiscalYear === '25-26' ||
      opts.fiscalYear === 'fy-25-26' ||
      opts.fiscalYear === 'previous' ||
      opts.fiscalYear === 'fy-previous'
    ) {
      startDate = new Date(2025, 6, 1);
      endDate = new Date(2026, 5, 30, 23, 59, 59, 999);
    } else if (
      opts.fiscalYear === '2024-2025' ||
      opts.fiscalYear === '24-25' ||
      opts.fiscalYear === 'fy-24-25'
    ) {
      startDate = new Date(2024, 6, 1);
      endDate = new Date(2025, 5, 30, 23, 59, 59, 999);
    } else if (opts.fiscalYear === 'all-time') {
      startDate = new Date(2020, 0, 1);
      endDate = new Date(2035, 11, 31, 23, 59, 59, 999);
    } else if (opts.year) {
      const y =
        typeof opts.year === 'string' ? parseInt(opts.year, 10) : opts.year;
      startDate = new Date(y, 0, 1);
      endDate = new Date(y, 11, 31, 23, 59, 59, 999);
    } else {
      startDate = opts.startDate
        ? new Date(opts.startDate)
        : new Date(2026, 6, 1);
      endDate = opts.endDate
        ? new Date(opts.endDate)
        : new Date(2027, 5, 30, 23, 59, 59, 999);
      endDate.setHours(23, 59, 59, 999);
    }

    await onProgress?.(
      20,
      'Querying return, exchange, and claim records from database...',
    );

    // 1. Fetch PosReturn records
    const posReturnWhere: any = {
      createdAt: { gte: startDate, lte: endDate },
    };
    if (opts.locationIds && opts.locationIds.length > 0) {
      posReturnWhere.locationId = { in: opts.locationIds };
    } else if (opts.locationId) {
      posReturnWhere.locationId = opts.locationId;
    }
    if (opts.cashierUserId) {
      posReturnWhere.cashierUserId = opts.cashierUserId;
    }

    const posReturns = await prisma.posReturn.findMany({
      where: posReturnWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        salesOrder: {
          select: {
            id: true,
            orderNumber: true,
            createdAt: true,
            notes: true,
            paymentMethod: true,
            fbrInvoiceNumber: true,
          },
        },
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
        originalCustomer: {
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
                size: { select: { name: true } },
                color: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    // 2. Fetch PosClaim records in range
    const claimWhere: any = {
      createdAt: { gte: startDate, lte: endDate },
    };
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
                size: { select: { name: true } },
                color: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    await onProgress?.(50, 'Building sales return register audit matrix...');

    const createEmptyTotals = (): SalesReturnTotals => ({
      returnCount: 0,
      totalItems: 0,
      grossAmount: 0,
      wostAmount: 0,
      discountAmount: 0,
      discountWostAmount: 0,
      amountAfterDiscount: 0,
      taxAmount: 0,
      netAmount: 0,
      cashRefund: 0,
      cardRefund: 0,
      voucherIssuedAmount: 0,
      exchangeVoucherAmount: 0,
      creditVoucherAmount: 0,
      claimVoucherAmount: 0,
      rewardVoucherAmount: 0,
    });

    const addTotals = (target: SalesReturnTotals, src: SalesReturnTotals) => {
      target.returnCount += src.returnCount;
      target.totalItems += src.totalItems;
      target.grossAmount = Number(
        (target.grossAmount + src.grossAmount).toFixed(2),
      );
      target.wostAmount = Number(
        (target.wostAmount + src.wostAmount).toFixed(2),
      );
      target.discountAmount = Number(
        (target.discountAmount + src.discountAmount).toFixed(2),
      );
      target.discountWostAmount = Number(
        (target.discountWostAmount + src.discountWostAmount).toFixed(2),
      );
      target.amountAfterDiscount = Number(
        (target.amountAfterDiscount + src.amountAfterDiscount).toFixed(2),
      );
      target.taxAmount = Number((target.taxAmount + src.taxAmount).toFixed(2));
      target.netAmount = Number((target.netAmount + src.netAmount).toFixed(2));
      target.cashRefund = Number(
        (target.cashRefund + src.cashRefund).toFixed(2),
      );
      target.cardRefund = Number(
        (target.cardRefund + src.cardRefund).toFixed(2),
      );
      target.voucherIssuedAmount = Number(
        (target.voucherIssuedAmount + src.voucherIssuedAmount).toFixed(2),
      );
      target.exchangeVoucherAmount = Number(
        (target.exchangeVoucherAmount + src.exchangeVoucherAmount).toFixed(2),
      );
      target.creditVoucherAmount = Number(
        (target.creditVoucherAmount + src.creditVoucherAmount).toFixed(2),
      );
      target.claimVoucherAmount = Number(
        (target.claimVoucherAmount + src.claimVoucherAmount).toFixed(2),
      );
      target.rewardVoucherAmount = Number(
        (target.rewardVoucherAmount + src.rewardVoucherAmount).toFixed(2),
      );
    };

    const grandTotals = createEmptyTotals();
    const locationNodesMap = new Map<string, SalesReturnLocationNode>();
    const returnNodesList: SalesReturnNode[] = [];

    // Helper: Determine Sub Type
    const classifySubType = (
      returnType: string,
      refundMode: string,
      voucherType?: string,
      notes?: string,
      claimId?: string,
    ): {
      subType: 'EXCHANGE_SR' | 'REFUND_RF' | 'CLAIM_CLM';
      label: string;
    } => {
      if (
        claimId ||
        voucherType === 'CLAIM' ||
        (notes && /claim|defect|_clm/i.test(notes))
      ) {
        return { subType: 'CLAIM_CLM', label: 'Claim (_CLM)' };
      }
      if (
        returnType === 'REFUND' ||
        refundMode === 'CASH' ||
        voucherType === 'REFUND' ||
        voucherType === 'CREDIT' ||
        (notes && /refund|_rf/i.test(notes))
      ) {
        return { subType: 'REFUND_RF', label: 'Refund (RF)' };
      }
      return { subType: 'EXCHANGE_SR', label: 'Exchange (_SR)' };
    };

    // Transform PosReturns
    for (const pr of posReturns) {
      const cust =
        pr.customer || pr.originalCustomer || (pr.salesOrder as any)?.customer;
      const voucher = pr.voucher;
      const notes = pr.reason || (pr.salesOrder as any)?.notes || '';
      const { subType, label: subTypeLabel } = classifySubType(
        pr.returnType,
        pr.refundMode,
        voucher?.voucherType,
        notes,
      );

      const itemsList: SalesReturnLineItem[] = [];
      let retTotalQty = 0;
      let retGross = 0;
      let retWost = 0;
      let retDisc = 0;
      let retDiscWost = 0;
      let retTax = 0;
      let retNet = 0;

      for (const it of pr.items || []) {
        const qty = it.quantity || 1;
        const unitPrice = Number(
          it.originalUnitPrice ||
            it.refundPerUnit ||
            it.originalPaidPerUnit ||
            0,
        );
        const unitPriceWost = Number(
          (it.unitPriceWost
            ? Number(it.unitPriceWost)
            : unitPrice / 1.18
          ).toFixed(2),
        );
        const valExcl = Number(
          (it.lineTotalWost
            ? Number(it.lineTotalWost)
            : qty * unitPriceWost
          ).toFixed(2),
        );
        const disc = Number(
          it.discountPercent
            ? (unitPrice * qty * Number(it.discountPercent)) / 100
            : 0,
        );
        const discWost = Number(
          (it.discountWost ? Number(it.discountWost) : disc / 1.18).toFixed(2),
        );
        const amtAfterDisc = Number(Math.max(0, valExcl - discWost).toFixed(2));
        const tax = Number(it.taxAmount || 0);
        const lineTotal = Number(it.lineTotal || unitPrice * qty - disc + tax);

        retTotalQty += qty;
        retGross += unitPrice * qty;
        retWost += valExcl;
        retDisc += disc;
        retDiscWost += discWost;
        retTax += tax;
        retNet += lineTotal;

        itemsList.push({
          id: it.id,
          returnNumber: pr.returnNumber,
          originalOrderNumber: pr.salesOrder?.orderNumber || '-',
          sku: it.item?.sku || it.item?.barCode || 'NO-SKU',
          barCode: it.item?.barCode || it.item?.sku || '-',
          description: it.item?.description || 'Return Article',
          sizeName: it.item?.size?.name || '-',
          colorName: it.item?.color?.name || '-',
          quantity: qty,
          unitPrice,
          priceWost: unitPriceWost,
          valueExcl: valExcl,
          discountPercent: Number(it.discountPercent || 0),
          discountAmount: disc,
          discountAmountWost: discWost,
          amountAfterDiscount: amtAfterDisc,
          taxPercent: Number(it.taxPercent || 0),
          taxAmount: tax,
          lineTotal,
          returnReason: it.reason || pr.reason || '-',
        });
      }

      if (itemsList.length === 0) {
        const totalRefAmt = Number(pr.totalRefundAmount || 0);
        const wostAmt = Number(pr.subtotalWost || totalRefAmt / 1.18);
        retTotalQty = 1;
        retGross = totalRefAmt;
        retWost = wostAmt;
        retNet = totalRefAmt;

        itemsList.push({
          id: pr.id,
          returnNumber: pr.returnNumber,
          originalOrderNumber: pr.salesOrder?.orderNumber || '-',
          sku: '-',
          barCode: '-',
          description: 'Return Summary Record',
          sizeName: '-',
          colorName: '-',
          quantity: 1,
          unitPrice: totalRefAmt,
          priceWost: Number((totalRefAmt / 1.18).toFixed(2)),
          valueExcl: wostAmt,
          discountPercent: 0,
          discountAmount: 0,
          discountAmountWost: 0,
          amountAfterDiscount: wostAmt,
          taxPercent: 0,
          taxAmount: Number(pr.taxAmount || 0),
          lineTotal: totalRefAmt,
          returnReason: pr.reason || '-',
        });
      }

      const totalRefundAmt = Number(pr.totalRefundAmount || retNet);
      const cashRefund = pr.refundMode === 'CASH' ? totalRefundAmt : 0;
      const voucherIssuedAmt =
        pr.refundMode === 'VOUCHER' || voucher
          ? Number(voucher?.faceValue || totalRefundAmt)
          : 0;

      const nodeTotals: SalesReturnTotals = {
        returnCount: 1,
        totalItems: retTotalQty,
        grossAmount: retGross,
        wostAmount: retWost,
        discountAmount: retDisc,
        discountWostAmount: retDiscWost,
        amountAfterDiscount: Number(
          Math.max(0, retWost - retDiscWost).toFixed(2),
        ),
        taxAmount: retTax,
        netAmount: totalRefundAmt,
        cashRefund,
        cardRefund: 0,
        voucherIssuedAmount: voucherIssuedAmt,
        exchangeVoucherAmount: subType === 'EXCHANGE_SR' ? voucherIssuedAmt : 0,
        creditVoucherAmount: subType === 'REFUND_RF' ? voucherIssuedAmt : 0,
        claimVoucherAmount: subType === 'CLAIM_CLM' ? voucherIssuedAmt : 0,
        rewardVoucherAmount: 0,
      };

      addTotals(grandTotals, nodeTotals);

      const locName = pr.locationId
        ? locationMap.get(pr.locationId) || 'Main Outlet'
        : 'Main Outlet';
      const cashierName = pr.cashierUserId
        ? cashierMap.get(pr.cashierUserId) || 'Cashier'
        : 'Cashier';

      const returnNode: SalesReturnNode = {
        id: pr.id,
        returnNumber: pr.returnNumber,
        originalOrderNumber: pr.salesOrder?.orderNumber || '-',
        createdAt: pr.createdAt.toISOString(),
        subType,
        subTypeLabel,
        customerName: cust?.name || 'Walk-in Customer',
        customerPhone: cust?.contactNo || '-',
        customerCnic: cust?.cnicNo || '-',
        customerCode: cust?.subCode || cust?.traderId || '-',
        cashierName,
        cashierUserId: pr.cashierUserId || undefined,
        locationId: pr.locationId || undefined,
        locationName: locName,
        refundMode: pr.refundMode,
        reason: pr.reason || '-',
        voucherCode: voucher?.code,
        voucherAmount: voucher ? Number(voucher.faceValue) : undefined,
        totals: nodeTotals,
        items: itemsList,
        customerDetails: cust
          ? {
              name: cust.name,
              phone: cust.contactNo,
              cnic: cust.cnicNo,
              code: cust.subCode || cust.traderId,
              address: cust.address,
              email: cust.email,
            }
          : undefined,
        voucherDetails: voucher
          ? {
              id: voucher.id,
              code: voucher.code,
              voucherType: voucher.voucherType,
              faceValue: Number(voucher.faceValue),
              isRedeemed: voucher.isRedeemed,
              description: voucher.description || undefined,
            }
          : undefined,
      };

      returnNodesList.push(returnNode);

      const locKey = pr.locationId ? `loc:${pr.locationId}` : 'main-outlet';
      let locNode = locationNodesMap.get(locKey);
      if (!locNode) {
        locNode = {
          locationKey: locKey,
          locationId: pr.locationId || undefined,
          locationName: locName,
          returns: [],
          totals: createEmptyTotals(),
        };
        locationNodesMap.set(locKey, locNode);
      }
      locNode.returns.push(returnNode);
      addTotals(locNode.totals, nodeTotals);
    }

    // Transform Standalone PosClaims
    for (const clm of claims) {
      // Check if this claim was already linked to an existing return node
      if (returnNodesList.some((r) => r.returnNumber === clm.claimNumber))
        continue;

      const cust = clm.salesOrder?.customer;
      const voucher = clm.voucher;
      const approvedAmt = Number(clm.approvedAmount || clm.claimedAmount || 0);

      const itemsList: SalesReturnLineItem[] = [];
      let claimQty = 0;

      for (const it of clm.items || []) {
        const qty = it.claimedQty || 1;
        const unitPrice = Number(it.unitPaidPrice || 0);
        const unitPriceWost = Number((unitPrice / 1.18).toFixed(2));
        const valExcl = Number((qty * unitPriceWost).toFixed(2));
        const lineTotal = Number(it.claimedAmount || qty * unitPrice);

        claimQty += qty;
        itemsList.push({
          id: it.id,
          returnNumber: clm.claimNumber,
          originalOrderNumber: clm.salesOrder?.orderNumber || '-',
          sku: it.item?.sku || it.item?.barCode || 'NO-SKU',
          barCode: it.item?.barCode || it.item?.sku || '-',
          description: it.item?.description || 'Claim Article',
          sizeName: it.item?.size?.name || '-',
          colorName: it.item?.color?.name || '-',
          quantity: qty,
          unitPrice,
          priceWost: unitPriceWost,
          valueExcl: valExcl,
          discountPercent: 0,
          discountAmount: 0,
          discountAmountWost: 0,
          amountAfterDiscount: valExcl,
          taxPercent: 0,
          taxAmount: 0,
          lineTotal,
          returnReason: it.reviewNotes || clm.reasonNotes || '-',
        });
      }

      if (itemsList.length === 0) {
        itemsList.push({
          id: clm.id,
          returnNumber: clm.claimNumber,
          originalOrderNumber: clm.salesOrder?.orderNumber || '-',
          sku: '-',
          barCode: '-',
          description: 'Claim Record',
          sizeName: '-',
          colorName: '-',
          quantity: 1,
          unitPrice: approvedAmt,
          priceWost: Number((approvedAmt / 1.18).toFixed(2)),
          valueExcl: Number((approvedAmt / 1.18).toFixed(2)),
          discountPercent: 0,
          discountAmount: 0,
          discountAmountWost: 0,
          amountAfterDiscount: Number((approvedAmt / 1.18).toFixed(2)),
          taxPercent: 0,
          taxAmount: 0,
          lineTotal: approvedAmt,
          returnReason: clm.reasonNotes || '-',
        });
        claimQty = 1;
      }

      const valExcl = Number((approvedAmt / 1.18).toFixed(2));
      const voucherIssuedAmt = voucher
        ? Number(voucher.faceValue)
        : approvedAmt;

      const nodeTotals: SalesReturnTotals = {
        returnCount: 1,
        totalItems: claimQty,
        grossAmount: approvedAmt,
        wostAmount: valExcl,
        discountAmount: 0,
        discountWostAmount: 0,
        amountAfterDiscount: valExcl,
        taxAmount: 0,
        netAmount: approvedAmt,
        cashRefund: 0,
        cardRefund: 0,
        voucherIssuedAmount: voucherIssuedAmt,
        exchangeVoucherAmount: 0,
        creditVoucherAmount: 0,
        claimVoucherAmount: voucherIssuedAmt,
        rewardVoucherAmount: 0,
      };

      addTotals(grandTotals, nodeTotals);

      const locId = clm.salesOrder?.locationId;
      const locName = locId
        ? locationMap.get(locId) || 'Main Outlet'
        : 'Main Outlet';
      const cashierName = clm.salesOrder?.cashierUserId
        ? cashierMap.get(clm.salesOrder.cashierUserId) || 'Cashier'
        : 'Cashier';

      const returnNode: SalesReturnNode = {
        id: clm.id,
        returnNumber: clm.claimNumber,
        originalOrderNumber: clm.salesOrder?.orderNumber || '-',
        createdAt: clm.createdAt.toISOString(),
        subType: 'CLAIM_CLM',
        subTypeLabel: 'Claim (_CLM)',
        customerName: cust?.name || 'Customer Registered',
        customerPhone: cust?.contactNo || '-',
        customerCnic: cust?.cnicNo || '-',
        customerCode: cust?.subCode || cust?.traderId || '-',
        cashierName,
        cashierUserId: clm.salesOrder?.cashierUserId || undefined,
        locationId: locId || undefined,
        locationName: locName,
        refundMode: 'VOUCHER',
        reason: clm.reasonNotes || '-',
        claimStatus: clm.status,
        voucherCode: voucher?.code,
        voucherAmount: voucher ? Number(voucher.faceValue) : undefined,
        totals: nodeTotals,
        items: itemsList,
        customerDetails: cust
          ? {
              name: cust.name,
              phone: cust.contactNo,
              cnic: cust.cnicNo,
              code: cust.subCode || cust.traderId,
              address: cust.address,
              email: cust.email,
            }
          : undefined,
        voucherDetails: voucher
          ? {
              id: voucher.id,
              code: voucher.code,
              voucherType: voucher.voucherType,
              faceValue: Number(voucher.faceValue),
              isRedeemed: voucher.isRedeemed,
              description: voucher.description || undefined,
            }
          : undefined,
      };

      returnNodesList.push(returnNode);

      const locKey = locId ? `loc:${locId}` : 'main-outlet';
      let locNode = locationNodesMap.get(locKey);
      if (!locNode) {
        locNode = {
          locationKey: locKey,
          locationId: locId || undefined,
          locationName: locName,
          returns: [],
          totals: createEmptyTotals(),
        };
        locationNodesMap.set(locKey, locNode);
      }
      locNode.returns.push(returnNode);
      addTotals(locNode.totals, nodeTotals);
    }

    // Direct Disk Streaming if previewJobId is present
    if (opts.previewJobId) {
      const ndjsonPath = this.getPreviewNdjsonFilePath(opts.previewJobId);
      const gzipStream = zlib.createGzip({ level: 6 });
      const writeStream = fs.createWriteStream(ndjsonPath);

      const streamPromise = new Promise<void>((resolve, reject) => {
        pipeline(gzipStream, writeStream, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const metaLine =
        JSON.stringify({
          type: 'meta',
          reportType: opts.reportType || 'merged',
          dateRange: {
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
          },
          locationNames,
          locations: allLocations,
          totalReturns: returnNodesList.length,
        }) + '\n';
      gzipStream.write(metaLine);

      const SUB_CHUNK = 250;
      for (let i = 0; i < returnNodesList.length; i += SUB_CHUNK) {
        const batch = returnNodesList.slice(i, i + SUB_CHUNK);
        const chunkLine =
          JSON.stringify({
            type: 'returns',
            startIndex: i,
            count: batch.length,
            returns: batch,
          }) + '\n';
        gzipStream.write(chunkLine);
      }

      const totalsLine =
        JSON.stringify({
          type: 'totals',
          grandTotals,
          totalReturns: returnNodesList.length,
          done: true,
        }) + '\n';
      gzipStream.write(totalsLine);

      gzipStream.end();
      await streamPromise;
    }

    await onProgress?.(100, 'Sales return report computation complete!');

    return {
      reportType: opts.reportType || 'merged',
      locations: Array.from(locationNodesMap.values()),
      returns: returnNodesList,
      flatItems: [],
      grandTotals,
      dateRange: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
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
        fileSize: fileBuffer.length,
        moduleName: 'SALES_RETURN_LIST_EXPORT',
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

  async queueExport(
    opts: QueueSalesReturnListExportOptions,
  ): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

    await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName: `sales-return-list-report-${jobId}.${opts.format}`,
        filePath: `uploads/exports/export-${jobId}.${opts.format}`,
        moduleName: 'SALES_RETURN_LIST_EXPORT',
        status: 'PENDING',
      },
    });

    await this.exportQueue.add(
      'generate-sales-return-list-export',
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
        subType: opts.subType,
        refundMode: opts.refundMode,
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

    this.logger.log(
      `[SalesReturnListExport] Queued job ${jobId} for user ${opts.userId} (format: ${opts.format})`,
    );
    return { jobId };
  }

  async getJobStatus(
    jobId: string,
  ): Promise<{ state: string; progress: number; message?: string }> {
    const job = await this.exportQueue.getJob(jobId);
    if (!job) throw new NotFoundException(`Export job ${jobId} not found`);
    const state = await job.getState();
    const rawProg: any = job.progress();
    const progress =
      typeof rawProg === 'number'
        ? rawProg
        : typeof rawProg === 'object' && rawProg?.percent !== undefined
          ? Number(rawProg.percent)
          : 0;
    const message =
      typeof rawProg === 'object' && rawProg?.message
        ? String(rawProg.message)
        : undefined;
    return { state, progress, message };
  }

  async streamExportFile(jobId: string, res: any): Promise<void> {
    const record = await this.prisma.exportHistory.findUnique({
      where: { id: jobId },
      select: { fileName: true, filePath: true },
    });

    if (!record) {
      throw new NotFoundException(
        `Export record ${jobId} not found in database`,
      );
    }

    try {
      await this.prisma.exportHistory.update({
        where: { id: jobId },
        data: {
          downloadCount: { increment: 1 },
        },
      });
    } catch (err: any) {
      this.logger.warn(
        `Could not update export history download count for job ${jobId}: ${err.message}`,
      );
    }

    if (record.filePath.startsWith('s3://')) {
      const s3Key = record.filePath.replace('s3://', '');
      const signedUrl = await this.uploadService.getSignedUrlForDownload(
        s3Key,
        record.fileName,
      );
      return res.redirect(signedUrl, 302);
    }

    if (
      record.filePath.startsWith('http://') ||
      record.filePath.startsWith('https://')
    ) {
      return res.redirect(record.filePath, 302);
    }

    const filePath = path.join(process.cwd(), record.filePath);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(
        'Export file not found. It may have expired or the job is still running.',
      );
    }

    const stat = fs.statSync(filePath);
    const stream = fs.createReadStream(filePath);
    const isPdf = record.fileName.endsWith('.pdf');
    res.header(
      'Content-Type',
      isPdf
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.header(
      'Content-Disposition',
      `attachment; filename="${record.fileName}"`,
    );
    res.header('Content-Length', stat.size);
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(stream);
  }

  async streamFilteredPreviewExcel(
    jobId: string,
    options: {
      exportType?: 'flat' | 'hierarchical';
      search?: string;
      subType?: ReturnSubType;
      refundMode?: string;
      locationId?: string;
      cashierId?: string;
    },
    res: any,
  ): Promise<void> {
    const ndjsonPath = this.getPreviewNdjsonFilePath(jobId);
    const jsonPath = path.join(
      this.previewStorageDir,
      `sales-return-list-preview-${jobId}.json.gz`,
    );

    let targetFilePath = '';
    if (fs.existsSync(ndjsonPath)) {
      targetFilePath = ndjsonPath;
    } else if (fs.existsSync(jsonPath)) {
      targetFilePath = jsonPath;
    } else {
      throw new NotFoundException(
        'Sales return list preview result not found or expired',
      );
    }

    const exportType = options.exportType || 'flat';
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `sales-return-list-${exportType}-${dateStr}.xlsx`;

    const passThrough = new PassThrough();
    if (typeof res.header === 'function') {
      res.header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.header('Content-Disposition', `attachment; filename="${fileName}"`);
      res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (typeof res.setHeader === 'function') {
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${fileName}"`,
      );
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

    const sheet = workbook.addWorksheet(
      exportType === 'flat' ? 'Flat Return Items' : 'Sales Returns',
    );

    if (exportType === 'flat') {
      sheet.columns = [
        { header: 'Outlet / Location', key: 'locationName', width: 22 },
        { header: 'Return #', key: 'returnNumber', width: 18 },
        { header: 'Original Invoice #', key: 'originalOrderNumber', width: 18 },
        { header: 'Sub Type', key: 'subTypeLabel', width: 16 },
        { header: 'Return Date', key: 'returnDate', width: 20 },
        { header: 'Cashier', key: 'cashierName', width: 16 },
        { header: 'Customer', key: 'customerName', width: 18 },
        { header: 'Phone', key: 'customerPhone', width: 14 },
        { header: 'CNIC', key: 'customerCnic', width: 16 },
        { header: 'Customer Code', key: 'customerCode', width: 14 },
        { header: 'Refund Mode', key: 'refundMode', width: 14 },
        { header: 'Return Reason', key: 'returnReason', width: 24 },
        { header: 'Voucher Issued Code', key: 'voucherCode', width: 20 },
        { header: 'Voucher Issued Amount', key: 'voucherAmount', width: 20 },
        { header: 'SKU', key: 'sku', width: 16 },
        { header: 'Barcode', key: 'barCode', width: 16 },
        { header: 'Description', key: 'description', width: 26 },
        { header: 'Size', key: 'sizeName', width: 10 },
        { header: 'Color', key: 'colorName', width: 12 },
        { header: 'Return Quantity', key: 'quantity', width: 12 },
        { header: 'Unit Price', key: 'unitPrice', width: 12 },
        { header: 'Unit Price WOST', key: 'priceWost', width: 14 },
        { header: 'Value Excl.', key: 'valueExcl', width: 14 },
        { header: 'Discount %', key: 'discountPercent', width: 11 },
        { header: 'Discount', key: 'discountAmount', width: 12 },
        { header: 'Discount WOST', key: 'discountAmountWost', width: 13 },
        {
          header: 'Amount After Discount',
          key: 'amountAfterDiscount',
          width: 18,
        },
        { header: 'Sales Tax', key: 'taxAmount', width: 12 },
        { header: 'Value Incl. (Net Return)', key: 'lineTotal', width: 18 },
        { header: 'Cash Refund', key: 'cashRefund', width: 14 },
        { header: 'Card Refund', key: 'cardRefund', width: 14 },
      ];
    } else {
      sheet.columns = [
        { header: 'Return #', key: 'returnNumber', width: 18 },
        { header: 'Original Invoice #', key: 'originalOrderNumber', width: 18 },
        { header: 'Sub Type', key: 'subTypeLabel', width: 16 },
        { header: 'Return Date', key: 'date', width: 20 },
        { header: 'Location', key: 'location', width: 18 },
        { header: 'Cashier', key: 'cashier', width: 16 },
        { header: 'Customer', key: 'customer', width: 18 },
        { header: 'Phone', key: 'phone', width: 14 },
        { header: 'CNIC', key: 'cnic', width: 16 },
        { header: 'Customer Code', key: 'customerCode', width: 14 },
        { header: 'Refund Mode', key: 'refundMode', width: 14 },
        { header: 'Return Reason', key: 'reason', width: 24 },
        { header: 'Voucher Issued Code', key: 'voucherCode', width: 20 },
        { header: 'Voucher Issued Amount', key: 'voucherAmount', width: 20 },
        { header: 'Return Quantity', key: 'quantity', width: 12 },
        { header: 'Unit Price WOST (Avg)', key: 'unitPriceWost', width: 18 },
        { header: 'Value Excl.', key: 'valueExcl', width: 14 },
        { header: 'Discount Total', key: 'discountTotal', width: 14 },
        { header: 'Discount WOST', key: 'discountWost', width: 14 },
        {
          header: 'Amount After Discount',
          key: 'amountAfterDiscount',
          width: 18,
        },
        { header: 'Sales Tax', key: 'salesTax', width: 12 },
        { header: 'Value Incl. (Net Return)', key: 'netTotal', width: 18 },
        { header: 'Cash Refund', key: 'cashRefund', width: 14 },
        {
          header: 'Exchange Voucher Issued',
          key: 'exchangeVoucher',
          width: 18,
        },
        { header: 'Credit Voucher Issued', key: 'creditVoucher', width: 18 },
        { header: 'Claim Voucher Issued', key: 'claimVoucher', width: 18 },
      ];
    }

    const q = (options.search || '').trim().toLowerCase();
    const targetSubType =
      options.subType && options.subType !== 'ALL' ? options.subType : null;
    const targetRefundMode =
      options.refundMode && options.refundMode !== 'all'
        ? options.refundMode.toUpperCase()
        : null;
    const locSet =
      options.locationId && options.locationId !== 'all'
        ? new Set(
            options.locationId.split(',').map((s) => s.trim().toLowerCase()),
          )
        : null;
    const cashierFilter =
      options.cashierId && options.cashierId !== 'all'
        ? options.cashierId.trim().toLowerCase()
        : null;

    let totalQty = 0;
    let totalValExcl = 0;
    let totalDiscount = 0;
    let totalDiscWost = 0;
    let totalAmtAfterDisc = 0;
    let totalTax = 0;
    let totalNet = 0;
    let totalCashRefund = 0;
    let totalVoucherIssued = 0;

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
        let returnsToProcess: any[] = [];

        if (parsed.type === 'returns' && Array.isArray(parsed.returns)) {
          returnsToProcess = parsed.returns;
        } else if (Array.isArray(parsed.returns)) {
          returnsToProcess = parsed.returns;
        } else if (parsed.data && Array.isArray(parsed.data.returns)) {
          returnsToProcess = parsed.data.returns;
        } else if (parsed.returnNumber) {
          returnsToProcess = [parsed];
        }

        for (const ret of returnsToProcess) {
          if (!ret) continue;

          // Subtype filter
          if (targetSubType && ret.subType !== targetSubType) continue;
          // Refund mode filter
          if (
            targetRefundMode &&
            (ret.refundMode || '').toUpperCase() !== targetRefundMode
          )
            continue;
          // Location filter
          if (locSet) {
            const locId = (ret.locationId || '').toLowerCase();
            const locName = (ret.locationName || '').toLowerCase();
            if (!locSet.has(locId) && !locSet.has(locName)) continue;
          }
          // Cashier filter
          if (cashierFilter) {
            const cId = (ret.cashierUserId || '').toLowerCase();
            const cName = (ret.cashierName || '').toLowerCase();
            if (cId !== cashierFilter && cName !== cashierFilter) continue;
          }
          // Search query
          if (q) {
            const matchesHeader =
              (ret.returnNumber || '').toLowerCase().includes(q) ||
              (ret.originalOrderNumber || '').toLowerCase().includes(q) ||
              (ret.customerName || '').toLowerCase().includes(q) ||
              (ret.customerPhone || '').toLowerCase().includes(q) ||
              (ret.customerCnic || '').toLowerCase().includes(q) ||
              (ret.cashierName || '').toLowerCase().includes(q) ||
              (ret.voucherCode || '').toLowerCase().includes(q);

            const matchesItems = (ret.items || []).some(
              (it: any) =>
                (it.sku || '').toLowerCase().includes(q) ||
                (it.barCode || '').toLowerCase().includes(q) ||
                (it.description || '').toLowerCase().includes(q),
            );

            if (!matchesHeader && !matchesItems) continue;
          }

          const t = ret.totals || {};

          if (exportType === 'flat') {
            const items =
              ret.items && ret.items.length > 0
                ? ret.items
                : [
                    {
                      sku: '-',
                      barCode: '-',
                      description: 'Return Summary',
                      quantity: t.totalItems || 1,
                      unitPrice: t.grossAmount || 0,
                      discountAmount: t.discountAmount || 0,
                      taxAmount: t.taxAmount || 0,
                      lineTotal: t.netAmount || 0,
                    },
                  ];

            for (const item of items) {
              const qty = Number(item.quantity || 0);
              const unitPrice = Number(item.unitPrice || 0);
              const unitPriceWost =
                item.priceWost !== undefined
                  ? item.priceWost
                  : unitPrice / 1.18;
              const valExcl = Number((qty * unitPriceWost).toFixed(2));
              const disc = Number(item.discountAmount || 0);
              const discWost = Number(
                (item.discountAmountWost !== undefined
                  ? item.discountAmountWost
                  : disc / 1.18
                ).toFixed(2),
              );
              const amtAfterDisc = Number(
                Math.max(0, valExcl - discWost).toFixed(2),
              );
              const tax = Number(item.taxAmount || 0);
              const lineTotal = Number(
                item.lineTotal || unitPrice * qty - disc + tax,
              );

              totalQty += qty;
              totalValExcl += valExcl;
              totalDiscount += disc;
              totalDiscWost += discWost;
              totalAmtAfterDisc += amtAfterDisc;
              totalTax += tax;
              totalNet += lineTotal;
              totalCashRefund += Number(t.cashRefund || 0);
              totalVoucherIssued += Number(t.voucherIssuedAmount || 0);

              const row = sheet.addRow({
                locationName: ret.locationName || '-',
                returnNumber: ret.returnNumber,
                originalOrderNumber: ret.originalOrderNumber || '-',
                subTypeLabel: ret.subTypeLabel || ret.subType,
                returnDate: ret.createdAt
                  ? new Date(ret.createdAt)
                      .toISOString()
                      .replace('T', ' ')
                      .slice(0, 19)
                  : '-',
                cashierName: ret.cashierName || '-',
                customerName: ret.customerName || 'Walk-in',
                customerPhone: ret.customerPhone || '-',
                customerCnic: ret.customerCnic || '-',
                customerCode: ret.customerCode || '-',
                refundMode: ret.refundMode || 'VOUCHER',
                returnReason: item.returnReason || ret.reason || '-',
                voucherCode: ret.voucherCode || '-',
                voucherAmount: ret.voucherAmount || 0,
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
                lineTotal: lineTotal,
                cashRefund: Number(t.cashRefund || 0),
                cardRefund: Number(t.cardRefund || 0),
              });
              row.commit();
            }
          } else {
            const qty = Number(t.totalItems || 0);
            const gross = Number(t.grossAmount || 0);
            const valExcl = Number((gross / 1.18).toFixed(2));
            const unitPriceWost =
              qty > 0 ? Number((valExcl / qty).toFixed(2)) : 0;
            const disc = Number(t.discountAmount || 0);
            const discWost = Number(
              (t.discountWostAmount || disc / 1.18).toFixed(2),
            );
            const amtAfterDisc = Number(
              Math.max(0, valExcl - discWost).toFixed(2),
            );
            const tax = Number(t.taxAmount || 0);
            const net = Number(t.netAmount || 0);

            totalQty += qty;
            totalValExcl += valExcl;
            totalDiscount += disc;
            totalDiscWost += discWost;
            totalAmtAfterDisc += amtAfterDisc;
            totalTax += tax;
            totalNet += net;
            totalCashRefund += Number(t.cashRefund || 0);
            totalVoucherIssued += Number(t.voucherIssuedAmount || 0);

            const row = sheet.addRow({
              returnNumber: ret.returnNumber,
              originalOrderNumber: ret.originalOrderNumber || '-',
              subTypeLabel: ret.subTypeLabel || ret.subType,
              date: ret.createdAt
                ? new Date(ret.createdAt)
                    .toISOString()
                    .replace('T', ' ')
                    .slice(0, 19)
                : '-',
              location: ret.locationName || '-',
              cashier: ret.cashierName || '-',
              customer: ret.customerName || 'Walk-in',
              phone: ret.customerPhone || '-',
              cnic: ret.customerCnic || '-',
              customerCode: ret.customerCode || '-',
              refundMode: ret.refundMode || 'VOUCHER',
              reason: ret.reason || '-',
              voucherCode: ret.voucherCode || '-',
              voucherAmount: ret.voucherAmount || 0,
              quantity: qty,
              unitPriceWost: unitPriceWost,
              valueExcl: valExcl,
              discountTotal: disc,
              discountWost: discWost,
              amountAfterDiscount: amtAfterDisc,
              salesTax: tax,
              netTotal: net,
              cashRefund: Number(t.cashRefund || 0),
              exchangeVoucher: Number(t.exchangeVoucherAmount || 0),
              creditVoucher: Number(t.creditVoucherAmount || 0),
              claimVoucher: Number(t.claimVoucherAmount || 0),
            });
            row.commit();
          }
        }
      } catch (e) {
        // skip malformed line
      }
    }

    // Totals Summary Row
    if (exportType === 'flat') {
      const summaryRow = sheet.addRow({
        locationName: 'GRAND TOTAL',
        quantity: totalQty,
        unitPrice: '',
        priceWost: '',
        valueExcl: Number(totalValExcl.toFixed(2)),
        discountPercent: '',
        discountAmount: Number(totalDiscount.toFixed(2)),
        discountAmountWost: Number(totalDiscWost.toFixed(2)),
        amountAfterDiscount: Number(totalAmtAfterDisc.toFixed(2)),
        taxAmount: Number(totalTax.toFixed(2)),
        lineTotal: Number(totalNet.toFixed(2)),
        cashRefund: Number(totalCashRefund.toFixed(2)),
        cardRefund: 0,
      });
      summaryRow.font = { bold: true };
      summaryRow.commit();
    } else {
      const summaryRow = sheet.addRow({
        returnNumber: 'GRAND TOTAL',
        quantity: totalQty,
        unitPriceWost:
          totalQty > 0 ? Number((totalValExcl / totalQty).toFixed(2)) : 0,
        valueExcl: Number(totalValExcl.toFixed(2)),
        discountTotal: Number(totalDiscount.toFixed(2)),
        discountWost: Number(totalDiscWost.toFixed(2)),
        amountAfterDiscount: Number(totalAmtAfterDisc.toFixed(2)),
        salesTax: Number(totalTax.toFixed(2)),
        netTotal: Number(totalNet.toFixed(2)),
        cashRefund: Number(totalCashRefund.toFixed(2)),
        exchangeVoucher: '',
        creditVoucher: '',
        claimVoucher: '',
      });
      summaryRow.font = { bold: true };
      summaryRow.commit();
    }

    sheet.commit();
    await workbook.commit();
  }
}
