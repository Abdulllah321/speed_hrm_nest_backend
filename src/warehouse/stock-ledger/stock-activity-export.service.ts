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

export interface StockActivityTotals {
  bf: number;
  fromWarehouse: number;
  fromOutlet: number;
  totalTrfIn: number;
  toWarehouse: number;
  toOutlet: number;
  totalTrfOut: number;
  exchg: number;
  refund: number;
  claim: number;
  sales: number;
  adj: number;
  availableStock: number;
  transit: number;
  balance: number;
  purchases: number;
  purchaseReturn: number;
  deliveryChallan: number;
  wholesaleReturn: number;
  reservedSO: number;
  reservedSRN: number;
  transitGRN: number;
}

export interface StockActivityVariantItem {
  id: string;
  size: string;
  color: string;
  barCode?: string;
  sku: string;
  totals: StockActivityTotals;
}

export interface StockActivityProductNode {
  sku: string;
  description: string;
  productLabel: string;
  sizes: StockActivityVariantItem[];
  totals: StockActivityTotals;
}

export interface StockActivityCategoryNode {
  categoryId: string;
  categoryName: string;
  products: StockActivityProductNode[];
  totals: StockActivityTotals;
}

export interface StockActivityGenderNode {
  genderId: string;
  genderName: string;
  categories: StockActivityCategoryNode[];
  totals: StockActivityTotals;
}

export interface StockActivityDivisionNode {
  divisionId: string;
  divisionName: string;
  genders: StockActivityGenderNode[];
  totals: StockActivityTotals;
}

export interface StockActivityBrandNode {
  brandId: string;
  brandName: string;
  divisions: StockActivityDivisionNode[];
  totals: StockActivityTotals;
}

export interface StockActivityLocationNode {
  locationKey: string;
  locationId?: string;
  warehouseId?: string;
  locationName: string;
  locationType: 'OUTLET' | 'WAREHOUSE';
  brands: StockActivityBrandNode[];
  totals: StockActivityTotals;
}

export interface StockActivityFlatRecord {
  locationName?: string;
  brand: string;
  division: string;
  category: string;
  gender: string;
  silhouette: string;
  sku: string;
  articleName: string;
  color: string;
  size: string;
  barCode: string;
  totals: StockActivityTotals;
}

export interface StockActivityReportResult {
  reportType: 'merged' | 'separate' | 'detailed';
  locations?: StockActivityLocationNode[];
  brands: StockActivityBrandNode[];
  flatItems: StockActivityFlatRecord[];
  grandTotals: StockActivityTotals;
  dateRange: { startDate?: string; endDate?: string };
  locationNames: string;
}

export interface QueueStockActivityExportOptions {
  userId: string;
  locationId?: string;
  warehouseId?: string;
  startDate?: string;
  endDate?: string;
  reportType?: 'merged' | 'separate' | 'detailed';
  format: 'xlsx' | 'pdf';
  summaryOnly?: boolean;
  showBrand?: boolean;
  showDivision?: boolean;
  showCategory?: boolean;
  showGender?: boolean;
  showSilhouette?: boolean;
  showArticle?: boolean;
  showVariant?: boolean;
}

@Injectable()
export class StockActivityExportService {
  private readonly logger = new Logger(StockActivityExportService.name);
  private readonly previewStorageDir = path.join(process.cwd(), 'uploads', 'report-previews');

  constructor(
    @InjectQueue('stock-activity-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
    private readonly exportHistoryService: ExportHistoryService,
    private readonly fiscalClosingService: FiscalYearClosingService,
  ) {
    if (!fs.existsSync(this.previewStorageDir)) {
      fs.mkdirSync(this.previewStorageDir, { recursive: true });
    }
  }

  async queueReportPreview(opts: {
    userId: string;
    locationId?: string;
    warehouseId?: string;
    startDate?: string;
    endDate?: string;
    reportType?: 'merged' | 'separate' | 'detailed';
    search?: string;
  }): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

    // Clean up older pending preview jobs for the same user to prevent queue pile-up
    try {
      const pendingJobs = await this.exportQueue.getJobs(['waiting', 'delayed']);
      for (const job of pendingJobs) {
        if (job.name === 'generate-stock-activity-preview' && job.data?.userId === opts.userId) {
          await job.remove();
          this.logger.log(`[StockActivityReport] Removed older pending preview job ${job.id} for user ${opts.userId}`);
        }
      }
    } catch (e: any) {
      this.logger.warn(`Failed to clean up older pending preview jobs: ${e.message}`);
    }

    await this.exportQueue.add(
      'generate-stock-activity-preview',
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
        search: opts.search,
      },
      {
        jobId: `preview-${jobId}`,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
        timeout: 60 * 60 * 1000,
      },
    );

    this.logger.log(`[StockActivityReport] Queued preview job ${jobId} for user ${opts.userId} (mode: ${opts.reportType || 'merged'})`);
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

  async saveReportPreviewResult(jobId: string, result: StockActivityReportResult): Promise<void> {
    const jsonStr = JSON.stringify(result);
    const compressed = await gzipAsync(Buffer.from(jsonStr, 'utf8'));
    const filePath = path.join(this.previewStorageDir, `stock-activity-preview-${jobId}.json.gz`);
    await fs.promises.writeFile(filePath, compressed);
  }

  async getReportPreviewResult(jobId: string): Promise<StockActivityReportResult | null> {
    const filePath = path.join(this.previewStorageDir, `stock-activity-preview-${jobId}.json.gz`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const compressed = await fs.promises.readFile(filePath);
    const decompressed = await gunzipAsync(compressed);
    return JSON.parse(decompressed.toString('utf8'));
  }

  async generateStockActivityReportDataInternal(
    prisma: PrismaService,
    opts: {
      locationId?: string;
      warehouseId?: string;
      startDate?: string;
      endDate?: string;
      reportType?: 'merged' | 'separate' | 'detailed';
      search?: string;
      onProgress?: (percent: number, message: string) => Promise<void> | void;
    },
  ): Promise<StockActivityReportResult> {
    const { locationId, warehouseId, startDate: startStr, endDate: endStr, reportType = 'merged', search, onProgress } = opts;
    const isSeparate = reportType === 'separate';
    const isDetailed = reportType === 'detailed';
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

    const startDate = parseLocalDate(startStr, false);
    const endDate = parseLocalDate(endStr, true);

    // Load Location & Warehouse Names Lookup first to resolve default targets
    const [allLocations, allWarehouses] = await Promise.all([
      prisma.location.findMany({ select: { id: true, name: true, code: true } }),
      prisma.warehouse.findMany({ select: { id: true, name: true, code: true } }),
    ]);

    const locIds = locationId ? locationId.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const whIds = warehouseId ? warehouseId.split(',').map((s) => s.trim()).filter(Boolean) : [];

    let locationOrWarehouseWhere: any = {};
    let toLocOrWhWhere: any = {};
    let locationNames = '';

    if (reportType === 'detailed') {
      // Detailed Mode = Warehouse Stock Activity (Central Warehouse C40001)
      const c40001Wh = allWarehouses.find((w: any) => w.code === 'C40001') || allWarehouses[0];
      const targetWhIds = whIds.length > 0 ? whIds : (c40001Wh ? [c40001Wh.id] : []);
      const warehouseWhere = targetWhIds.length > 1 ? { in: targetWhIds } : targetWhIds.length === 1 ? targetWhIds[0] : undefined;

      locationOrWarehouseWhere = warehouseWhere
        ? { warehouseId: warehouseWhere, locationId: null }
        : { warehouseId: { not: null }, locationId: null };
      toLocOrWhWhere = warehouseWhere ? { toWarehouseId: warehouseWhere } : {};

      const matchedWhs = allWarehouses.filter((w) => targetWhIds.includes(w.id));
      locationNames = matchedWhs.length > 0 ? matchedWhs.map((w) => `${w.name} (${w.code || 'WH'})`).join(', ') : 'Central Warehouse (C40001)';
    } else {
      // Merged / Separate Mode = POS Outlets & Non-Central Warehouses (Strictly Exclude Central Warehouse C40001)
      const storeLocations = allLocations.filter(
        (l) => l.code !== 'C40001' && l.code !== 'WH-C40001' && !l.name.includes('LOGISTIC AREA'),
      );
      const storeLocIds = storeLocations.map((l) => l.id);
      const nonC40001Warehouses = allWarehouses.filter((w) => w.code !== 'C40001');
      const nonC40001WhIds = nonC40001Warehouses.map((w) => w.id);

      const actualLocIds = locIds
        .filter((id) => !id.startsWith('wh:'))
        .filter((id) => storeLocIds.includes(id));
      const passedWhIds = [
        ...whIds,
        ...locIds.filter((id) => id.startsWith('wh:')).map((id) => id.replace('wh:', '')),
      ].filter((id) => nonC40001WhIds.includes(id));

      if (actualLocIds.length > 0 || passedWhIds.length > 0) {
        const orConds: any[] = [];
        if (actualLocIds.length > 0) {
          orConds.push({ locationId: actualLocIds.length > 1 ? { in: actualLocIds } : actualLocIds[0] });
        }
        if (passedWhIds.length > 0) {
          orConds.push({
            warehouseId: passedWhIds.length > 1 ? { in: passedWhIds } : passedWhIds[0],
            locationId: null,
          });
        }
        locationOrWarehouseWhere = orConds.length > 1 ? { OR: orConds } : (orConds.length === 1 ? orConds[0] : {});

        const toOrConds: any[] = [];
        if (actualLocIds.length > 0) {
          toOrConds.push({ toLocationId: actualLocIds.length > 1 ? { in: actualLocIds } : actualLocIds[0] });
        }
        if (passedWhIds.length > 0) {
          toOrConds.push({ toWarehouseId: passedWhIds.length > 1 ? { in: passedWhIds } : passedWhIds[0] });
        }
        toLocOrWhWhere = toOrConds.length > 1 ? { OR: toOrConds } : (toOrConds.length === 1 ? toOrConds[0] : {});

        const selectedLocNames = storeLocations.filter((l) => actualLocIds.includes(l.id)).map((l) => l.name);
        const selectedWhNames = nonC40001Warehouses.filter((w) => passedWhIds.includes(w.id)).map((w) => `${w.name} (Warehouse)`);
        locationNames = [...selectedLocNames, ...selectedWhNames].join(', ');
      } else {
        // Default: All Outlets + 3 Non-Central Warehouses (C20001, C30001, C-TSDMC)
        locationOrWarehouseWhere = {
          OR: [
            { locationId: { in: storeLocIds } },
            { warehouseId: { in: nonC40001WhIds }, locationId: null },
          ],
        };

        toLocOrWhWhere = {
          OR: [
            { toLocationId: { in: storeLocIds } },
            { toWarehouseId: { in: nonC40001WhIds } },
          ],
        };

        locationNames = 'All Outlets & Warehouses';
      }
    }

    const locationNameMap = new Map<string, { name: string; type: 'OUTLET' | 'WAREHOUSE' }>();
    for (const l of allLocations) locationNameMap.set(`loc:${l.id}`, { name: `${l.name} (Outlet)`, type: 'OUTLET' });
    for (const w of allWarehouses) locationNameMap.set(`wh:${w.id}`, { name: `${w.name} (Warehouse)`, type: 'WAREHOUSE' });

    await onProgress?.(15, 'Fetching inventory item IDs & stock ledger history...');

    const [inventoryItems, ledgerItems, transitRequestItems] = await Promise.all([
      prisma.inventoryItem.findMany({
        where: {
          ...locationOrWarehouseWhere,
        },
        select: { itemId: true, locationId: true, warehouseId: true, quantity: true },
      }),
      prisma.stockLedger.findMany({
        where: {
          ...locationOrWarehouseWhere,
          createdAt: { lte: endDate },
        },
        select: { itemId: true, locationId: true, warehouseId: true },
        distinct: ['itemId', 'locationId', 'warehouseId'],
      }),
      prisma.transferRequestItem.findMany({
        where: {
          transferRequest: {
            ...toLocOrWhWhere,
            status: { in: ['PENDING', 'PENDING_CHECKER', 'PENDING_AUTHORIZER', 'PENDING_APPROVER', 'APPROVED', 'SOURCE_APPROVED', 'DISPATCHED', 'SHIPPED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED'] },
          },
        },
        select: { itemId: true },
      }),
    ]);

    const uniqueItemIds = [...new Set([
      ...inventoryItems.map((i) => i.itemId),
      ...ledgerItems.map((l) => l.itemId),
      ...transitRequestItems.map((t) => t.itemId),
    ])];

    const createEmptyTotals = (): StockActivityTotals => ({
      bf: 0,
      fromWarehouse: 0,
      fromOutlet: 0,
      totalTrfIn: 0,
      toWarehouse: 0,
      toOutlet: 0,
      totalTrfOut: 0,
      exchg: 0,
      refund: 0,
      claim: 0,
      sales: 0,
      adj: 0,
      availableStock: 0,
      transit: 0,
      balance: 0,
      purchases: 0,
      purchaseReturn: 0,
      deliveryChallan: 0,
      wholesaleReturn: 0,
      reservedSO: 0,
      reservedSRN: 0,
      transitGRN: 0,
    });

    const addTotals = (target: StockActivityTotals, source: StockActivityTotals) => {
      target.bf += source.bf;
      target.fromWarehouse += source.fromWarehouse;
      target.fromOutlet += source.fromOutlet;
      target.totalTrfIn += source.totalTrfIn;
      target.toWarehouse += source.toWarehouse;
      target.toOutlet += source.toOutlet;
      target.totalTrfOut += source.totalTrfOut;
      target.exchg += source.exchg;
      target.refund += source.refund;
      target.claim += source.claim;
      target.sales += source.sales;
      target.adj += source.adj;
      target.availableStock += source.availableStock;
      target.transit += source.transit;
      target.balance += source.balance;
      target.purchases += source.purchases;
      target.purchaseReturn += source.purchaseReturn;
      target.deliveryChallan += source.deliveryChallan;
      target.wholesaleReturn += source.wholesaleReturn;
      target.reservedSO += source.reservedSO;
      target.reservedSRN += source.reservedSRN;
      target.transitGRN += source.transitGRN;
    };

    if (uniqueItemIds.length === 0) {
      return {
        reportType,
        brands: [],
        flatItems: [],
        grandTotals: createEmptyTotals(),
        dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
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
    const itemLookup = new Map<string, any>();
    for (const item of items) {
      itemLookup.set(item.id, item);
    }

    const matchedItemIds = items.map((i) => i.id);
    const matchedItemChunks = chunkArray(matchedItemIds, 1000);

    await onProgress?.(45, 'Computing opening B/F balances & in-range ledger transactions...');

    const fiscalOpeningDate = await this.fiscalClosingService.findLatestFiscalOpeningSnapshotDate(prisma, startDate);

    // If the fiscal opening snapshot falls on the same day as startDate (or after),
    // the range { gte: fiscalOpeningDate, lt: startDate } would be empty.
    // Fall back to scanning ALL history before startDate so opening balances are never zeroed out.
    const effectiveFiscalOpeningDate =
      fiscalOpeningDate && fiscalOpeningDate < startDate ? fiscalOpeningDate : null;

    // Map keys: if separate -> `${locKey}:${itemId}`, else -> `merged:${itemId}`
    const bfMap = new Map<string, number>();

    for (const chunk of matchedItemChunks) {
      const bfWhere: any = {
        AND: [
          locationOrWarehouseWhere,
          {
            itemId: { in: chunk },
            createdAt: effectiveFiscalOpeningDate
              ? { gte: effectiveFiscalOpeningDate, lt: startDate }
              : { lt: startDate },
          },
        ],
      };

      const groupByFields: ('itemId' | 'locationId' | 'warehouseId')[] = isSeparate
        ? ['itemId', 'locationId', 'warehouseId']
        : ['itemId'];

      const bfGroup = await prisma.stockLedger.groupBy({
        by: groupByFields as any,
        where: bfWhere,
        _sum: { qty: true },
      });

      for (const row of bfGroup) {
        const qtyVal = Math.max(0, Number(row._sum.qty || 0));
        const itemId = row.itemId;
        if (isSeparate) {
          const locKey = row.locationId ? `loc:${row.locationId}` : row.warehouseId ? `wh:${row.warehouseId}` : 'unknown';
          const compositeKey = `${locKey}:${itemId}`;
          bfMap.set(compositeKey, (bfMap.get(compositeKey) || 0) + qtyVal);
        } else {
          const compositeKey = `merged:${itemId}`;
          bfMap.set(compositeKey, (bfMap.get(compositeKey) || 0) + qtyVal);
        }
      }

      const inRangeOpeningGroup = await prisma.stockLedger.groupBy({
        by: groupByFields as any,
        where: {
          AND: [
            locationOrWarehouseWhere,
            {
              itemId: { in: chunk },
              createdAt: { gte: startDate, lte: endDate },
              OR: [
                { movementType: MovementType.OPENING_BALANCE },
                { referenceType: 'OPENING_BALANCE' },
                { referenceType: 'BULK_STOCK_UPLOAD' },
                { referenceType: 'FISCAL_YEAR_OPENING' },
              ],
            },
          ],
        },
        _sum: { qty: true },
      });

      for (const row of inRangeOpeningGroup) {
        const qtyVal = Number(row._sum.qty || 0);
        const itemId = row.itemId;
        if (isSeparate) {
          const locKey = row.locationId ? `loc:${row.locationId}` : row.warehouseId ? `wh:${row.warehouseId}` : 'unknown';
          const compositeKey = `${locKey}:${itemId}`;
          const currentBf = bfMap.get(compositeKey) || 0;
          bfMap.set(compositeKey, Math.max(0, currentBf + qtyVal));
        } else {
          const compositeKey = `merged:${itemId}`;
          const currentBf = bfMap.get(compositeKey) || 0;
          bfMap.set(compositeKey, Math.max(0, currentBf + qtyVal));
        }
      }
    }

    const ledgerEntries: any[] = [];
    for (const chunk of matchedItemChunks) {
      const chunkEntries = await prisma.stockLedger.findMany({
        where: {
          AND: [
            locationOrWarehouseWhere,
            {
              itemId: { in: chunk },
              createdAt: { gte: startDate, lte: endDate },
              NOT: [
                { movementType: MovementType.OPENING_BALANCE },
                { referenceType: 'OPENING_BALANCE' },
                { referenceType: 'BULK_STOCK_UPLOAD' },
                { referenceType: 'FISCAL_YEAR_OPENING' },
              ],
            },
          ],
        },
        select: {
          itemId: true,
          locationId: true,
          warehouseId: true,
          qty: true,
          referenceType: true,
          referenceId: true,
          movementType: true,
        },
      });
      ledgerEntries.push(...chunkEntries);
    }

    const transitItems: any[] = [];
    for (const chunk of matchedItemChunks) {
      const chunkTransit = await prisma.transferRequestItem.findMany({
        where: {
          itemId: { in: chunk },
          transferRequest: {
            ...toLocOrWhWhere,
            status: { in: ['PENDING', 'PENDING_CHECKER', 'PENDING_AUTHORIZER', 'PENDING_APPROVER', 'APPROVED', 'SOURCE_APPROVED', 'DISPATCHED', 'SHIPPED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED'] },
            transferType: {
              in: ['WAREHOUSE_TO_OUTLET', 'OUTLET_TO_OUTLET', 'OUTLET_TO_WAREHOUSE', 'WAREHOUSE_TO_WAREHOUSE'],
            },
          },
        },
        select: {
          itemId: true,
          quantity: true,
          transferRequest: {
            select: { toLocationId: true, toWarehouseId: true },
          },
        },
      });
      transitItems.push(...chunkTransit);
    }

    const transitMap = new Map<string, number>();
    for (const row of transitItems) {
      const qty = Number(row.quantity || 0);
      const itemId = row.itemId;
      if (isSeparate) {
        const toLocId = row.transferRequest?.toLocationId;
        const toWhId = row.transferRequest?.toWarehouseId;
        const locKey = toLocId ? `loc:${toLocId}` : toWhId ? `wh:${toWhId}` : 'unknown';
        const compositeKey = `${locKey}:${itemId}`;
        transitMap.set(compositeKey, (transitMap.get(compositeKey) || 0) + qty);
      } else {
        const compositeKey = `merged:${itemId}`;
        transitMap.set(compositeKey, (transitMap.get(compositeKey) || 0) + qty);
      }
    }
    
    // FETCH RESERVATIONS (SO & SRN)
    const reserveWarehouseFilter = locationOrWarehouseWhere.warehouseId
      ? { warehouseId: locationOrWarehouseWhere.warehouseId }
      : {};

    const reservationsNested = await Promise.all(
      matchedItemChunks.map((chunk) =>
        prisma.stockReserve.groupBy({
          by: isSeparate ? ['itemId', 'warehouseId'] : ['itemId'],
          where: {
            itemId: { in: chunk },
            ...reserveWarehouseFilter,
            OR: [
              { expiresAt: null },
              { expiresAt: { gte: now } }
            ]
          },
          _sum: { quantity: true },
        })
      )
    );
    const reservations = reservationsNested.flat();

    const reservationsNestedByType = await Promise.all(
      matchedItemChunks.map((chunk) =>
        prisma.stockReserve.groupBy({
          by: isSeparate ? ['itemId', 'warehouseId', 'referenceType'] : ['itemId', 'referenceType'],
          where: {
            itemId: { in: chunk },
            ...reserveWarehouseFilter,
            OR: [
              { expiresAt: null },
              { expiresAt: { gte: now } }
            ]
          },
          _sum: { quantity: true },
        })
      )
    );
    const reservationsByType = reservationsNestedByType.flat();
    const reserveSOMap = new Map<string, number>();
    const reserveSRNMap = new Map<string, number>();

    for (const res of reservationsByType) {
      const qty = Number(res._sum.quantity || 0);
      const itemId = res.itemId;
      const refType = (res as any).referenceType;
      if (isSeparate) {
        const whId = (res as any).warehouseId;
        const locKey = whId ? `wh:${whId}` : 'unknown';
        const compositeKey = `${locKey}:${itemId}`;
        if (refType === 'SALES_ORDER') {
          reserveSOMap.set(compositeKey, (reserveSOMap.get(compositeKey) || 0) + qty);
        } else if (refType === 'STOCK_REQUISITION') {
          reserveSRNMap.set(compositeKey, (reserveSRNMap.get(compositeKey) || 0) + qty);
        }
      } else {
        const compositeKey = `merged:${itemId}`;
        if (refType === 'SALES_ORDER') {
          reserveSOMap.set(compositeKey, (reserveSOMap.get(compositeKey) || 0) + qty);
        } else if (refType === 'STOCK_REQUISITION') {
          reserveSRNMap.set(compositeKey, (reserveSRNMap.get(compositeKey) || 0) + qty);
        }
      }
    }

    // FETCH TRANSIT GRN (Approved PO items - received qty)
    const transitGRNNested = await Promise.all(
      matchedItemChunks.map((chunk) =>
        prisma.purchaseOrderItem.findMany({
          where: {
            itemId: { in: chunk },
            purchaseOrder: {
              status: 'APPROVED',
            },
          },
          select: {
            itemId: true,
            quantity: true,
            receivedQty: true,
          },
        })
      )
    );
    const transitGRNItems = transitGRNNested.flat();
    const transitGRNMap = new Map<string, number>();

    for (const poItem of transitGRNItems) {
      const pendingQty = Number(poItem.quantity || 0) - Number(poItem.receivedQty || 0);
      if (pendingQty > 0) {
        const itemId = poItem.itemId;
        if (isSeparate) {
          const compositeKey = `unknown:${itemId}`;
          transitGRNMap.set(compositeKey, (transitGRNMap.get(compositeKey) || 0) + pendingQty);
        } else {
          const compositeKey = `merged:${itemId}`;
          transitGRNMap.set(compositeKey, (transitGRNMap.get(compositeKey) || 0) + pendingQty);
        }
      }
    }

    await onProgress?.(70, 'Aggregating stock movement metrics by item & location...');

    // Build a fallback BF map from InventoryItem.quantity for items that have current stock
    // but no historical ledger entries before startDate (e.g. new fiscal year with no prior close).
    // This ensures items with existing stock are always visible even if bfMap has no entry.
    // Key by item.id (UUID) to match the compositeKey used in populateBrandHierarchy.
    const inventoryQtyMap = new Map<string, number>();
    for (const inv of inventoryItems) {
      // Resolve to the canonical Item.id UUID (items are keyed by item.id)
      const resolvedItemId = itemLookup.has(inv.itemId) ? inv.itemId : null;
      if (!resolvedItemId) continue; // skip if item not in our matched items set
      if (isSeparate) {
        const locKey = inv.locationId
          ? `loc:${inv.locationId}`
          : inv.warehouseId
          ? `wh:${inv.warehouseId}`
          : 'unknown';
        const compositeKey = `${locKey}:${resolvedItemId}`;
        inventoryQtyMap.set(compositeKey, (inventoryQtyMap.get(compositeKey) || 0) + Number(inv.quantity || 0));
      } else {
        const compositeKey = `merged:${resolvedItemId}`;
        inventoryQtyMap.set(compositeKey, (inventoryQtyMap.get(compositeKey) || 0) + Number(inv.quantity || 0));
      }
    }

    const centralWh = allWarehouses.find((w) => w.code === 'C40001');
    const centralWhId = centralWh?.id;
    const isCentralWarehouseScope = reportType === 'detailed';

    const transferRefs = [
      'TRANSFER_REQUEST',
      'TRANSFER_IN',
      'TRANSFER_OUT',
      'OUTLET_TRANSFER_IN',
      'OUTLET_TRANSFER_OUT',
      'RETURN_REQUEST',
      'CLAIM_RETURN',
      'CLAIM_TO_PLM',
      'CLAIM_RETURN_REQUEST',
    ];
    const transferRefIds = [
      ...new Set(
        ledgerEntries
          .filter((e) => transferRefs.includes(e.referenceType))
          .map((e) => e.referenceId)
          .filter(Boolean),
      ),
    ];

    const trMap = new Map<
      string,
      { fromWarehouseId: string | null; toWarehouseId: string | null; transferType: string }
    >();
    if (transferRefIds.length > 0) {
      const trChunks = chunkArray(transferRefIds, 1000);
      const trsNested = await Promise.all(
        trChunks.map((chunk) =>
          prisma.transferRequest.findMany({
            where: {
              OR: [{ id: { in: chunk } }, { requestNo: { in: chunk } }],
            },
            select: {
              id: true,
              requestNo: true,
              fromWarehouseId: true,
              toWarehouseId: true,
              transferType: true,
            },
          }),
        ),
      );
      for (const tr of trsNested.flat()) {
        const meta = {
          fromWarehouseId: tr.fromWarehouseId,
          toWarehouseId: tr.toWarehouseId,
          transferType: tr.transferType,
        };
        trMap.set(tr.id, meta);
        trMap.set(tr.requestNo, meta);
      }
    }

    const itemMetricsMap = new Map<
      string,
      {
        fromWarehouse: number;
        fromOutlet: number;
        toWarehouse: number;
        toOutlet: number;
        exchg: number;
        refund: number;
        claim: number;
        sales: number;
        adj: number;
        purchases: number;
        purchaseReturn: number;
        deliveryChallan: number;
        wholesaleReturn: number;
      }
    >();

    for (const entry of ledgerEntries) {
      const itemId = entry.itemId;
      const locKey = isSeparate
        ? entry.locationId
          ? `loc:${entry.locationId}`
          : entry.warehouseId
          ? `wh:${entry.warehouseId}`
          : 'unknown'
        : 'merged';

      const compositeKey = `${locKey}:${itemId}`;
      let m = itemMetricsMap.get(compositeKey);
      if (!m) {
        m = {
          fromWarehouse: 0,
          fromOutlet: 0,
          toWarehouse: 0,
          toOutlet: 0,
          exchg: 0,
          refund: 0,
          claim: 0,
          sales: 0,
          adj: 0,
          purchases: 0,
          purchaseReturn: 0,
          deliveryChallan: 0,
          wholesaleReturn: 0,
        };
        itemMetricsMap.set(compositeKey, m);
      }

      const qty = Number(entry.qty || 0);
      const ref = entry.referenceType || '';
      const mov = entry.movementType;

      if (mov === MovementType.ADJUSTMENT || ref === 'STOCK_ADJUSTMENT' || ref === 'ADJUSTMENT') {
        m.adj += qty;
      } else if (qty > 0) {
        if (['TRANSFER_REQUEST', 'TRANSFER_IN', 'OUTLET_TRANSFER_IN'].includes(ref)) {
          const tr = entry.referenceId ? trMap.get(entry.referenceId) : null;
          if (tr) {
            if (tr.fromWarehouseId === centralWhId) {
              m.fromWarehouse += qty;
            } else {
              m.fromOutlet += qty;
            }
          } else {
            if (ref === 'OUTLET_TRANSFER_IN') {
              m.fromOutlet += qty;
            } else if (isCentralWarehouseScope) {
              m.fromOutlet += qty;
            } else {
              m.fromWarehouse += qty;
            }
          }
        } else if (['POS_RETURN', 'POS_EXCHANGE_IN'].includes(ref)) {
          m.exchg += qty;
        } else if (['POS_REFUND', 'POS_VOID'].includes(ref)) {
          m.refund += qty;
        } else if (['POS_CLAIM_APPROVED'].includes(ref)) {
          m.claim += qty;
        } else if (['LANDED_COST', 'GRN', 'PURCHASE_INVOICE', 'PURCHASE_RECEIPT'].includes(ref)) {
          m.purchases += qty;
        } else if (['SALES_RETURN_DC', 'SALES_RETURN_INV', 'WHOLESALE_RETURN'].includes(ref)) {
          m.wholesaleReturn += qty;
        } else if (['RETURN_REQUEST', 'CLAIM_RETURN', 'OUTLET_RETURN', 'CLAIM_RETURN_RECEIPT'].includes(ref)) {
          m.fromOutlet += qty;
        } else {
          m.adj += qty;
        }
      } else if (qty < 0) {
        const absQty = Math.abs(qty);
        if (['TRANSFER_REQUEST', 'TRANSFER_OUT', 'OUTLET_TRANSFER_OUT'].includes(ref)) {
          const tr = entry.referenceId ? trMap.get(entry.referenceId) : null;
          if (tr) {
            if (tr.toWarehouseId === centralWhId) {
              m.toWarehouse += absQty;
            } else {
              m.toOutlet += absQty;
            }
          } else {
            if (ref === 'OUTLET_TRANSFER_OUT') {
              m.toOutlet += absQty;
            } else if (isCentralWarehouseScope) {
              m.toOutlet += absQty;
            } else {
              m.toOutlet += absQty;
            }
          }
        } else if (['RETURN_REQUEST', 'CLAIM_RETURN', 'CLAIM_TO_PLM', 'CLAIM_RETURN_REQUEST'].includes(ref)) {
          m.toWarehouse += absQty;
        } else if (['POS_SALE', 'POS_EXCHANGE_OUT'].includes(ref)) {
          m.sales += absQty;
        } else if (['PURCHASE_RETURN', 'PURCHASE_RETURN_LC', 'PURCHASE_RETURN_GRN', 'PURCHASE_RETURN_INV'].includes(ref)) {
          m.purchaseReturn += absQty;
        } else if (['DELIVERY_CHALLAN', 'SALES_DELIVERY'].includes(ref)) {
          m.deliveryChallan += absQty;
        } else {
          m.adj += qty;
        }
      }
    }

    await onProgress?.(85, 'Building brand & category hierarchy matrix...');

    const grandTotals = createEmptyTotals();
    const flatItems: StockActivityFlatRecord[] = [];

    // Helper to add item to a brand hierarchy tree
    const populateBrandHierarchy = (
      brandsList: StockActivityBrandNode[],
      item: any,
      compositeKey: string,
      locName?: string,
    ) => {
      // Ledger-derived BF (opening balance brought forward / bulk upload)
      const bf = Math.max(0, bfMap.get(compositeKey) || 0);
      const transit = Math.max(0, transitMap.get(compositeKey) || 0);
      const m = itemMetricsMap.get(compositeKey) || {
        fromWarehouse: 0,
        fromOutlet: 0,
        toWarehouse: 0,
        toOutlet: 0,
        exchg: 0,
        refund: 0,
        claim: 0,
        sales: 0,
        adj: 0,
        purchases: 0,
        purchaseReturn: 0,
        deliveryChallan: 0,
        wholesaleReturn: 0,
      };

      const totalTrfIn = m.fromWarehouse + m.fromOutlet;
      const totalTrfOut = m.toWarehouse + m.toOutlet;
      const availableStock = bf + totalTrfIn - totalTrfOut + m.exchg + m.refund + m.claim - m.sales + m.adj + m.purchases - m.purchaseReturn - m.deliveryChallan + m.wholesaleReturn;
      const balance = availableStock + transit;

      // Skip item if absolutely zero activity and zero balances across all metrics
      if (
        bf === 0 &&
        totalTrfIn === 0 &&
        totalTrfOut === 0 &&
        m.exchg === 0 &&
        m.refund === 0 &&
        m.claim === 0 &&
        m.sales === 0 &&
        m.adj === 0 &&
        m.purchases === 0 &&
        m.purchaseReturn === 0 &&
        m.deliveryChallan === 0 &&
        m.wholesaleReturn === 0 &&
        availableStock === 0 &&
        transit === 0
      ) {
        return;
      }

      const reservedSO = reserveSOMap.get(compositeKey) || 0;
      const reservedSRN = reserveSRNMap.get(compositeKey) || 0;
      const transitGRN = transitGRNMap.get(compositeKey) || 0;

      const totals: StockActivityTotals = {
        bf,
        fromWarehouse: m.fromWarehouse,
        fromOutlet: m.fromOutlet,
        totalTrfIn,
        toWarehouse: m.toWarehouse,
        toOutlet: m.toOutlet,
        totalTrfOut,
        exchg: m.exchg,
        refund: m.refund,
        claim: m.claim,
        sales: m.sales,
        adj: m.adj,
        availableStock,
        transit,
        balance,
        purchases: m.purchases,
        purchaseReturn: m.purchaseReturn,
        deliveryChallan: m.deliveryChallan,
        wholesaleReturn: m.wholesaleReturn,
        reservedSO,
        reservedSRN,
        transitGRN,
      };

      addTotals(grandTotals, totals);

      const brandId = item.brand?.id || 'no-brand';
      const brandName = item.brand?.name || 'No Brand';
      const divId = item.division?.id || 'no-division';
      const divName = item.division?.name || 'No Division';
      const genderId = item.gender?.id || 'no-gender';
      const genderName = item.gender?.name || 'No Gender';
      const catId = item.category?.id || 'no-category';
      const catName = item.category?.name || 'No Category';
      const silName = item.silhouette?.name || 'No Silhouette';
      const sku = item.sku || item.barCode || 'NO-SKU';
      const desc = item.description || sku;
      const colorName = item.color?.name || 'Default';
      const sizeName = item.size?.name || 'Default';
      const barCode = item.barCode || sku;

      flatItems.push({
        locationName: locName,
        brand: brandName,
        division: divName,
        category: catName,
        gender: genderName,
        silhouette: silName,
        sku,
        articleName: desc,
        color: colorName,
        size: sizeName,
        barCode,
        totals,
      });

      // 1. Brand Level
      let brandNode = brandsList.find((b) => b.brandId === brandId);
      if (!brandNode) {
        brandNode = { brandId, brandName, divisions: [], totals: createEmptyTotals() };
        brandsList.push(brandNode);
      }
      addTotals(brandNode.totals, totals);

      // 2. Division Level
      let divNode = brandNode.divisions.find((d) => d.divisionId === divId);
      if (!divNode) {
        divNode = { divisionId: divId, divisionName: divName, genders: [], totals: createEmptyTotals() };
        brandNode.divisions.push(divNode);
      }
      addTotals(divNode.totals, totals);

      // 3. Gender Level
      let genderNode = divNode.genders.find((g) => g.genderId === genderId);
      if (!genderNode) {
        genderNode = { genderId, genderName, categories: [], totals: createEmptyTotals() };
        divNode.genders.push(genderNode);
      }
      addTotals(genderNode.totals, totals);

      // 4. Category Level
      let catNode = genderNode.categories.find((c) => c.categoryId === catId);
      if (!catNode) {
        catNode = { categoryId: catId, categoryName: catName, products: [], totals: createEmptyTotals() };
        genderNode.categories.push(catNode);
      }
      addTotals(catNode.totals, totals);

      // 5. Product Level
      let prodNode = catNode.products.find((p) => p.sku === sku);
      if (!prodNode) {
        prodNode = { sku, description: desc, productLabel: desc, sizes: [], totals: createEmptyTotals() };
        catNode.products.push(prodNode);
      }
      addTotals(prodNode.totals, totals);

      // 6. Variant Level
      let sizeItem = prodNode.sizes.find((s) => s.size === sizeName && s.color === colorName && s.barCode === barCode);
      if (!sizeItem) {
        sizeItem = { id: item.id, size: sizeName, color: colorName, barCode, sku, totals };
        prodNode.sizes.push(sizeItem);
      } else {
        addTotals(sizeItem.totals, totals);
      }
    };

    let locationsList: StockActivityLocationNode[] = [];
    let mergedBrandsList: StockActivityBrandNode[] = [];

    if (isSeparate) {
      // Build the set of distinct location keys from ALL data sources:
      // 1. bfMap keys (ledger-based opening balances)
      // 2. itemMetricsMap keys (in-range ledger activity)
      // 3. inventoryItems directly (on-hand stock at any location/warehouse)
      // This ensures locations appear even when there is no in-range ledger activity.
      const locationKeysSet = new Set<string>();

      const extractLocKey = (key: string) => {
        const parts = key.split(':');
        if (parts[0] === 'unknown') return 'unknown';
        if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
        return null;
      };

      for (const key of bfMap.keys()) {
        const lk = extractLocKey(key);
        if (lk) locationKeysSet.add(lk);
      }
      for (const key of itemMetricsMap.keys()) {
        const lk = extractLocKey(key);
        if (lk) locationKeysSet.add(lk);
      }
      // Seed from inventoryItems so locations with only on-hand stock are included
      for (const inv of inventoryItems) {
        const lk = inv.locationId
          ? `loc:${inv.locationId}`
          : inv.warehouseId
          ? `wh:${inv.warehouseId}`
          : 'unknown';
        locationKeysSet.add(lk);
      }
      // Seed from ledgerItems so locations with only historical ledger entries are included
      for (const li of ledgerItems) {
        const lk = li.locationId
          ? `loc:${li.locationId}`
          : li.warehouseId
          ? `wh:${li.warehouseId}`
          : 'unknown';
        locationKeysSet.add(lk);
      }

      for (const locKey of locationKeysSet) {
        const locInfo = locationNameMap.get(locKey) || {
          name: locKey.startsWith('loc:')
            ? `Outlet Location ${locKey.replace('loc:', '')}`
            : locKey.startsWith('wh:')
            ? `Warehouse ${locKey.replace('wh:', '')}`
            : 'Unknown Location',
          type: locKey.startsWith('wh:') ? 'WAREHOUSE' : 'OUTLET',
        };

        const locNode: StockActivityLocationNode = {
          locationKey: locKey,
          locationId: locKey.startsWith('loc:') ? locKey.replace('loc:', '') : undefined,
          warehouseId: locKey.startsWith('wh:') ? locKey.replace('wh:', '') : undefined,
          locationName: locInfo.name,
          locationType: locInfo.type as any,
          brands: [],
          totals: createEmptyTotals(),
        };

        for (const item of items) {
          const compositeKey = `${locKey}:${item.id}`;
          populateBrandHierarchy(locNode.brands, item, compositeKey, locInfo.name);
        }

        if (locNode.brands.length > 0) {
          for (const b of locNode.brands) {
            addTotals(locNode.totals, b.totals);
          }
          locationsList.push(locNode);
        }
      }
    } else {
      // Merged Mode across all locations
      for (const item of items) {
        const compositeKey = `merged:${item.id}`;
        populateBrandHierarchy(mergedBrandsList, item, compositeKey);
      }
    }

    await onProgress?.(100, 'Stock Activity preview generation complete!');

    return {
      reportType,
      locations: isSeparate ? locationsList : undefined,
      brands: mergedBrandsList,
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
        moduleName: 'STOCK_ACTIVITY_REPORT',
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

  async queueExport(opts: QueueStockActivityExportOptions): Promise<{ jobId: string }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const ext = opts.format === 'pdf' ? 'pdf' : 'xlsx';

    await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName: `stock-activity-report-${new Date().toISOString().slice(0, 10)}.${ext}`,
        filePath: path.join('uploads', 'exports', `export-${jobId}.${ext}`),
        moduleName: 'STOCK_ACTIVITY_REPORT',
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
        reportType: opts.reportType || 'merged',
        format: opts.format,
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
        timeout: 2 * 60 * 60 * 1000,
      },
    );

    this.logger.log(`[StockActivityExport] Queued job ${jobId} for user ${opts.userId} (format: ${opts.format}, reportType: ${opts.reportType || 'merged'})`);
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
      this.logger.error(`[StockActivityExport] Stream error: ${err.message}`);
    });

    const isPdf = record.fileName.endsWith('.pdf');
    res.header('Content-Type', isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename="${record.fileName}"`);
    res.header('Content-Length', stat.size);
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(stream);
  }
}
