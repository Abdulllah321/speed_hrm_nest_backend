import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadService } from '../../upload/upload.service';
import { ExportHistoryService } from '../export-history/export-history.service';
import { FiscalYearClosingService } from './fiscal-year-closing.service';
import { MovementType } from '@prisma/client';
import { chunkArray } from '../../common/utils/chunk.util';

const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

export interface StockPositionTotals {
  launchQty: number;
  beginning: number;
  netSales: number;
  end: number;
  totalQty: number;
  sellThroughPercent: number;
  opening: number;
  purchases: number;
  purchaseReturns: number;
  netPurchases: number;
  positiveAdjustments: number;
  negativeAdjustments: number;
  netAdjustments: number;
  sales: number;
  salesReturns: number;
}

export interface StockPositionVariantItem {
  id: string;
  sku: string;
  barCode: string;
  size: string;
  color: string;
  division: string;
  department: string;
  productCategory: string;
  silhouette: string;
  class: string;
  subclass: string;
  season: string;
  oldSeason: string;
  gender: string;
  case: string;
  band: string;
  movementType: string;
  heelHeight: string;
  width: string;
  channelClass: string;
  discountPercent: number;
  rirRp: number;
  currentRp: number;
  fob: number;
  launchDate: string;
  launchQty: number;
  beginning: number;
  sellThroughPercent: number;
  netSales: number;
  end: number;
  lastGrnNumber: string;
  lastGrnDate: string;
  lastLcNumber?: string;
  lastLcDate?: string;
  lastSaleDate: string;
  totalQty: number;
  lastSaleOutletBreakdown?: string;
  totals: StockPositionTotals;
}

export interface StockPositionProductNode {
  sku: string;
  description: string;
  productLabel: string;
  discountPercent?: number;
  rirRp?: number;
  currentRp?: number;
  fob?: number;
  launchDate?: string;
  lastGrnNumber?: string;
  lastGrnDate?: string;
  lastLcNumber?: string;
  lastLcDate?: string;
  lastSaleDate?: string;
  totalQty?: number;
  lastSaleOutletBreakdown?: string;
  sizes: StockPositionVariantItem[];
  totals: StockPositionTotals;
}

export interface StockPositionCategoryNode {
  categoryId: string;
  categoryName: string;
  products: StockPositionProductNode[];
  totals: StockPositionTotals;
}

export interface StockPositionGenderNode {
  genderId: string;
  genderName: string;
  categories: StockPositionCategoryNode[];
  totals: StockPositionTotals;
}

export interface StockPositionDivisionNode {
  divisionId: string;
  divisionName: string;
  genders: StockPositionGenderNode[];
  totals: StockPositionTotals;
}

export interface StockPositionBrandNode {
  brandId: string;
  brandName: string;
  divisions: StockPositionDivisionNode[];
  totals: StockPositionTotals;
}

export interface StockPositionFlatRecord {
  brand: string;
  sku: string;
  itemName: string;
  barcode: string;
  barCode?: string;
  size: string;
  color: string;
  division: string;
  department: string;
  productCategory: string;
  silhouette: string;
  class: string;
  subclass: string;
  season: string;
  oldSeason: string;
  gender: string;
  case: string;
  band: string;
  movementType: string;
  heelHeight: string;
  width: string;
  channelClass: string;
  discountPercent: number;
  rirRp: number;
  currentRp: number;
  fob: number;
  launchDate: string;
  launchQty: number;
  beginning: number;
  sellThroughPercent: number;
  netSales: number;
  end: number;
  lastGrnNumber: string;
  lastGrnDate: string;
  lastLcNumber?: string;
  lastLcDate?: string;
  lastSaleDate: string;
  totalQty: number;
  lastSaleOutletBreakdown?: string;
  totals: StockPositionTotals;
}

export interface StockPositionReportResult {
  brands: StockPositionBrandNode[];
  flatItems: StockPositionFlatRecord[];
  grandTotals: StockPositionTotals;
  dateRange: { startDate?: string; endDate?: string };
  locationNames: string;
}

export interface QueueStockPositionExportOptions {
  userId: string;
  userRole?: string;
  locationId?: string;
  warehouseId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  brandIds?: string[];
}

@Injectable()
export class StockPositionExportService {
  private readonly logger = new Logger(StockPositionExportService.name);
  private readonly previewStorageDir = path.join(
    process.cwd(),
    'uploads',
    'report-previews',
  );

  constructor(
    @InjectQueue('stock-position-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
    private readonly exportHistoryService: ExportHistoryService,
    private readonly fiscalClosingService: FiscalYearClosingService,
  ) {
    if (!fs.existsSync(this.previewStorageDir)) {
      fs.mkdirSync(this.previewStorageDir, { recursive: true });
    }
  }

  async queueReportPreview(
    opts: QueueStockPositionExportOptions,
  ): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

    // Clean up older pending preview jobs for the same user
    try {
      const pendingJobs = await this.exportQueue.getJobs([
        'waiting',
        'delayed',
      ]);
      for (const job of pendingJobs) {
        if (
          job.name === 'generate-stock-position-preview' &&
          job.data?.userId === opts.userId
        ) {
          await job.remove();
          this.logger.log(
            `[StockPositionReport] Removed older pending preview job ${job.id} for user ${opts.userId}`,
          );
        }
      }
    } catch (e: any) {
      this.logger.warn(
        `Failed to clean up older pending preview jobs: ${e.message}`,
      );
    }

    await this.exportQueue.add(
      'generate-stock-position-preview',
      {
        jobId,
        userId: opts.userId,
        userRole: opts.userRole,
        tenantId,
        tenantDbUrl,
        locationId: opts.locationId,
        warehouseId: opts.warehouseId,
        startDate: opts.startDate,
        endDate: opts.endDate,
        search: opts.search,
        brandIds: opts.brandIds,
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
      `[StockPositionReport] Queued preview job ${jobId} for user ${opts.userId} (role: ${opts.userRole || 'N/A'})`,
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

  async saveReportPreviewResult(
    jobId: string,
    result: StockPositionReportResult,
  ): Promise<void> {
    const jsonStr = JSON.stringify(result);
    const compressed = await gzipAsync(Buffer.from(jsonStr, 'utf8'));
    const filePath = path.join(
      this.previewStorageDir,
      `stock-position-preview-${jobId}.json.gz`,
    );
    await fs.promises.writeFile(filePath, compressed);
  }

  async getReportPreviewResult(
    jobId: string,
  ): Promise<StockPositionReportResult | null> {
    const filePath = path.join(
      this.previewStorageDir,
      `stock-position-preview-${jobId}.json.gz`,
    );
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const compressed = await fs.promises.readFile(filePath);
    const decompressed = await gunzipAsync(compressed);
    return JSON.parse(decompressed.toString('utf8'));
  }

  async generateStockPositionReportDataInternal(
    prisma: PrismaService,
    opts: {
      userId?: string;
      userRole?: string;
      brandIds?: string[];
      locationId?: string;
      warehouseId?: string;
      startDate?: string;
      endDate?: string;
      search?: string;
      onProgress?: (percent: number, message: string) => Promise<void> | void;
    },
  ): Promise<StockPositionReportResult> {
    const {
      userId,
      userRole,
      brandIds,
      locationId,
      warehouseId,
      startDate: startStr,
      endDate: endStr,
      search,
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

    const startDate = parseLocalDate(startStr, false);
    const endDate = parseLocalDate(endStr, true);

    // ── Resolve location & warehouse filters with physical stock location mapping ──
    const [allLocations, allWarehouses]: [
      Array<{
        id: string;
        name: string;
        code: string;
        shortCode?: string | null;
        warehouseId?: string | null;
        isStockLocation?: boolean;
      }>,
      Array<{ id: string; name: string; code: string }>,
    ] = await Promise.all([
      (prisma as any).location.findMany({
        where: { isDeleted: false },
        select: {
          id: true,
          name: true,
          code: true,
          shortCode: true,
          warehouseId: true,
          isStockLocation: true,
        },
        orderBy: { name: 'asc' },
      }),
      (prisma as any).warehouse.findMany({
        where: { isDeleted: false, isActive: true },
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const locIds = locationId
      ? locationId
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const whIds = warehouseId
      ? warehouseId
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    // Build mapping from dedicated warehouse location IDs to parent warehouse ID
    const whLocIdToWhIdMap = new Map<string, string>();
    const warehouseLocIdsSet = new Set<string>();

    for (const wh of allWarehouses) {
      const matchingLocs = allLocations.filter(
        (l) =>
          (l as any).warehouseId === wh.id ||
          l.id === wh.id ||
          l.code === `WH-${wh.code}` ||
          (l.code === wh.code && wh.code !== 'C20001'),
      );
      for (const ml of matchingLocs) {
        whLocIdToWhIdMap.set(ml.id, wh.id);
        warehouseLocIdsSet.add(ml.id);
      }
    }

    // Resolve target location IDs for queries
    const targetLocationIds: string[] = [...locIds];
    if (whIds.length > 0) {
      for (const whId of whIds) {
        const whObj = allWarehouses.find(
          (w) => w.id === whId || w.code === whId,
        );
        const whCode = whObj?.code || whId;
        const matchingLocs = allLocations.filter(
          (l) =>
            (l as any).warehouseId === whId ||
            l.id === whId ||
            l.code === `WH-${whCode}` ||
            l.code === whCode,
        );
        for (const ml of matchingLocs) {
          targetLocationIds.push(ml.id);
        }
      }
    }

    const uniqueTargetLocationIds = [...new Set(targetLocationIds)];

    const locationFilters: any[] = [];
    if (uniqueTargetLocationIds.length > 0) {
      locationFilters.push({
        locationId:
          uniqueTargetLocationIds.length > 1
            ? { in: uniqueTargetLocationIds }
            : uniqueTargetLocationIds[0],
      });
    }
    if (whIds.length > 0) {
      locationFilters.push({
        warehouseId: whIds.length > 1 ? { in: whIds } : whIds[0],
      });
    }

    const locationOrWarehouseWhere: any =
      locationFilters.length > 1
        ? { OR: locationFilters }
        : locationFilters.length === 1
          ? locationFilters[0]
          : {};

    let locationNames = 'All Locations & Warehouses';
    if (locIds.length > 0 || whIds.length > 0) {
      const matchedLocs = allLocations
        .filter((l) => locIds.includes(l.id))
        .map((l) => l.name);
      const matchedWhs = allWarehouses
        .filter((w) => whIds.includes(w.id))
        .map((w) => `${w.name} (Warehouse)`);
      const combined = [...matchedLocs, ...matchedWhs];
      if (combined.length > 0) {
        locationNames = combined.join(', ');
      }
    }

    const locationNameLookup = new Map<string, string>();
    for (const loc of allLocations) {
      locationNameLookup.set(loc.id, loc.name);
    }
    for (const wh of allWarehouses) {
      locationNameLookup.set(wh.id, wh.name);
    }

    const createEmptyTotals = (): StockPositionTotals => ({
      launchQty: 0,
      beginning: 0,
      netSales: 0,
      end: 0,
      totalQty: 0,
      sellThroughPercent: 0,
      opening: 0,
      purchases: 0,
      purchaseReturns: 0,
      netPurchases: 0,
      positiveAdjustments: 0,
      negativeAdjustments: 0,
      netAdjustments: 0,
      sales: 0,
      salesReturns: 0,
    });

    const addTotals = (
      target: StockPositionTotals,
      source: StockPositionTotals,
    ) => {
      target.launchQty += Number(source.launchQty) || 0;
      target.beginning += source.beginning;
      target.netSales += source.netSales;
      target.end += source.end;
      target.totalQty += source.totalQty;
      target.opening += source.opening;
      target.purchases += source.purchases;
      target.purchaseReturns += source.purchaseReturns;
      target.netPurchases += source.netPurchases;
      target.positiveAdjustments += source.positiveAdjustments;
      target.negativeAdjustments += source.negativeAdjustments;
      target.netAdjustments += source.netAdjustments;
      target.sales += source.sales;
      target.salesReturns += source.salesReturns;
      target.sellThroughPercent =
        target.beginning > 0
          ? Math.round((target.netSales / target.beginning) * 10000) / 100
          : 0;
    };

    // ── RBAC / Brand Isolation ─────────────────────────────────────────
    const roleName = userRole?.toLowerCase();
    const isAdmin =
      roleName === 'super_admin' ||
      roleName === 'super-admin' ||
      roleName === 'admin';
    let allowedBrandIds: string[] | null = null;

    if (!isAdmin && userId) {
      const userBrands = await prisma.userBrand.findMany({
        where: { userId: userId },
        select: { brandId: true },
      });
      allowedBrandIds = userBrands.map((ub) => ub.brandId);
    }

    let finalAllowedBrandIds = allowedBrandIds;
    if (brandIds && brandIds.length > 0) {
      if (finalAllowedBrandIds !== null) {
        finalAllowedBrandIds = finalAllowedBrandIds.filter((id) =>
          brandIds.includes(id),
        );
      } else {
        finalAllowedBrandIds = brandIds;
      }
    }

    if (finalAllowedBrandIds !== null && finalAllowedBrandIds.length === 0) {
      return {
        brands: [],
        flatItems: [],
        grandTotals: createEmptyTotals(),
        dateRange: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        locationNames,
      };
    }

    await onProgress?.(15, 'Discovering active items and catalog records...');

    // Discover items with inventory or stock ledger entries in scope
    const [inventoryItems, ledgerItems] = await Promise.all([
      prisma.inventoryItem.findMany({
        where: { ...locationOrWarehouseWhere },
        select: { itemId: true, quantity: true },
      }),
      prisma.stockLedger.findMany({
        where: {
          ...locationOrWarehouseWhere,
          createdAt: { lte: endDate },
        },
        select: { itemId: true },
        distinct: ['itemId'],
      }),
    ]);

    const uniqueItemIds = [
      ...new Set([
        ...inventoryItems.map((i) => i.itemId),
        ...ledgerItems.map((l) => l.itemId),
      ]),
    ];

    if (uniqueItemIds.length === 0) {
      return {
        brands: [],
        flatItems: [],
        grandTotals: createEmptyTotals(),
        dateRange: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        locationNames,
      };
    }

    await onProgress?.(30, 'Retrieving catalog product details...');

    const uniqueItemChunks = chunkArray(uniqueItemIds, 1000);
    const itemsNested = await Promise.all(
      uniqueItemChunks.map((chunk) =>
        prisma.item.findMany({
          where: {
            OR: [{ id: { in: chunk } }, { itemId: { in: chunk } }],
            ...(finalAllowedBrandIds !== null
              ? { brandId: { in: finalAllowedBrandIds } }
              : {}),
          },
          include: {
            brand: true,
            division: true,
            category: true,
            gender: true,
            silhouette: true,
            itemClass: true,
            itemSubclass: true,
            season: true,
            channelClass: true,
            color: true,
            size: true,
            segment: true,
          },
        }),
      ),
    );
    const rawItems = itemsNested.flat();

    const searchTrimmed = search?.trim().toLowerCase();
    const items = searchTrimmed
      ? rawItems.filter((i) => {
          const skuMatch = i.sku?.toLowerCase().includes(searchTrimmed);
          const descMatch = i.description
            ?.toLowerCase()
            .includes(searchTrimmed);
          const barMatch = i.barCode?.toLowerCase().includes(searchTrimmed);
          const brandMatch = i.brand?.name
            ?.toLowerCase()
            .includes(searchTrimmed);
          return skuMatch || descMatch || barMatch || brandMatch;
        })
      : rawItems;

    if (items.length === 0) {
      return {
        brands: [],
        flatItems: [],
        grandTotals: createEmptyTotals(),
        dateRange: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        locationNames,
      };
    }
    const itemLookup = new Map<string, any>();
    for (const item of items) {
      itemLookup.set(item.id, item);
      itemLookup.set(item.itemId, item);
    }

    const matchedItemIds = items.map((i) => i.id);
    const matchedItemChunks = chunkArray(matchedItemIds, 1000);

    // Build Current Total Stock Map from inventoryItems
    const currentStockMap = new Map<string, number>();
    for (const inv of inventoryItems) {
      const item = itemLookup.get(inv.itemId);
      if (!item) continue;
      currentStockMap.set(
        item.id,
        (currentStockMap.get(item.id) || 0) + Number(inv.quantity || 0),
      );
    }

    await onProgress?.(
      45,
      'Computing fiscal opening B/F balances & in-range ledger movements...',
    );

    const snapshotDate =
      await this.fiscalClosingService.findLatestFiscalOpeningSnapshotDate(
        prisma,
        startDate,
      );
    const queryStartDate =
      snapshotDate && snapshotDate < startDate ? snapshotDate : startDate;

    const ledgerMap = new Map<string, any[]>();
    let chunkIndex = 0;
    const totalChunks = matchedItemChunks.length;

    for (const chunk of matchedItemChunks) {
      chunkIndex++;
      const pct = 45 + Math.floor((chunkIndex / Math.max(1, totalChunks)) * 20);
      await onProgress?.(
        pct,
        `Fetching stock ledger entries for ${matchedItemIds.length} items (Chunk ${chunkIndex} of ${totalChunks})...`,
      );

      const chunkLedgerEntries = await prisma.stockLedger.findMany({
        where: {
          AND: [
            locationOrWarehouseWhere,
            {
              itemId: { in: chunk },
              createdAt: {
                gte: queryStartDate,
                lte: endDate,
              },
            },
          ],
        },
        select: {
          id: true,
          itemId: true,
          qty: true,
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

    type ItemPositionMetrics = {
      opening: number;
      purchases: number;
      purchaseReturns: number;
      netPurchases: number;
      positiveAdjustments: number;
      negativeAdjustments: number;
      netAdjustments: number;
      sales: number;
      salesReturns: number;
      netSales: number;
      beginning: number;
      end: number;
    };

    const itemMetricsMap = new Map<string, ItemPositionMetrics>();

    for (const item of items) {
      const entries = ledgerMap.get(item.id) || [];

      let qtyBalance = 0;
      let openingQty = 0;
      let periodOpeningQty = 0;

      let purchases = 0;
      let purchaseReturns = 0;

      let sales = 0;
      let salesReturns = 0;
      let salesQty = 0;

      let positiveAdjustments = 0;
      let negativeAdjustments = 0;
      let adjQty = 0;

      for (const entry of entries) {
        const entryQty = Number(entry.qty);
        const ref = entry.referenceType || '';

        const isBeforePeriod = entry.createdAt < startDate;
        const isFiscalYearOpening = ref === 'FISCAL_YEAR_OPENING';

        // Skip mid-range automated Fiscal Year Opening snapshots to prevent double counting when querying across fiscal years
        if (
          isFiscalYearOpening &&
          !isBeforePeriod &&
          queryStartDate < entry.createdAt &&
          startDate < entry.createdAt
        ) {
          continue;
        }

        const isOpening =
          entry.movementType === 'OPENING_BALANCE' ||
          entry.movementType === MovementType.OPENING_BALANCE ||
          ref === 'OPENING_BALANCE' ||
          ref === 'BULK_STOCK_UPLOAD' ||
          ref === 'FISCAL_YEAR_OPENING';

        const isAdjustment =
          entry.movementType === 'ADJUSTMENT' ||
          entry.movementType === MovementType.ADJUSTMENT ||
          ref === 'ADJUSTMENT' ||
          ref === 'STOCK_ADJUSTMENT' ||
          ref === 'SADJ' ||
          ref === 'CLOSING_BALANCE' ||
          ref === 'MANUAL_ZERO_STOCK' ||
          ref.startsWith('SADJ') ||
          ref.includes('ADJUSTMENT') ||
          ref.includes('CLOSING_BALANCE') ||
          ref.includes('ZERO_STOCK');

        const isTransfer =
          entry.movementType === 'TRANSFER' ||
          entry.movementType === MovementType.TRANSFER ||
          [
            'TRANSFER_REQUEST',
            'OUTLET_TRANSFER_IN',
            'OUTLET_TRANSFER_OUT',
            'TRANSFER_RECEIPT',
            'RETURN_REQUEST',
            'TRANSFER',
            'STOCK_TRANSFER',
            'TRANSFER_IN',
            'TRANSFER_OUT',
            'STN',
            'STOCK_TRANSFER_NOTE',
            'DIRECT_TRANSFER',
            'DIRECT_TRANSFER_IN',
            'DIRECT_TRANSFER_OUT',
            'STOCK_MOVEMENT',
            'INTER_OUTLET_TRANSFER',
            'CROSS_LOCATION_RETURN_TRANSFER',
            'CLAIM_TO_PLM',
            'CLAIM_RETURN',
            'CLAIM_RETURN_REQUEST',
            'POS_CLAIM_APPROVED',
            'CLAIM_ACKNOWLEDGED',
            'STOCK_REQUISITION',
          ].includes(ref) ||
          ref.startsWith('TRANSFER') ||
          ref.includes('TRANSFER');

        const isPosSalesReturn =
          !isTransfer &&
          ([
            'POS_RETURN',
            'POS_EXCHANGE_IN',
            'POS_REFUND',
            'POS_VOID',
            'SALES_RETURN',
            'SRN',
          ].includes(ref) ||
            ref.startsWith('POS_RETURN') ||
            ref.startsWith('POS_REFUND') ||
            ref.startsWith('POS_VOID') ||
            ref.startsWith('SALES_RETURN'));

        if (
          entry.movementType === 'INBOUND' ||
          entry.movementType === MovementType.INBOUND ||
          entry.movementType === 'OPENING_BALANCE' ||
          entry.movementType === MovementType.OPENING_BALANCE ||
          isOpening ||
          ((entry.movementType === 'ADJUSTMENT' ||
            entry.movementType === MovementType.ADJUSTMENT) &&
            entryQty > 0) ||
          ((entry.movementType === 'TRANSFER' ||
            entry.movementType === MovementType.TRANSFER) &&
            entryQty > 0) ||
          (isTransfer && entryQty > 0) ||
          isPosSalesReturn
        ) {
          qtyBalance += entryQty;

          if (!isBeforePeriod) {
            const isPurchase =
              !isTransfer &&
              !isOpening &&
              !isAdjustment &&
              !isPosSalesReturn &&
              (ref === 'GRN' ||
                ref === 'PURCHASE' ||
                ref === 'LANDED_COST' ||
                ref.startsWith('GRN') ||
                ref.startsWith('PURCHASE') ||
                entry.movementType === 'INBOUND' ||
                entry.movementType === MovementType.INBOUND);

            if (isOpening) {
              periodOpeningQty += entryQty;
            } else if (isAdjustment) {
              positiveAdjustments += entryQty;
              adjQty += entryQty;
            } else if (isTransfer) {
              // Internal transfers must NOT be counted in Purchases, Sales, or Adjustments
            } else if (isPosSalesReturn) {
              // Sales Return reduces Net Sales
              salesReturns += entryQty;
              salesQty -= entryQty;
            } else if (isPurchase) {
              purchases += entryQty;
            }
          }
        } else {
          // Outbound
          qtyBalance += entryQty; // entryQty is negative

          if (!isBeforePeriod) {
            const isPurchaseReturn =
              [
                'PURCHASE_RETURN',
                'PURCHASE_RETURN_GRN',
                'PURCHASE_RETURN_LC',
                'PURCHASE_RETURN_INV',
                'PRN',
                'PURCHASE_RETURN_NOTE',
              ].includes(ref) ||
              ref.startsWith('PURCHASE_RETURN') ||
              ref.startsWith('PRN');

            const isSale =
              !isTransfer &&
              !isAdjustment &&
              !isOpening &&
              ([
                'POS_SALE',
                'POS_EXCHANGE_OUT',
                'POS_RETURN',
                'POS_EXCHANGE_IN',
                'POS_REFUND',
                'POS_VOID',
                'SALE',
                'SALES_ORDER',
                'DELIVERY_CHALLAN',
              ].includes(ref) ||
                ref.startsWith('POS_SALE') ||
                ref.startsWith('SALE') ||
                entry.movementType === 'OUTBOUND' ||
                entry.movementType === MovementType.OUTBOUND);

            const absQty = Math.abs(entryQty);

            if (isPurchaseReturn) {
              purchaseReturns += absQty;
            } else if (isAdjustment) {
              negativeAdjustments += absQty;
              adjQty += entryQty; // negative
            } else if (isTransfer) {
              // Internal transfers must NOT be counted in Sales or Purchase Returns
            } else if (isSale) {
              if (entryQty > 0) {
                // Return
                salesReturns += entryQty;
                salesQty -= entryQty;
              } else {
                // Sale (outbound)
                sales += absQty;
                salesQty += absQty;
              }
            }
          }
        }

        if (isBeforePeriod) {
          openingQty = qtyBalance;
        }
      }

      const safeOpeningQty = Math.max(0, openingQty);
      const finalOpeningQty = safeOpeningQty + periodOpeningQty;

      const netPurchases = purchases - purchaseReturns;
      const netAdjustments = adjQty;

      const availableQty = finalOpeningQty + purchases - purchaseReturns;
      const beginning = availableQty + netAdjustments;
      const netSales = salesQty; // = sales - salesReturns
      const end = beginning - netSales; // = availableQty - salesQty + adjQty = closingQty in Valuation!

      itemMetricsMap.set(item.id, {
        opening: finalOpeningQty,
        purchases,
        purchaseReturns,
        netPurchases,
        positiveAdjustments,
        negativeAdjustments,
        netAdjustments,
        sales,
        salesReturns,
        netSales,
        beginning,
        end,
      });
    }

    await onProgress?.(
      65,
      'Fetching launch dates, earliest Landed Costs, latest GRNs & last sales...',
    );

    // 3a. Purchase Orders (for earliest PO launch date & PO quantity fallback)
    const poLaunchMap = new Map<
      string,
      { date: Date | null; dateStr: string; qty: number }
    >();

    // 3. Launch Qty & Date (earliest LC or GRN)
    const launchDataMap = new Map<
      string,
      {
        launchDate: string;
        launchDateObj: Date | null;
        launchQty: number;
        fob: number;
      }
    >();

    // 4. Last GRN Number & Last GRN Date
    const lastGrnMap = new Map<
      string,
      { grnNumber: string; grnDate: string }
    >();

    // 4b. Latest Landed Cost (Number, Date, unitCostPKR)
    const lastLcMap = new Map<
      string,
      { lcNumber: string; lcDate: string; unitCostPKR: number }
    >();

    // 5. Last Sale Date & Total Quantity sold on that date across all outlets
    const lastSaleDateMap = new Map<string, string>();
    const lastSaleDateQtyMap = new Map<string, number>();
    const lastSaleOutletBreakdownMap = new Map<string, string>();

    // Query earliest POs, GRN, LC, and last sales for matched items
    for (const chunk of matchedItemChunks) {
      // 1. Earliest Purchase Order for matched items (for launch date / qty fallback)
      const poItems = await prisma.purchaseOrderItem.findMany({
        where: { itemId: { in: chunk } },
        select: {
          itemId: true,
          quantity: true,
          purchaseOrder: {
            select: { orderDate: true, createdAt: true },
          },
        },
        orderBy: { purchaseOrder: { orderDate: 'asc' } },
      });

      for (const poItem of poItems) {
        const iId = poItem.itemId;
        if (!poLaunchMap.has(iId)) {
          const rawDate =
            poItem.purchaseOrder?.orderDate || poItem.purchaseOrder?.createdAt;
          const dateObj = rawDate ? new Date(rawDate) : null;
          poLaunchMap.set(iId, {
            date: dateObj,
            dateStr: dateObj
              ? `${dateObj.getMonth() + 1}/${dateObj.getDate()}/${dateObj.getFullYear()}`
              : '',
            qty: Number(poItem.quantity || 0),
          });
        }
      }

      // 2. Latest & Earliest GRNs
      const grnItems = await prisma.goodsReceiptNoteItem.findMany({
        where: { itemId: { in: chunk } },
        select: {
          itemId: true,
          receivedQty: true,
          goodsReceiptNote: {
            select: { grnNumber: true, receivedDate: true, createdAt: true },
          },
        },
        orderBy: { goodsReceiptNote: { receivedDate: 'asc' } },
      });

      for (const grnItem of grnItems) {
        const iId = grnItem.itemId;
        const recDate =
          grnItem.goodsReceiptNote?.receivedDate ||
          grnItem.goodsReceiptNote?.createdAt;
        const dateObj = recDate ? new Date(recDate) : null;
        const dateStr = dateObj
          ? `${dateObj.getMonth() + 1}/${dateObj.getDate()}/${dateObj.getFullYear()}`
          : '';
        const grnNo = grnItem.goodsReceiptNote?.grnNumber || '-';

        // Earliest for launch
        if (!launchDataMap.has(iId)) {
          launchDataMap.set(iId, {
            launchDate: dateStr,
            launchDateObj: dateObj,
            launchQty: Number(grnItem.receivedQty || 0),
            fob: 0,
          });
        }

        // Latest for last GRN (overwrites as we process ascending order)
        lastGrnMap.set(iId, {
          grnNumber: grnNo,
          grnDate: dateStr,
        });
      }

      // 3. Landed Cost items for earliest LC launch date, qty, and FOB
      const lcItems = await prisma.landedCostItem.findMany({
        where: { itemId: { in: chunk } },
        select: {
          itemId: true,
          qty: true,
          unitCostPKR: true,
          landedCost: {
            select: { landedCostNumber: true, createdAt: true },
          },
        },
        orderBy: { landedCost: { createdAt: 'asc' } },
      });

      for (const lcItem of lcItems) {
        const iId = lcItem.itemId;
        const lcDateObj = lcItem.landedCost?.createdAt
          ? new Date(lcItem.landedCost.createdAt)
          : null;
        const dateStr = lcDateObj
          ? `${lcDateObj.getMonth() + 1}/${lcDateObj.getDate()}/${lcDateObj.getFullYear()}`
          : '';
        const lcFob = Number(lcItem.unitCostPKR || 0);
        const existingLaunch = launchDataMap.get(iId);
        if (!existingLaunch) {
          launchDataMap.set(iId, {
            launchDate: dateStr,
            launchDateObj: lcDateObj,
            launchQty: Number(lcItem.qty || 0),
            fob: lcFob,
          });
        } else {
          if (!existingLaunch.fob && lcFob > 0) {
            existingLaunch.fob = lcFob;
          }
          if (!existingLaunch.launchDateObj && lcDateObj) {
            existingLaunch.launchDate = dateStr;
            existingLaunch.launchDateObj = lcDateObj;
          }
        }
      }

      // 4. Latest Landed Cost for Landed Cost Number & Date
      const latestLcItems = await prisma.landedCostItem.findMany({
        where: { itemId: { in: chunk } },
        select: {
          itemId: true,
          unitCostPKR: true,
          landedCost: {
            select: { landedCostNumber: true, createdAt: true },
          },
        },
        orderBy: { landedCost: { createdAt: 'desc' } },
      });

      for (const lcItem of latestLcItems) {
        const iId = lcItem.itemId;
        if (!lastLcMap.has(iId)) {
          const recDate = lcItem.landedCost?.createdAt;
          const dateStr = recDate
            ? new Date(recDate).toLocaleDateString('en-US')
            : '-';
          lastLcMap.set(iId, {
            lcNumber: lcItem.landedCost?.landedCostNumber || '-',
            lcDate: dateStr,
            unitCostPKR: Number(lcItem.unitCostPKR || 0),
          });
        }
      }

      // 5. Latest POS / Sales invoice date, total sale quantity, and outlet breakdown
      const lastSaleEntries = await prisma.stockLedger.findMany({
        where: {
          itemId: { in: chunk },
          referenceType: {
            in: [
              'POS_SALE',
              'POS_EXCHANGE_OUT',
              'SALE',
              'SALES_DELIVERY',
              'DELIVERY_CHALLAN',
            ],
          },
        },
        select: {
          itemId: true,
          qty: true,
          createdAt: true,
          locationId: true,
          warehouseId: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      const entriesByItem = new Map<string, typeof lastSaleEntries>();
      for (const entry of lastSaleEntries) {
        let arr = entriesByItem.get(entry.itemId);
        if (!arr) {
          arr = [];
          entriesByItem.set(entry.itemId, arr);
        }
        arr.push(entry);
      }

      for (const [itemId, entries] of entriesByItem.entries()) {
        if (entries.length > 0 && entries[0].createdAt) {
          const latestDate = new Date(entries[0].createdAt);
          const datePart = `${latestDate.getMonth() + 1}/${latestDate.getDate()}/${latestDate.getFullYear()}`;
          const timePart = `${latestDate.getHours().toString().padStart(2, '0')}:${latestDate.getMinutes().toString().padStart(2, '0')}`;
          lastSaleDateMap.set(itemId, `${datePart} ${timePart}`);

          const targetYear = latestDate.getFullYear();
          const targetMonth = latestDate.getMonth();
          const targetDay = latestDate.getDate();

          let totalSaleQtyOnLastDate = 0;
          const outletMap = new Map<string, number>();

          for (const e of entries) {
            if (e.createdAt) {
              const ed = new Date(e.createdAt);
              if (
                ed.getFullYear() === targetYear &&
                ed.getMonth() === targetMonth &&
                ed.getDate() === targetDay
              ) {
                const absQty = Math.abs(Number(e.qty || 0));
                totalSaleQtyOnLastDate += absQty;
                const outletName =
                  (e.locationId ? locationNameLookup.get(e.locationId) : null) ||
                  (e.warehouseId ? locationNameLookup.get(e.warehouseId) : null) ||
                  'Direct / Main';
                outletMap.set(
                  outletName,
                  (outletMap.get(outletName) || 0) + absQty,
                );
              }
            }
          }

          const outletParts: string[] = [];
          for (const [outletName, oQty] of outletMap.entries()) {
            outletParts.push(`${outletName}: ${oQty}`);
          }

          lastSaleDateQtyMap.set(itemId, totalSaleQtyOnLastDate);
          lastSaleOutletBreakdownMap.set(itemId, outletParts.join(', '));
        }
      }
    }

    await onProgress?.(85, 'Assembling hierarchical tree and flat matrix...');

    const grandTotals = createEmptyTotals();
    const flatItems: StockPositionFlatRecord[] = [];
    const brandsList: StockPositionBrandNode[] = [];

    // Helper to format date
    const formatDateOnly = (d?: Date | null): string => {
      if (!d) return '-';
      const dt = new Date(d);
      return `${dt.getMonth() + 1}/${dt.getDate()}/${dt.getFullYear()}`;
    };

    // Iterate through items and build records
    for (const item of items) {
      const iId = item.id;
      const m = itemMetricsMap.get(iId) || {
        opening: 0,
        purchases: 0,
        purchaseReturns: 0,
        netPurchases: 0,
        positiveAdjustments: 0,
        negativeAdjustments: 0,
        netAdjustments: 0,
        sales: 0,
        salesReturns: 0,
        netSales: 0,
        beginning: 0,
        end: 0,
      };

      const opening = m.opening;
      const purchases = m.purchases;
      const purchaseReturns = m.purchaseReturns;
      const netPurchases = m.netPurchases;
      const positiveAdjustments = m.positiveAdjustments;
      const negativeAdjustments = m.negativeAdjustments;
      const netAdjustments = m.netAdjustments;
      const beginning = m.beginning;
      const sales = m.sales;
      const salesReturns = m.salesReturns;
      const netSales = m.netSales;
      const end = m.end;

      const sellThroughPercent =
        beginning > 0
          ? Math.round((netSales / beginning) * 10000) / 100
          : 0;

      // In Total Quantity, user wants total sale quantity on the last sale date across all outlets
      const totalQty = lastSaleDateQtyMap.get(iId) || 0;

      // Skip item if absolutely zero activity across all dimensions
      if (
        opening === 0 &&
        purchases === 0 &&
        purchaseReturns === 0 &&
        positiveAdjustments === 0 &&
        negativeAdjustments === 0 &&
        sales === 0 &&
        salesReturns === 0 &&
        end === 0 &&
        totalQty === 0
      ) {
        continue;
      }

      const poLaunch = poLaunchMap.get(iId);
      const launchInfo = launchDataMap.get(iId);

      let actualLaunchDateObj: Date | null = null;
      let launchDate = '-';

      if ((item as any).launchDate) {
        actualLaunchDateObj = new Date((item as any).launchDate);
        launchDate = formatDateOnly(actualLaunchDateObj);
      } else if (poLaunch?.date) {
        actualLaunchDateObj = poLaunch.date;
        launchDate = poLaunch.dateStr;
      } else if (launchInfo?.launchDateObj) {
        actualLaunchDateObj = launchInfo.launchDateObj;
        launchDate = launchInfo.launchDate;
      }

      // "in launch QTY only display current fuscal year launch qty"
      // If the launch date was within current fiscal year (startDate <= actualLaunchDateObj <= endDate),
      // then display launch quantity. Otherwise, 0 (displays as -)
      let launchQty = 0;
      if (
        actualLaunchDateObj &&
        actualLaunchDateObj >= startDate &&
        actualLaunchDateObj <= endDate
      ) {
        if (
          (item as any).launchQty !== undefined &&
          (item as any).launchQty !== null &&
          Number((item as any).launchQty) > 0
        ) {
          launchQty = Number((item as any).launchQty);
        } else if (poLaunch?.qty && poLaunch.qty > 0) {
          launchQty = poLaunch.qty;
        } else if (launchInfo?.launchQty && launchInfo.launchQty > 0) {
          launchQty = launchInfo.launchQty;
        }
      }

      // In Last LC Number and Date: Landed Cost (or fallback to GRN)
      const lastGrnInfo = lastGrnMap.get(iId);
      const lastLcInfo = lastLcMap.get(iId);
      const lastLcNumber =
        lastLcInfo?.lcNumber && lastLcInfo.lcNumber !== '-'
          ? lastLcInfo.lcNumber
          : lastGrnInfo?.grnNumber || '-';
      const lastLcDate =
        lastLcInfo?.lcDate && lastLcInfo.lcDate !== '-'
          ? lastLcInfo.lcDate
          : lastGrnInfo?.grnDate || '-';
      const lastGrnNumber = lastGrnInfo?.grnNumber || lastLcNumber;
      const lastGrnDate = lastGrnInfo?.grnDate || lastLcDate;
      const lastSaleDate = lastSaleDateMap.get(iId) || '-';
      const lastSaleOutletBreakdown =
        lastSaleOutletBreakdownMap.get(iId) || '';

      const currentRp = Number(item.unitPrice || 0);
      const rirRp = 0;
      const discountPercent = Number(item.discountRate || 0);
      const rawFob = Number(item.fob || item.unitCost || 0);
      const fob = rawFob > 0 ? rawFob : (launchInfo?.fob || 0);

      const itemTotals: StockPositionTotals = {
        launchQty,
        beginning,
        netSales,
        end,
        totalQty,
        sellThroughPercent,
        opening,
        purchases: m.purchases,
        purchaseReturns: m.purchaseReturns,
        netPurchases,
        positiveAdjustments: m.positiveAdjustments,
        negativeAdjustments: m.negativeAdjustments,
        netAdjustments,
        sales,
        salesReturns,
      };

      // Add to grand totals
      addTotals(grandTotals, itemTotals);

      // Create flat record
      const flatRecord: StockPositionFlatRecord = {
        brand: item.brand?.name || 'Unbranded',
        sku: item.sku || '-',
        itemName: item.description || item.itemId || '-',
        barcode: item.barCode || '-',
        barCode: item.barCode || '-',
        size: item.size?.name || '-',
        color: item.color?.name || '-',
        division: item.division?.name || 'N/A',
        department: item.segment?.name || item.division?.name || 'N/A',
        productCategory: item.category?.name || 'N/A',
        silhouette: item.silhouette?.name || 'N/A',
        class: item.itemClass?.name || 'N/A',
        subclass: item.itemSubclass?.name || 'N/A',
        season: item.season?.name || 'N/A',
        oldSeason: item.oldSeason || 'N/A',
        gender: item.gender?.name || 'N/A',
        case: item.case || 'N/A',
        band: item.band || 'N/A',
        movementType: item.movementType || item.movementName || 'N/A',
        heelHeight: item.heelHeight || 'N/A',
        width: item.width || 'N/A',
        channelClass: item.channelClass?.name || 'MULTI',
        discountPercent,
        rirRp,
        currentRp,
        fob,
        launchDate,
        launchQty,
        beginning,
        sellThroughPercent,
        netSales,
        end,
        lastGrnNumber,
        lastGrnDate,
        lastLcNumber,
        lastLcDate,
        lastSaleDate,
        totalQty,
        lastSaleOutletBreakdown,
        totals: itemTotals,
      };

      flatItems.push(flatRecord);

      // Populate Brand -> Division -> Category -> Gender -> SKU -> Variant Hierarchy
      const brandName = item.brand?.name || 'Unbranded';
      let brandNode = brandsList.find((b) => b.brandName === brandName);
      if (!brandNode) {
        brandNode = {
          brandId: item.brandId || brandName,
          brandName,
          divisions: [],
          totals: createEmptyTotals(),
        };
        brandsList.push(brandNode);
      }
      addTotals(brandNode.totals, itemTotals);

      const divisionName = item.division?.name || 'Unassigned Division';
      let divNode = brandNode.divisions.find(
        (d) => d.divisionName === divisionName,
      );
      if (!divNode) {
        divNode = {
          divisionId: item.divisionId || divisionName,
          divisionName,
          genders: [],
          totals: createEmptyTotals(),
        };
        brandNode.divisions.push(divNode);
      }
      addTotals(divNode.totals, itemTotals);

      const genderName = item.gender?.name || 'Unassigned Gender';
      let genderNode = divNode.genders.find(
        (g) => g.genderName === genderName,
      );
      if (!genderNode) {
        genderNode = {
          genderId: item.genderId || genderName,
          genderName,
          categories: [],
          totals: createEmptyTotals(),
        };
        divNode.genders.push(genderNode);
      }
      addTotals(genderNode.totals, itemTotals);

      const categoryName = item.category?.name || 'Uncategorized';
      let catNode = genderNode.categories.find(
        (c) => c.categoryName === categoryName,
      );
      if (!catNode) {
        catNode = {
          categoryId: item.categoryId || categoryName,
          categoryName,
          products: [],
          totals: createEmptyTotals(),
        };
        genderNode.categories.push(catNode);
      }
      addTotals(catNode.totals, itemTotals);

      const sku = item.sku || item.itemId || 'Unknown SKU';
      let productNode = catNode.products.find((p) => p.sku === sku);
      if (!productNode) {
        productNode = {
          sku,
          description: item.description || sku,
          productLabel: `${sku} - ${item.description || ''}`,
          discountPercent,
          rirRp,
          currentRp,
          fob,
          launchDate,
          lastGrnNumber,
          lastGrnDate,
          lastLcNumber,
          lastLcDate,
          lastSaleDate,
          totalQty,
          lastSaleOutletBreakdown,
          sizes: [],
          totals: createEmptyTotals(),
        };
        catNode.products.push(productNode);
      } else {
        if (productNode.discountPercent === undefined && discountPercent !== undefined) {
          productNode.discountPercent = discountPercent;
        }
        if (!productNode.rirRp && rirRp) productNode.rirRp = rirRp;
        if (!productNode.currentRp && currentRp) productNode.currentRp = currentRp;
        if (!productNode.fob && fob) productNode.fob = fob;
        if ((!productNode.launchDate || productNode.launchDate === '-') && launchDate !== '-') {
          productNode.launchDate = launchDate;
        }
        if ((!productNode.lastLcNumber || productNode.lastLcNumber === '-') && lastLcNumber !== '-') {
          productNode.lastLcNumber = lastLcNumber;
          productNode.lastLcDate = lastLcDate;
        }
        if ((!productNode.lastSaleDate || productNode.lastSaleDate === '-') && lastSaleDate !== '-') {
          productNode.lastSaleDate = lastSaleDate;
        }
        if (!productNode.lastSaleOutletBreakdown && lastSaleOutletBreakdown) {
          productNode.lastSaleOutletBreakdown = lastSaleOutletBreakdown;
        }
      }
      addTotals(productNode.totals, itemTotals);

      const variantItem: StockPositionVariantItem = {
        id: item.id,
        sku,
        barCode: item.barCode || '-',
        size: item.size?.name || '-',
        color: item.color?.name || '-',
        division: item.division?.name || 'N/A',
        department: item.segment?.name || item.division?.name || 'N/A',
        productCategory: item.category?.name || 'N/A',
        silhouette: item.silhouette?.name || 'N/A',
        class: item.itemClass?.name || 'N/A',
        subclass: item.itemSubclass?.name || 'N/A',
        season: item.season?.name || 'N/A',
        oldSeason: item.oldSeason || 'N/A',
        gender: item.gender?.name || 'N/A',
        case: item.case || 'N/A',
        band: item.band || 'N/A',
        movementType: item.movementType || item.movementName || 'N/A',
        heelHeight: item.heelHeight || 'N/A',
        width: item.width || 'N/A',
        channelClass: item.channelClass?.name || 'MULTI',
        discountPercent,
        rirRp,
        currentRp,
        fob,
        launchDate,
        launchQty,
        beginning,
        sellThroughPercent,
        netSales,
        end,
        lastGrnNumber,
        lastGrnDate,
        lastLcNumber,
        lastLcDate,
        lastSaleDate,
        totalQty,
        lastSaleOutletBreakdown,
        totals: itemTotals,
      };

      productNode.sizes.push(variantItem);
    }

    // Sort brands alphabetically
    brandsList.sort((a, b) => a.brandName.localeCompare(b.brandName));

    await onProgress?.(100, 'Report calculation finished.');

    return {
      brands: brandsList,
      flatItems,
      grandTotals,
      dateRange: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
      locationNames,
    };
  }

  async registerClientGeneratedExport(
    prisma: any,
    userId: string,
    body: {
      fileName: string;
      fileBase64: string;
      mimeType: string;
    },
  ): Promise<{ jobId: string; downloadUrl?: string }> {
    const jobId = uuidv4();
    const { fileName, fileBase64, mimeType } = body;

    const exportDir = path.join(process.cwd(), 'uploads', 'exports');
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    const ext = fileName.endsWith('.pdf') ? '.pdf' : '.xlsx';
    const diskFileName = `stock-position-export-${jobId}${ext}`;
    const filePath = path.join(exportDir, diskFileName);

    const buffer = Buffer.from(fileBase64, 'base64');
    await fs.promises.writeFile(filePath, buffer);

    await prisma.exportHistory.create({
      data: {
        id: jobId,
        userId,
        fileName,
        filePath,
        moduleName: 'STOCK_POSITION_REPORT',
        status: 'PENDING',
      },
    });

    const downloadUrl = await this.exportHistoryService.completeAndUploadExport(
      prisma,
      jobId,
      filePath,
      fileName,
      mimeType ||
        (ext === '.pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    );

    return { jobId, downloadUrl };
  }
}
