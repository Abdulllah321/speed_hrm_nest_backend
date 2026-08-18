import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadService } from '../../upload/upload.service';
import { PrismaClient } from '@prisma/client';
import { chunkArray } from '../../common/utils/chunk.util';

export interface QueueStockValuationExportOptions {
  userId: string;
  locationId?: string;
  startDate?: string;
  endDate?: string;
  format: 'xlsx' | 'pdf';
  summaryOnly?: boolean;
  showBrand?: boolean;
  showDivision?: boolean;
  showCategory?: boolean;
  showGender?: boolean;
  showSilhouette?: boolean;
  showArticle?: boolean;
  showVariant?: boolean;
  exportType?: 'hierarchical' | 'flat';
  filterBrands?: string[];
  filterDivisions?: string[];
  filterCategories?: string[];
  filterGenders?: string[];
  filterSilhouettes?: string[];
  searchText?: string;
  previewJobId?: string;
}

@Injectable()
export class StockValuationExportService {
  private readonly logger = new Logger(StockValuationExportService.name);

  constructor(
    @InjectQueue('stock-valuation-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

  async queueReportPreview(opts: {
    userId: string;
    locationId?: string;
    startDate?: string;
    endDate?: string;
    summaryOnly?: boolean;
    showBrand?: boolean;
    showDivision?: boolean;
    showCategory?: boolean;
    showGender?: boolean;
    showSilhouette?: boolean;
    showArticle?: boolean;
    showVariant?: boolean;
    filterBrands?: string[];
    filterDivisions?: string[];
    filterCategories?: string[];
    filterGenders?: string[];
    filterSilhouettes?: string[];
    searchText?: string;
  }): Promise<{ jobId: string; queuePosition: number; waitingCount: number }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

    // Remove any waiting preview jobs previously queued by this user to prevent queue buildup
    if (opts.userId) {
      try {
        const waitingJobs = await this.exportQueue.getWaiting();
        for (const wJob of waitingJobs) {
          if (
            wJob.name === 'generate-valuation-preview' &&
            wJob.data?.userId === opts.userId
          ) {
            this.logger.log(`Pruning superseded valuation preview job ${wJob.id} for user ${opts.userId}`);
            await wJob.remove();
          }
        }
      } catch (err: any) {
        this.logger.warn(`Could not prune waiting valuation preview jobs for user ${opts.userId}: ${err.message}`);
      }
    }

    await this.exportQueue.add(
      'generate-valuation-preview',
      {
        jobId,
        userId: opts.userId,
        tenantId,
        tenantDbUrl,
        locationId: opts.locationId,
        startDate: opts.startDate,
        endDate: opts.endDate,
        summaryOnly: !!opts.summaryOnly,
        showBrand: opts.showBrand,
        showDivision: opts.showDivision,
        showCategory: opts.showCategory,
        showGender: opts.showGender,
        showSilhouette: opts.showSilhouette,
        showArticle: opts.showArticle,
        showVariant: opts.showVariant,
        filterBrands: opts.filterBrands,
        filterDivisions: opts.filterDivisions,
        filterCategories: opts.filterCategories,
        filterGenders: opts.filterGenders,
        filterSilhouettes: opts.filterSilhouettes,
        searchText: opts.searchText,
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
    const jsonStr = JSON.stringify(data);
    const gzipped = zlib.gzipSync(jsonStr);
    const filePath = path.join(previewDir, `valuation-preview-${jobId}.json.gz`);
    fs.writeFileSync(filePath, gzipped);

    setTimeout(() => {
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      }
    }, 60 * 60 * 1000);
  }

  getReportPreviewResult(jobId: string): any {
    const filePath = path.join(process.cwd(), 'uploads', 'previews', `valuation-preview-${jobId}.json.gz`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const gzipped = fs.readFileSync(filePath);
    const jsonStr = zlib.gunzipSync(gzipped).toString('utf-8');
    return JSON.parse(jsonStr);
  }

  async queueExport(opts: QueueStockValuationExportOptions): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const ext = opts.format === 'pdf' ? 'pdf' : 'xlsx';

    // Save export job request in history audit table
    await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName: `stock-valuation-report-${new Date().toISOString().slice(0, 10)}.${ext}`,
        filePath: path.join('uploads', 'exports', `export-${jobId}.${ext}`),
        moduleName: 'STOCK_VALUATION_REPORT',
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
        startDate: opts.startDate,
        endDate: opts.endDate,
        format: opts.format,
        summaryOnly: !!opts.summaryOnly,
        showBrand: opts.showBrand,
        showDivision: opts.showDivision,
        showCategory: opts.showCategory,
        showGender: opts.showGender,
        showSilhouette: opts.showSilhouette,
        showArticle: opts.showArticle,
        showVariant: opts.showVariant,
        exportType: opts.exportType || 'hierarchical',
        filterBrands: opts.filterBrands,
        filterDivisions: opts.filterDivisions,
        filterCategories: opts.filterCategories,
        filterGenders: opts.filterGenders,
        filterSilhouettes: opts.filterSilhouettes,
        searchText: opts.searchText,
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

    this.logger.log(`[StockValuationExport] Queued job ${jobId} for user ${opts.userId} (format: ${opts.format}, tenant: ${tenantId})`);
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

    const filePath = path.join(process.cwd(), record.filePath);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Export file not found. It may have expired or the job is still running.');
    }

    const stat = fs.statSync(filePath);

    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      this.logger.error(`[StockValuationExport] Stream error: ${err.message}`);
    });

    const isPdf = record.fileName.endsWith('.pdf');
    res.header('Content-Type', isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename="${record.fileName}"`);
    res.header('Content-Length', stat.size);
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(stream);
  }

  // Get report data in memory for inline UI rendering
  async getValuationReportData(opts: {
    locationId?: string;
    startDate?: string;
    endDate?: string;
    summaryOnly?: boolean;
    showBrand?: boolean;
    showDivision?: boolean;
    showCategory?: boolean;
    showGender?: boolean;
    showSilhouette?: boolean;
    showArticle?: boolean;
    showVariant?: boolean;
  }) {
    // Use injected singleton prisma instance to prevent creating orphan pg-pool connections
    const { root, grandTotals, meta } = await this.generateValuationReportDataInternal(this.prisma, opts);
    return { data: root, grandTotals, meta };
  }

  // Core valuation logic shared between the controller preview and background processor
  async generateValuationReportDataInternal(
    prisma: PrismaClient | PrismaService,
    opts: {
      locationId?: string;
      startDate?: string;
      endDate?: string;
      summaryOnly?: boolean;
      showBrand?: boolean;
      showDivision?: boolean;
      showCategory?: boolean;
      showGender?: boolean;
      showSilhouette?: boolean;
      showArticle?: boolean;
      showVariant?: boolean;
      exportType?: 'hierarchical' | 'flat';
      filterBrands?: string[];
      filterDivisions?: string[];
      filterCategories?: string[];
      filterGenders?: string[];
      filterSilhouettes?: string[];
      searchText?: string;
      onProgress?: (percent: number, message: string) => Promise<void> | void;
    },
  ) {
    const {
      locationId,
      startDate: startStr,
      endDate: endStr,
      summaryOnly,
      showBrand,
      showDivision,
      showCategory,
      showGender,
      showSilhouette,
      showArticle,
      showVariant,
      onProgress,
    } = opts;

    await onProgress?.(10, 'Discovering distinct items from stock ledgers...');

    const now = new Date();
    // Default to start of current fiscal year (July 1st in Pakistan) if not provided
    const getDefaultFiscalYearStart = (ref: Date) => {
      const year = ref.getFullYear();
      const month = ref.getMonth(); // 0 = Jan, 6 = July
      const fyYear = month >= 6 ? year : year - 1;
      return new Date(fyYear, 6, 1, 0, 0, 0, 0);
    };

    const startDate = startStr ? new Date(startStr) : getDefaultFiscalYearStart(now);
    const endDate = endStr ? new Date(endStr) : new Date(now);

    // Discover all distinct items from the StockLedger (location-agnostic when no locationId is provided)
    const ledgerItems = await prisma.stockLedger.findMany({
      where: {
        ...(locationId ? { locationId } : {}),
      },
      select: { itemId: true },
      distinct: ['itemId'],
    });

    const uniqueItemIds = [...new Set(ledgerItems.map(l => l.itemId))];

    if (uniqueItemIds.length === 0) {
      return {
        root: [],
        grandTotals: this.createEmptyValuationTotals(),
        items: [],
        itemMetricsMap: new Map(),
      };
    }

    await onProgress?.(25, 'Loading product catalog, brands, categories & valuation settings...');

    const itemChunks = chunkArray(uniqueItemIds, 1000);
    const itemsNested = await Promise.all(
      itemChunks.map((chunk) =>
        prisma.item.findMany({
          where: { id: { in: chunk } },
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

    const settingsNested = await Promise.all(
      itemChunks.map((chunk) =>
        prisma.tenantItemSetting.findMany({
          where: { itemId: { in: chunk } },
        }),
      ),
    );
    const tenantSettings = settingsNested.flat();

    const settingMap = new Map(tenantSettings.map(s => [s.itemId, s]));

    await onProgress?.(45, 'Applying active brand, category & search filters...');

    // Apply active filter parameters (Brand, Division, Category, Gender, Silhouette, SearchText)
    let activeItems = items;
    if (
      (opts.filterBrands && opts.filterBrands.length > 0) ||
      (opts.filterDivisions && opts.filterDivisions.length > 0) ||
      (opts.filterCategories && opts.filterCategories.length > 0) ||
      (opts.filterGenders && opts.filterGenders.length > 0) ||
      (opts.filterSilhouettes && opts.filterSilhouettes.length > 0) ||
      (opts.searchText && opts.searchText.trim() !== '')
    ) {
      const q = (opts.searchText || '').trim().toLowerCase();
      const fb = new Set(opts.filterBrands || []);
      const fd = new Set(opts.filterDivisions || []);
      const fc = new Set(opts.filterCategories || []);
      const fg = new Set(opts.filterGenders || []);
      const fs = new Set(opts.filterSilhouettes || []);

      activeItems = items.filter((item) => {
        const brandName = item.brand?.name || '';
        const divName = item.division?.name || '';
        const catName = item.category?.name || '';
        const genderName = item.gender?.name || '';
        const silName = item.silhouette?.name || '';

        if (fb.size > 0 && !fb.has(brandName)) return false;
        if (fd.size > 0 && !fd.has(divName)) return false;
        if (fc.size > 0 && !fc.has(catName)) return false;
        if (fg.size > 0 && !fg.has(genderName)) return false;
        if (fs.size > 0 && !fs.has(silName)) return false;

        if (q) {
          const matchBar = (item.barCode || '').toLowerCase().includes(q);
          const matchSku = (item.sku || '').toLowerCase().includes(q);
          const matchDesc = (item.description || '').toLowerCase().includes(q);
          const matchBrand = brandName.toLowerCase().includes(q);
          const matchDiv = divName.toLowerCase().includes(q);
          const matchCat = catName.toLowerCase().includes(q);
          if (!matchBar && !matchSku && !matchDesc && !matchBrand && !matchDiv && !matchCat) return false;
        }

        return true;
      });
    }

    const totalItems = activeItems.length;
    const pageItems = activeItems;

    const matchedItemIds = pageItems.map(i => i.id);

    await onProgress?.(60, 'Fetching historical stock ledger movements and cost entries...');

    // Fetch stock ledger entries in 1,000 item chunks to compute historical WAC safely
    const matchedItemChunks = chunkArray(matchedItemIds, 1000);
    const ledgerMap = new Map<string, any[]>();

    for (const chunk of matchedItemChunks) {
      const chunkLedgerEntries = await prisma.stockLedger.findMany({
        where: {
          ...(locationId ? { locationId } : {}),
          itemId: { in: chunk },
          createdAt: { lte: endDate },
        },
        select: {
          id: true,
          itemId: true,
          qty: true,
          unitCost: true,
          rate: true,
          movementType: true,
          referenceType: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      for (const entry of chunkLedgerEntries) {
        let list = ledgerMap.get(entry.itemId);
        if (!list) {
          list = [];
          ledgerMap.set(entry.itemId, list);
        }
        list.push(entry);
      }
    }

    await onProgress?.(80, 'Calculating weighted average costs, opening, sales & closing valuation...');

    const itemMetricsMap = new Map<string, ReturnType<typeof this.createEmptyValuationTotals>>();

    for (const item of items) {
      const setting = settingMap.get(item.id);
      const valuationMethod = setting?.valuationMethod || 'WEIGHTED_AVG';
      let defaultCost = Number(item.unitCost || 0);
      if (defaultCost === 0) {
        defaultCost = Number(
          valuationMethod === 'STANDARD'
            ? (setting?.standardCost || 0)
            : (setting?.averageCost || item.fob || 0)
        );
      }

      const entries = ledgerMap.get(item.id) || [];
      
      let qtyBalance = 0;
      let runningWac = defaultCost;

      // Stage totals inside range
      let openingQty = 0;
      let openingWac = defaultCost;
      let periodOpeningQty = 0;
      let periodOpeningVal = 0;

      let purchaseQty = 0;
      let purchaseVal = 0;

      let purchaseRetQty = 0;
      let purchaseRetVal = 0;

      let salesQty = 0;
      let salesVal = 0;

      let adjQty = 0;
      let adjVal = 0;

      for (const entry of entries) {
        const entryQty = Number(entry.qty);
        let entryCost = Number(entry.unitCost ?? entry.rate ?? 0);
        if (entryCost === 0) {
          entryCost = runningWac;
        }
        const isBeforePeriod = entry.createdAt < startDate;

        if (
          entry.movementType === 'INBOUND' ||
          entry.movementType === 'OPENING_BALANCE' ||
          entry.referenceType === 'OPENING_BALANCE' ||
          entry.referenceType === 'BULK_STOCK_UPLOAD' ||
          (entry.movementType === 'ADJUSTMENT' && entryQty > 0)
        ) {
          // Blended WAC on Inbound / Purchases / Positive Adjustments
          if (valuationMethod === 'WEIGHTED_AVG') {
            const newQty = qtyBalance + entryQty;
            if (newQty > 0) {
              runningWac = ((qtyBalance * runningWac) + (entryQty * entryCost)) / newQty;
            } else {
              runningWac = entryCost;
            }
          }
          qtyBalance += entryQty;

            if (!isBeforePeriod) {
            // Check if it is a purchase vs. adjustment vs. opening
            const ref = entry.referenceType || '';
            const isOpening =
              entry.movementType === 'OPENING_BALANCE' ||
              entry.referenceType === 'OPENING_BALANCE' ||
              entry.referenceType === 'BULK_STOCK_UPLOAD';
            const isAdjustment =
              entry.movementType === 'ADJUSTMENT' ||
              ref === 'ADJUSTMENT' ||
              ref === 'STOCK_ADJUSTMENT' ||
              ref === 'SADJ' ||
              ref.startsWith('SADJ') ||
              ref.includes('ADJUSTMENT');
            const isPurchase =
              ref === 'GRN' ||
              ref === 'PURCHASE' ||
              ref === 'LANDED_COST' ||
              (!isOpening && !isAdjustment && entry.movementType === 'INBOUND');

            if (isOpening) {
              periodOpeningQty += entryQty;
              periodOpeningVal += entryQty * entryCost;
            } else if (isAdjustment) {
              adjQty += entryQty;
              adjVal += entryQty * entryCost;
            } else if (isPurchase) {
              purchaseQty += entryQty;
              purchaseVal += entryQty * entryCost;
            } else {
              purchaseQty += entryQty;
              purchaseVal += entryQty * entryCost;
            }
          }
        } else {
          // Outbound (Sales, Negative Adjustments, Purchase Returns, Transfers Out) uses current runningWac
          qtyBalance += entryQty; // entryQty is negative

          if (!isBeforePeriod) {
            const ref = entry.referenceType || '';
            const isPurchaseReturn =
              ['PURCHASE_RETURN', 'PURCHASE_RETURN_GRN', 'PURCHASE_RETURN_LC', 'PURCHASE_RETURN_INV', 'PRN', 'PURCHASE_RETURN_NOTE'].includes(ref) ||
              ref.startsWith('PURCHASE_RETURN') ||
              ref.startsWith('PRN');
            const isAdjustment =
              entry.movementType === 'ADJUSTMENT' ||
              ref === 'ADJUSTMENT' ||
              ref === 'STOCK_ADJUSTMENT' ||
              ref === 'SADJ' ||
              ref.startsWith('SADJ') ||
              ref.includes('ADJUSTMENT');
            const isSale =
              ['POS_SALE', 'POS_EXCHANGE_OUT', 'POS_RETURN', 'POS_EXCHANGE_IN', 'POS_REFUND', 'POS_VOID'].includes(ref) ||
              entry.movementType === 'OUTBOUND';

            const absQty = Math.abs(entryQty);

            if (isPurchaseReturn) {
              // Purchase return reduces purchase value at original return cost
              purchaseRetQty += absQty;
              purchaseRetVal += absQty * entryCost;
            } else if (isAdjustment) {
              adjQty += entryQty; // negative
              adjVal += entryQty * runningWac; // negative value
            } else if (isSale) {
              // Note: for POS Returns, entryQty will be positive, meaning it reduces net sales qty
              if (entryQty > 0) {
                // Return
                salesQty -= entryQty;
                salesVal -= entryQty * entryCost;
              } else {
                // Sale (outbound)
                salesQty += absQty;
                salesVal += absQty * runningWac; // COGS
              }
            } else {
              // Default sales/outbound
              salesQty += absQty;
              salesVal += absQty * runningWac;
            }
          }
        }

        // Capture WAC just before period starts
        if (isBeforePeriod) {
          openingQty = qtyBalance;
          openingWac = runningWac;
        }
      }

      // Calculations of final stage values
      const safeOpeningQty = Math.max(0, openingQty);
      const openingValue = (safeOpeningQty * openingWac) + periodOpeningVal;
      const finalOpeningQty = safeOpeningQty + periodOpeningQty;
      const finalOpeningWac = finalOpeningQty > 0 ? openingValue / finalOpeningQty : defaultCost;
      
      const purchaseCost = purchaseQty > 0 ? purchaseVal / purchaseQty : 0;
      const purchaseRetCost = purchaseRetQty > 0 ? purchaseRetVal / purchaseRetQty : 0;

      const availableQty = finalOpeningQty + purchaseQty - purchaseRetQty;
      const availableVal = openingValue + purchaseVal - purchaseRetVal;
      const availableCost = availableQty > 0 ? availableVal / availableQty : 0;

      const salesCost = salesQty > 0 ? salesVal / salesQty : 0;

      const adjCost = adjQty !== 0 ? adjVal / adjQty : 0;

      const closingQty = availableQty - salesQty + adjQty;
      const closingVal = availableVal - salesVal + adjVal;
      const closingCost = closingQty > 0 ? closingVal / closingQty : 0;

      itemMetricsMap.set(item.id, {
        openingQty: finalOpeningQty,
        openingCost: finalOpeningWac,
        openingValue,
        purchaseQty,
        purchaseCost,
        purchaseValue: purchaseVal,
        purchaseRetQty,
        purchaseRetCost,
        purchaseRetValue: purchaseRetVal,
        availableQty,
        availableCost,
        availableValue: availableVal,
        salesQty,
        salesCost,
        salesValue: salesVal,
        adjQty,
        adjCost,
        adjValue: adjVal,
        closingQty,
        closingCost,
        closingValue: closingVal,
      });
    }

    // Build hierarchical grouping dynamically
    const sBrand = showBrand !== false;
    const sDivision = showDivision !== false;
    const sCategory = showCategory !== false;
    const sGender = showGender !== false;
    const sSilhouette = showSilhouette !== false;
    const sArticle = showArticle !== false;
    const sVariant = showVariant !== undefined ? showVariant : !summaryOnly;

    const levels: string[] = [];
    if (sBrand) levels.push('brand');
    if (sDivision) levels.push('division');
    if (sCategory) levels.push('category');
    if (sGender) levels.push('gender');
    if (sSilhouette) levels.push('silhouette');
    if (sArticle) levels.push('article');
    if (sVariant) levels.push('variant');

    if (levels.length === 0) {
      levels.push('brand');
    }

    const root: any[] = [];

    const addValuationTotals = (target: any, source: any) => {
      target.openingQty += source.openingQty;
      target.openingValue += source.openingValue;
      target.openingCost = target.openingQty > 0 ? target.openingValue / target.openingQty : 0;

      target.purchaseQty += source.purchaseQty;
      target.purchaseValue += source.purchaseValue;
      target.purchaseCost = target.purchaseQty > 0 ? target.purchaseValue / target.purchaseQty : 0;

      target.purchaseRetQty += source.purchaseRetQty;
      target.purchaseRetValue += source.purchaseRetValue;
      target.purchaseRetCost = target.purchaseRetQty > 0 ? target.purchaseRetValue / target.purchaseRetQty : 0;

      target.availableQty += source.availableQty;
      target.availableValue += source.availableValue;
      target.availableCost = target.availableQty > 0 ? target.availableValue / target.availableQty : 0;

      target.salesQty += source.salesQty;
      target.salesValue += source.salesValue;
      target.salesCost = target.salesQty > 0 ? target.salesValue / target.salesQty : 0;

      target.adjQty += source.adjQty;
      target.adjValue += source.adjValue;
      target.adjCost = target.adjQty !== 0 ? target.adjValue / target.adjQty : 0;

      target.closingQty += source.closingQty;
      target.closingValue += source.closingValue;
      target.closingCost = target.closingQty > 0 ? target.closingValue / target.closingQty : 0;
    };

    for (const item of items) {
      const metrics = itemMetricsMap.get(item.id) || this.createEmptyValuationTotals();

      let currentLevelNodes = root;
      for (let i = 0; i < levels.length; i++) {
        const levelName = levels[i];
        let nodeVal = '';
        let extraFields: any = {};

        if (levelName === 'brand') {
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
          const bc = (item.barCode || '').trim();
          nodeVal = bc ? `${item.sku}_${bc}` : `${item.sku}_${item.id}`;
          extraFields.barCode = bc || item.barCode || '';
          extraFields.sku = item.sku;
          extraFields.color = item.color?.name || 'Default';
          extraFields.size = item.size?.name || 'Default';
        }

        let existingNode = currentLevelNodes.find(n => n.level === levelName && n.value === nodeVal);
        if (!existingNode) {
          existingNode = {
            level: levelName,
            value: nodeVal,
            totals: this.createEmptyValuationTotals(),
            ...extraFields,
            children: [],
          };
          currentLevelNodes.push(existingNode);
        }

        addValuationTotals(existingNode.totals, metrics);

        if (i < levels.length - 1) {
          currentLevelNodes = existingNode.children;
        }
      }
    }

    // Compute grand totals
    const grandTotals = this.createEmptyValuationTotals();
    for (const node of root) {
      addValuationTotals(grandTotals, node.totals);
    }

    const meta = {
      total: totalItems,
      page: 1,
      limit: totalItems,
      totalPages: 1,
    };

    return { root, grandTotals, items: activeItems, itemMetricsMap, meta };
  }

  private createEmptyValuationTotals() {
    return {
      openingQty: 0,
      openingCost: 0,
      openingValue: 0,
      purchaseQty: 0,
      purchaseCost: 0,
      purchaseValue: 0,
      purchaseRetQty: 0,
      purchaseRetCost: 0,
      purchaseRetValue: 0,
      availableQty: 0,
      availableCost: 0,
      availableValue: 0,
      salesQty: 0,
      salesCost: 0,
      salesValue: 0,
      adjQty: 0,
      adjCost: 0,
      adjValue: 0,
      closingQty: 0,
      closingCost: 0,
      closingValue: 0,
    };
  }
}
