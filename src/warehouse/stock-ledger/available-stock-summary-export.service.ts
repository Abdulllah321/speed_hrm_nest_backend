import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadService } from '../../upload/upload.service';
import { MovementType, PrismaClient } from '@prisma/client';

export interface QueueAvailableStockSummaryExportOptions {
  userId: string;
  locationId?: string;
  warehouseId?: string;
  startDate?: string;
  endDate?: string;
  format: 'xlsx' | 'pdf';
  exportType?: 'hierarchical' | 'flat';
  reportType?: 'merged' | 'separate';
  summaryOnly?: boolean;
  showBrand?: boolean;
  showDivision?: boolean;
  showCategory?: boolean;
  showGender?: boolean;
  showSilhouette?: boolean;
  showArticle?: boolean;
  showVariant?: boolean;
  includeCosting?: boolean;
  previewJobId?: string;
}

import { FiscalYearClosingService } from './fiscal-year-closing.service';

@Injectable()
export class AvailableStockSummaryExportService {
  private readonly logger = new Logger(AvailableStockSummaryExportService.name);
  private readonly cancelledPreviewJobIds = new Set<string>();

  constructor(
    @InjectQueue('available-stock-summary-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
    private readonly fiscalClosingService: FiscalYearClosingService,
  ) {}

  isJobCancelled(jobId?: string): boolean {
    if (!jobId) return false;
    return this.cancelledPreviewJobIds.has(jobId);
  }

  async queueReportPreview(opts: {
    userId: string;
    locationId?: string;
    warehouseId?: string;
    startDate?: string;
    endDate?: string;
    reportType?: 'merged' | 'separate';
    summaryOnly?: boolean;
    showBrand?: boolean;
    showDivision?: boolean;
    showCategory?: boolean;
    showGender?: boolean;
    showSilhouette?: boolean;
    showArticle?: boolean;
    showVariant?: boolean;
  }): Promise<{ jobId: string; queuePosition: number; waitingCount: number }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

    // Cancel any waiting or active preview jobs previously queued by this user to prevent queue buildup
    if (opts.userId) {
      try {
        const [waitingJobs, activeJobs] = await Promise.all([
          this.exportQueue.getWaiting(),
          this.exportQueue.getActive(),
        ]);

        for (const wJob of waitingJobs) {
          if (
            wJob.name === 'generate-report-preview' &&
            wJob.data?.userId === opts.userId
          ) {
            this.logger.log(`Pruning superseded waiting available stock preview job ${wJob.id} for user ${opts.userId}`);
            if (wJob.data?.jobId) this.cancelledPreviewJobIds.add(wJob.data.jobId);
            await wJob.remove();
          }
        }

        for (const aJob of activeJobs) {
          if (
            aJob.name === 'generate-report-preview' &&
            aJob.data?.userId === opts.userId
          ) {
            const activeJobId = aJob.data?.jobId;
            this.logger.log(`Cancelling active running available stock preview job ${activeJobId} for user ${opts.userId}`);
            if (activeJobId) this.cancelledPreviewJobIds.add(activeJobId);
          }
        }
      } catch (err: any) {
        this.logger.warn(`Could not prune available stock preview jobs for user ${opts.userId}: ${err.message}`);
      }
    }

    await this.exportQueue.add(
      'generate-report-preview',
      {
        jobId,
        userId: opts.userId,
        tenantId,
        tenantDbUrl,
        locationId: opts.locationId,
        warehouseId: opts.warehouseId,
        startDate: opts.startDate,
        endDate: opts.endDate,
        reportType: opts.reportType || 'merged',
        summaryOnly: !!opts.summaryOnly,
        showBrand: opts.showBrand,
        showDivision: opts.showDivision,
        showCategory: opts.showCategory,
        showGender: opts.showGender,
        showSilhouette: opts.showSilhouette,
        showArticle: opts.showArticle,
        showVariant: opts.showVariant,
      },
      {
        jobId,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    const [waiting, active] = await Promise.all([
      this.exportQueue.getWaiting(),
      this.exportQueue.getActive(),
    ]);

    const allJobs = [...active, ...waiting];
    const idx = allJobs.findIndex((j) => j.id?.toString() === jobId);
    const queuePosition = idx >= 0 ? idx + 1 : 1;

    return { jobId, queuePosition, waitingCount: waiting.length };
  }

  async getJobQueueStatus(jobId: string): Promise<{
    state: string;
    progress: number;
    message: string;
    queuePosition: number;
    waitingCount: number;
    failedReason?: string;
  }> {
    const job = await this.exportQueue.getJob(jobId);
    if (!job) {
      return { state: 'unknown', progress: 0, message: '', queuePosition: 0, waitingCount: 0 };
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
      const idx = allJobs.findIndex((j) => j.id?.toString() === jobId);
      queuePosition = idx >= 0 ? idx + 1 : 1;
    }

    return {
      state,
      progress,
      message,
      queuePosition,
      waitingCount,
      failedReason: job.failedReason,
    };
  }

  saveReportPreviewResult(jobId: string, data: any): void {
    const previewDir = path.join(process.cwd(), 'uploads', 'previews');
    fs.mkdirSync(previewDir, { recursive: true });

    let serializableItemMetricsMap: Record<string, any> | undefined;
    if (data?.itemMetricsMap instanceof Map) {
      serializableItemMetricsMap = Object.fromEntries(data.itemMetricsMap);
    } else if (typeof data?.itemMetricsMap === 'object' && data?.itemMetricsMap !== null) {
      serializableItemMetricsMap = data.itemMetricsMap;
    }

    const payloadToSerialize = {
      ...data,
      itemMetricsMap: serializableItemMetricsMap,
    };

    const jsonStr = JSON.stringify(payloadToSerialize);
    const gzipped = zlib.gzipSync(jsonStr);
    const filePath = path.join(previewDir, `preview-${jobId}.json.gz`);
    fs.writeFileSync(filePath, gzipped);

    // Auto cleanup temp file after 1 hour
    setTimeout(() => {
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      }
    }, 60 * 60 * 1000);
  }

  getReportPreviewResult(jobId: string): any {
    const filePath = path.join(process.cwd(), 'uploads', 'previews', `preview-${jobId}.json.gz`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const gzipped = fs.readFileSync(filePath);
    const jsonStr = zlib.gunzipSync(gzipped).toString('utf-8');
    const parsed = JSON.parse(jsonStr);
    if (parsed && parsed.itemMetricsMap && !(parsed.itemMetricsMap instanceof Map)) {
      parsed.itemMetricsMap = new Map(Object.entries(parsed.itemMetricsMap));
    }
    return parsed;
  }

  async queueExport(opts: QueueAvailableStockSummaryExportOptions): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const ext = opts.format === 'pdf' ? 'pdf' : 'xlsx';

    // Save export job request in history audit table
    await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName: `available-stock-summary-${new Date().toISOString().slice(0, 10)}.${ext}`,
        filePath: path.join('uploads', 'exports', `export-${jobId}.${ext}`),
        moduleName: 'AVAILABLE_STOCK_SUMMARY_REPORT',
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
        warehouseId: opts.warehouseId,
        startDate: opts.startDate,
        endDate: opts.endDate,
        format: opts.format,
        exportType: opts.exportType,
        reportType: opts.reportType || 'merged',
        summaryOnly: !!opts.summaryOnly,
        showBrand: opts.showBrand,
        showDivision: opts.showDivision,
        showCategory: opts.showCategory,
        showGender: opts.showGender,
        showSilhouette: opts.showSilhouette,
        showArticle: opts.showArticle,
        showVariant: opts.showVariant,
        includeCosting: !!opts.includeCosting,
        previewJobId: opts.previewJobId,
      },
      {
        jobId,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
        timeout: 2 * 60 * 60 * 1000,
      },
    );

    this.logger.log(`[AvailableStockSummaryExport] Queued job ${jobId} for user ${opts.userId} (format: ${opts.format}, type: ${opts.exportType || 'hierarchical'}, mode: ${opts.reportType || 'merged'}, tenant: ${tenantId})`);
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

    // Increment download count in ExportHistory
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

    let filePath = path.join(process.cwd(), record.filePath);

    if (!fs.existsSync(filePath)) {
      const publicFallback = path.join(process.cwd(), 'public', record.filePath);
      if (fs.existsSync(publicFallback)) {
        filePath = publicFallback;
      } else {
        throw new NotFoundException('Export file not found. It may have expired or the job is still running.');
      }
    }

    const stat = fs.statSync(filePath);

    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      this.logger.error(`[AvailableStockSummaryExport] Stream error: ${err.message}`);
    });

    const isPdf = record.fileName.endsWith('.pdf');
    res.header('Content-Type', isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename="${record.fileName}"`);
    res.header('Content-Length', stat.size);
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(stream);
  }

  // Get report data in memory for inline UI rendering
  async getAvailableStockSummaryReportData(opts: {
    locationId?: string;
    warehouseId?: string;
    startDate?: string;
    endDate?: string;
    reportType?: 'merged' | 'separate';
    summaryOnly?: boolean;
    showBrand?: boolean;
    showDivision?: boolean;
    showCategory?: boolean;
    showGender?: boolean;
    showSilhouette?: boolean;
    showArticle?: boolean;
    showVariant?: boolean;
    previewJobId?: string;
    isAborted?: () => boolean;
  }) {
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);

    return this.generateAvailableStockSummaryReportDataInternal(prisma, opts);
  }

  // Core Available Stock Summary logic shared between UI preview and processor
  async generateAvailableStockSummaryReportDataInternal(
    prisma: PrismaClient | PrismaService,
    opts: {
      locationId?: string;
      warehouseId?: string;
      startDate?: string;
      endDate?: string;
      reportType?: 'merged' | 'separate';
      summaryOnly?: boolean;
      showBrand?: boolean;
      showDivision?: boolean;
      showCategory?: boolean;
      showGender?: boolean;
      showSilhouette?: boolean;
      showArticle?: boolean;
      showVariant?: boolean;
      previewJobId?: string;
      isAborted?: () => boolean;
      onProgress?: (percent: number, message: string) => Promise<void> | void;
    },
  ) {
    const {
      locationId,
      warehouseId,
      startDate: startStr,
      endDate: endStr,
      reportType = 'merged',
      summaryOnly,
      showBrand,
      showDivision,
      showCategory,
      showGender,
      showSilhouette,
      showArticle,
      showVariant,
      previewJobId,
      isAborted,
      onProgress,
    } = opts;

    const checkCancelled = () => isAborted?.() || (previewJobId && this.isJobCancelled(previewJobId));

    if (checkCancelled()) {
      this.logger.log(`[ReportPreview ${previewJobId}] Computation aborted early as job was cancelled by user.`);
      return { root: [], grandTotals: this.createEmptyTotals(), items: [], itemMetricsMap: new Map(), flatItemsList: [] };
    }

    const locIds = locationId ? locationId.split(',').map(s => s.trim()).filter(Boolean) : [];
    const whIds = warehouseId ? warehouseId.split(',').map(s => s.trim()).filter(Boolean) : [];

    const locationWhere = locIds.length > 1 ? { in: locIds } : (locIds.length === 1 ? locIds[0] : undefined);
    const warehouseWhere = whIds.length > 1 ? { in: whIds } : (whIds.length === 1 ? whIds[0] : undefined);

    const locOrWhFilters: any[] = [];
    if (locationWhere) locOrWhFilters.push({ locationId: locationWhere });
    if (warehouseWhere) locOrWhFilters.push({ warehouseId: warehouseWhere });

    const locationOrWarehouseWhere = locOrWhFilters.length > 1
      ? { OR: locOrWhFilters }
      : (locOrWhFilters.length === 1 ? locOrWhFilters[0] : {});

    const isSeparate = reportType === 'separate';

    const sBrand = showBrand !== false;
    const sDivision = showDivision !== false;
    const sCategory = showCategory !== false;
    const sGender = showGender !== false;
    const sSilhouette = showSilhouette !== false;
    const sArticle = showArticle !== false;
    const sVariant = showVariant !== undefined ? showVariant : !summaryOnly;

    const levels: string[] = [];
    if (isSeparate) levels.push('location');
    if (sBrand) levels.push('brand');
    if (sDivision) levels.push('division');
    if (sCategory) levels.push('category');
    if (sGender) levels.push('gender');
    if (sSilhouette) levels.push('silhouette');
    if (sArticle) levels.push('article');
    if (sVariant) levels.push('variant');

    if (levels.length === 0) {
      levels.push(isSeparate ? 'location' : 'brand');
    }

    const now = new Date();
    const startDate = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = endStr ? new Date(endStr) : new Date(now);

    await onProgress?.(15, 'Loading outlet and warehouse location metadata...');

    // Location & Warehouse names lookup for Separate mode
    const locationNameMap = new Map<string, string>();
    if (isSeparate) {
      const [allLocations, allWarehouses] = await Promise.all([
        prisma.location.findMany({ select: { id: true, name: true } }),
        prisma.warehouse.findMany({ select: { id: true, name: true } }),
      ]);
      for (const l of allLocations) locationNameMap.set(`loc:${l.id}`, `${l.name} (Outlet)`);
      for (const w of allWarehouses) locationNameMap.set(`wh:${w.id}`, `${w.name} (Warehouse)`);
    }

    // Resolve nearest Fiscal Opening Snapshot date
    const snapshotDate = await this.fiscalClosingService.findLatestFiscalOpeningSnapshotDate(prisma, startDate);
    const queryStartDate = snapshotDate && snapshotDate < startDate ? snapshotDate : startDate;

    await onProgress?.(25, 'Discovering inventory items & stock ledgers...');

    // Concurrent discovery of inventory items and ledger items within query date window
    const [inventoryItems, ledgerItems] = await Promise.all([
      prisma.inventoryItem.findMany({
        where: {
          ...locationOrWarehouseWhere,
        },
        select: { itemId: true, locationId: true, warehouseId: true },
      }),
      prisma.stockLedger.findMany({
        where: {
          ...locationOrWarehouseWhere,
          createdAt: { gte: queryStartDate, lte: endDate },
        },
        select: { itemId: true },
        distinct: ['itemId'],
      }),
    ]);

    if (isAborted?.()) {
      return { root: [], grandTotals: this.createEmptyTotals(), items: [], itemMetricsMap: new Map(), flatItemsList: [] };
    }

    let uniqueItemIds = [...new Set([
      ...inventoryItems.map(i => i.itemId),
      ...ledgerItems.map(l => l.itemId),
    ])];

    if (uniqueItemIds.length === 0) {
      const allItemsFallback = await prisma.item.findMany({
        select: { id: true },
        take: 2000,
      });
      uniqueItemIds = allItemsFallback.map(i => i.id);
    }

    if (uniqueItemIds.length === 0) {
      return { root: [], grandTotals: this.createEmptyTotals(), items: [], itemMetricsMap: new Map(), flatItemsList: [] };
    }

    await onProgress?.(40, 'Fetching product catalog, brands, categories & size details...');

    // Safely chunk item fetching to prevent database query parameter limit errors
    const CHUNK_SIZE = 1000;
    const itemChunks: string[][] = [];
    for (let i = 0; i < uniqueItemIds.length; i += CHUNK_SIZE) {
      itemChunks.push(uniqueItemIds.slice(i, i + CHUNK_SIZE));
    }

    const itemsNested = await Promise.all(
      itemChunks.map(chunk =>
        prisma.item.findMany({
          where: {
            OR: [
              { id: { in: chunk } },
              { itemId: { in: chunk } },
            ],
          },
          include: {
            color: true,
            size: true,
            gender: true,
            category: true,
            division: true,
            brand: true,
            silhouette: true,
          },
        })
      )
    );

    const items = itemsNested.flat();
    if (items.length === 0 || isAborted?.()) {
      return { root: [], grandTotals: this.createEmptyTotals(), items: [], itemMetricsMap: new Map(), flatItemsList: [] };
    }

    const matchedItemIds = items.map(i => i.id);
    const matchedItemChunks: string[][] = [];
    for (let i = 0; i < matchedItemIds.length; i += CHUNK_SIZE) {
      matchedItemChunks.push(matchedItemIds.slice(i, i + CHUNK_SIZE));
    }

    const groupByCols: ('itemId' | 'locationId' | 'warehouseId')[] = isSeparate ? ['itemId', 'locationId', 'warehouseId'] : ['itemId'];

    const toLocOrWhFilters: any[] = [];
    if (locationWhere) toLocOrWhFilters.push({ toLocationId: locationWhere });
    if (warehouseWhere) toLocOrWhFilters.push({ toWarehouseId: warehouseWhere });

    const toLocOrWhWhere = toLocOrWhFilters.length > 1
      ? { OR: toLocOrWhFilters }
      : (toLocOrWhFilters.length === 1 ? toLocOrWhFilters[0] : {});

    await onProgress?.(55, `Executing queries for ${matchedItemIds.length} items across ${matchedItemChunks.length} chunks (stock movements, transit & reserves)...`);

    // Execute ALL database query pipelines concurrently via Promise.all
    const [
      bfGroupResults,
      inRangeOpeningResults,
      tenantSettingsResults,
      ledgerEntriesResults,
      transitItemsResults,
      reserveGroupResults,
    ] = await Promise.all([
      // 1. Compute BF (Opening balance before startDate)
      Promise.all(
        matchedItemChunks.map(chunk =>
          prisma.stockLedger.groupBy({
            by: groupByCols,
            where: {
              ...locationOrWarehouseWhere,
              itemId: { in: chunk },
              createdAt: { lt: startDate },
            },
            _sum: { qty: true },
          })
        )
      ),
      // 2. Query OPENING_BALANCE entries within range
      Promise.all(
        matchedItemChunks.map(chunk =>
          prisma.stockLedger.groupBy({
            by: groupByCols,
            where: {
              ...locationOrWarehouseWhere,
              itemId: { in: chunk },
              createdAt: { gte: startDate, lte: endDate },
              OR: [
                { movementType: MovementType.OPENING_BALANCE },
                { referenceType: 'OPENING_BALANCE' },
                { referenceType: 'BULK_STOCK_UPLOAD' }
              ]
            },
            _sum: { qty: true },
          })
        )
      ),
      // 3. Fetch tenant item settings
      Promise.all(
        matchedItemChunks.map(chunk =>
          prisma.tenantItemSetting.findMany({
            where: { itemId: { in: chunk } },
          })
        )
      ),
      // 4. Query normal ledger entries within range
      Promise.all(
        matchedItemChunks.map(chunk =>
          prisma.stockLedger.findMany({
            where: {
              ...locationOrWarehouseWhere,
              itemId: { in: chunk },
              createdAt: { gte: startDate, lte: endDate },
              NOT: [
                { movementType: MovementType.OPENING_BALANCE },
                { referenceType: 'OPENING_BALANCE' },
                { referenceType: 'BULK_STOCK_UPLOAD' }
              ]
            },
            select: {
              itemId: true,
              qty: true,
              referenceType: true,
              movementType: true,
              locationId: true,
              warehouseId: true,
              unitCost: true,
              rate: true,
            },
          })
        )
      ),
      // 5. Query transit items
      Promise.all(
        matchedItemChunks.map(chunk =>
          prisma.transferRequestItem.findMany({
            where: {
              itemId: { in: chunk },
              transferRequest: {
                ...toLocOrWhWhere,
                status: { in: ['PENDING', 'SOURCE_APPROVED'] },
                transferType: { in: ['WAREHOUSE_TO_OUTLET', 'OUTLET_TO_OUTLET', 'OUTLET_TO_WAREHOUSE', 'WAREHOUSE_TO_WAREHOUSE'] },
              },
            },
            select: {
              itemId: true,
              quantity: true,
              transferRequest: {
                select: { toLocationId: true, toWarehouseId: true },
              },
            },
          })
        )
      ),
      // 6. Query reserved stock
      Promise.all(
        matchedItemChunks.map(chunk =>
          prisma.stockReserve.groupBy({
            by: ['itemId', ...(warehouseWhere ? ['warehouseId' as const] : [])],
            where: {
              itemId: { in: chunk },
              ...(warehouseWhere ? { warehouseId: warehouseWhere } : {}),
              OR: [
                { expiresAt: null },
                { expiresAt: { gte: new Date() } }
              ]
            },
            _sum: { quantity: true },
          })
        )
      ),
    ]);

    if (isAborted?.()) {
      return { root: [], grandTotals: this.createEmptyTotals(), items: [], itemMetricsMap: new Map(), flatItemsList: [] };
    }

    // Populate BF Map
    const bfMap = new Map<string, number>();
    for (const row of bfGroupResults.flat()) {
      const locKey = isSeparate
        ? (row.locationId ? `loc:${row.locationId}` : (row.warehouseId ? `wh:${row.warehouseId}` : 'unknown'))
        : 'all';
      const key = `${locKey}_${row.itemId}`;
      bfMap.set(key, (bfMap.get(key) || 0) + Number(row._sum.qty || 0));
    }

    // Add In-Range Openings to BF Map
    for (const row of inRangeOpeningResults.flat()) {
      const locKey = isSeparate
        ? (row.locationId ? `loc:${row.locationId}` : (row.warehouseId ? `wh:${row.warehouseId}` : 'unknown'))
        : 'all';
      const key = `${locKey}_${row.itemId}`;
      const currentBf = bfMap.get(key) || 0;
      bfMap.set(key, currentBf + Number(row._sum.qty || 0));
    }

    // Populate Setting Map
    const settingMap = new Map(tenantSettingsResults.flat().map(s => [s.itemId, s]));

    // Populate Ledger Movements and Cost Map
    const ledgerEntries = ledgerEntriesResults.flat();
    const latestLedgerCostMap = new Map<string, number>();
    for (const entry of ledgerEntries) {
      const cost = Number(entry.unitCost ?? entry.rate ?? 0);
      if (cost > 0) {
        latestLedgerCostMap.set(entry.itemId, cost);
      }
    }

    // Populate Transit Map
    const transitMap = new Map<string, number>();
    for (const row of transitItemsResults.flat()) {
      const qty = Number(row.quantity || 0);
      const tr = row.transferRequest;
      const locKey = isSeparate
        ? (tr.toLocationId ? `loc:${tr.toLocationId}` : (tr.toWarehouseId ? `wh:${tr.toWarehouseId}` : 'unknown'))
        : 'all';
      const key = `${locKey}_${row.itemId}`;
      transitMap.set(key, (transitMap.get(key) || 0) + qty);
    }

    // Populate Reserve Map
    const reserveMap = new Map<string, number>();
    for (const row of reserveGroupResults.flat()) {
      const locKey = isSeparate
        ? (row.warehouseId ? `wh:${row.warehouseId}` : 'all')
        : 'all';
      const key = `${locKey}_${row.itemId}`;
      reserveMap.set(key, (reserveMap.get(key) || 0) + Number(row._sum.quantity || 0));
    }

    const movementMetricsMap = new Map<string, {
      fromWarehouse: number;
      fromOutlet: number;
      toWarehouse: number;
      toOutlet: number;
      exchg: number;
      refund: number;
      claim: number;
      sales: number;
      adj: number;
    }>();

    for (const entry of ledgerEntries) {
      const locKey = isSeparate
        ? (entry.locationId ? `loc:${entry.locationId}` : (entry.warehouseId ? `wh:${entry.warehouseId}` : 'unknown'))
        : 'all';
      const key = `${locKey}_${entry.itemId}`;

      let m = movementMetricsMap.get(key);
      if (!m) {
        m = {
          fromWarehouse: 0, fromOutlet: 0, toWarehouse: 0, toOutlet: 0,
          exchg: 0, refund: 0, claim: 0, sales: 0, adj: 0,
        };
        movementMetricsMap.set(key, m);
      }

      const qty = Number(entry.qty || 0);
      const ref = entry.referenceType || '';
      const mov = entry.movementType;

      if (mov === MovementType.ADJUSTMENT || ref === 'STOCK_ADJUSTMENT' || ref === 'ADJUSTMENT') {
        m.adj += qty;
      } else if (qty > 0) {
        if (ref === 'TRANSFER_REQUEST') {
          m.fromWarehouse += qty;
        } else if (ref === 'OUTLET_TRANSFER_IN') {
          m.fromOutlet += qty;
        } else if (['POS_RETURN', 'POS_EXCHANGE_IN'].includes(ref)) {
          m.exchg += qty;
        } else if (['POS_REFUND', 'POS_VOID'].includes(ref)) {
          m.refund += qty;
        } else if (ref === 'POS_CLAIM_APPROVED') {
          m.claim += qty;
        } else {
          m.adj += qty;
        }
      } else if (qty < 0) {
        const absQty = Math.abs(qty);
        if (['RETURN_REQUEST', 'CLAIM_RETURN', 'CLAIM_TO_PLM', 'CLAIM_RETURN_REQUEST'].includes(ref)) {
          m.toWarehouse += absQty;
        } else if (ref === 'OUTLET_TRANSFER_OUT') {
          m.toOutlet += absQty;
        } else if (['POS_SALE', 'POS_EXCHANGE_OUT'].includes(ref)) {
          m.sales += absQty;
        } else {
          m.adj += qty;
        }
      }
    }

    // Determine list of active location keys
    const locKeysSet = new Set<string>();
    if (!isSeparate) {
      locKeysSet.add('all');
    } else {
      for (const k of bfMap.keys()) locKeysSet.add(k.split('_')[0]);
      for (const k of movementMetricsMap.keys()) locKeysSet.add(k.split('_')[0]);
      for (const k of transitMap.keys()) locKeysSet.add(k.split('_')[0]);
      for (const k of reserveMap.keys()) locKeysSet.add(k.split('_')[0]);
      for (const inv of inventoryItems) {
        if (inv.locationId) locKeysSet.add(`loc:${inv.locationId}`);
        if (inv.warehouseId) locKeysSet.add(`wh:${inv.warehouseId}`);
      }
    }

    const activeLocKeys = [...locKeysSet].filter(k => k !== 'unknown');
    if (activeLocKeys.length === 0 && isSeparate) {
      activeLocKeys.push('all');
    }

    const root: any[] = [];
    const itemMetricsMap = new Map<string, {
      quantity: number;
      transit: number;
      reserved: number;
      total: number;
      unitPrice: number;
      value: number;
      unitCost: number;
      costingValue: number;
    }>();

    const flatItemsList: { locationName: string; item: any; metrics: any }[] = [];

    const addTotals = (target: any, source: any) => {
      target.quantity += source.quantity;
      target.transit += source.transit;
      target.reserved += source.reserved;
      target.total += source.total;
      target.value += source.value;
      target.costingValue += source.costingValue;
    };

    for (const locKey of activeLocKeys) {
      const locationName = isSeparate
        ? (locationNameMap.get(locKey) || (locKey.startsWith('loc:') ? 'Outlet Store' : 'Warehouse'))
        : 'All Selected Outlets / Warehouses';

      for (const item of items) {
        const mapKey = `${locKey}_${item.id}`;
        const bf = bfMap.get(mapKey) || 0;
        const transit = transitMap.get(mapKey) || 0;
        const reserved = reserveMap.get(mapKey) || 0;
        const m = movementMetricsMap.get(mapKey) || {
          fromWarehouse: 0, fromOutlet: 0, toWarehouse: 0, toOutlet: 0,
          exchg: 0, refund: 0, claim: 0, sales: 0, adj: 0,
        };

        const totalTrfIn = m.fromWarehouse + m.fromOutlet;
        const totalTrfOut = m.toWarehouse + m.toOutlet;
        const availableStock = bf + totalTrfIn - totalTrfOut + m.exchg + m.refund + m.claim - m.sales + m.adj;
        const balance = availableStock + transit + reserved;

        // In separate mode, skip item entries with 0 stock across all fields for this specific location
        if (isSeparate && availableStock === 0 && transit === 0 && reserved === 0 && balance === 0) {
          continue;
        }

        const setting = settingMap.get(item.id);
        let unitPrice = Number(item.unitPrice || 0);
        if (unitPrice === 0 && (setting as any)?.retailPrice) {
          unitPrice = Number((setting as any).retailPrice);
        }

        let unitCost = Number(item.unitCost || 0);
        if (unitCost === 0) {
          unitCost = Number(
            setting?.averageCost ||
            setting?.standardCost ||
            item.fob ||
            latestLedgerCostMap.get(item.id) ||
            0
          );
        }

        const value = balance * unitPrice;
        const costingValue = balance * unitCost;

        const variantMetrics = {
          quantity: availableStock,
          transit,
          reserved,
          total: balance,
          unitPrice,
          value,
          unitCost,
          costingValue,
        };

        itemMetricsMap.set(mapKey, variantMetrics);
        flatItemsList.push({ locationName, item, metrics: variantMetrics });

        let currentLevelNodes = root;
        for (let i = 0; i < levels.length; i++) {
          const levelName = levels[i];
          let nodeVal = '';
          let extraFields: any = {};

          if (levelName === 'location') {
            nodeVal = locationName;
          } else if (levelName === 'brand') {
            nodeVal = item.brand?.name || 'No Brand';
          } else if (levelName === 'division') {
            nodeVal = item.division?.name || 'No Division';
          } else if (levelName === 'category') {
            nodeVal = item.category?.name || 'No Category';
          } else if (levelName === 'gender') {
            nodeVal = item.gender?.name || 'No Gender';
          } else if (levelName === 'silhouette') {
            nodeVal = item.silhouette?.name || 'No Silhouette';
          } else if (levelName === 'article') {
            nodeVal = item.sku;
            extraFields.sku = item.sku;
            extraFields.articleName = item.description || 'Unknown Article';
          } else if (levelName === 'variant') {
            nodeVal = `${item.color?.name || 'Default'}-${item.size?.name || 'Default'}`;
            extraFields.color = item.color?.name || 'Default';
            extraFields.size = item.size?.name || 'Default';
          }

          let existingNode = currentLevelNodes.find(n => n.level === levelName && n.value === nodeVal);
          if (!existingNode) {
            existingNode = {
              level: levelName,
              value: nodeVal,
              totals: this.createEmptyTotals(),
              ...extraFields,
              children: [],
            };
            currentLevelNodes.push(existingNode);
          }

          // Add to the level node's totals
          addTotals(existingNode.totals, variantMetrics);

          // At article level, explicitly save the item unit price (Selling Price) and cost price
          if (levelName === 'article' || levelName === 'variant') {
            existingNode.totals.unitPrice = unitPrice;
            existingNode.totals.unitCost = unitCost;
          }

          if (i < levels.length - 1) {
            currentLevelNodes = existingNode.children;
          }
        }
      }
    }

    // Compute grand totals
    const grandTotals = this.createEmptyTotals();
    for (const node of root) {
      addTotals(grandTotals, node.totals);
    }

    return { root, grandTotals, items, itemMetricsMap, flatItemsList };
  }

  private createEmptyTotals() {
    return {
      quantity: 0,
      transit: 0,
      reserved: 0,
      total: 0,
      unitPrice: 0,
      value: 0,
      unitCost: 0,
      costingValue: 0,
    };
  }
}
