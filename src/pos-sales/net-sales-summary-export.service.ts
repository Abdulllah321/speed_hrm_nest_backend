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
  totalItemsSold: number;
  totalItemsReturned: number;
  netItems: number;
  retailSalesValue: number;
  wostAmount: number;
  discountAmount: number;
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

          // Line 2: Categories (totals only, empty items)
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

          // Line 3..N: Flat items chunked into batches (1,500 records per line)
          const flatItems = result.flatItems || [];
          for (let i = 0; i < flatItems.length; i += 1500) {
            const slice = flatItems.slice(i, i + 1500);
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
    const filePath = this.getPreviewFilePath(jobId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    if (filePath.endsWith('.ndjson.gz')) {
      const fileStream = fs.createReadStream(filePath);
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

    const compressed = await fs.promises.readFile(filePath);
    const decompressed = await gunzipAsync(compressed);
    return JSON.parse(decompressed.toString('utf8'));
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
      totalItemsSold: 0,
      totalItemsReturned: 0,
      netItems: 0,
      retailSalesValue: 0,
      wostAmount: 0,
      discountAmount: 0,
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
      target.retailSalesValue += source.retailSalesValue;
      target.wostAmount += source.wostAmount;
      target.discountAmount += source.discountAmount;
      target.valueExSalesTax += source.valueExSalesTax;
      target.taxAmount += source.taxAmount;
      target.valueInclSalesTax += source.valueInclSalesTax;

      // Legacy field aliases
      target.grossSalesAmount += source.grossSalesAmount;
      target.returnAmount += source.returnAmount;
      target.netSalesAmount += source.netSalesAmount;
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

          const calculatedTaxPct =
            taxPercent > 0
              ? taxPercent
              : tax > 0 && Number(item.lineTotal || 0) - tax > 0
              ? Math.round((tax / (Number(item.lineTotal || 0) - tax)) * 100 * 100) / 100
              : tax > 0
              ? 18
              : 0;
          const taxDivisor = 1 + calculatedTaxPct / 100;

          const wostPerUnit = unitPrice / taxDivisor;
          const wostAmount = Math.round(wostPerUnit * qty * 100) / 100;
          const valueExSalesTax = Math.round((wostAmount - disc) * 100) / 100;
          const taxAmount = tax > 0 ? tax : Math.round((valueExSalesTax * (calculatedTaxPct / 100)) * 100) / 100;
          const valueInclSalesTax = Math.round((valueExSalesTax + taxAmount) * 100) / 100;
          const grossAmt = unitPrice * qty;

          const lineTotals: NetSalesSummaryTotals = {
            orderCount: 1,
            unitPrice,
            totalItemsSold: qty,
            totalItemsReturned: 0,
            netItems: qty,
            retailSalesValue: grossAmt,
            wostAmount,
            discountAmount: disc,
            valueExSalesTax,
            taxAmount,
            valueInclSalesTax,
            grossSalesAmount: grossAmt,
            returnAmount: 0,
            netSalesAmount: valueInclSalesTax,
          };

          addTotals(grandTotals, lineTotals);

          const sku = item.item?.sku || item.item?.barCode || 'NO-SKU';
          const barCode = item.item?.barCode || item.item?.sku || '-';
          const description = item.item?.description || item.item?.sku || 'Article';
          const sizeName = item.item?.size?.name || 'Default';
          const colorName = item.item?.color?.name || 'Default';
          const monthKey = docDate && docDate !== 'N/A' ? docDate.slice(0, 7) : 'all';
          const taxRateName = calculatedTaxPct > 0 ? `${calculatedTaxPct}% Sales Tax Group` : '0% Tax Exempt Group';

          const variantKey = `${order.locationId || 'main'}|${monthKey}|${catName}|${brandName}|${divisionName}|${genderName}|${silhouetteName}|${sku}|${barCode}|${sizeName}|${colorName}|${calculatedTaxPct}`;

          let existingRecord = flatItemsMap.get(variantKey);
          if (!existingRecord) {
            existingRecord = {
              locationId: order.locationId || undefined,
              locationName: locName,
              docDate: `${monthKey}-01`,
              docMonth: monthKey,
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
              valueExSalesTax: 0,
              taxAmount: 0,
              valueInclSalesTax: 0,
              netAmount: 0,
            };
            flatItemsMap.set(variantKey, existingRecord);
          }

          existingRecord.soldQty += qty;
          existingRecord.netQty += qty;
          existingRecord.retailSalesValue = Math.round(((existingRecord.retailSalesValue || 0) + grossAmt) * 100) / 100;
          existingRecord.wostAmount = Math.round(((existingRecord.wostAmount || 0) + wostAmount) * 100) / 100;
          existingRecord.grossAmount = Math.round((existingRecord.grossAmount + grossAmt) * 100) / 100;
          existingRecord.discountAmount = Math.round((existingRecord.discountAmount + disc) * 100) / 100;
          existingRecord.valueExSalesTax = Math.round(((existingRecord.valueExSalesTax || 0) + valueExSalesTax) * 100) / 100;
          existingRecord.taxAmount = Math.round((existingRecord.taxAmount + taxAmount) * 100) / 100;
          existingRecord.valueInclSalesTax = Math.round(((existingRecord.valueInclSalesTax || 0) + valueInclSalesTax) * 100) / 100;
          existingRecord.netAmount = Math.round((existingRecord.netAmount + valueInclSalesTax) * 100) / 100;
          if (existingRecord.soldQty > 0) {
            existingRecord.unitPrice = Math.round((existingRecord.grossAmount / existingRecord.soldQty) * 100) / 100;
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
            addTotals(locNode.totals, lineTotals);
          }
        }
      }

      processedOrders += chunkOrders.length;
      const pct = Math.min(55, 25 + Math.round((processedOrders / (totalOrdersCount || 1)) * 30));
      await onProgress?.(pct, `Processed ${processedOrders.toLocaleString()} of ${totalOrdersCount.toLocaleString()} sales orders...`);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 2: Process Gross Sales Returns (pos_returns & unlinked stock_ledgers)
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

    const [posReturns, returnLedgerEntries] = await Promise.all([
      (prisma as any).posReturn.findMany({
        where: posReturnWhere,
        include: {
          salesOrder: {
            include: {
              customer: { select: { name: true, contactNo: true } },
            },
          },
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
      }),
      (prisma as any).stockLedger.findMany({
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
      }),
    ]);

    const handledPosReturnIds = new Set<string>(posReturns.map((r: any) => r.id));
    const handledSalesOrderIds = new Set<string>(posReturns.map((r: any) => r.salesOrderId).filter(Boolean));

    const orphanEntries = returnLedgerEntries.filter(
      (e: any) => !handledPosReturnIds.has(e.referenceId) && !handledSalesOrderIds.has(e.referenceId),
    );

    let orphanSourceOrders: any[] = [];
    if (orphanEntries.length > 0) {
      const orphanRefIds = [...new Set(orphanEntries.map((e: any) => e.referenceId).filter(Boolean))] as string[];
      orphanSourceOrders = await (prisma as any).salesOrder.findMany({
        where: { id: { in: orphanRefIds } },
        include: {
          items: true,
        },
      });
    }
    const orphanOrderMap = new Map<string, any>(orphanSourceOrders.map((o: any) => [o.id, o]));

    await onProgress?.(80, 'Merging sales returns into Net Sales Summary matrix...');

    const processReturnItem = (params: {
      locationId?: string;
      createdAt?: Date;
      item: any;
      quantity: number;
      unitPrice: number;
      taxPercent: number;
      discWost: number;
      lineTotalWost: number;
      taxAmt: number;
      docNo: string;
      cashierUserId?: string;
    }) => {
      const {
        locationId,
        createdAt,
        item,
        quantity: retQty,
        unitPrice: rawUnitPrice,
        taxPercent: rawTaxPercent,
        discWost: rawDiscWost,
        lineTotalWost: rawLineTotalWost,
        taxAmt: rawTaxAmt,
        docNo,
        cashierUserId,
      } = params;

      if (!item || retQty <= 0) return;

      const locName = locationId ? locationMap.get(locationId) || 'Main Outlet' : 'Main Outlet';
      const locKey = locationId ? `loc:${locationId}` : 'main-outlet';
      const docDate = createdAt ? new Date(createdAt).toISOString().split('T')[0] : 'N/A';
      const monthKey = docDate && docDate !== 'N/A' ? docDate.slice(0, 7) : 'all';

      let salesPerson = 'Default Cashier';
      if (cashierUserId && cashierMap.has(cashierUserId)) {
        salesPerson = cashierMap.get(cashierUserId)!;
      }

      const catName = item.category?.name || 'Unassigned Category';
      const brandName = item.brand?.name || 'Default Brand';
      const divisionName = item.division?.name || 'Default Division';
      const genderName = item.gender?.name || 'Default Gender';
      const silhouetteName = item.silhouette?.name || 'Default Silhouette';

      const unitPrice = Number(rawUnitPrice || item.unitPrice || 0);
      const calculatedTaxPct = Number(rawTaxPercent || 18);
      const taxDivisor = 1 + calculatedTaxPct / 100;

      const wostPerUnit = unitPrice / taxDivisor;
      const wostAmount = rawLineTotalWost !== 0 ? Math.abs(rawLineTotalWost) : Math.round(wostPerUnit * retQty * 100) / 100;
      const disc = Math.abs(rawDiscWost);
      const valueExSalesTax = Math.round((wostAmount - disc) * 100) / 100;
      const taxAmount = rawTaxAmt !== 0 ? Math.abs(rawTaxAmt) : Math.round((valueExSalesTax * (calculatedTaxPct / 100)) * 100) / 100;
      const valueInclSalesTax = Math.round((valueExSalesTax + taxAmount) * 100) / 100;
      const grossAmt = unitPrice * retQty;

      const returnTotals: NetSalesSummaryTotals = {
        orderCount: 0,
        unitPrice,
        totalItemsSold: 0,
        totalItemsReturned: retQty,
        netItems: -retQty,
        retailSalesValue: -grossAmt,
        wostAmount: -wostAmount,
        discountAmount: -disc,
        valueExSalesTax: -valueExSalesTax,
        taxAmount: -taxAmount,
        valueInclSalesTax: -valueInclSalesTax,
        grossSalesAmount: 0,
        returnAmount: valueInclSalesTax,
        netSalesAmount: -valueInclSalesTax,
      };

      addTotals(grandTotals, returnTotals);

      const sku = item.sku || item.barCode || 'NO-SKU';
      const barCode = item.barCode || item.sku || '-';
      const description = item.description || item.sku || 'Article';
      const sizeName = item.size?.name || 'Default';
      const colorName = item.color?.name || 'Default';
      const taxRateName = calculatedTaxPct > 0 ? `${calculatedTaxPct}% Sales Tax Group` : '0% Tax Exempt Group';

      const variantKey = `${locationId || 'main'}|${monthKey}|${catName}|${brandName}|${divisionName}|${genderName}|${silhouetteName}|${sku}|${barCode}|${sizeName}|${colorName}|${calculatedTaxPct}`;

      let existingRecord = flatItemsMap.get(variantKey);
      if (!existingRecord) {
        existingRecord = {
          locationId: locationId || undefined,
          locationName: locName,
          docDate: `${monthKey}-01`,
          docMonth: monthKey,
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
          valueExSalesTax: 0,
          taxAmount: 0,
          valueInclSalesTax: 0,
          netAmount: 0,
        };
        flatItemsMap.set(variantKey, existingRecord);
      }

      existingRecord.returnQty += retQty;
      existingRecord.netQty -= retQty;
      existingRecord.retailSalesValue = Math.round(((existingRecord.retailSalesValue || 0) - grossAmt) * 100) / 100;
      existingRecord.wostAmount = Math.round(((existingRecord.wostAmount || 0) - wostAmount) * 100) / 100;
      existingRecord.returnAmount = Math.round((existingRecord.returnAmount + valueInclSalesTax) * 100) / 100;
      existingRecord.discountAmount = Math.round((existingRecord.discountAmount - disc) * 100) / 100;
      existingRecord.valueExSalesTax = Math.round(((existingRecord.valueExSalesTax || 0) - valueExSalesTax) * 100) / 100;
      existingRecord.taxAmount = Math.round((existingRecord.taxAmount - taxAmount) * 100) / 100;
      existingRecord.valueInclSalesTax = Math.round(((existingRecord.valueInclSalesTax || 0) - valueInclSalesTax) * 100) / 100;
      existingRecord.netAmount = Math.round((existingRecord.netAmount - valueInclSalesTax) * 100) / 100;

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
      addTotals(globalCat.totals, returnTotals);

      if (isSeparate) {
        let locNode = locationNodesMap.get(locKey);
        if (!locNode) {
          locNode = {
            locationKey: locKey,
            locationId: locationId || undefined,
            locationName: locName,
            categories: [],
            totals: createEmptyTotals(),
          };
          locationNodesMap.set(locKey, locNode);
        }
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
        addTotals(locCat.totals, returnTotals);
        addTotals(locNode.totals, returnTotals);
      }
    };

    // 2a. Process PosReturn items
    for (const ret of posReturns) {
      for (const item of ret.items) {
        processReturnItem({
          locationId: ret.locationId,
          createdAt: ret.createdAt,
          item: item.item,
          quantity: Math.abs(Number(item.quantity || 1)),
          unitPrice: Number(item.originalUnitPrice || item.originalPaidPerUnit || item.unitPrice || 0),
          taxPercent: Number(item.taxPercent || 18),
          discWost: Number(item.discountWost || 0),
          lineTotalWost: Number(item.lineTotalWost || 0),
          taxAmt: Number(item.taxAmount || 0),
          docNo: ret.returnNumber || 'POS-RETURN',
          cashierUserId: ret.cashierUserId,
        });
      }
    }

    // 2b. Process Orphan Stock Ledger Returns
    for (const entry of orphanEntries) {
      if (!entry.item) continue;
      const srcOrder = orphanOrderMap.get(entry.referenceId);
      const matchedOi = srcOrder?.items?.find((i: any) => i.itemId === entry.itemId);
      const retQty = Math.abs(Number(entry.qty || 1));
      const unitPrice = matchedOi ? Number(matchedOi.unitPrice || 0) : Number(entry.item.unitPrice || 0);
      const taxPercent = matchedOi ? Number((matchedOi as any).taxPercent || (matchedOi as any).taxRate || 18) : 18;
      const disc = matchedOi
        ? Math.round((Number(matchedOi.discountAmount || 0) / (Number(matchedOi.quantity) || 1)) * retQty * 100) / 100
        : 0;

      processReturnItem({
        locationId: entry.locationId,
        createdAt: entry.createdAt,
        item: entry.item,
        quantity: retQty,
        unitPrice,
        taxPercent,
        discWost: disc,
        lineTotalWost: 0,
        taxAmt: 0,
        docNo: srcOrder?.orderNumber || entry.referenceId || 'POS-RETURN',
        cashierUserId: srcOrder?.cashierUserId,
      });
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
