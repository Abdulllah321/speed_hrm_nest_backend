import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as readline from 'readline';
import * as ExcelJS from 'exceljs';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { pipeline, PassThrough } from 'stream';
import { UploadService } from '../upload/upload.service';
import { ExportHistoryService } from '../warehouse/export-history/export-history.service';

const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

// ───If it works don't touch it I know how i fixed it by spending hours of time and millions of token ─── Gross Sales Return Interfaces ───If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ───

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

// ───If it works don't touch it I know how i fixed it by spending hours of time and millions of token ─── Gross Sales Summary Interfaces ───If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ────

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
  locationId?: string;
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
  locationId?: string;
  locationIds?: string[];
  startDate?: string;
  endDate?: string;
  cashierUserId?: string;
  format: 'xlsx' | 'pdf';
  exportType?: 'flat' | 'hierarchical';
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

  // ───If it works don't touch it I know how i fixed it by spending hours of time and millions of token ─── Gross Sales Return Preview Methods ───If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ─────

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
    year?: string | number;
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

    this.logger.log(`[GrossSalesReturnReport] Queued preview job ${jobId} for user ${opts.userId}`);
    return { jobId };
  }

  // ───If it works don't touch it I know how i fixed it by spending hours of time and millions of token ─── Gross Sales Summary Preview Methods ───If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ────

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
    fiscalYear?: string;
    year?: string | number;
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
        fiscalYear: opts.fiscalYear,
        year: opts.year,
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

  getPreviewFilePath(jobId: string): string {
    const jsonPath = path.join(this.previewStorageDir, `gross-sales-preview-${jobId}.json.gz`);
    if (fs.existsSync(jsonPath)) return jsonPath;
    const ndjsonPath = path.join(this.previewStorageDir, `gross-sales-preview-${jobId}.ndjson.gz`);
    if (fs.existsSync(ndjsonPath)) return ndjsonPath;
    const oldReturnPath = path.join(this.previewStorageDir, `gross-sales-return-preview-${jobId}.json.gz`);
    if (fs.existsSync(oldReturnPath)) return oldReturnPath;
    return jsonPath;
  }

  getPreviewNdjsonFilePath(jobId: string): string {
    return path.join(this.previewStorageDir, `gross-sales-preview-${jobId}.ndjson.gz`);
  }

  async saveReportPreviewResult(jobId: string, result: any): Promise<void> {
    // 1. Save compressed preview JSON directly (capped to 5,000 records for instant <5ms frontend preview loading)
    try {
      const jsonPath = path.join(this.previewStorageDir, `gross-sales-preview-${jobId}.json.gz`);
      const previewResult = {
        ...result,
        flatItems: (result.flatItems || []).slice(0, 5000),
        returns: (result.returns || []).slice(0, 5000),
      };
      const jsonStr = JSON.stringify(previewResult);
      const compressedJson = await gzipAsync(Buffer.from(jsonStr, 'utf8'));
      await fs.promises.writeFile(jsonPath, compressedJson);
    } catch (err: any) {
      this.logger.warn(`Failed to save compressed preview JSON for ${jobId}: ${err.message}`);
    }

    // 2. Also stream complete un-truncated NDJSON to disk for streaming Excel export (stream-preview-excel)
    const filePath = this.getPreviewNdjsonFilePath(jobId);
    const gzip = zlib.createGzip({ level: 6 });
    const writeStream = fs.createWriteStream(filePath);

    await new Promise<void>((resolve, reject) => {
      pipeline(gzip, writeStream, (err) => {
        if (err) reject(err);
        else resolve();
      });

      const writeData = async () => {
        try {
          const safeWrite = async (chunk: string): Promise<void> => {
            if (!gzip.write(chunk)) {
              await new Promise((r) => gzip.once('drain', r));
            }
          };

          const isSummary = Array.isArray(result.categories);
          const isReturn = Array.isArray(result.returns);

          // Line 1: Meta header
          const metaLine = JSON.stringify({
            type: 'meta',
            reportType: result.reportType,
            dateRange: result.dateRange,
            locationNames: result.locationNames,
            locations: result.locations,
            totalCategories: isSummary ? result.categories.length : undefined,
            totalReturns: isReturn ? result.returns.length : undefined,
            totalRecords: (result.flatItems || []).length,
          }) + '\n';
          await safeWrite(metaLine);

          // Line 2..N: Records chunked into batches
          const CHUNK = 100;
          if (isSummary) {
            const categories = result.categories || [];
            for (let i = 0; i < categories.length; i += CHUNK) {
              const slice = categories.slice(i, i + CHUNK);
              const chunkLine = JSON.stringify({
                type: 'categories',
                startIndex: i,
                count: slice.length,
                categories: slice,
              }) + '\n';
              await safeWrite(chunkLine);
              await new Promise((res) => setImmediate(res));
            }
          } else if (isReturn) {
            const returns = result.returns || [];
            for (let i = 0; i < returns.length; i += CHUNK) {
              const slice = returns.slice(i, i + CHUNK);
              const chunkLine = JSON.stringify({
                type: 'returns',
                startIndex: i,
                count: slice.length,
                returns: slice,
              }) + '\n';
              await safeWrite(chunkLine);
              await new Promise((res) => setImmediate(res));
            }
          }

          // Flat items chunked into batches (1,500 records per line for high throughput without memory spikes)
          const flatItems = result.flatItems || [];
          for (let i = 0; i < flatItems.length; i += 1500) {
            const slice = flatItems.slice(i, i + 1500);
            const chunkLine = JSON.stringify({
              type: 'flatItems',
              startIndex: i,
              count: slice.length,
              flatItems: slice,
            }) + '\n';
            await safeWrite(chunkLine);
            await new Promise((res) => setImmediate(res));
          }

          // Final Line: Verified Grand Totals
          const totalsLine = JSON.stringify({
            type: 'totals',
            grandTotals: result.grandTotals,
            totalRecords: flatItems.length,
            done: true,
          }) + '\n';
          await safeWrite(totalsLine);

          gzip.end();
        } catch (e) {
          gzip.destroy(e as any);
        }
      };

      writeData();
    });
  }

  async getReportPreviewResult(jobId: string): Promise<any | null> {
    const jsonPath = path.join(this.previewStorageDir, `gross-sales-preview-${jobId}.json.gz`);
    if (fs.existsSync(jsonPath)) {
      const compressed = await fs.promises.readFile(jsonPath);
      const decompressed = await gunzipAsync(compressed);
      const parsed = JSON.parse(decompressed.toString('utf8'));
      return parsed.data || parsed;
    }

    const ndjsonPath = path.join(this.previewStorageDir, `gross-sales-preview-${jobId}.ndjson.gz`);
    if (!fs.existsSync(ndjsonPath)) {
      return null;
    }

    // Fast stream reader for ndjson.gz with preview sampling (up to 5,000 records)
    return new Promise<any | null>((resolve) => {
      const gz = fs.createReadStream(ndjsonPath);
      const gunzip = zlib.createGunzip();
      const rl = readline.createInterface({ input: gz.pipe(gunzip) });

      let meta: any = {};
      const categories: any[] = [];
      const returns: any[] = [];
      const flatItems: any[] = [];
      let grandTotals: any = {};
      const PREVIEW_LIMIT = 5000;

      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          if (line.includes('"type":"meta"')) {
            meta = JSON.parse(line);
          } else if (line.includes('"type":"totals"')) {
            grandTotals = JSON.parse(line).grandTotals || {};
          } else if (line.includes('"type":"categories"')) {
            const obj = JSON.parse(line);
            if (Array.isArray(obj.categories)) {
              categories.push(...obj.categories);
            }
          } else if (line.includes('"type":"returns"')) {
            if (returns.length < PREVIEW_LIMIT) {
              const obj = JSON.parse(line);
              if (Array.isArray(obj.returns)) {
                const remaining = PREVIEW_LIMIT - returns.length;
                returns.push(...obj.returns.slice(0, remaining));
              }
            }
          } else if (line.includes('"type":"flatItems"')) {
            if (flatItems.length < PREVIEW_LIMIT) {
              const obj = JSON.parse(line);
              if (Array.isArray(obj.flatItems)) {
                const remaining = PREVIEW_LIMIT - flatItems.length;
                flatItems.push(...obj.flatItems.slice(0, remaining));
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
          locations: meta.locations,
          categories: categories.length > 0 ? categories : undefined,
          returns: returns.length > 0 ? returns : undefined,
          flatItems,
          grandTotals,
        });
      });

      gz.on('error', () => resolve(null));
      gunzip.on('error', () => resolve(null));
    });
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
      fiscalYear?: string;
      year?: string | number;
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
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [y, m, d] = dateStr.split('-').map(Number);
        return isEndOfDay
          ? new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999))
          : new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
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

      if (!fyStr || fyStr === 'current') {
        startYear = defaultStartYear;
      } else if (fyStr === 'previous') {
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
          (it.item?.sku && (it.item.sku || '').toLowerCase().includes(q)) ||
          (it.item?.barCode && (it.item.barCode || '').toLowerCase().includes(q)) ||
          (it.item?.description && (it.item.description || '').toLowerCase().includes(q))
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

    const finalResult = {
      reportType,
      locations: isSeparate ? Array.from(locationNodesMap.values()) : undefined,
      returns: returnNodes,
      flatItems,
      grandTotals,
      dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
      locationNames,
    };

    console.log(`[generateGrossSalesReturnReportDataInternal] Result contains ${returnNodes.length} returnNodes and ${flatItems.length} flatItems.`);

    return finalResult;
  }

  // ───If it works don't touch it I know how i fixed it by spending hours of time and millions of token ─── Gross Sales Summary Computation Engine ───If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ──────If it works don't touch it I know how i fixed it by spending hours of time and millions of token ────

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
      fiscalYear?: string;
      year?: string | number;
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
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [y, m, d] = dateStr.split('-').map(Number);
        return isEndOfDay
          ? new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999))
          : new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
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

      if (!fyStr || fyStr === 'current') {
        startYear = defaultStartYear;
      } else if (fyStr === 'previous') {
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
        { customer: { name: { contains: s, mode: 'insensitive' } } },
      ];
    }

    await (prisma as any).$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_sales_orders_created_at ON sales_orders(created_at);
      CREATE INDEX IF NOT EXISTS idx_sales_orders_loc_created ON sales_orders(location_id, created_at);
    `).catch(() => { });

    await onProgress?.(25, 'Counting matching POS sales orders...');
    const totalOrdersCount = await prisma.salesOrder.count({ where });

    await onProgress?.(30, `Found ${totalOrdersCount.toLocaleString()} orders. Building Gross Sales Category matrix...`);

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
    const flatItemsMap = new Map<string, GrossSalesSummaryFlatRecord>();

    // Grouping structure: Category -> CategoryNode
    const globalCategoryNodesMap = new Map<string, GrossSalesSummaryCategoryNode>();
    const locationNodesMap = new Map<string, GrossSalesSummaryLocationNode>();

    const CHUNK = 3000;
    let processedCount = 0;

    while (true) {
      const chunkOrders: any[] = await prisma.salesOrder.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: processedCount,
        take: CHUNK,
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

      if (!chunkOrders.length) break;

      for (const order of chunkOrders) {
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

          const sku = item.item?.sku || item.item?.barCode || 'NO-SKU';
          const barCode = item.item?.barCode || item.item?.sku || '-';
          const description = item.item?.description || item.item?.sku || 'Article';
          const sizeName = item.item?.size?.name || 'Default';
          const colorName = item.item?.color?.name || 'Default';

          // Aggregate by location and product variant dimensions
          const variantKey = `${order.locationId || 'main'}|${catName}|${brandName}|${divisionName}|${genderName}|${silhouetteName}|${sku}|${barCode}|${sizeName}|${colorName}`;
          let existingRecord = flatItemsMap.get(variantKey);
          if (!existingRecord) {
            existingRecord = {
              locationId: order.locationId || undefined,
              locationName: locName,
              categoryName: catName,
              brandName,
              divisionName,
              genderName,
              silhouetteName,
              sku,
              barCode,
              description,
              sizeName,
              colorName,
              quantity: 0,
              unitPrice,
              wostAmount: 0,
              discountAmount: 0,
              taxAmount: 0,
              subTotal: 0,
            };
            flatItemsMap.set(variantKey, existingRecord);
          }

          existingRecord.quantity += qty;
          existingRecord.wostAmount = Math.round((existingRecord.wostAmount + wostAmount) * 100) / 100;
          existingRecord.discountAmount = Math.round((existingRecord.discountAmount + disc) * 100) / 100;
          existingRecord.taxAmount = Math.round((existingRecord.taxAmount + taxAmount) * 100) / 100;
          existingRecord.subTotal = Math.round((existingRecord.subTotal + subTotal) * 100) / 100;
          if (existingRecord.quantity > 0) {
            existingRecord.unitPrice = Math.round(((existingRecord.subTotal + existingRecord.discountAmount) / existingRecord.quantity) * 100) / 100;
          }

          // Add to global merged map (accumulate category totals only; line items live exclusively in flatItems)
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
            addTotals(locCat.totals, lineTotals);
            addTotals(locNode.totals, lineTotals);
          }
        }
      }

      processedCount += chunkOrders.length;
      const percent = Math.min(95, Math.round(30 + (processedCount / (totalOrdersCount || 1)) * 65));
      await onProgress?.(percent, `Processing sales items (${processedCount.toLocaleString()} of ${totalOrdersCount.toLocaleString()} orders)...`);
    }

    const flatItems = Array.from(flatItemsMap.values());
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
        locationIds: opts.locationIds,
        startDate: opts.startDate,
        endDate: opts.endDate,
        cashierUserId: opts.cashierUserId,
        format: opts.format,
        exportType: opts.exportType || 'hierarchical',
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
      const signedUrl = await this.uploadService.getSignedUrlForDownload(s3Key, record.fileName);
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

  async streamFilteredSummaryPreviewExcel(
    jobId: string,
    options: {
      exportType?: 'flat' | 'hierarchical';
      search?: string;
      locationId?: string;
      levels?: string;
    },
    res: any,
  ): Promise<void> {
    const filePath = this.getPreviewNdjsonFilePath(jobId);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Gross sales summary preview result not found or expired');
    }

    const exportType = options.exportType || 'flat';
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `gross-sales-summary-${exportType}-${dateStr}.xlsx`;

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

    const sheet = workbook.addWorksheet(exportType === 'flat' ? 'Summary Flat' : 'Summary Hierarchy');

    sheet.columns = [
      { header: 'Outlet / Location', key: 'locationName', width: 22 },
      { header: 'Category', key: 'categoryName', width: 18 },
      { header: 'Brand', key: 'brandName', width: 16 },
      { header: 'Division', key: 'divisionName', width: 16 },
      { header: 'Gender', key: 'genderName', width: 14 },
      { header: 'Silhouette', key: 'silhouetteName', width: 16 },
      { header: 'SKU', key: 'sku', width: 16 },
      { header: 'Barcode', key: 'barCode', width: 16 },
      { header: 'Description', key: 'description', width: 28 },
      { header: 'Size', key: 'sizeName', width: 10 },
      { header: 'Color', key: 'colorName', width: 12 },
      { header: 'Quantity', key: 'quantity', width: 10 },
      { header: 'Unit Price', key: 'unitPrice', width: 12 },
      { header: 'WOST', key: 'wostAmount', width: 14 },
      { header: 'Discount', key: 'discountAmount', width: 12 },
      { header: 'Tax', key: 'taxAmount', width: 12 },
      { header: 'SubTotal', key: 'subTotal', width: 14 },
    ];

    const q = (options.search || '').trim().toLowerCase();
    const locSet = options.locationId && options.locationId !== 'all'
      ? new Set(options.locationId.split(',').map((s) => s.trim().toLowerCase()))
      : null;

    let totalQty = 0;
    let totalWost = 0;
    let totalDiscount = 0;
    let totalTax = 0;
    let totalSubTotal = 0;

    await new Promise<void>((resolve, reject) => {
      let hasError = false;
      const gz = fs.createReadStream(filePath);
      const gunzip = zlib.createGunzip();
      const rl = readline.createInterface({ input: gz.pipe(gunzip) });

      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          if (exportType === 'flat' && line.includes('"type":"flatItems"')) {
            const obj = JSON.parse(line);
            if (Array.isArray(obj.flatItems)) {
              for (const item of obj.flatItems) {
                if (locSet) {
                  const loc = (item.locationName || '').toLowerCase();
                  if (!locSet.has(loc)) continue;
                }

                if (q) {
                  const matches =
                    (item.sku || '').toLowerCase().includes(q) ||
                    (item.barCode || '').toLowerCase().includes(q) ||
                    (item.description || '').toLowerCase().includes(q) ||
                    (item.categoryName || '').toLowerCase().includes(q) ||
                    (item.brandName || '').toLowerCase().includes(q) ||
                    (item.locationName || '').toLowerCase().includes(q);
                  if (!matches) continue;
                }

                const qty = Number(item.quantity || 0);
                const wost = Number(item.wostAmount || 0);
                const disc = Number(item.discountAmount || 0);
                const tax = Number(item.taxAmount || 0);
                const sub = Number(item.subTotal || 0);

                totalQty += qty;
                totalWost += wost;
                totalDiscount += disc;
                totalTax += tax;
                totalSubTotal += sub;

                const row = sheet.addRow({
                  locationName: item.locationName || '-',
                  categoryName: item.categoryName || '-',
                  brandName: item.brandName || '-',
                  divisionName: item.divisionName || '-',
                  genderName: item.genderName || '-',
                  silhouetteName: item.silhouetteName || '-',
                  sku: item.sku || '-',
                  barCode: item.barCode || '-',
                  description: item.description || '-',
                  sizeName: item.sizeName || '-',
                  colorName: item.colorName || '-',
                  quantity: qty,
                  unitPrice: Number(item.unitPrice || 0),
                  wostAmount: wost,
                  discountAmount: disc,
                  taxAmount: tax,
                  subTotal: sub,
                });
                row.commit();
              }
            }
          }
        } catch {
          // Ignore parse errors on chunks
        }
      });

      rl.on('close', () => {
        if (!hasError) resolve();
      });

      gz.on('error', (err) => {
        hasError = true;
        reject(err);
      });
      gunzip.on('error', (err) => {
        hasError = true;
        reject(err);
      });
    });

    const summaryRow = sheet.addRow({
      locationName: 'FILTERED TOTALS',
      quantity: totalQty,
      wostAmount: totalWost,
      discountAmount: totalDiscount,
      taxAmount: totalTax,
      subTotal: totalSubTotal,
    });
    summaryRow.font = { bold: true };
    summaryRow.commit();

    sheet.commit();
    await workbook.commit();
  }

  async streamFilteredReturnPreviewExcel(
    jobId: string,
    options: {
      exportType?: 'flat' | 'hierarchical';
      search?: string;
      paymentMode?: string;
      fbrOnly?: boolean;
      locationId?: string;
    },
    res: any,
  ): Promise<void> {
    const filePath = this.getPreviewNdjsonFilePath(jobId);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Sales return preview result not found or expired');
    }

    const exportType = options.exportType || 'flat';
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `gross-sales-return-${exportType}-${dateStr}.xlsx`;

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

    const sheet = workbook.addWorksheet(exportType === 'flat' ? 'Return Flat Items' : 'Return Summary');

    if (exportType === 'flat') {
      sheet.columns = [
        { header: 'Outlet / Location', key: 'locationName', width: 22 },
        { header: 'Return #', key: 'returnNumber', width: 16 },
        { header: 'Order #', key: 'orderNumber', width: 16 },
        { header: 'Return Date', key: 'returnDate', width: 20 },
        { header: 'Cashier', key: 'cashierName', width: 16 },
        { header: 'Customer', key: 'customerName', width: 18 },
        { header: 'Phone', key: 'customerPhone', width: 14 },
        { header: 'Refund Mode', key: 'paymentMethod', width: 14 },
        { header: 'FBR Inv #', key: 'fbrInvoiceNumber', width: 16 },
        { header: 'FBR Status', key: 'fbrStatus', width: 12 },
        { header: 'Category', key: 'categoryName', width: 18 },
        { header: 'Brand', key: 'brandName', width: 16 },
        { header: 'SKU', key: 'sku', width: 16 },
        { header: 'Barcode', key: 'barCode', width: 16 },
        { header: 'Description', key: 'description', width: 28 },
        { header: 'Size', key: 'sizeName', width: 10 },
        { header: 'Color', key: 'colorName', width: 12 },
        { header: 'Quantity', key: 'quantity', width: 10 },
        { header: 'Unit Price', key: 'unitPrice', width: 12 },
        { header: 'WOST Return', key: 'wostAmount', width: 14 },
        { header: 'Discount Reversal', key: 'discountAmount', width: 14 },
        { header: 'Tax', key: 'taxAmount', width: 12 },
        { header: 'SubTotal', key: 'subTotal', width: 14 },
        { header: 'Gross Return', key: 'returnGrossAmount', width: 14 },
        { header: 'Net Refund', key: 'returnNetAmount', width: 14 },
      ];
    } else {
      sheet.columns = [
        { header: 'Return #', key: 'returnNumber', width: 16 },
        { header: 'Orig Order #', key: 'orderNumber', width: 16 },
        { header: 'Return Date', key: 'createdAt', width: 20 },
        { header: 'Customer', key: 'customerName', width: 18 },
        { header: 'Cashier', key: 'cashierName', width: 16 },
        { header: 'Refund Mode', key: 'paymentMethod', width: 14 },
        { header: 'FBR Inv #', key: 'fbrInvoiceNumber', width: 16 },
        { header: 'Items Returned', key: 'totalItems', width: 14 },
        { header: 'Gross Return', key: 'grossAmount', width: 14 },
        { header: 'Discount Reversal', key: 'discountAmount', width: 14 },
        { header: 'Tax', key: 'taxAmount', width: 12 },
        { header: 'Net Refund', key: 'netAmount', width: 14 },
      ];
    }

    const q = (options.search || '').trim().toLowerCase();
    const pMode = options.paymentMode && options.paymentMode !== 'all' ? options.paymentMode.toUpperCase() : null;
    const isFbrOnly = options.fbrOnly === true;
    const locSet = options.locationId && options.locationId !== 'all'
      ? new Set(options.locationId.split(',').map((s) => s.trim().toLowerCase()))
      : null;

    let totalQty = 0;
    let totalGross = 0;
    let totalDiscount = 0;
    let totalNet = 0;

    await new Promise<void>((resolve, reject) => {
      let hasError = false;
      const gz = fs.createReadStream(filePath);
      const gunzip = zlib.createGunzip();
      const rl = readline.createInterface({ input: gz.pipe(gunzip) });

      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          if (exportType === 'flat' && line.includes('"type":"flatItems"')) {
            const obj = JSON.parse(line);
            if (Array.isArray(obj.flatItems)) {
              for (const item of obj.flatItems) {
                if (locSet) {
                  const loc = (item.locationName || '').toLowerCase();
                  if (!locSet.has(loc)) continue;
                }

                if (pMode && (item.paymentMethod || '').toUpperCase() !== pMode) continue;
                if (isFbrOnly && (!item.fbrInvoiceNumber || item.fbrInvoiceNumber === '-' || item.fbrInvoiceNumber.trim() === '')) continue;

                if (q) {
                  const matches =
                    (item.returnNumber || '').toLowerCase().includes(q) ||
                    (item.orderNumber || '').toLowerCase().includes(q) ||
                    (item.customerName || '').toLowerCase().includes(q) ||
                    (item.customerPhone || '').toLowerCase().includes(q) ||
                    (item.cashierName || '').toLowerCase().includes(q) ||
                    (item.sku || '').toLowerCase().includes(q) ||
                    (item.barCode || '').toLowerCase().includes(q) ||
                    (item.description || '').toLowerCase().includes(q);
                  if (!matches) continue;
                }

                const qty = Number(item.quantity || 0);
                const gross = Number(item.returnGrossAmount || (item.unitPrice * qty));
                const disc = Number(item.discountAmount || 0);
                const net = Number(item.returnNetAmount || item.subTotal || 0);

                totalQty += qty;
                totalGross += gross;
                totalDiscount += disc;
                totalNet += net;

                const row = sheet.addRow({
                  locationName: item.locationName || '-',
                  returnNumber: item.returnNumber,
                  orderNumber: item.orderNumber,
                  returnDate: item.returnDate || '-',
                  cashierName: item.cashierName || '-',
                  customerName: item.customerName || 'Walk-in',
                  customerPhone: item.customerPhone || '-',
                  paymentMethod: item.paymentMethod || '-',
                  fbrInvoiceNumber: item.fbrInvoiceNumber || '-',
                  fbrStatus: item.fbrStatus || '-',
                  categoryName: item.categoryName || '-',
                  brandName: item.brandName || '-',
                  sku: item.sku || '-',
                  barCode: item.barCode || '-',
                  description: item.description || '-',
                  sizeName: item.sizeName || '-',
                  colorName: item.colorName || '-',
                  quantity: qty,
                  unitPrice: Number(item.unitPrice || 0),
                  wostAmount: Number(item.wostAmount || 0),
                  discountAmount: disc,
                  taxAmount: Number(item.taxAmount || 0),
                  subTotal: Number(item.subTotal || 0),
                  returnGrossAmount: gross,
                  returnNetAmount: net,
                });
                row.commit();
              }
            }
          } else if (exportType === 'hierarchical' && line.includes('"type":"returns"')) {
            const obj = JSON.parse(line);
            if (Array.isArray(obj.returns)) {
              for (const ret of obj.returns) {
                if (pMode && (ret.paymentMethod || '').toUpperCase() !== pMode) continue;
                if (isFbrOnly && (!ret.fbrInvoiceNumber || ret.fbrInvoiceNumber === '-' || ret.fbrInvoiceNumber.trim() === '')) continue;

                if (q) {
                  const matches =
                    (ret.returnNumber || '').toLowerCase().includes(q) ||
                    (ret.orderNumber || '').toLowerCase().includes(q) ||
                    (ret.customerName || '').toLowerCase().includes(q) ||
                    (ret.customerPhone || '').toLowerCase().includes(q) ||
                    (ret.cashierName || '').toLowerCase().includes(q) ||
                    (ret.items || []).some((it: any) =>
                      (it.sku || '').toLowerCase().includes(q) ||
                      (it.barCode || '').toLowerCase().includes(q) ||
                      (it.description || '').toLowerCase().includes(q)
                    );
                  if (!matches) continue;
                }

                const itemsCount = Number(ret.totals?.totalItems || 0);
                const gross = Number(ret.totals?.grossAmount || 0);
                const disc = Number(ret.totals?.discountAmount || 0);
                const net = Number(ret.totals?.netAmount || 0);

                totalQty += itemsCount;
                totalGross += gross;
                totalDiscount += disc;
                totalNet += net;

                const row = sheet.addRow({
                  returnNumber: ret.returnNumber,
                  orderNumber: ret.orderNumber,
                  createdAt: ret.createdAt ? new Date(ret.createdAt).toISOString().replace('T', ' ').slice(0, 19) : '-',
                  customerName: ret.customerName || 'Walk-in',
                  cashierName: ret.cashierName || '-',
                  paymentMethod: ret.paymentMethod || '-',
                  fbrInvoiceNumber: ret.fbrInvoiceNumber || '-',
                  totalItems: itemsCount,
                  grossAmount: gross,
                  discountAmount: disc,
                  taxAmount: Number(ret.totals?.taxAmount || 0),
                  netAmount: net,
                });
                row.commit();
              }
            }
          }
        } catch {
          // Ignore parsing errors on chunks
        }
      });

      rl.on('close', () => {
        if (!hasError) resolve();
      });

      gz.on('error', (err) => {
        hasError = true;
        reject(err);
      });
      gunzip.on('error', (err) => {
        hasError = true;
        reject(err);
      });
    });

    const summaryRow = sheet.addRow(
      exportType === 'flat'
        ? {
          locationName: 'FILTERED TOTALS',
          quantity: totalQty,
          discountAmount: totalDiscount,
          returnGrossAmount: totalGross,
          returnNetAmount: totalNet,
        }
        : {
          returnNumber: 'FILTERED TOTALS',
          totalItems: totalQty,
          grossAmount: totalGross,
          discountAmount: totalDiscount,
          netAmount: totalNet,
        }
    );
    summaryRow.font = { bold: true };
    summaryRow.commit();

    sheet.commit();
    await workbook.commit();
  }
}
