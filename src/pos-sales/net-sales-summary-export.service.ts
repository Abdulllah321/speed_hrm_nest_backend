import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { pipeline, PassThrough } from 'stream';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { UploadService } from '../upload/upload.service';
import { ExportHistoryService } from '../warehouse/export-history/export-history.service';

const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

export interface NetSalesSummaryTotals {
  orderCount: number;
  unitPrice?: number;
  priceWost?: number;
  totalItemsSold: number;
  totalItemsReturned: number;
  netItems: number;
  retailSalesValue: number;
  wostAmount: number;
  discountAmount: number;
  discountWostAmount?: number;
  valueExSalesTax: number;
  taxAmount: number;
  valueInclSalesTax: number;

  grossSalesAmount: number;
  returnAmount: number;
  netSalesAmount: number;
}

export interface NetSalesSummaryLineItem {
  id: string;
  docNo?: string;
  docDate?: string;
  docMonth?: string;
  salesPerson?: string;
  taxRatePercent?: number;
  taxRateName?: string;
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
  unitPrice: number;
  soldQty: number;
  returnQty: number;
  netQty: number;
  retailSalesValue: number;
  wostAmount: number;
  discountAmount: number;
  discountWostAmount?: number;
  valueExSalesTax: number;
  taxAmount: number;
  valueInclSalesTax: number;

  grossAmount: number;
  returnAmount: number;
  netAmount: number;
}

export interface NetSalesSummaryCategoryNode {
  categoryName: string;
  brandName: string;
  divisionName?: string;
  genderName?: string;
  silhouetteName?: string;
  totals: NetSalesSummaryTotals;
  items: NetSalesSummaryLineItem[];
}

export interface NetSalesSummaryLocationNode {
  locationKey: string;
  locationId?: string;
  locationName: string;
  categories: NetSalesSummaryCategoryNode[];
  totals: NetSalesSummaryTotals;
}

export interface NetSalesSummaryFlatRecord {
  locationId?: string;
  cashierUserId?: string;
  createdAt?: string | Date;
  locationName: string;
  docNo?: string;
  docDate?: string;
  docMonth?: string;
  salesPerson?: string;
  taxRatePercent?: number;
  taxRateName?: string;
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
  unitPrice?: number;
  soldQty: number;
  returnQty: number;
  netQty: number;
  retailSalesValue?: number;
  wostAmount?: number;
  grossAmount: number;
  returnAmount: number;
  discountAmount: number;
  discountWostAmount?: number;
  valueExSalesTax?: number;
  taxAmount: number;
  valueInclSalesTax?: number;
  netAmount: number;
}

export interface NetSalesSummaryReportResult {
  reportType: 'merged' | 'separate';
  locations?: NetSalesSummaryLocationNode[];
  categories: NetSalesSummaryCategoryNode[];
  flatItems: NetSalesSummaryFlatRecord[];
  grandTotals: NetSalesSummaryTotals;
  dateRange: { startDate?: string; endDate?: string };
  locationNames: string;
}

export interface QueueNetSalesSummaryExportOptions {
  userId: string;
  locationId?: string;
  startDate?: string;
  endDate?: string;
  cashierUserId?: string;
  format: 'xlsx' | 'pdf';
  summaryOnly?: boolean;
  showSalesperson?: boolean;
  showYear?: boolean;
  showMonth?: boolean;
  showDay?: boolean;
  showDocument?: boolean;
  showBrand?: boolean;
  showDivision?: boolean;
  showSalesTax?: boolean;
  showCategory?: boolean;
  showGender?: boolean;
  showSilhouette?: boolean;
  showArticle?: boolean;
  showVariant?: boolean;
}

@Injectable()
export class NetSalesSummaryExportService {
  private readonly logger = new Logger(NetSalesSummaryExportService.name);

  constructor(
    @InjectQueue('net-sales-summary-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly prismaMaster: PrismaMasterService,
    private readonly uploadService: UploadService,
    private readonly exportHistoryService: ExportHistoryService,
  ) {}

  async queueExport(
    opts: QueueNetSalesSummaryExportOptions,
  ): Promise<{ jobId: string; historyId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const dateStr = new Date().toISOString().split('T')[0];
    const ext = opts.format === 'pdf' ? 'pdf' : 'xlsx';
    const fileName = `net-sales-summary-report-${dateStr}.${ext}`;

    const historyRecord = await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName,
        filePath: path.join('uploads', 'exports', `export-${jobId}.${ext}`),
        moduleName: 'NET_SALES_SUMMARY_REPORT',
        status: 'PENDING',
      },
    });

    await this.exportQueue.add(
      {
        jobId,
        tenantId,
        tenantDbUrl,
        ...opts,
      },
      {
        jobId,
        attempts: 3,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    return { jobId, historyId: historyRecord.id };
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
      'generate-net-sales-summary-preview',
      {
        jobId,
        tenantId,
        tenantDbUrl,
        ...opts,
      },
      {
        jobId: `preview-${jobId}`,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    return { jobId };
  }

  async getJobStatus(jobId: string): Promise<{ state: string; progress: number; message?: string }> {
    const job = (await this.exportQueue.getJob(jobId)) || (await this.exportQueue.getJob(`preview-${jobId}`));
    if (!job) throw new NotFoundException(`Export job ${jobId} not found`);
    const state = await job.getState();
    const rawProg: any = job.progress();
    const progress =
      typeof rawProg === 'number'
        ? rawProg
        : typeof rawProg === 'object' && rawProg?.percent !== undefined
        ? Number(rawProg.percent)
        : 0;
    const message = typeof rawProg === 'object' && rawProg?.message ? String(rawProg.message) : undefined;
    return { state, progress, message };
  }

  async getJobQueueStatus(jobId: string) {
    const job = (await this.exportQueue.getJob(`preview-${jobId}`)) || (await this.exportQueue.getJob(jobId));
    if (!job) {
      return { status: 'completed', progress: 100 };
    }
    const state = await job.getState();
    const progressData = job.progress();
    const progress = typeof progressData === 'number' ? progressData : (progressData as any)?.percent || 0;
    const message = typeof progressData === 'object' ? (progressData as any)?.message : undefined;
    return {
      status: state,
      progress: progress || (state === 'completed' ? 100 : 0),
      message,
      queuePosition: 0,
      waitingCount: 0,
      failedReason: job.failedReason,
    };
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
        data: { downloadCount: { increment: 1 } },
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
    const isPdf = record.fileName.endsWith('.pdf');

    res.header('Content-Type', isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename="${record.fileName}"`);
    res.header('Content-Length', stat.size);
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');

    res.send(stream);
  }

  getPreviewFilePath(jobId: string): string {
    const previewDir = path.join(process.cwd(), 'uploads', 'previews');
    const ndjsonPath = path.join(previewDir, `net-sales-summary-preview-${jobId}.ndjson.gz`);
    if (fs.existsSync(ndjsonPath)) return ndjsonPath;
    const jsonPath = path.join(previewDir, `net-sales-summary-preview-${jobId}.json.gz`);
    if (fs.existsSync(jsonPath)) return jsonPath;
    return ndjsonPath;
  }

  getPreviewNdjsonFilePath(jobId: string): string {
    const previewDir = path.join(process.cwd(), 'uploads', 'previews');
    return path.join(previewDir, `net-sales-summary-preview-${jobId}.ndjson.gz`);
  }

  async saveReportPreviewResult(jobId: string, result: NetSalesSummaryReportResult): Promise<void> {
    const previewDir = path.join(process.cwd(), 'uploads', 'previews');
    await fs.promises.mkdir(previewDir, { recursive: true });

    // 1. Save compressed preview JSON directly (capped to 25,000 records for fast instant loading)
    try {
      const jsonPath = path.join(previewDir, `net-sales-summary-preview-${jobId}.json.gz`);
      const previewResult = {
        ...result,
        flatItems: (result.flatItems || []).slice(0, 25000),
      };
      const jsonStr = JSON.stringify(previewResult);
      const compressedJson = await gzipAsync(Buffer.from(jsonStr, 'utf8'));
      await fs.promises.writeFile(jsonPath, compressedJson);
    } catch (err: any) {
      this.logger.warn(`Failed to save compressed preview JSON for ${jobId}: ${err.message}`);
    }

    // 2. Stream complete un-truncated NDJSON to disk with fine-grained 100-item chunks
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

          // Line 1: Meta header
          const metaLine =
            JSON.stringify({
              type: 'meta',
              reportType: result.reportType,
              dateRange: result.dateRange,
              locationNames: result.locationNames,
              locations: result.locations,
              totalRecords: (result.flatItems || []).length,
            }) + '\n';
          await safeWrite(metaLine);

          // Line 2: Categories in chunks of 100
          const categories = result.categories || [];
          for (let i = 0; i < categories.length; i += 100) {
            const slice = categories.slice(i, i + 100);
            const chunkLine =
              JSON.stringify({
                type: 'categories',
                startIndex: i,
                count: slice.length,
                categories: slice,
              }) + '\n';
            await safeWrite(chunkLine);
            await new Promise((res) => setImmediate(res));
          }

          // Line 3..N: Flat items chunked into batches (100 records per line)
          const flatItems = result.flatItems || [];
          for (let i = 0; i < flatItems.length; i += 100) {
            const slice = flatItems.slice(i, i + 100);
            const chunkLine =
              JSON.stringify({
                type: 'flatItems',
                startIndex: i,
                count: slice.length,
                flatItems: slice,
              }) + '\n';
            await safeWrite(chunkLine);
            await new Promise((res) => setImmediate(res));
          }

          // Final Line: Verified Grand Totals
          const totalsLine =
            JSON.stringify({
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

  async getReportPreviewResult(jobId: string): Promise<NetSalesSummaryReportResult | null> {
    const previewDir = path.join(process.cwd(), 'uploads', 'previews');
    const jsonPath = path.join(previewDir, `net-sales-summary-preview-${jobId}.json.gz`);
    if (fs.existsSync(jsonPath)) {
      const compressed = await fs.promises.readFile(jsonPath);
      const decompressed = await gunzipAsync(compressed);
      const parsed = JSON.parse(decompressed.toString('utf8'));
      return parsed.data || parsed;
    }

    const ndjsonPath = path.join(previewDir, `net-sales-summary-preview-${jobId}.ndjson.gz`);
    if (!fs.existsSync(ndjsonPath)) {
      return null;
    }

    const fileStream = fs.createReadStream(ndjsonPath);
    const gunzip = zlib.createGunzip();
      const lineReader = readline.createInterface({
        input: fileStream.pipe(gunzip),
        crlfDelay: Infinity,
      });

      let meta: any = {};
      const categories: any[] = [];
      const flatItems: any[] = [];
      let grandTotals: any = {};

      for await (const line of lineReader) {
        if (!line || !line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'meta') {
            meta = obj;
          } else if (obj.type === 'categories' && Array.isArray(obj.categories)) {
            categories.push(...obj.categories);
          } else if (obj.type === 'flatItems' && Array.isArray(obj.flatItems)) {
            flatItems.push(...obj.flatItems);
          } else if (obj.type === 'totals') {
            grandTotals = obj.grandTotals || grandTotals;
          }
        } catch (_) {}
      }

      return {
        reportType: meta.reportType || 'merged',
        dateRange: meta.dateRange || {},
        locationNames: meta.locationNames || '',
        locations: meta.locations,
        categories,
        flatItems,
        grandTotals,
      };
  }

  /**
   * Generates Net Sales Summary Report Data by cleanly combining:
   * 1. Gross Sales Orders (from sales_orders & sales_order_items)
   * 2. Gross Sales Returns (from pos_returns & pos_return_items & stock_ledgers)
   */
  async generateNetSalesSummaryReportDataInternal(
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
  ): Promise<NetSalesSummaryReportResult> {
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

    const getFiscalYearBounds = (fyStr?: string): { start: Date; end: Date } => {
      let startYear: number;
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
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

    if (endDate > now) {
      endDate = now;
    }

    const locIds = locationId ? locationId.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const locationWhere = locIds.length > 1 ? { in: locIds } : locIds.length === 1 ? locIds[0] : undefined;

    await onProgress?.(10, 'Loading store metadata and cashiers...');

    const [allLocations, cashiersList] = await Promise.all([
      prisma.location.findMany({ select: { id: true, name: true } }),
      this.prismaMaster?.user?.findMany
        ? this.prismaMaster.user.findMany({ select: { id: true, firstName: true, lastName: true } })
        : (prisma as any).user?.findMany
        ? (prisma as any).user.findMany({ select: { id: true, firstName: true, lastName: true } })
        : Promise.resolve([]),
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

    const createEmptyTotals = (): NetSalesSummaryTotals => ({
      orderCount: 0,
      unitPrice: 0,
      priceWost: 0,
      totalItemsSold: 0,
      totalItemsReturned: 0,
      netItems: 0,
      retailSalesValue: 0,
      wostAmount: 0,
      discountAmount: 0,
      discountWostAmount: 0,
      valueExSalesTax: 0,
      taxAmount: 0,
      valueInclSalesTax: 0,
      grossSalesAmount: 0,
      returnAmount: 0,
      netSalesAmount: 0,
    });

    const addTotals = (target: NetSalesSummaryTotals, source: NetSalesSummaryTotals) => {
      target.orderCount += source.orderCount;
      target.totalItemsSold += source.totalItemsSold;
      target.totalItemsReturned += source.totalItemsReturned;
      target.netItems += source.netItems;
      target.retailSalesValue = Number((target.retailSalesValue + source.retailSalesValue).toFixed(2));
      target.wostAmount = Number((target.wostAmount + source.wostAmount).toFixed(2));
      target.discountAmount = Number((target.discountAmount + source.discountAmount).toFixed(2));
      target.discountWostAmount = Number(((target.discountWostAmount || 0) + (source.discountWostAmount || 0)).toFixed(2));
      target.valueExSalesTax = Number((target.valueExSalesTax + source.valueExSalesTax).toFixed(2));
      target.taxAmount = Number((target.taxAmount + source.taxAmount).toFixed(2));
      target.valueInclSalesTax = Number((target.valueInclSalesTax + source.valueInclSalesTax).toFixed(2));

      // Legacy field aliases
      target.grossSalesAmount = Number((target.grossSalesAmount + source.grossSalesAmount).toFixed(2));
      target.returnAmount = Number((target.returnAmount + source.returnAmount).toFixed(2));
      target.netSalesAmount = Number((target.netSalesAmount + source.netSalesAmount).toFixed(2));
    };

    const grandTotals = createEmptyTotals();
    const flatItemsMap = new Map<string, NetSalesSummaryFlatRecord>();
    const globalCategoryNodesMap = new Map<string, NetSalesSummaryCategoryNode>();
    const locationNodesMap = new Map<string, NetSalesSummaryLocationNode>();

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 1: Process Gross Sales Orders
    // ─────────────────────────────────────────────────────────────────────────────
    await onProgress?.(25, 'Querying Gross POS Sales Orders...');

    const salesWhere: any = {
      orderNumber: { not: { startsWith: 'RET-' } },
      status: {
        notIn: ['hold', 'hold_expired', 'hold_cancelled', 'voided', 'cancelled', 'VOIDED', 'CANCELLED', 'draft', 'DRAFT'],
      },
      createdAt: { gte: startDate, lte: endDate },
    };

    if (locationWhere) salesWhere.locationId = locationWhere;
    if (cashierUserId) salesWhere.cashierUserId = cashierUserId;
    if (fbrOnly) salesWhere.fbrInvoiceNumber = { not: null };
    if (paymentModeGroup && paymentModeGroup !== 'all') {
      salesWhere.paymentMethod = { equals: paymentModeGroup, mode: 'insensitive' };
    }
    if (minAmount !== undefined || maxAmount !== undefined) {
      salesWhere.grandTotal = {};
      if (minAmount !== undefined) salesWhere.grandTotal.gte = Number(minAmount);
      if (maxAmount !== undefined) salesWhere.grandTotal.lte = Number(maxAmount);
    }
    if (search && search.trim()) {
      const s = search.trim();
      salesWhere.OR = [
        { orderNumber: { contains: s, mode: 'insensitive' } },
        { customer: { name: { contains: s, mode: 'insensitive' } } },
      ];
    }

    const totalOrdersCount = await prisma.salesOrder.count({ where: salesWhere });
    const CHUNK = 3000;
    let processedOrders = 0;

    while (true) {
      const chunkOrders: any[] = await prisma.salesOrder.findMany({
        where: salesWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: processedOrders,
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
        const docNo = order.orderNumber || 'N/A';
        const docDate = order.createdAt ? new Date(order.createdAt).toISOString().split('T')[0] : 'N/A';
        const docMonth = docDate && docDate !== 'N/A' ? docDate.slice(0, 7) : 'all';
        const createdAt = order.createdAt ? new Date(order.createdAt).toISOString() : new Date().toISOString();

        let salesPerson = 'Default Cashier';
        if (order.cashierUserId && cashierMap.has(order.cashierUserId)) {
          salesPerson = cashierMap.get(order.cashierUserId)!;
        } else if (order.notes) {
          const match = order.notes.match(/SalesPerson:\s*([^|]+)/i);
          if (match) salesPerson = match[1].trim();
        }

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

        let ordRetailGross = 0;
        let ordRetailDisc = 0;
        let ordCompWost = 0;
        let ordCompDiscWost = 0;

        const lineItemCalcs: any[] = [];

        for (const item of order.items) {
          const qty = Number(item.quantity || 0);
          if (qty <= 0) continue;

          const unitPrice = Number(item.unitPrice || 0);
          const lineRetailGross = unitPrice * qty;
          ordRetailGross += lineRetailGross;

          const priceWost = unitPrice / 1.18;
          const valExcl = Number((priceWost * qty).toFixed(2));

          const rawDiscAmt = Number(item.discountAmount || 0);
          const discPct = Number(item.discountPercent || (lineRetailGross > 0 && rawDiscAmt > 0 ? (rawDiscAmt / valExcl) * 100 : 0));

          let discAmtWost = 0;
          let discAmtRetail = 0;

          if (discPct > 0) {
            discAmtRetail = Math.round((lineRetailGross * (discPct / 100)) * 100) / 100;
            discAmtWost = Math.round((valExcl * (discPct / 100)) * 100) / 100;
          } else if (rawDiscAmt > 0) {
            discAmtWost = rawDiscAmt;
            discAmtRetail = Math.round(rawDiscAmt * 1.18 * 100) / 100;
          }

          ordRetailDisc += discAmtRetail;
          ordCompWost += valExcl;
          ordCompDiscWost += discAmtWost;

          const amountAfterDiscount = Math.max(0, valExcl - discAmtWost);
          const calculatedTaxPct = Number(item.taxPercent || 18);
          const taxAmount = Number(item.taxAmount || Math.round(amountAfterDiscount * (calculatedTaxPct / 100) * 100) / 100);
          const lineTotal = Number(item.lineTotal || (lineRetailGross - discAmtRetail));

          lineItemCalcs.push({
            item,
            qty,
            unitPrice,
            lineRetailGross,
            priceWost,
            valExcl,
            discAmtRetail,
            discAmtWost,
            amountAfterDiscount,
            calculatedTaxPct,
            taxAmount,
            lineTotal,
          });
        }

        const totalItemsCount = lineItemCalcs.reduce((acc, i) => acc + i.qty, 0);
        const orderWost = Number(order.subtotal || 0);
        const orderDiscWost = Number(order.discountAmount || 0);
        const net = Number(order.grandTotal || 0);
        const tax = Number(order.taxAmount || 0);

        const grossWost = orderWost > 0 ? orderWost : (ordCompWost > 0 ? ordCompWost : net / 1.18);
        const retailGross = ordRetailGross > 0 ? ordRetailGross : (grossWost * 1.18);
        const totalDiscWost = orderDiscWost > 0 ? orderDiscWost : ordCompDiscWost;
        const totalDiscRetail = ordRetailDisc > 0 ? ordRetailDisc : (totalDiscWost * 1.18);

        const orderTotals: NetSalesSummaryTotals = {
          orderCount: 1,
          totalItemsSold: totalItemsCount,
          totalItemsReturned: 0,
          netItems: totalItemsCount,
          retailSalesValue: retailGross,
          wostAmount: grossWost,
          discountAmount: totalDiscRetail,
          discountWostAmount: totalDiscWost,
          valueExSalesTax: Number((grossWost - totalDiscWost).toFixed(2)),
          taxAmount: tax,
          valueInclSalesTax: net,
          grossSalesAmount: retailGross,
          returnAmount: 0,
          netSalesAmount: net,
        };

        addTotals(grandTotals, orderTotals);
        if (isSeparate && locNode) {
          addTotals(locNode.totals, orderTotals);
        }

        for (const calc of lineItemCalcs) {
          const { item, qty, unitPrice, lineRetailGross, valExcl, discAmtRetail, discAmtWost, amountAfterDiscount, calculatedTaxPct, taxAmount, lineTotal } = calc;

          const catName = item.item?.category?.name || 'Unassigned Category';
          const brandName = item.item?.brand?.name || 'Default Brand';
          const divisionName = item.item?.division?.name || 'Default Division';
          const genderName = item.item?.gender?.name || 'Default Gender';
          const silhouetteName = item.item?.silhouette?.name || 'Default Silhouette';
          const sizeName = item.item?.size?.name || 'Default';
          const colorName = item.item?.color?.name || 'Default';
          const sku = item.item?.sku || item.item?.barCode || 'NO-SKU';
          const barCode = item.item?.barCode || item.item?.sku || '-';
          const description = item.item?.description || item.item?.sku || 'Article';
          const taxRateName = calculatedTaxPct > 0 ? `${calculatedTaxPct}% Sales Tax Group` : '0% Tax Exempt Group';

          const lineTotals: NetSalesSummaryTotals = {
            orderCount: 1,
            unitPrice,
            totalItemsSold: qty,
            totalItemsReturned: 0,
            netItems: qty,
            retailSalesValue: lineRetailGross,
            wostAmount: valExcl,
            discountAmount: discAmtRetail,
            discountWostAmount: discAmtWost,
            valueExSalesTax: amountAfterDiscount,
            taxAmount,
            valueInclSalesTax: lineTotal,
            grossSalesAmount: lineRetailGross,
            returnAmount: 0,
            netSalesAmount: lineTotal,
          };

          const variantKey = `SO:${order.id}|${order.locationId || 'main'}|${catName}|${brandName}|${divisionName}|${genderName}|${silhouetteName}|${sku}|${barCode}|${sizeName}|${colorName}|${calculatedTaxPct}`;

          let existingRecord = flatItemsMap.get(variantKey);
          if (!existingRecord) {
            existingRecord = {
              locationId: order.locationId || undefined,
              cashierUserId: order.cashierUserId || undefined,
              locationName: locName,
              docNo,
              docDate,
              docMonth,
              createdAt,
              salesPerson,
              taxRatePercent: calculatedTaxPct,
              taxRateName,
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
              unitPrice,
              soldQty: 0,
              returnQty: 0,
              netQty: 0,
              retailSalesValue: 0,
              wostAmount: 0,
              grossAmount: 0,
              returnAmount: 0,
              discountAmount: 0,
              discountWostAmount: 0,
              valueExSalesTax: 0,
              taxAmount: 0,
              valueInclSalesTax: 0,
              netAmount: 0,
            };
            flatItemsMap.set(variantKey, existingRecord);
          }

          existingRecord.soldQty += qty;
          existingRecord.netQty += qty;
          existingRecord.retailSalesValue = Number(((existingRecord.retailSalesValue || 0) + lineRetailGross).toFixed(2));
          existingRecord.wostAmount = Number(((existingRecord.wostAmount || 0) + valExcl).toFixed(2));
          existingRecord.grossAmount = Number((existingRecord.grossAmount + lineRetailGross).toFixed(2));
          existingRecord.discountAmount = Number((existingRecord.discountAmount + discAmtRetail).toFixed(2));
          existingRecord.discountWostAmount = Number(((existingRecord.discountWostAmount || 0) + discAmtWost).toFixed(2));
          existingRecord.valueExSalesTax = Number(((existingRecord.valueExSalesTax || 0) + amountAfterDiscount).toFixed(2));
          existingRecord.taxAmount = Number((existingRecord.taxAmount + taxAmount).toFixed(2));
          existingRecord.valueInclSalesTax = Number(((existingRecord.valueInclSalesTax || 0) + lineTotal).toFixed(2));
          existingRecord.netAmount = Number((existingRecord.netAmount + lineTotal).toFixed(2));
          if (existingRecord.soldQty > 0) {
            existingRecord.unitPrice = Number((existingRecord.grossAmount / existingRecord.soldQty).toFixed(2));
          }

          let globalCat = globalCategoryNodesMap.get(catName);
          if (!globalCat) {
            globalCat = {
              categoryName: catName,
              brandName,
              divisionName,
              genderName,
              silhouetteName,
              totals: createEmptyTotals(),
              items: [],
            };
            globalCategoryNodesMap.set(catName, globalCat);
          }
          addTotals(globalCat.totals, lineTotals);

          if (isSeparate && locNode) {
            let locCat = locNode.categories.find((c) => c.categoryName === catName);
            if (!locCat) {
              locCat = {
                categoryName: catName,
                brandName,
                divisionName,
                genderName,
                silhouetteName,
                totals: createEmptyTotals(),
                items: [],
              };
              locNode.categories.push(locCat);
            }
            addTotals(locCat.totals, lineTotals);
          }
        }
      }

      processedOrders += chunkOrders.length;
      const pct = Math.min(55, 25 + Math.round((processedOrders / (totalOrdersCount || 1)) * 30));
      await onProgress?.(pct, `Processed ${processedOrders.toLocaleString()} of ${totalOrdersCount.toLocaleString()} sales orders...`);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 2: Process Gross Sales Returns (pos_returns & pos_claims)
    // ─────────────────────────────────────────────────────────────────────────────
    await onProgress?.(60, 'Querying POS sales returns and return line items...');

    const posReturnWhere: any = {
      createdAt: { gte: startDate, lte: endDate },
    };
    if (locationWhere) posReturnWhere.locationId = locationWhere;
    if (cashierUserId) {
      posReturnWhere.OR = [{ cashierUserId }, { salesOrder: { cashierUserId } }];
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
          select: {
            id: true,
            orderNumber: true,
            locationId: true,
            cashierUserId: true,
            fbrInvoiceNumber: true,
            customer: { select: { name: true, contactNo: true } },
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
        voucher: {
          select: {
            code: true,
            voucherType: true,
            faceValue: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    let posClaims: any[] = [];
    try {
      if ((prisma as any).posClaim?.findMany) {
        const claimWhere: any = {
          createdAt: { gte: startDate, lte: endDate },
        };
        if (locationWhere) claimWhere.salesOrder = { locationId: locationWhere };
        posClaims = await (prisma as any).posClaim.findMany({
          where: claimWhere,
          include: {
            salesOrder: {
              select: {
                id: true,
                orderNumber: true,
                locationId: true,
                cashierUserId: true,
                fbrInvoiceNumber: true,
                customer: { select: { name: true, contactNo: true } },
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
            voucher: { select: { code: true, faceValue: true } },
          },
          orderBy: { createdAt: 'desc' },
        });
      }
    } catch (_) {}

    await onProgress?.(80, 'Merging sales returns into Net Sales Summary matrix...');

    for (const ret of posReturns) {
      const sampleLocId = ret.locationId || ret.salesOrder?.locationId;
      const locName = sampleLocId ? locationMap.get(sampleLocId) || 'Main Outlet' : 'Main Outlet';
      const locKey = sampleLocId ? `loc:${sampleLocId}` : 'main-outlet';
      const cashierId = ret.cashierUserId || ret.salesOrder?.cashierUserId;
      let salesPerson = 'Default Cashier';
      if (cashierId && cashierMap.has(cashierId)) {
        salesPerson = cashierMap.get(cashierId)!;
      }
      const retNo = ret.returnNumber || ret.voucher?.code || `SR-${ret.id.slice(0, 8)}`;
      const docDate = ret.createdAt ? new Date(ret.createdAt).toISOString().split('T')[0] : 'N/A';
      const docMonth = docDate && docDate !== 'N/A' ? docDate.slice(0, 7) : 'all';
      const createdAt = ret.createdAt ? new Date(ret.createdAt).toISOString() : new Date().toISOString();

      let locNode = locationNodesMap.get(locKey);
      if (isSeparate && !locNode) {
        locNode = {
          locationKey: locKey,
          locationId: sampleLocId || undefined,
          locationName: locName,
          categories: [],
          totals: createEmptyTotals(),
        };
        locationNodesMap.set(locKey, locNode);
      }

      let retTotalQty = 0;
      let retGross = 0;
      let retWost = 0;
      let retDisc = 0;
      let retDiscWost = 0;
      let retTax = 0;
      let retNet = 0;

      const retLineCalcs: any[] = [];

      for (const it of ret.items || []) {
        const qty = Math.abs(Number(it.quantity || 1));
        const unitPrice = Number(it.originalUnitPrice || it.refundPerUnit || it.originalPaidPerUnit || 0);
        const unitPriceWost = Number((it.unitPriceWost ? Number(it.unitPriceWost) : unitPrice / 1.18).toFixed(2));
        const valExcl = Number((it.lineTotalWost ? Number(it.lineTotalWost) : qty * unitPriceWost).toFixed(2));
        const disc = Number(it.discountPercent ? (unitPrice * qty * Number(it.discountPercent)) / 100 : 0);
        const discWost = Number((it.discountWost ? Number(it.discountWost) : disc / 1.18).toFixed(2));
        const amtAfterDisc = Number(Math.max(0, valExcl - discWost).toFixed(2));
        const tax = Number(it.taxAmount || 0);
        const lineTotal = Number(it.lineTotal || (unitPrice * qty - disc + tax));

        retTotalQty += qty;
        retGross += unitPrice * qty;
        retWost += valExcl;
        retDisc += disc;
        retDiscWost += discWost;
        retTax += tax;
        retNet += lineTotal;

        retLineCalcs.push({
          it,
          qty,
          unitPrice,
          valExcl,
          disc,
          discWost,
          amtAfterDisc,
          tax,
          lineTotal,
        });
      }

      if (retLineCalcs.length === 0) {
        const totalRefAmt = Number(ret.totalRefundAmount || 0);
        const wostAmt = Number(ret.subtotalWost || totalRefAmt / 1.18);
        retTotalQty = 1;
        retGross = totalRefAmt;
        retWost = wostAmt;
        retNet = totalRefAmt;

        retLineCalcs.push({
          it: { item: null },
          qty: 1,
          unitPrice: totalRefAmt,
          valExcl: wostAmt,
          disc: 0,
          discWost: 0,
          amtAfterDisc: wostAmt,
          tax: Number(ret.taxAmount || 0),
          lineTotal: totalRefAmt,
        });
      }

      const totalRefundAmt = Number(ret.totalRefundAmount || retNet);

      const returnTotals: NetSalesSummaryTotals = {
        orderCount: 0,
        totalItemsSold: 0,
        totalItemsReturned: retTotalQty,
        netItems: -retTotalQty,
        retailSalesValue: -retGross,
        wostAmount: -retWost,
        discountAmount: -retDisc,
        discountWostAmount: -retDiscWost,
        valueExSalesTax: -Number(Math.max(0, retWost - retDiscWost).toFixed(2)),
        taxAmount: -retTax,
        valueInclSalesTax: -totalRefundAmt,
        grossSalesAmount: 0,
        returnAmount: totalRefundAmt,
        netSalesAmount: -totalRefundAmt,
      };

      addTotals(grandTotals, returnTotals);
      if (isSeparate && locNode) {
        addTotals(locNode.totals, returnTotals);
      }

      for (const calc of retLineCalcs) {
        const { it, qty, unitPrice, valExcl, disc, discWost, amtAfterDisc, tax, lineTotal } = calc;
        const itemObj = it.item;

        const catName = itemObj?.category?.name || 'Unassigned Category';
        const brandName = itemObj?.brand?.name || 'Default Brand';
        const divisionName = itemObj?.division?.name || 'Default Division';
        const genderName = itemObj?.gender?.name || 'Default Gender';
        const silhouetteName = itemObj?.silhouette?.name || 'Default Silhouette';
        const sizeName = itemObj?.size?.name || 'Default';
        const colorName = itemObj?.color?.name || 'Default';
        const sku = itemObj?.sku || itemObj?.barCode || 'NO-SKU';
        const barCode = itemObj?.barCode || itemObj?.sku || '-';
        const description = itemObj?.description || itemObj?.sku || 'Article';
        const calculatedTaxPct = Number(it.taxPercent || 18);
        const taxRateName = calculatedTaxPct > 0 ? `${calculatedTaxPct}% Sales Tax Group` : '0% Tax Exempt Group';

        const lineReturnTotals: NetSalesSummaryTotals = {
          orderCount: 0,
          unitPrice,
          totalItemsSold: 0,
          totalItemsReturned: qty,
          netItems: -qty,
          retailSalesValue: -(unitPrice * qty),
          wostAmount: -valExcl,
          discountAmount: -disc,
          discountWostAmount: -discWost,
          valueExSalesTax: -amtAfterDisc,
          taxAmount: -tax,
          valueInclSalesTax: -lineTotal,
          grossSalesAmount: 0,
          returnAmount: lineTotal,
          netSalesAmount: -lineTotal,
        };

        const variantKey = `RET:${ret.id}|${sampleLocId || 'main'}|${catName}|${brandName}|${divisionName}|${genderName}|${silhouetteName}|${sku}|${barCode}|${sizeName}|${colorName}|${calculatedTaxPct}`;

        let existingRecord = flatItemsMap.get(variantKey);
        if (!existingRecord) {
          existingRecord = {
            locationId: sampleLocId || undefined,
            cashierUserId: cashierId || undefined,
            locationName: locName,
            docNo: retNo,
            docDate,
            docMonth,
            createdAt,
            salesPerson,
            taxRatePercent: calculatedTaxPct,
            taxRateName,
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
            unitPrice,
            soldQty: 0,
            returnQty: 0,
            netQty: 0,
            retailSalesValue: 0,
            wostAmount: 0,
            grossAmount: 0,
            returnAmount: 0,
            discountAmount: 0,
            discountWostAmount: 0,
            valueExSalesTax: 0,
            taxAmount: 0,
            valueInclSalesTax: 0,
            netAmount: 0,
          };
          flatItemsMap.set(variantKey, existingRecord);
        }

        existingRecord.returnQty += qty;
        existingRecord.netQty -= qty;
        existingRecord.retailSalesValue = Number(((existingRecord.retailSalesValue || 0) - unitPrice * qty).toFixed(2));
        existingRecord.wostAmount = Number(((existingRecord.wostAmount || 0) - valExcl).toFixed(2));
        existingRecord.returnAmount = Number((existingRecord.returnAmount + lineTotal).toFixed(2));
        existingRecord.discountAmount = Number((existingRecord.discountAmount - disc).toFixed(2));
        existingRecord.discountWostAmount = Number(((existingRecord.discountWostAmount || 0) - discWost).toFixed(2));
        existingRecord.valueExSalesTax = Number(((existingRecord.valueExSalesTax || 0) - amtAfterDisc).toFixed(2));
        existingRecord.taxAmount = Number((existingRecord.taxAmount - tax).toFixed(2));
        existingRecord.valueInclSalesTax = Number(((existingRecord.valueInclSalesTax || 0) - lineTotal).toFixed(2));
        existingRecord.netAmount = Number((existingRecord.netAmount - lineTotal).toFixed(2));

        let globalCat = globalCategoryNodesMap.get(catName);
        if (!globalCat) {
          globalCat = {
            categoryName: catName,
            brandName,
            divisionName,
            genderName,
            silhouetteName,
            totals: createEmptyTotals(),
            items: [],
          };
          globalCategoryNodesMap.set(catName, globalCat);
        }
        addTotals(globalCat.totals, lineReturnTotals);

        if (isSeparate && locNode) {
          let locCat = locNode.categories.find((c) => c.categoryName === catName);
          if (!locCat) {
            locCat = {
              categoryName: catName,
              brandName,
              divisionName,
              genderName,
              silhouetteName,
              totals: createEmptyTotals(),
              items: [],
            };
            locNode.categories.push(locCat);
          }
          addTotals(locCat.totals, lineReturnTotals);
        }
      }
    }

    // Process standalone PosClaims (if any)
    for (const clm of posClaims) {
      if (posReturns.some((r: any) => r.returnNumber === clm.claimNumber)) continue;

      const locId = clm.salesOrder?.locationId;
      const locName = locId ? locationMap.get(locId) || 'Main Outlet' : 'Main Outlet';
      const locKey = locId ? `loc:${locId}` : 'main-outlet';
      const cashierId = clm.salesOrder?.cashierUserId;
      let salesPerson = 'Default Cashier';
      if (cashierId && cashierMap.has(cashierId)) {
        salesPerson = cashierMap.get(cashierId)!;
      }
      const clmNo = clm.claimNumber || `CLM-${clm.id.slice(0, 8)}`;
      const docDate = clm.createdAt ? new Date(clm.createdAt).toISOString().split('T')[0] : 'N/A';
      const docMonth = docDate && docDate !== 'N/A' ? docDate.slice(0, 7) : 'all';
      const createdAt = clm.createdAt ? new Date(clm.createdAt).toISOString() : new Date().toISOString();
      const approvedAmt = Number(clm.approvedAmount || clm.claimedAmount || 0);
      const valExcl = Number((approvedAmt / 1.18).toFixed(2));

      let locNode = locationNodesMap.get(locKey);
      if (isSeparate && !locNode) {
        locNode = {
          locationKey: locKey,
          locationId: locId || undefined,
          locationName: locName,
          categories: [],
          totals: createEmptyTotals(),
        };
        locationNodesMap.set(locKey, locNode);
      }

      let claimQty = 0;
      const clmItems = clm.items || [];
      for (const it of clmItems) {
        claimQty += Number(it.claimedQty || 1);
      }
      if (claimQty === 0) claimQty = 1;

      const claimTotals: NetSalesSummaryTotals = {
        orderCount: 0,
        totalItemsSold: 0,
        totalItemsReturned: claimQty,
        netItems: -claimQty,
        retailSalesValue: -approvedAmt,
        wostAmount: -valExcl,
        discountAmount: 0,
        discountWostAmount: 0,
        valueExSalesTax: -valExcl,
        taxAmount: 0,
        valueInclSalesTax: -approvedAmt,
        grossSalesAmount: 0,
        returnAmount: approvedAmt,
        netSalesAmount: -approvedAmt,
      };

      addTotals(grandTotals, claimTotals);
      if (isSeparate && locNode) {
        addTotals(locNode.totals, claimTotals);
      }

      for (const it of clmItems) {
        const qty = Number(it.claimedQty || 1);
        const unitPrice = Number(it.unitPaidPrice || (approvedAmt / claimQty));
        const lineValExcl = Number((qty * (unitPrice / 1.18)).toFixed(2));
        const lineTotal = Number(it.claimedAmount || qty * unitPrice);
        const itemObj = it.item;

        const catName = itemObj?.category?.name || 'Unassigned Category';
        const brandName = itemObj?.brand?.name || 'Default Brand';
        const divisionName = itemObj?.division?.name || 'Default Division';
        const genderName = itemObj?.gender?.name || 'Default Gender';
        const silhouetteName = itemObj?.silhouette?.name || 'Default Silhouette';
        const sizeName = itemObj?.size?.name || 'Default';
        const colorName = itemObj?.color?.name || 'Default';
        const sku = itemObj?.sku || itemObj?.barCode || 'NO-SKU';
        const barCode = itemObj?.barCode || itemObj?.sku || '-';
        const description = itemObj?.description || itemObj?.sku || 'Claim Article';

        const lineClaimTotals: NetSalesSummaryTotals = {
          orderCount: 0,
          unitPrice,
          totalItemsSold: 0,
          totalItemsReturned: qty,
          netItems: -qty,
          retailSalesValue: -lineTotal,
          wostAmount: -lineValExcl,
          discountAmount: 0,
          discountWostAmount: 0,
          valueExSalesTax: -lineValExcl,
          taxAmount: 0,
          valueInclSalesTax: -lineTotal,
          grossSalesAmount: 0,
          returnAmount: lineTotal,
          netSalesAmount: -lineTotal,
        };

        const variantKey = `CLM:${clm.id}|${locId || 'main'}|${catName}|${brandName}|${divisionName}|${genderName}|${silhouetteName}|${sku}|${barCode}|${sizeName}|${colorName}|0`;

        let existingRecord = flatItemsMap.get(variantKey);
        if (!existingRecord) {
          existingRecord = {
            locationId: locId || undefined,
            cashierUserId: cashierId || undefined,
            locationName: locName,
            docNo: clmNo,
            docDate,
            docMonth,
            createdAt,
            salesPerson,
            taxRatePercent: 0,
            taxRateName: '0% Tax Exempt Group',
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
            unitPrice,
            soldQty: 0,
            returnQty: 0,
            netQty: 0,
            retailSalesValue: 0,
            wostAmount: 0,
            grossAmount: 0,
            returnAmount: 0,
            discountAmount: 0,
            discountWostAmount: 0,
            valueExSalesTax: 0,
            taxAmount: 0,
            valueInclSalesTax: 0,
            netAmount: 0,
          };
          flatItemsMap.set(variantKey, existingRecord);
        }

        existingRecord.returnQty += qty;
        existingRecord.netQty -= qty;
        existingRecord.retailSalesValue = Number(((existingRecord.retailSalesValue || 0) - lineTotal).toFixed(2));
        existingRecord.wostAmount = Number(((existingRecord.wostAmount || 0) - lineValExcl).toFixed(2));
        existingRecord.returnAmount = Number((existingRecord.returnAmount + lineTotal).toFixed(2));
        existingRecord.valueExSalesTax = Number(((existingRecord.valueExSalesTax || 0) - lineValExcl).toFixed(2));
        existingRecord.valueInclSalesTax = Number(((existingRecord.valueInclSalesTax || 0) - lineTotal).toFixed(2));
        existingRecord.netAmount = Number((existingRecord.netAmount - lineTotal).toFixed(2));

        let globalCat = globalCategoryNodesMap.get(catName);
        if (!globalCat) {
          globalCat = {
            categoryName: catName,
            brandName,
            divisionName,
            genderName,
            silhouetteName,
            totals: createEmptyTotals(),
            items: [],
          };
          globalCategoryNodesMap.set(catName, globalCat);
        }
        addTotals(globalCat.totals, lineClaimTotals);

        if (isSeparate && locNode) {
          let locCat = locNode.categories.find((c) => c.categoryName === catName);
          if (!locCat) {
            locCat = {
              categoryName: catName,
              brandName,
              divisionName,
              genderName,
              silhouetteName,
              totals: createEmptyTotals(),
              items: [],
            };
            locNode.categories.push(locCat);
          }
          addTotals(locCat.totals, lineClaimTotals);
        }
      }
    }

    const flatItems = Array.from(flatItemsMap.values());
    await onProgress?.(100, 'Net Sales Summary computation complete!');

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
    body: { fileName: string; fileBase64: string; mimeType: string },
  ) {
    const jobId = uuidv4();
    const fileBuffer = Buffer.from(body.fileBase64, 'base64');
    const tempDir = path.join(process.cwd(), 'uploads', 'exports');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const tempFilePath = path.join(tempDir, `temp-${jobId}-${body.fileName}`);
    fs.writeFileSync(tempFilePath, fileBuffer);

    const activePrisma = prisma || this.prisma;

    await activePrisma.exportHistory.create({
      data: {
        id: jobId,
        userId,
        fileName: body.fileName,
        filePath: path.join('uploads', 'exports', `temp-${jobId}-${body.fileName}`),
        moduleName: 'NET_SALES_SUMMARY_REPORT',
        status: 'PENDING',
      },
    });

    const fileUrl = await this.exportHistoryService.completeAndUploadExport(
      activePrisma,
      jobId,
      tempFilePath,
      body.fileName,
      body.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    return {
      historyId: jobId,
      downloadUrl: fileUrl || `/api/warehouse/export-history/download/${jobId}`,
    };
  }

  async streamFilteredSummaryPreviewExcel(
    jobId: string,
    options: {
      exportType?: 'flat' | 'hierarchical';
      search?: string;
      locationId?: string;
    },
    res: any,
  ): Promise<void> {
    const filePath = this.getPreviewFilePath(jobId);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Net sales summary preview result not found or expired');
    }

    const exportType = options.exportType || 'flat';
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `net-sales-summary-${exportType}-${dateStr}.xlsx`;

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

    const sheet = workbook.addWorksheet(exportType === 'flat' ? 'Net Sales Flat' : 'Net Sales Summary');
    const q = (options.search || '').trim().toLowerCase();
    const locSet =
      options.locationId && options.locationId !== 'all'
        ? new Set(options.locationId.split(',').map((s) => s.trim().toLowerCase()))
        : null;

    if (exportType === 'flat') {
      sheet.columns = [
        { header: 'Outlet / Location', key: 'locationName', width: 22 },
        { header: 'Month / Year', key: 'monthYear', width: 16 },
        { header: 'Doc Date', key: 'docDate', width: 16 },
        { header: 'Doc Number', key: 'docNo', width: 16 },
        { header: 'Salesperson / Cashier', key: 'salesPerson', width: 20 },
        { header: 'Tax Group Rate', key: 'taxRate', width: 14 },
        { header: 'Brand', key: 'brandName', width: 16 },
        { header: 'Division', key: 'divisionName', width: 16 },
        { header: 'Category', key: 'categoryName', width: 18 },
        { header: 'Gender', key: 'genderName', width: 14 },
        { header: 'Silhouette', key: 'silhouetteName', width: 16 },
        { header: 'SKU', key: 'sku', width: 16 },
        { header: 'Barcode', key: 'barCode', width: 16 },
        { header: 'Description', key: 'description', width: 28 },
        { header: 'Size', key: 'sizeName', width: 10 },
        { header: 'Color', key: 'colorName', width: 12 },
        { header: 'Unit Price', key: 'unitPrice', width: 12 },
        { header: 'Sold Qty', key: 'soldQty', width: 10 },
        { header: 'Return Qty', key: 'returnQty', width: 10 },
        { header: 'Net Qty', key: 'netQty', width: 10 },
        { header: 'Retail Sales Value', key: 'retailSalesValue', width: 16 },
        { header: 'WOST Amount', key: 'wostAmount', width: 14 },
        { header: 'Discount Amount', key: 'discountAmount', width: 14 },
        { header: 'Value Excl. Sales Tax', key: 'valueExSalesTax', width: 16 },
        { header: 'Sales Tax Amount', key: 'taxAmount', width: 14 },
        { header: 'Value Incl. Sales Tax / Net Revenue', key: 'valueInclSalesTax', width: 18 },
      ];

      let totalSold = 0;
      let totalReturn = 0;
      let totalNetQty = 0;
      let totalRetail = 0;
      let totalWost = 0;
      let totalDiscount = 0;
      let totalExTax = 0;
      let totalTax = 0;
      let totalInclTax = 0;

      const fileStream = fs.createReadStream(filePath);
      const gunzip = zlib.createGunzip();
      const lineReader = readline.createInterface({
        input: fileStream.pipe(gunzip),
        crlfDelay: Infinity,
      });

      for await (const line of lineReader) {
        if (!line || !line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'flatItems' && Array.isArray(parsed.flatItems)) {
            for (const item of parsed.flatItems) {
              if (locSet) {
                const loc = (item.locationName || '').toLowerCase();
                const locId = (item.locationId || '').toLowerCase();
                if (!locSet.has(loc) && !locSet.has(locId)) continue;
              }

              if (q) {
                const matches =
                  (item.sku || '').toLowerCase().includes(q) ||
                  (item.barCode || '').toLowerCase().includes(q) ||
                  (item.description || '').toLowerCase().includes(q) ||
                  (item.categoryName || '').toLowerCase().includes(q) ||
                  (item.brandName || '').toLowerCase().includes(q) ||
                  (item.docNo || '').toLowerCase().includes(q) ||
                  (item.locationName || '').toLowerCase().includes(q);
                if (!matches) continue;
              }

              const sold = Number(item.soldQty || 0);
              const ret = Number(item.returnQty || 0);
              const netQty = Number(item.netQty !== undefined ? item.netQty : sold - ret);
              const retail = Number(item.retailSalesValue || 0);
              const wost = Number(item.wostAmount || 0);
              const disc = Number(item.discountAmount || 0);
              const exTax = Number(item.valueExSalesTax || 0);
              const tax = Number(item.taxAmount || 0);
              const inclTax = Number(item.valueInclSalesTax || 0);

              totalSold += sold;
              totalReturn += ret;
              totalNetQty += netQty;
              totalRetail += retail;
              totalWost += wost;
              totalDiscount += disc;
              totalExTax += exTax;
              totalTax += tax;
              totalInclTax += inclTax;

              const row = sheet.addRow({
                locationName: item.locationName || '-',
                monthYear: item.docDate ? item.docDate.slice(0, 7) : '-',
                docDate: item.docDate ? item.docDate.slice(0, 10) : '-',
                docNo: item.docNo || '-',
                salesPerson: item.salesPerson || '-',
                taxRate: item.taxRateName || (item.taxRatePercent ? `${item.taxRatePercent}%` : '-'),
                brandName: item.brandName || '-',
                divisionName: item.divisionName || '-',
                categoryName: item.categoryName || '-',
                genderName: item.genderName || '-',
                silhouetteName: item.silhouetteName || '-',
                sku: item.sku || '-',
                barCode: item.barCode || '-',
                description: item.description || '-',
                sizeName: item.sizeName || '-',
                colorName: item.colorName || '-',
                unitPrice: Number(item.unitPrice || 0),
                soldQty: sold,
                returnQty: ret,
                netQty,
                retailSalesValue: retail,
                wostAmount: wost,
                discountAmount: disc,
                valueExSalesTax: exTax,
                taxAmount: tax,
                valueInclSalesTax: inclTax,
              });
              row.commit();
            }
          }
        } catch (_) {}
      }

      const summaryRow = sheet.addRow({
        locationName: 'FILTERED TOTALS',
        soldQty: totalSold,
        returnQty: totalReturn,
        netQty: totalNetQty,
        retailSalesValue: totalRetail,
        wostAmount: totalWost,
        discountAmount: totalDiscount,
        valueExSalesTax: totalExTax,
        taxAmount: totalTax,
        valueInclSalesTax: totalInclTax,
      });
      summaryRow.font = { bold: true };
      summaryRow.commit();
    } else {
      const result = await this.getReportPreviewResult(jobId);
      const hasLocNodes = Boolean(result?.locations && result.locations.length > 0);
      sheet.columns = [
        ...(hasLocNodes ? [{ header: 'Outlet / Location', key: 'locationName', width: 22 }] : []),
        { header: 'Category', key: 'categoryName', width: 22 },
        { header: 'Brand', key: 'brandName', width: 18 },
        { header: 'Division', key: 'divisionName', width: 16 },
        { header: 'Gender', key: 'genderName', width: 14 },
        { header: 'Silhouette', key: 'silhouetteName', width: 16 },
        { header: 'Sold Qty', key: 'soldQty', width: 10 },
        { header: 'Return Qty', key: 'returnQty', width: 10 },
        { header: 'Net Qty', key: 'netQty', width: 10 },
        { header: 'Retail Sales Value', key: 'retailSalesValue', width: 16 },
        { header: 'WOST Amount', key: 'wostAmount', width: 14 },
        { header: 'Discount Amount', key: 'discountAmount', width: 14 },
        { header: 'Value Excl. Sales Tax', key: 'valueExSalesTax', width: 16 },
        { header: 'Sales Tax Amount', key: 'taxAmount', width: 14 },
        { header: 'Value Incl. Sales Tax / Net Revenue', key: 'valueInclSalesTax', width: 18 },
      ];

      if (hasLocNodes && result?.locations) {
        for (const loc of result.locations) {
          if (locSet) {
            const lName = (loc.locationName || '').toLowerCase();
            const lId = (loc.locationId || '').toLowerCase();
            if (!locSet.has(lName) && !locSet.has(lId)) continue;
          }
          for (const cat of loc.categories || []) {
            const totals = cat.totals;
            const row = sheet.addRow({
              locationName: loc.locationName,
              categoryName: cat.categoryName || '-',
              brandName: cat.brandName || '-',
              divisionName: cat.divisionName || '-',
              genderName: cat.genderName || '-',
              silhouetteName: cat.silhouetteName || '-',
              soldQty: totals.totalItemsSold,
              returnQty: totals.totalItemsReturned,
              netQty: totals.netItems,
              retailSalesValue: totals.retailSalesValue,
              wostAmount: totals.wostAmount,
              discountAmount: totals.discountAmount,
              valueExSalesTax: totals.valueExSalesTax,
              taxAmount: totals.taxAmount,
              valueInclSalesTax: totals.valueInclSalesTax,
            });
            row.commit();
          }
        }
      } else if (result?.categories) {
        for (const cat of result.categories) {
          const totals = cat.totals;
          const row = sheet.addRow({
            categoryName: cat.categoryName || '-',
            brandName: cat.brandName || '-',
            divisionName: cat.divisionName || '-',
            genderName: cat.genderName || '-',
            silhouetteName: cat.silhouetteName || '-',
            soldQty: totals.totalItemsSold,
            returnQty: totals.totalItemsReturned,
            netQty: totals.netItems,
            retailSalesValue: totals.retailSalesValue,
            wostAmount: totals.wostAmount,
            discountAmount: totals.discountAmount,
            valueExSalesTax: totals.valueExSalesTax,
            taxAmount: totals.taxAmount,
            valueInclSalesTax: totals.valueInclSalesTax,
          });
          row.commit();
        }
      }

      const gt = result?.grandTotals;
      if (gt) {
        const summaryRow = sheet.addRow({
          ...(hasLocNodes ? { locationName: 'GRAND TOTALS' } : {}),
          categoryName: hasLocNodes ? '-' : 'GRAND TOTALS',
          soldQty: gt.totalItemsSold,
          returnQty: gt.totalItemsReturned,
          netQty: gt.netItems,
          retailSalesValue: gt.retailSalesValue,
          wostAmount: gt.wostAmount,
          discountAmount: gt.discountAmount,
          valueExSalesTax: gt.valueExSalesTax,
          taxAmount: gt.taxAmount,
          valueInclSalesTax: gt.valueInclSalesTax,
        });
        summaryRow.font = { bold: true };
        summaryRow.commit();
      }
    }

    sheet.commit();
    await workbook.commit();
  }
}
