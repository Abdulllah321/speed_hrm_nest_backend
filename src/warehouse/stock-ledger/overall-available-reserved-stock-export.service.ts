import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadService } from '../../upload/upload.service';
import { MovementType } from '@prisma/client';

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
}

@Injectable()
export class OverallAvailableReservedStockExportService {
  private readonly logger = new Logger(OverallAvailableReservedStockExportService.name);

  constructor(
    @InjectQueue('overall-available-reserved-stock-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

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

    const filePath = path.join(process.cwd(), record.filePath);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Export file not found. It may have expired or the job is still running.');
    }

    const stat = fs.statSync(filePath);
    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      this.logger.error(`[OverallAvailableReservedStockExport] Stream error: ${err.message}`);
    });

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
  }) {
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);

    return this.generateOverallAvailableReservedStockReportDataInternal(prisma, opts);
  }

  async generateOverallAvailableReservedStockReportDataInternal(
    prisma: PrismaService,
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
    },
  ) {
    const {
      locationId,
      warehouseId,
      asOfDate: asOfStr,
      summaryOnly,
      showBrand,
      showDivision,
      showCategory,
      showGender,
      showSilhouette,
      showArticle,
      showVariant,
    } = opts;

    const locIds = locationId ? locationId.split(',').map(s => s.trim()).filter(Boolean) : [];
    let locationWhere: any;

    if (locIds.length > 0) {
      locationWhere = locIds.length > 1 ? { in: locIds } : locIds[0];
    } else {
      const stockLocations = await prisma.location.findMany({
        where: { isStockLocation: true, isDeleted: false },
        select: { id: true },
      });
      const stockLocIds = stockLocations.map(l => l.id);
      locationWhere = { in: stockLocIds };
    }

    const whIds = warehouseId ? warehouseId.split(',').map(s => s.trim()).filter(Boolean) : [];
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

    const now = new Date();
    const targetDate = asOfStr ? new Date(asOfStr) : new Date();
    targetDate.setHours(23, 59, 59, 999);

    const isHistorical = targetDate.getTime() < (now.getTime() - 24 * 60 * 60 * 1000);

    // Fetch inventory item ids up to targetDate
    const inventoryItems = await prisma.inventoryItem.findMany({
      where: {
        ...locationOrWarehouseWhere,
        status: 'AVAILABLE',
        createdAt: { lte: targetDate },
      },
      select: { itemId: true },
    });

    const ledgerItems = await prisma.stockLedger.findMany({
      where: {
        ...locationOrWarehouseWhere,
        createdAt: { lte: targetDate },
      },
      select: { itemId: true },
      distinct: ['itemId'],
    });

    const uniqueItemIds = [...new Set([
      ...inventoryItems.map(i => i.itemId),
      ...ledgerItems.map(l => l.itemId),
    ])];

    const whIdsList = warehouses.map(w => w.id);
    const locIdsList = stockLocations.map(l => l.id);

    if (uniqueItemIds.length === 0) {
      return {
        root: [],
        grandTotals: this.createEmptyTotals(whIdsList, locIdsList),
        warehouses,
        stockLocations,
      };
    }

    const items = await prisma.item.findMany({
      where: {
        OR: [
          { id: { in: uniqueItemIds } },
          { itemId: { in: uniqueItemIds } },
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
        season: true,
        itemClass: true,
        subCategory: true,
      },
    });

    if (items.length === 0) {
      return {
        root: [],
        grandTotals: this.createEmptyTotals(whIdsList, locIdsList),
        warehouses,
        stockLocations,
      };
    }

    const matchedItemIds = items.map(i => i.id);

    const toLocOrWhFilters: any[] = [];
    if (locationWhere) toLocOrWhFilters.push({ toLocationId: locationWhere });
    if (warehouseWhere) toLocOrWhFilters.push({ toWarehouseId: warehouseWhere });

    const toLocOrWhWhere = toLocOrWhFilters.length > 1
      ? { OR: toLocOrWhFilters }
      : (toLocOrWhFilters.length === 1 ? toLocOrWhFilters[0] : {});

    // Query transit items as of targetDate
    const transitItems = await prisma.transferRequestItem.findMany({
      where: {
        itemId: { in: matchedItemIds },
        transferRequest: {
          ...toLocOrWhWhere,
          createdAt: { lte: targetDate },
          status: { in: ['PENDING', 'SOURCE_APPROVED'] },
          transferType: { in: ['WAREHOUSE_TO_OUTLET', 'OUTLET_TO_OUTLET', 'OUTLET_TO_WAREHOUSE', 'WAREHOUSE_TO_WAREHOUSE'] },
        },
      },
      select: {
        itemId: true,
        quantity: true,
      },
    });

    const transitMap = new Map<string, number>();
    for (const row of transitItems) {
      const qty = Number(row.quantity || 0);
      transitMap.set(row.itemId, (transitMap.get(row.itemId) || 0) + qty);
    }

    // Query reserved stock for matched items as of targetDate
    const reserveGroup = await prisma.stockReserve.groupBy({
      by: ['itemId'],
      where: {
        itemId: { in: matchedItemIds },
        createdAt: { lte: targetDate },
        ...(warehouseWhere ? { warehouseId: warehouseWhere } : {}),
        OR: [
          { expiresAt: null },
          { expiresAt: { gte: targetDate } }
        ]
      },
      _sum: { quantity: true },
    });

    const reserveMap = new Map<string, number>();
    for (const row of reserveGroup) {
      reserveMap.set(row.itemId, Number(row._sum.quantity || 0));
    }

    // Breakdown per location / warehouse
    const invLocMap = new Map<string, number>();
    const invWhMap = new Map<string, number>();

    if (isHistorical) {
      // Historical stock as of targetDate calculated from StockLedger
      const histLocGroup = await prisma.stockLedger.groupBy({
        by: ['itemId', 'locationId'],
        where: {
          itemId: { in: matchedItemIds },
          locationId: { not: null },
          createdAt: { lte: targetDate },
        },
        _sum: { qty: true },
      });

      for (const row of histLocGroup) {
        if (row.locationId) {
          invLocMap.set(`${row.itemId}_${row.locationId}`, Number(row._sum.qty || 0));
        }
      }

      const histWhGroup = await prisma.stockLedger.groupBy({
        by: ['itemId', 'warehouseId'],
        where: {
          itemId: { in: matchedItemIds },
          locationId: null,
          createdAt: { lte: targetDate },
        },
        _sum: { qty: true },
      });

      for (const row of histWhGroup) {
        if (row.warehouseId) {
          invWhMap.set(`${row.itemId}_${row.warehouseId}`, Number(row._sum.qty || 0));
        }
      }
    } else {
      // Real-time stock from InventoryItem table
      const invLocGroup = await prisma.inventoryItem.groupBy({
        by: ['itemId', 'locationId'],
        where: {
          itemId: { in: matchedItemIds },
          status: 'AVAILABLE',
          locationId: { not: null },
        },
        _sum: { quantity: true },
      });

      for (const row of invLocGroup) {
        if (row.locationId) {
          invLocMap.set(`${row.itemId}_${row.locationId}`, Number(row._sum.quantity || 0));
        }
      }

      const invWhGroup = await prisma.inventoryItem.groupBy({
        by: ['itemId', 'warehouseId'],
        where: {
          itemId: { in: matchedItemIds },
          status: 'AVAILABLE',
          locationId: null,
        },
        _sum: { quantity: true },
      });

      for (const row of invWhGroup) {
        if (row.warehouseId) {
          invWhMap.set(`${row.itemId}_${row.warehouseId}`, Number(row._sum.quantity || 0));
        }
      }
    }

    const root: any[] = [];

    const addTotals = (target: any, source: any) => {
      target.quantity += source.quantity;
      target.transit += source.transit;
      target.reserved += source.reserved;
      target.total += source.total;
      target.value += source.value;
      target.costingValue += source.costingValue;

      for (const whId of whIdsList) {
        target.warehouseStocks[whId] = (target.warehouseStocks[whId] || 0) + (source.warehouseStocks[whId] || 0);
      }
      for (const locId of locIdsList) {
        target.locationStocks[locId] = (target.locationStocks[locId] || 0) + (source.locationStocks[locId] || 0);
      }
    };

    for (const item of items) {
      const transit = transitMap.get(item.id) || 0;
      const reserved = reserveMap.get(item.id) || 0;

      let sumWh = 0;
      const warehouseStocks: Record<string, number> = {};
      for (const wh of warehouses) {
        const qty = invWhMap.get(`${item.id}_${wh.id}`) || invWhMap.get(`${item.itemId}_${wh.id}`) || 0;
        warehouseStocks[wh.id] = qty;
        sumWh += qty;
      }

      let sumLoc = 0;
      const locationStocks: Record<string, number> = {};
      for (const loc of stockLocations) {
        const qty = invLocMap.get(`${item.id}_${loc.id}`) || invLocMap.get(`${item.itemId}_${loc.id}`) || 0;
        locationStocks[loc.id] = qty;
        sumLoc += qty;
      }

      const availableStock = sumWh + sumLoc;
      const balance = availableStock + transit + reserved;
      const unitPrice = item.unitPrice || 0;
      const value = balance * unitPrice;
      const unitCost = item.unitCost || 0;
      const costingValue = balance * unitCost;

      const discountRate = item.discountRate || 0;
      const taxRate = item.taxRate1 || 0;

      const variantMetrics = {
        quantity: availableStock,
        transit,
        reserved,
        total: balance,
        unitPrice,
        value,
        unitCost,
        costingValue,
        discountRate,
        taxRate,
        warehouseStocks,
        locationStocks,
      };

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
          nodeVal = `${item.color?.name || 'Default'}-${item.size?.name || 'Default'}`;
          extraFields.color = item.color?.name || 'Default';
          extraFields.size = item.size?.name || 'Default';
        }

        let existingNode = currentLevelNodes.find(n => n.level === levelName && n.value === nodeVal);
        if (!existingNode) {
          existingNode = {
            level: levelName,
            value: nodeVal,
            totals: this.createEmptyTotals(whIdsList, locIdsList),
            ...extraFields,
            children: [],
          };
          currentLevelNodes.push(existingNode);
        }

        addTotals(existingNode.totals, variantMetrics);

        if (levelName === 'article' || levelName === 'variant') {
          existingNode.totals.unitPrice = unitPrice;
          existingNode.totals.unitCost = unitCost;
          existingNode.totals.discountRate = discountRate;
          existingNode.totals.taxRate = taxRate;
        }

        if (i < levels.length - 1) {
          currentLevelNodes = existingNode.children;
        }
      }
    }

    // Compute grand totals
    const grandTotals = this.createEmptyTotals(whIdsList, locIdsList);
    for (const node of root) {
      addTotals(grandTotals, node.totals);
    }

    return { root, grandTotals, warehouses, stockLocations };
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
