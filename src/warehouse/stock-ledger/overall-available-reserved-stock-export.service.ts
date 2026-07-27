import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadService } from '../../upload/upload.service';

export interface QueueOverallAvailableReservedStockExportOptions {
  userId: string;
  locationId?: string;
  warehouseId?: string;
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

    // Save export job request in history audit table
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
      includeCosting?: boolean;
    },
  ) {
    const {
      locationId,
      warehouseId,
      summaryOnly,
      showBrand,
      showDivision,
      showCategory,
      showGender,
      showSilhouette,
      showArticle,
      showVariant,
      includeCosting,
    } = opts;

    // Fetch active Warehouses
    const whIdsFilter = warehouseId ? warehouseId.split(',').map(s => s.trim()).filter(Boolean) : [];
    const warehouses = await prisma.warehouse.findMany({
      where: {
        isDeleted: false,
        ...(whIdsFilter.length > 0 ? { id: { in: whIdsFilter } } : {}),
      },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });

    // Fetch active Stock Locations (isStockLocation: true)
    const locIdsFilter = locationId ? locationId.split(',').map(s => s.trim()).filter(Boolean) : [];
    const stockLocations = await prisma.location.findMany({
      where: {
        isStockLocation: true,
        isDeleted: false,
        ...(locIdsFilter.length > 0 ? { id: { in: locIdsFilter } } : {}),
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

    // Query StockLedger balances grouped by itemId, warehouseId, locationId
    const ledgerGroup = await prisma.stockLedger.groupBy({
      by: ['itemId', 'warehouseId', 'locationId'],
      _sum: { qty: true },
    });

    // Query InventoryItem balances grouped by itemId, warehouseId, locationId
    const inventoryGroup = await prisma.inventoryItem.groupBy({
      by: ['itemId', 'warehouseId', 'locationId'],
      where: { status: 'AVAILABLE' },
      _sum: { quantity: true },
    });

    // Query StockReserve entries grouped by itemId, warehouseId
    const reserveGroup = await prisma.stockReserve.groupBy({
      by: ['itemId', 'warehouseId'],
      where: {
        OR: [
          { expiresAt: null },
          { expiresAt: { gte: new Date() } }
        ]
      },
      _sum: { quantity: true },
    });

    const itemIdsFromLedger = ledgerGroup.map(g => g.itemId);
    const itemIdsFromInv = inventoryGroup.map(g => g.itemId);
    const itemIdsFromReserve = reserveGroup.map(g => g.itemId);

    const uniqueItemIds = [...new Set([...itemIdsFromLedger, ...itemIdsFromInv, ...itemIdsFromReserve])];

    let items: any[] = [];
    if (uniqueItemIds.length > 0) {
      items = await prisma.item.findMany({
        where: {
          OR: [
            { id: { in: uniqueItemIds } },
            { itemId: { in: uniqueItemIds } },
          ],
        },
        include: {
          brand: true,
          division: true,
          category: true,
          gender: true,
          silhouette: true,
          season: true,
          size: true,
          color: true,
          itemClass: true,
          subCategory: true,
        },
      });
    }

    // Fallback: If no stock items matched or uniqueItemIds empty, fetch active items
    if (items.length === 0) {
      items = await prisma.item.findMany({
        where: { isActive: true },
        take: 500,
        include: {
          brand: true,
          division: true,
          category: true,
          gender: true,
          silhouette: true,
          season: true,
          size: true,
          color: true,
          itemClass: true,
          subCategory: true,
        },
      });
    }

    const whIdsList = warehouses.map(w => w.id);
    const locIdsList = stockLocations.map(l => l.id);

    if (items.length === 0) {
      return {
        root: [],
        grandTotals: this.createEmptyTotals(whIdsList, locIdsList),
        warehouses,
        stockLocations,
      };
    }

    // Stock Ledger maps
    const locStockMap = new Map<string, number>();
    const whStockMap = new Map<string, number>();

    for (const row of ledgerGroup) {
      const qty = Number(row._sum.qty || 0);
      if (row.locationId) {
        const key = `${row.itemId}_${row.locationId}`;
        locStockMap.set(key, (locStockMap.get(key) || 0) + qty);
      } else if (row.warehouseId) {
        const key = `${row.itemId}_${row.warehouseId}`;
        whStockMap.set(key, (whStockMap.get(key) || 0) + qty);
      }
    }

    // Inventory Item maps
    const invLocStockMap = new Map<string, number>();
    const invWhStockMap = new Map<string, number>();

    for (const row of inventoryGroup) {
      const qty = Number(row._sum.quantity || 0);
      if (row.locationId) {
        const key = `${row.itemId}_${row.locationId}`;
        invLocStockMap.set(key, (invLocStockMap.get(key) || 0) + qty);
      } else if (row.warehouseId) {
        const key = `${row.itemId}_${row.warehouseId}`;
        invWhStockMap.set(key, (invWhStockMap.get(key) || 0) + qty);
      }
    }

    // Stock Reserve map
    const itemReserveMap = new Map<string, number>();
    for (const row of reserveGroup) {
      const qty = Number(row._sum.quantity || 0);
      itemReserveMap.set(row.itemId, (itemReserveMap.get(row.itemId) || 0) + qty);
    }

    const root: any[] = [];

    const getLocStock = (item: any, locId: string) => {
      const ledgerQty = (locStockMap.get(`${item.id}_${locId}`) || 0) + (locStockMap.get(`${item.itemId}_${locId}`) || 0);
      if (ledgerQty !== 0) return ledgerQty;
      return (invLocStockMap.get(`${item.id}_${locId}`) || 0) + (invLocStockMap.get(`${item.itemId}_${locId}`) || 0);
    };

    const getWhStock = (item: any, whId: string) => {
      const ledgerQty = (whStockMap.get(`${item.id}_${whId}`) || 0) + (whStockMap.get(`${item.itemId}_${whId}`) || 0);
      if (ledgerQty !== 0) return ledgerQty;
      return (invWhStockMap.get(`${item.id}_${whId}`) || 0) + (invWhStockMap.get(`${item.itemId}_${whId}`) || 0);
    };

    const addTotals = (target: any, source: any) => {
      target.availableStock += source.availableStock;
      target.reservedStock += source.reservedStock;
      target.totalStock += source.totalStock;
      target.availableValue += source.availableValue;
      target.reservedValue += source.reservedValue;
      target.totalValue += source.totalValue;

      if (includeCosting) {
        target.availableCostingValue += source.availableCostingValue;
        target.reservedCostingValue += source.reservedCostingValue;
        target.totalCostingValue += source.totalCostingValue;
      }

      for (const whId of whIdsList) {
        target.warehouseStocks[whId] = (target.warehouseStocks[whId] || 0) + (source.warehouseStocks[whId] || 0);
      }
      for (const locId of locIdsList) {
        target.locationStocks[locId] = (target.locationStocks[locId] || 0) + (source.locationStocks[locId] || 0);
      }
    };

    for (const item of items) {
      const warehouseStocks: Record<string, number> = {};
      let totalWhStock = 0;

      for (const wh of warehouses) {
        const qty = getWhStock(item, wh.id);
        warehouseStocks[wh.id] = qty;
        totalWhStock += qty;
      }

      const locationStocks: Record<string, number> = {};
      let totalLocStock = 0;

      for (const loc of stockLocations) {
        const qty = getLocStock(item, loc.id);
        locationStocks[loc.id] = qty;
        totalLocStock += qty;
      }

      const availableStock = totalWhStock + totalLocStock;
      const reservedStock = (itemReserveMap.get(item.id) || 0) + (itemReserveMap.get(item.itemId) || 0);
      const totalStock = availableStock + reservedStock;

      const unitPrice = item.unitPrice || 0;
      const unitCost = item.unitCost || 0;
      const discountRate = item.discountRate || 0;
      const taxRate = (item.taxRate1 || 0) + (item.taxRate2 || 0);

      const availableValue = availableStock * unitPrice;
      const reservedValue = reservedStock * unitPrice;
      const totalValue = totalStock * unitPrice;

      const availableCostingValue = availableStock * unitCost;
      const reservedCostingValue = reservedStock * unitCost;
      const totalCostingValue = totalStock * unitCost;

      const variantMetrics = {
        availableStock,
        reservedStock,
        totalStock,
        unitPrice,
        unitCost,
        discountRate,
        taxRate,
        availableValue,
        reservedValue,
        totalValue,
        availableCostingValue,
        reservedCostingValue,
        totalCostingValue,
        warehouseStocks,
        locationStocks,
      };

      let currentLevelNodes = root;
      for (let i = 0; i < levels.length; i++) {
        const levelName = levels[i];
        let nodeVal = '';
        let extraFields: any = {};

        if (levelName === 'brand') {
          nodeVal = item.brand?.name || 'N/A';
        } else if (levelName === 'division') {
          nodeVal = item.division?.name || 'N/A';
        } else if (levelName === 'category') {
          nodeVal = item.category?.name || 'N/A';
        } else if (levelName === 'gender') {
          nodeVal = item.gender?.name || 'N/A';
        } else if (levelName === 'silhouette') {
          nodeVal = item.silhouette?.name || 'N/A';
        } else if (levelName === 'article') {
          nodeVal = item.sku;
          extraFields.sku = item.sku;
          extraFields.barCode = item.barCode || 'N/A';
          extraFields.itemName = item.description || 'Unknown Article';
          extraFields.brand = item.brand?.name || 'N/A';
          extraFields.division = item.division?.name || 'N/A';
          extraFields.department = item.itemClass?.name || item.subCategory?.name || 'N/A';
          extraFields.category = item.category?.name || 'N/A';
          extraFields.gender = item.gender?.name || 'N/A';
          extraFields.silhouette = item.silhouette?.name || 'N/A';
          extraFields.season = item.season?.name || 'N/A';
        } else if (levelName === 'variant') {
          nodeVal = `${item.color?.name || 'Default'}-${item.size?.name || 'Default'}`;
          extraFields.sku = item.sku;
          extraFields.barCode = item.barCode || 'N/A';
          extraFields.itemName = item.description || 'Unknown Article';
          extraFields.brand = item.brand?.name || 'N/A';
          extraFields.division = item.division?.name || 'N/A';
          extraFields.department = item.itemClass?.name || item.subCategory?.name || 'N/A';
          extraFields.category = item.category?.name || 'N/A';
          extraFields.gender = item.gender?.name || 'N/A';
          extraFields.silhouette = item.silhouette?.name || 'N/A';
          extraFields.season = item.season?.name || 'N/A';
          extraFields.color = item.color?.name || 'N/A';
          extraFields.size = item.size?.name || 'N/A';
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

    const grandTotals = this.createEmptyTotals(whIdsList, locIdsList);
    for (const node of root) {
      addTotals(grandTotals, node.totals);
    }

    return { root, grandTotals, warehouses, stockLocations };
  }

  private createEmptyTotals(whIds: string[], locIds: string[]) {
    const warehouseStocks: Record<string, number> = {};
    for (const id of whIds) warehouseStocks[id] = 0;

    const locationStocks: Record<string, number> = {};
    for (const id of locIds) locationStocks[id] = 0;

    return {
      availableStock: 0,
      reservedStock: 0,
      totalStock: 0,
      unitPrice: 0,
      unitCost: 0,
      discountRate: 0,
      taxRate: 0,
      availableValue: 0,
      reservedValue: 0,
      totalValue: 0,
      availableCostingValue: 0,
      reservedCostingValue: 0,
      totalCostingValue: 0,
      warehouseStocks,
      locationStocks,
    };
  }
}
