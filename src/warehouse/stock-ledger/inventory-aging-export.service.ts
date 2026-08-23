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
import { FiscalYearClosingService } from './fiscal-year-closing.service';
import { ExportHistoryService } from '../export-history/export-history.service';

export interface QueueInventoryAgingExportOptions {
  userId: string;
  locationId?: string;
  warehouseId?: string;
  startDate?: string;
  endDate?: string;
  format: 'xlsx' | 'pdf';
  exportType?: 'hierarchical' | 'flat';
  reportType?: 'merged' | 'separate';
  previewJobId?: string;
}

export interface InventoryAgingRecord {
  id: string;
  sku: string;
  barCode: string;
  name: string;
  description?: string;
  brandId?: string;
  brandName?: string;
  categoryId?: string;
  categoryName?: string;
  divisionId?: string;
  divisionName?: string;
  colorName?: string;
  sizeName?: string;
  unitCost: number;
  unitPrice: number;
  totalQty: number;
  totalValue: number;

  // Age Buckets (Qty & Value)
  bucket0to30Qty: number;
  bucket0to30Value: number;
  bucket31to60Qty: number;
  bucket31to60Value: number;
  bucket61to90Qty: number;
  bucket61to90Value: number;
  bucket91to120Qty: number;
  bucket91to120Value: number;
  bucket121to180Qty: number;
  bucket121to180Value: number;
  bucket181PlusQty: number;
  bucket181PlusValue: number;

  avgAgeDays: number;

  locationStocks: Record<string, number>;
  warehouseStocks: Record<string, number>;
}

export interface InventoryAgingTotals {
  totalItems: number;
  totalStockQty: number;
  totalStockValue: number;
  totalBucket0to30Qty: number;
  totalBucket0to30Value: number;
  totalBucket31to60Qty: number;
  totalBucket31to60Value: number;
  totalBucket61to90Qty: number;
  totalBucket61to90Value: number;
  totalBucket91to120Qty: number;
  totalBucket91to120Value: number;
  totalBucket121to180Qty: number;
  totalBucket121to180Value: number;
  totalBucket181PlusQty: number;
  totalBucket181PlusValue: number;
  overallAvgAgeDays: number;
  locationTotals: Record<string, number>;
  warehouseTotals: Record<string, number>;
}

@Injectable()
export class InventoryAgingExportService {
  private readonly logger = new Logger(InventoryAgingExportService.name);
  private readonly cancelledPreviewJobIds = new Set<string>();

  constructor(
    @InjectQueue('inventory-aging-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
    private readonly fiscalClosingService: FiscalYearClosingService,
    private readonly exportHistoryService: ExportHistoryService,
  ) {}

  async registerClientGeneratedExport(opts: {
    userId: string;
    fileBuffer: Buffer;
    fileName: string;
    format: 'xlsx' | 'pdf';
  }) {
    const jobId = uuidv4();
    const ext = opts.format === 'pdf' ? 'pdf' : 'xlsx';
    const relativePath = path.join('uploads', 'exports', `export-${jobId}.${ext}`);
    const fullPath = path.join(process.cwd(), relativePath);

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, opts.fileBuffer);

    // Save export job record in ExportHistory audit table
    await this.prisma.exportHistory.create({
      data: {
        id: jobId,
        userId: opts.userId,
        fileName: opts.fileName || `inventory-aging-${new Date().toISOString().slice(0, 10)}.${ext}`,
        filePath: relativePath,
        moduleName: 'INVENTORY_AGING_REPORT',
        status: 'PENDING',
      },
    });

    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const prisma = (tenantId && tenantDbUrl)
      ? PrismaService.getTenantClient(tenantId, tenantDbUrl)
      : this.prisma;

    const mimeType = opts.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    await this.exportHistoryService.completeAndUploadExport(
      prisma,
      jobId,
      fullPath,
      opts.fileName,
      mimeType,
    );

    return { jobId, status: 'COMPLETED' };
  }

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
  }): Promise<{ jobId: string; queuePosition: number; waitingCount: number }> {
    const jobId = uuidv4();
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

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
            this.logger.log(`Pruning superseded waiting aging preview job ${wJob.id} for user ${opts.userId}`);
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
            this.logger.log(`Cancelling active running aging preview job ${activeJobId} for user ${opts.userId}`);
            if (activeJobId) this.cancelledPreviewJobIds.add(activeJobId);
          }
        }
      } catch (err: any) {
        this.logger.warn(`Could not prune aging preview jobs for user ${opts.userId}: ${err.message}`);
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
    if (!job) throw new NotFoundException(`Preview job ${jobId} not found`);

    const state = await job.getState();
    const rawProg = job.progress();
    let progress = 0;
    let message = 'Processing inventory aging analysis...';

    if (typeof rawProg === 'number') {
      progress = rawProg;
    } else if (rawProg && typeof rawProg === 'object') {
      progress = (rawProg as any).percent || 0;
      message = (rawProg as any).message || message;
    }

    const [waiting, active] = await Promise.all([
      this.exportQueue.getWaiting(),
      this.exportQueue.getActive(),
    ]);

    const allJobs = [...active, ...waiting];
    const idx = allJobs.findIndex((j) => j.id?.toString() === jobId);
    const queuePosition = idx >= 0 ? idx + 1 : 1;
    const failedReason = job.failedReason;

    return {
      state,
      progress,
      message,
      queuePosition,
      waitingCount: waiting.length,
      failedReason,
    };
  }

  async getPreviewResult(jobId: string): Promise<{
    status: boolean;
    data?: any;
    message?: string;
  }> {
    const filePath = path.join(process.cwd(), 'uploads', 'previews', `preview-${jobId}.json.gz`);
    if (!fs.existsSync(filePath)) {
      return { status: false, message: 'Preview result file not found or expired.' };
    }
    const gzipped = fs.readFileSync(filePath);
    const jsonStr = zlib.gunzipSync(gzipped).toString('utf-8');
    return JSON.parse(jsonStr);
  }

  async getInventoryAgingReportData(opts: {
    locationId?: string;
    warehouseId?: string;
    startDate?: string;
    endDate?: string;
    reportType?: 'merged' | 'separate';
    previewJobId?: string;
    isAborted?: () => boolean;
  }) {
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);

    return this.generateInventoryAgingDataInternal(prisma, opts);
  }

  async generateInventoryAgingDataInternal(
    prisma: any,
    opts: {
      locationId?: string;
      warehouseId?: string;
      startDate?: string;
      endDate?: string;
      reportType?: 'merged' | 'separate';
      previewJobId?: string;
      isAborted?: () => boolean;
      onProgress?: (percent: number, message: string) => Promise<void>;
    },
  ) {
    const onProgress = opts.onProgress || (async () => {});
    await onProgress(5, 'Initializing inventory aging engine...');

    const locationIdFilter = opts.locationId ? opts.locationId.split(',').filter(Boolean) : [];
    const warehouseIdFilter = opts.warehouseId ? opts.warehouseId.split(',').filter(Boolean) : [];

    const asOfDate = opts.endDate ? new Date(opts.endDate) : new Date();

    // 1. Fetch Location & Warehouse metadata
    await onProgress(15, 'Loading stores & warehouse master catalog...');
    const [locations, warehouses] = await Promise.all([
      prisma.location.findMany({
        where: {
          isDeleted: false,
          ...(locationIdFilter.length > 0 ? { id: { in: locationIdFilter } } : {}),
        },
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
      prisma.warehouse.findMany({
        where: {
          isDeleted: false,
          ...(warehouseIdFilter.length > 0 ? { id: { in: warehouseIdFilter } } : {}),
        },
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const targetLocationIds = locations.map((l: any) => l.id);
    const targetWarehouseIds = warehouses.map((w: any) => w.id);

    // 2. Fetch inventory items stock balances
    await onProgress(35, 'Calculating stock balances & ledger movements...');
    const inventoryItems = await prisma.inventoryItem.findMany({
      where: {
        ...(targetLocationIds.length > 0 || targetWarehouseIds.length > 0
          ? {
              OR: [
                ...(targetLocationIds.length > 0 ? [{ locationId: { in: targetLocationIds } }] : []),
                ...(targetWarehouseIds.length > 0 ? [{ warehouseId: { in: targetWarehouseIds } }] : []),
              ],
            }
          : {}),
      },
      select: {
        itemId: true,
        locationId: true,
        warehouseId: true,
        quantity: true,
      },
    });

    const rawItemIds = [...new Set(inventoryItems.map((inv: any) => inv.itemId).filter(Boolean))];
    
    // Concurrent query for Item Master, Tenant Item Settings, and Historical Stock Ledger Costs
    const [items, tenantSettings, latestLedgerCosts] = await Promise.all([
      prisma.item.findMany({
        where: {
          id: { in: rawItemIds },
          isActive: true,
        },
        include: {
          brand: true,
          category: true,
          division: true,
          color: true,
          size: true,
        },
      }),
      prisma.tenantItemSetting.findMany({
        where: { itemId: { in: rawItemIds } },
      }),
      prisma.stockLedger.findMany({
        where: {
          itemId: { in: rawItemIds },
          OR: [
            { unitCost: { gt: 0 } },
            { rate: { gt: 0 } },
          ],
        },
        select: { itemId: true, unitCost: true, rate: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        distinct: ['itemId'],
      }),
    ]);

    const itemObjMap = new Map<string, any>(items.map((i: any) => [i.id, i]));
    const settingMap = new Map<string, any>(tenantSettings.map((s: any) => [s.itemId, s]));
    const ledgerCostMap = new Map<string, number>();

    for (const l of latestLedgerCosts) {
      const c = Number(l.unitCost || l.rate || 0);
      if (c > 0 && !ledgerCostMap.has(l.itemId)) {
        ledgerCostMap.set(l.itemId, c);
      }
    }

    await onProgress(60, 'Categorizing inventory into aging brackets & resolving unit cost valuation...');

    // Group inventory items by SKU/Item ID
    const itemMap = new Map<string, {
      item: any;
      totalQty: number;
      locationStocks: Record<string, number>;
      warehouseStocks: Record<string, number>;
    }>();

    for (const inv of inventoryItems) {
      const qty = Number(inv.quantity || 0);
      if (qty <= 0) continue;
      const itemMaster = itemObjMap.get(inv.itemId);
      if (!itemMaster) continue;

      let entry = itemMap.get(inv.itemId);
      if (!entry) {
        entry = {
          item: itemMaster,
          totalQty: 0,
          locationStocks: {},
          warehouseStocks: {},
        };
        itemMap.set(inv.itemId, entry);
      }

      entry.totalQty += qty;
      if (inv.locationId) {
        entry.locationStocks[inv.locationId] = (entry.locationStocks[inv.locationId] || 0) + qty;
      }
      if (inv.warehouseId) {
        entry.warehouseStocks[inv.warehouseId] = (entry.warehouseStocks[inv.warehouseId] || 0) + qty;
      }
    }

    // 3. Fetch Stock Movements for stock age estimation
    const itemIds = Array.from(itemMap.keys());
    const stockMovements = await prisma.stockMovement.findMany({
      where: {
        itemId: { in: itemIds },
        createdAt: { lte: asOfDate },
        type: { in: [MovementType.INBOUND, MovementType.OPENING_BALANCE, MovementType.TRANSFER, MovementType.ADJUSTMENT] },
      },
      select: {
        itemId: true,
        quantity: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Map movements by itemId for FIFO allocation
    const movementMap = new Map<string, Array<{ quantity: number; createdAt: Date }>>();
    for (const m of stockMovements) {
      let list = movementMap.get(m.itemId);
      if (!list) {
        list = [];
        movementMap.set(m.itemId, list);
      }
      list.push({ quantity: Number(m.quantity || 0), createdAt: m.createdAt });
    }

    await onProgress(80, 'Building aging buckets & matrix valuation totals...');

    const flatItemsList: InventoryAgingRecord[] = [];
    const grandTotals: InventoryAgingTotals = {
      totalItems: 0,
      totalStockQty: 0,
      totalStockValue: 0,
      totalBucket0to30Qty: 0,
      totalBucket0to30Value: 0,
      totalBucket31to60Qty: 0,
      totalBucket31to60Value: 0,
      totalBucket61to90Qty: 0,
      totalBucket61to90Value: 0,
      totalBucket91to120Qty: 0,
      totalBucket91to120Value: 0,
      totalBucket121to180Qty: 0,
      totalBucket121to180Value: 0,
      totalBucket181PlusQty: 0,
      totalBucket181PlusValue: 0,
      overallAvgAgeDays: 0,
      locationTotals: {},
      warehouseTotals: {},
    };

    let totalAgeWeightedDaysSum = 0;

    for (const [itemId, data] of itemMap.entries()) {
      const item = data.item;
      const totalQty = data.totalQty;

      // Multi-tier cost price resolution:
      // 1. Direct Item.unitCost
      // 2. Latest StockLedger purchase/receipt entry unitCost or rate
      // 3. TenantItemSetting (averageCost, standardCost)
      // 4. Item.fob / Item.unitPrice
      let unitCost = Number(item.unitCost || 0);
      if (unitCost === 0) {
        unitCost = ledgerCostMap.get(item.id) || 0;
      }
      if (unitCost === 0) {
        const setting = settingMap.get(item.id);
        unitCost = Number(setting?.averageCost || setting?.standardCost || item.fob || item.unitPrice || 0);
      }

      const unitPrice = Number(item.unitPrice || 0);
      const totalValue = totalQty * unitCost;

      // Allocate current stock Qty into age buckets using receipt movements (FIFO)
      const movements = movementMap.get(itemId) || [];
      let remainingToAllocate = totalQty;

      let b0to30 = 0;
      let b31to60 = 0;
      let b61to90 = 0;
      let b91to120 = 0;
      let b121to180 = 0;
      let b181plus = 0;
      let itemAgeDaysSum = 0;

      for (const mov of movements) {
        if (remainingToAllocate <= 0) break;
        const allocQty = Math.min(remainingToAllocate, mov.quantity);
        remainingToAllocate -= allocQty;

        const ageDays = Math.max(0, Math.floor((asOfDate.getTime() - new Date(mov.createdAt).getTime()) / (1000 * 60 * 60 * 24)));
        itemAgeDaysSum += ageDays * allocQty;

        if (ageDays <= 30) b0to30 += allocQty;
        else if (ageDays <= 60) b31to60 += allocQty;
        else if (ageDays <= 90) b61to90 += allocQty;
        else if (ageDays <= 120) b91to120 += allocQty;
        else if (ageDays <= 180) b121to180 += allocQty;
        else b181plus += allocQty;
      }

      // If movements didn't cover all stock, remaining stock falls into default 181+ days
      if (remainingToAllocate > 0) {
        b181plus += remainingToAllocate;
        itemAgeDaysSum += 180 * remainingToAllocate;
      }

      const avgAgeDays = totalQty > 0 ? Math.round(itemAgeDaysSum / totalQty) : 0;
      totalAgeWeightedDaysSum += itemAgeDaysSum;

      const record: InventoryAgingRecord = {
        id: item.id,
        sku: item.sku || item.itemId || 'N/A',
        barCode: item.barCode || '',
        name: item.name || item.description || 'N/A',
        description: item.description || '',
        brandId: item.brand?.id,
        brandName: item.brand?.name || 'No Brand',
        categoryId: item.category?.id,
        categoryName: item.category?.name || 'Uncategorized',
        divisionId: item.division?.id,
        divisionName: item.division?.name || 'Unassigned',
        colorName: item.color?.name || '',
        sizeName: item.size?.name || '',
        unitCost,
        unitPrice,
        totalQty,
        totalValue,

        bucket0to30Qty: b0to30,
        bucket0to30Value: b0to30 * unitCost,
        bucket31to60Qty: b31to60,
        bucket31to60Value: b31to60 * unitCost,
        bucket61to90Qty: b61to90,
        bucket61to90Value: b61to90 * unitCost,
        bucket91to120Qty: b91to120,
        bucket91to120Value: b91to120 * unitCost,
        bucket121to180Qty: b121to180,
        bucket121to180Value: b121to180 * unitCost,
        bucket181PlusQty: b181plus,
        bucket181PlusValue: b181plus * unitCost,

        avgAgeDays,
        locationStocks: data.locationStocks,
        warehouseStocks: data.warehouseStocks,
      };

      flatItemsList.push(record);

      // Accumulate Grand Totals
      grandTotals.totalItems += 1;
      grandTotals.totalStockQty += totalQty;
      grandTotals.totalStockValue += totalValue;

      grandTotals.totalBucket0to30Qty += b0to30;
      grandTotals.totalBucket0to30Value += b0to30 * unitCost;
      grandTotals.totalBucket31to60Qty += b31to60;
      grandTotals.totalBucket31to60Value += b31to60 * unitCost;
      grandTotals.totalBucket61to90Qty += b61to90;
      grandTotals.totalBucket61to90Value += b61to90 * unitCost;
      grandTotals.totalBucket91to120Qty += b91to120;
      grandTotals.totalBucket91to120Value += b91to120 * unitCost;
      grandTotals.totalBucket121to180Qty += b121to180;
      grandTotals.totalBucket121to180Value += b121to180 * unitCost;
      grandTotals.totalBucket181PlusQty += b181plus;
      grandTotals.totalBucket181PlusValue += b181plus * unitCost;

      for (const [locId, q] of Object.entries(data.locationStocks)) {
        grandTotals.locationTotals[locId] = (grandTotals.locationTotals[locId] || 0) + q;
      }
      for (const [whId, q] of Object.entries(data.warehouseStocks)) {
        grandTotals.warehouseTotals[whId] = (grandTotals.warehouseTotals[whId] || 0) + q;
      }
    }

    grandTotals.overallAvgAgeDays = grandTotals.totalStockQty > 0
      ? Math.round(totalAgeWeightedDaysSum / grandTotals.totalStockQty)
      : 0;

    await onProgress(100, 'Inventory aging calculations completed.');

    return {
      status: true,
      data: {
        flatItemsList,
        grandTotals,
        locations,
        warehouses,
      },
    };
  }
}
