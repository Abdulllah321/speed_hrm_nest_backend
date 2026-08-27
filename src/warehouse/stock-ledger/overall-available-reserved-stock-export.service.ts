import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadService } from '../../upload/upload.service';
import { MovementType, PrismaClient } from '@prisma/client';

export interface QueueOverallAvailableReservedStockExportOptions {
  userId: string;
  locationId?: string;
  warehouseId?: string;
  asOfDate?: string;
  format: 'xlsx' | 'pdf';
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
import { ExportHistoryService } from '../export-history/export-history.service';

@Injectable()
export class OverallAvailableReservedStockExportService {
  private readonly logger = new Logger(OverallAvailableReservedStockExportService.name);
  private readonly cancelledPreviewJobIds = new Set<string>();

  constructor(
    @InjectQueue('overall-available-reserved-stock-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
    private readonly fiscalClosingService: FiscalYearClosingService,
    private readonly exportHistoryService: ExportHistoryService,
  ) { }

  isJobCancelled(jobId?: string): boolean {
    if (!jobId) return false;
    return this.cancelledPreviewJobIds.has(jobId);
  }

  cancelReportPreview(jobId: string): void {
    if (jobId) {
      this.cancelledPreviewJobIds.add(jobId);
    }
  }

  async queueReportPreview(opts: {
    userId: string;
    locationId?: string;
    warehouseId?: string;
    asOfDate?: string;
    summaryOnly?: boolean;
    showBrand?: boolean;
    showDivision?: boolean;
    showCategory?: boolean;
    showGender?: boolean;
    showSilhouette?: boolean;
    showArticle?: boolean;
    showVariant?: boolean;
    includeCosting?: boolean;
  }): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    this.cancelledPreviewJobIds.delete(jobId);

    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

    // Cancel any waiting or active preview jobs previously queued by this user
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
            this.logger.log(`Pruning superseded waiting overall stock preview job ${wJob.id} for user ${opts.userId}`);
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
            this.logger.log(`Cancelling active running overall stock preview job ${activeJobId} for user ${opts.userId}`);
            if (activeJobId) this.cancelledPreviewJobIds.add(activeJobId);
          }
        }
      } catch (err: any) {
        this.logger.warn(`Could not prune overall stock preview jobs for user ${opts.userId}: ${err.message}`);
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
        asOfDate: opts.asOfDate,
        summaryOnly: !!opts.summaryOnly,
        showBrand: opts.showBrand,
        showDivision: opts.showDivision,
        showCategory: opts.showCategory,
        showGender: opts.showGender,
        showSilhouette: opts.showSilhouette,
        showArticle: opts.showArticle,
        showVariant: opts.showVariant,
        includeCosting: !!opts.includeCosting,
      },
      {
        jobId,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    this.logger.log(`[ReportPreview ${jobId}] Queued background computation for user ${opts.userId}`);
    return { jobId };
  }

  saveReportPreviewResult(jobId: string, data: any): void {
    const previewDir = path.join(process.cwd(), 'uploads', 'previews');
    if (!fs.existsSync(previewDir)) {
      fs.mkdirSync(previewDir, { recursive: true });
    }

    const cleanRoot = Array.isArray(data?.root) ? data.root : [];
    const cleanFlatItemsList = Array.isArray(data?.flatItemsList) ? data.flatItemsList : [];

    const payloadToSerialize = {
      root: cleanRoot,
      grandTotals: data?.grandTotals || this.createEmptyTotals(),
      warehouses: data?.warehouses || [],
      stockLocations: data?.stockLocations || [],
      flatItemsList: cleanFlatItemsList,
    };

    const jsonStr = JSON.stringify(payloadToSerialize);
    const gzipped = zlib.gzipSync(jsonStr);
    const filePath = path.join(previewDir, `preview-${jobId}.json.gz`);
    fs.writeFileSync(filePath, gzipped);

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
    return JSON.parse(jsonStr);
  }

  async queueExport(opts: QueueOverallAvailableReservedStockExportOptions): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const ext = opts.format === 'pdf' ? 'pdf' : 'xlsx';

    await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName: `overall-available-reserved-stock-${new Date().toISOString().slice(0, 10)}.${ext}`,
        filePath: path.join('uploads', 'exports', `export-${jobId}.${ext}`),
        moduleName: 'OVERALL_AVAILABLE_RESERVED_STOCK_REPORT',
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
        asOfDate: opts.asOfDate,
        format: opts.format,
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

    this.logger.log(`[OverallAvailableReservedStockExport] Queued job ${jobId} for user ${opts.userId} (format: ${opts.format}, tenant: ${tenantId})`);
    return { jobId };
  }

  async registerClientGeneratedExport(opts: {
    userId: string;
    fileBuffer: Buffer;
    fileName: string;
    format: 'xlsx' | 'pdf' | 'html';
  }) {
    const jobId = uuidv4();
    const ext = opts.format === 'pdf' ? 'pdf' : (opts.format === 'html' ? 'html' : 'xlsx');
    const relativePath = path.join('uploads', 'exports', `export-${jobId}.${ext}`);
    const fullPath = path.join(process.cwd(), relativePath);

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, opts.fileBuffer);

    await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName: opts.fileName || `overall-available-reserved-stock-${new Date().toISOString().slice(0, 10)}.${ext}`,
        filePath: relativePath,
        moduleName: 'OVERALL_AVAILABLE_RESERVED_STOCK_REPORT',
        status: 'PENDING',
      },
    });

    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const prisma = (tenantId && tenantDbUrl)
      ? PrismaService.getTenantClient(tenantId, tenantDbUrl)
      : this.prisma;

    const mimeType = opts.format === 'pdf' ? 'application/pdf' : (opts.format === 'html' ? 'text/html' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    await this.exportHistoryService.completeAndUploadExport(
      prisma,
      jobId,
      fullPath,
      opts.fileName,
      mimeType,
    );

    return { status: true, jobId };
  }

  async getJobStatus(jobId: string): Promise<{ state: string; progress: number }> {
    const job = await this.exportQueue.getJob(jobId);
    if (!job) throw new NotFoundException(`Export job ${jobId} not found`);
    const state = await job.getState();
    const progress = typeof job.progress() === 'number' ? (job.progress() as number) : 0;
    return { state, progress };
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

    const isPdf = record.fileName.endsWith('.pdf');
    res.header('Content-Type', isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename="${record.fileName}"`);
    res.header('Content-Length', stat.size);
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(stream);
  }

  async getOverallAvailableReservedStockReportData(opts: {
    locationId?: string;
    warehouseId?: string;
    asOfDate?: string;
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
    isAborted?: () => boolean;
  }) {
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);

    return this.generateOverallAvailableReservedStockReportDataInternal(prisma, opts);
  }

  async generateOverallAvailableReservedStockReportDataInternal(
    prisma: PrismaClient | PrismaService,
    opts: {
      locationId?: string;
      warehouseId?: string;
      asOfDate?: string;
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
      isAborted?: () => boolean;
      onProgress?: (percent: number, message: string) => Promise<void> | void;
    },
  ) {
    const {
      locationId,
      warehouseId,
      asOfDate: asOfStr,
      previewJobId,
      isAborted,
      onProgress,
    } = opts;

    const checkCancelled = () => isAborted?.() || (previewJobId && this.isJobCancelled(previewJobId));

    if (checkCancelled()) {
      return { root: [], flatItemsList: [], grandTotals: this.createEmptyTotals(), warehouses: [], stockLocations: [] };
    }

    await onProgress?.(10, 'Discovering active stock locations & warehouses...');

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

    // Fetch active Warehouses & Stock Locations
    const warehouses = await prisma.warehouse.findMany({
      where: {
        isDeleted: false,
        ...(whIds.length > 0 ? { id: { in: whIds } } : {}),
      },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });

    const stockLocations = await prisma.location.findMany({
      where: {
        isStockLocation: true,
        isDeleted: false,
        ...(locIds.length > 0 ? { id: { in: locIds } } : {}),
      },
      select: { id: true, name: true, code: true, shortCode: true },
      orderBy: { name: 'asc' },
    });

    const now = new Date();
    const endDate = asOfStr ? new Date(asOfStr) : new Date();
    endDate.setHours(23, 59, 59, 999);

    const getDefaultFiscalYearStart = (ref: Date) => {
      const year = ref.getFullYear();
      const month = ref.getMonth(); // 0 = Jan, 6 = July
      const fyYear = month >= 6 ? year : year - 1;
      return new Date(fyYear, 6, 1, 0, 0, 0, 0);
    };

    const snapshotDate = await this.fiscalClosingService.findLatestFiscalOpeningSnapshotDate(prisma, endDate);
    const startDate = snapshotDate && snapshotDate < endDate ? snapshotDate : getDefaultFiscalYearStart(endDate);
    const queryStartDate = snapshotDate && snapshotDate < startDate ? snapshotDate : undefined;

    await onProgress?.(20, 'Querying stock ledgers & inventory items...');

    // Fetch inventory item ids within active date window
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
          createdAt: queryStartDate ? { gte: queryStartDate, lte: endDate } : { lte: endDate },
        },
        select: { itemId: true },
        distinct: ['itemId'],
      }),
    ]);

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
      return {
        root: [],
        flatItemsList: [],
        grandTotals: this.createEmptyTotals(warehouses.map(w => w.id), stockLocations.map(l => l.id)),
        warehouses,
        stockLocations,
      };
    }

    await onProgress?.(45, 'Executing relational aggregations for stock movements, transit & reserves...');

    const groupByCols: ('itemId' | 'locationId' | 'warehouseId')[] = ['itemId', 'locationId', 'warehouseId'];

    const toLocOrWhFilters: any[] = [];
    if (locationWhere) toLocOrWhFilters.push({ toLocationId: locationWhere });
    if (warehouseWhere) toLocOrWhFilters.push({ toWarehouseId: warehouseWhere });

    const toLocOrWhWhere = toLocOrWhFilters.length > 1
      ? { OR: toLocOrWhFilters }
      : (toLocOrWhFilters.length === 1 ? toLocOrWhFilters[0] : {});

    const [
      bfGroupResults,
      inRangeOpeningResults,
      ledgerEntriesResults,
      transitItemsResults,
      reserveGroupResults,
      tenantSettingsResults,
    ] = await Promise.all([
      prisma.stockLedger.groupBy({
        by: groupByCols,
        where: {
          ...locationOrWarehouseWhere,
          createdAt: queryStartDate ? { gte: queryStartDate, lt: startDate } : { lt: startDate },
        },
        _sum: { qty: true },
      }),
      prisma.stockLedger.groupBy({
        by: groupByCols,
        where: {
          ...locationOrWarehouseWhere,
          createdAt: { gte: startDate, lte: endDate },
          OR: [
            { movementType: MovementType.OPENING_BALANCE },
            { referenceType: 'OPENING_BALANCE' },
            { referenceType: 'BULK_STOCK_UPLOAD' },
          ],
        },
        _sum: { qty: true },
      }),
      prisma.stockLedger.findMany({
        where: {
          ...locationOrWarehouseWhere,
          createdAt: { gte: startDate, lte: endDate },
          NOT: [
            { movementType: MovementType.OPENING_BALANCE },
            { referenceType: 'OPENING_BALANCE' },
            { referenceType: 'BULK_STOCK_UPLOAD' },
          ],
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
      }),
      prisma.transferRequestItem.findMany({
        where: {
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
      }),
      prisma.stockReserve.groupBy({
        by: ['itemId', 'warehouseId'],
        where: {
          ...(warehouseWhere ? { warehouseId: warehouseWhere } : {}),
          OR: [
            { expiresAt: null },
            { expiresAt: { gte: new Date() } },
          ],
        },
        _sum: { quantity: true },
      }),
      prisma.tenantItemSetting.findMany({
        select: {
          itemId: true,
          averageCost: true,
          standardCost: true,
        },
      }),
    ]);

    // Build B/F Opening map
    const bfMap = new Map<string, number>();
    for (const r of bfGroupResults) {
      const locKey = r.locationId ? `loc:${r.locationId}` : (r.warehouseId ? `wh:${r.warehouseId}` : 'unknown');
      const key = `${locKey}_${r.itemId}`;
      bfMap.set(key, (bfMap.get(key) || 0) + Number(r._sum?.qty || 0));
    }
    for (const r of inRangeOpeningResults) {
      const locKey = r.locationId ? `loc:${r.locationId}` : (r.warehouseId ? `wh:${r.warehouseId}` : 'unknown');
      const key = `${locKey}_${r.itemId}`;
      bfMap.set(key, (bfMap.get(key) || 0) + Number(r._sum?.qty || 0));
    }

    const latestLedgerCostMap = new Map<string, number>();
    for (const entry of ledgerEntriesResults) {
      const cost = Number(entry.unitCost ?? entry.rate ?? 0);
      if (cost > 0) latestLedgerCostMap.set(entry.itemId, cost);
    }

    // Transit map per location/warehouse & item
    const transitMap = new Map<string, number>();
    for (const row of transitItemsResults) {
      const qty = Number(row.quantity || 0);
      const tr = row.transferRequest;
      const locKey = tr.toLocationId ? `loc:${tr.toLocationId}` : (tr.toWarehouseId ? `wh:${tr.toWarehouseId}` : 'unknown');
      const key = `${locKey}_${row.itemId}`;
      transitMap.set(key, (transitMap.get(key) || 0) + qty);
    }

    // Reserve map per warehouse & item
    const reserveMap = new Map<string, number>();
    for (const row of reserveGroupResults) {
      const qty = Number(row._sum?.quantity || 0);
      if (row.warehouseId) {
        const key = `wh:${row.warehouseId}_${row.itemId}`;
        reserveMap.set(key, (reserveMap.get(key) || 0) + qty);
      }
      const allKey = `all_${row.itemId}`;
      reserveMap.set(allKey, (reserveMap.get(allKey) || 0) + qty);
    }

    // Movement metrics map
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

    for (const entry of ledgerEntriesResults) {
      const locKey = entry.locationId ? `loc:${entry.locationId}` : (entry.warehouseId ? `wh:${entry.warehouseId}` : 'unknown');
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
        if (ref === 'TRANSFER_REQUEST') m.fromWarehouse += qty;
        else if (ref === 'OUTLET_TRANSFER_IN') m.fromOutlet += qty;
        else if (['POS_RETURN', 'POS_EXCHANGE_IN'].includes(ref)) m.exchg += qty;
        else if (['POS_REFUND', 'POS_VOID'].includes(ref)) m.refund += qty;
        else if (ref === 'POS_CLAIM_APPROVED') m.claim += qty;
        else m.adj += qty;
      } else if (qty < 0) {
        const absQty = Math.abs(qty);
        if (['RETURN_REQUEST', 'CLAIM_RETURN', 'CLAIM_TO_PLM', 'CLAIM_RETURN_REQUEST'].includes(ref)) m.toWarehouse += absQty;
        else if (ref === 'OUTLET_TRANSFER_OUT') m.toOutlet += absQty;
        else if (['POS_SALE', 'POS_EXCHANGE_OUT'].includes(ref)) m.sales += absQty;
        else m.adj += qty;
      }
    }

    // Collect all item IDs that have activity or inventory
    const activeItemIdsSet = new Set<string>();
    for (const r of bfGroupResults) if (r?.itemId) activeItemIdsSet.add(r.itemId);
    for (const r of inRangeOpeningResults) if (r?.itemId) activeItemIdsSet.add(r.itemId);
    for (const r of ledgerEntriesResults) if (r?.itemId) activeItemIdsSet.add(r.itemId);
    for (const inv of inventoryItems) if (inv?.itemId) activeItemIdsSet.add(inv.itemId);
    for (const r of reserveGroupResults) if (r?.itemId) activeItemIdsSet.add(r.itemId);
    for (const t of transitItemsResults) if (t?.itemId) activeItemIdsSet.add(t.itemId);

    const activeItemIds = Array.from(activeItemIdsSet).filter(Boolean);

    await onProgress?.(65, `Loading product catalog metadata for ${activeItemIds.length} active items...`);

    const chunkArray = <T>(arr: T[], size = 1000): T[][] => {
      const chunks: T[][] = [];
      for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
      }
      return chunks;
    };

    const itemChunks = chunkArray(activeItemIds, 1000);
    const itemsNested = await Promise.all(
      itemChunks.map((chunk) =>
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
        }),
      ),
    );

    const items = itemsNested.flat();

    const settingMap = new Map<string, any>();
    for (const s of tenantSettingsResults) settingMap.set(s.itemId, s);

    await onProgress?.(85, 'Building store matrix breakdown and grand totals...');

    const whIdsList = warehouses.map(w => w.id);
    const locIdsList = stockLocations.map(l => l.id);

    const flatItemsList: any[] = [];
    const grandTotals = this.createEmptyTotals(whIdsList, locIdsList);

    for (const item of items) {
      let itemAvailableStockSum = 0;
      let itemTransitSum = 0;
      let itemReservedSum = 0;

      const warehouseStocks: Record<string, number> = {};
      for (const wh of warehouses) {
        const key = `wh:${wh.id}_${item.id}`;
        const altKey = item.itemId ? `wh:${wh.id}_${item.itemId}` : key;

        const bf = (bfMap.get(key) ?? bfMap.get(altKey)) || 0;
        const m = (movementMetricsMap.get(key) ?? movementMetricsMap.get(altKey)) || {
          fromWarehouse: 0, fromOutlet: 0, toWarehouse: 0, toOutlet: 0,
          exchg: 0, refund: 0, claim: 0, sales: 0, adj: 0,
        };

        const totalTrfIn = m.fromWarehouse + m.fromOutlet;
        const totalTrfOut = m.toWarehouse + m.toOutlet;
        const stockWh = bf + totalTrfIn - totalTrfOut + m.exchg + m.refund + m.claim - m.sales + m.adj;

        const tr = (transitMap.get(key) ?? transitMap.get(altKey)) || 0;
        const rs = (reserveMap.get(key) ?? reserveMap.get(altKey)) || 0;

        const availWh = stockWh - rs;
        warehouseStocks[wh.id] = availWh;
        itemAvailableStockSum += availWh;

        itemTransitSum += tr;
        itemReservedSum += rs;
      }

      const locationStocks: Record<string, number> = {};
      for (const loc of stockLocations) {
        const key = `loc:${loc.id}_${item.id}`;
        const altKey = item.itemId ? `loc:${loc.id}_${item.itemId}` : key;

        const bf = (bfMap.get(key) ?? bfMap.get(altKey)) || 0;
        const m = (movementMetricsMap.get(key) ?? movementMetricsMap.get(altKey)) || {
          fromWarehouse: 0, fromOutlet: 0, toWarehouse: 0, toOutlet: 0,
          exchg: 0, refund: 0, claim: 0, sales: 0, adj: 0,
        };

        const totalTrfIn = m.fromWarehouse + m.fromOutlet;
        const totalTrfOut = m.toWarehouse + m.toOutlet;
        const stockLoc = bf + totalTrfIn - totalTrfOut + m.exchg + m.refund + m.claim - m.sales + m.adj;

        const availLoc = stockLoc;
        locationStocks[loc.id] = availLoc;
        itemAvailableStockSum += availLoc;

        const tr = (transitMap.get(key) ?? transitMap.get(altKey)) || 0;
        itemTransitSum += tr;
      }

      const totalBalance = itemAvailableStockSum + itemTransitSum + itemReservedSum;
      const unitPrice = Number(item.unitPrice || 0);
      const value = totalBalance * unitPrice;

      const setting = settingMap.get(item.id) || (item.itemId ? settingMap.get(item.itemId) : undefined);
      let unitCost = Number(item.unitCost || 0);
      if (unitCost === 0) {
        unitCost = Number(
          setting?.averageCost ||
          setting?.standardCost ||
          item.fob ||
          latestLedgerCostMap.get(item.id) ||
          (item.itemId ? latestLedgerCostMap.get(item.itemId) : undefined) ||
          0
        );
      }
      const costingValue = totalBalance * unitCost;

      // Skip item if 0 across all fields
      if (itemAvailableStockSum === 0 && itemTransitSum === 0 && itemReservedSum === 0 && totalBalance === 0) {
        continue;
      }

      const itemRecord = {
        itemId: item.id,
        brand: item.brand?.name ?? 'No Brand',
        division: item.division?.name ?? 'No Division',
        category: item.category?.name ?? 'No Category',
        gender: item.gender?.name ?? 'No Gender',
        silhouette: item.silhouette?.name ?? 'No Silhouette',
        sku: item.sku ?? '',
        articleName: item.description ?? '',
        color: item.color?.name ?? 'Default',
        size: item.size?.name ?? 'Default',
        barCode: item.barCode ?? '',
        quantity: itemAvailableStockSum,
        transit: itemTransitSum,
        reserved: itemReservedSum,
        total: totalBalance,
        unitPrice,
        value,
        unitCost,
        costingValue,
        warehouseStocks,
        locationStocks,
      };

      flatItemsList.push(itemRecord);

      // Accumulate Grand Totals
      grandTotals.quantity += itemAvailableStockSum;
      grandTotals.transit += itemTransitSum;
      grandTotals.reserved += itemReservedSum;
      grandTotals.total += totalBalance;
      grandTotals.value += value;
      grandTotals.costingValue += costingValue;

      for (const whId of whIdsList) {
        grandTotals.warehouseStocks[whId] = (grandTotals.warehouseStocks[whId] || 0) + (warehouseStocks[whId] || 0);
      }
      for (const locId of locIdsList) {
        grandTotals.locationStocks[locId] = (grandTotals.locationStocks[locId] || 0) + (locationStocks[locId] || 0);
      }
    }

    await onProgress?.(100, 'Overall stock matrix computation completed');

    return {
      root: flatItemsList,
      flatItemsList,
      grandTotals,
      warehouses,
      stockLocations,
    };
  }

  private createEmptyTotals(whIds: string[] = [], locIds: string[] = []) {
    const warehouseStocks: Record<string, number> = {};
    for (const id of whIds) warehouseStocks[id] = 0;

    const locationStocks: Record<string, number> = {};
    for (const id of locIds) locationStocks[id] = 0;

    return {
      totalArticles: 0,
      quantity: 0,
      transit: 0,
      reserved: 0,
      total: 0,
      unitPrice: 0,
      value: 0,
      unitCost: 0,
      costingValue: 0,
      discountRate: 0,
      taxRate: 0,
      warehouseStocks,
      locationStocks,
    };
  }
}