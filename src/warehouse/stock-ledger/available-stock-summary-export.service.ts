import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadService } from '../../upload/upload.service';
import { MovementType } from '@prisma/client';

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
}

@Injectable()
export class AvailableStockSummaryExportService {
  private readonly logger = new Logger(AvailableStockSummaryExportService.name);

  constructor(
    @InjectQueue('available-stock-summary-export') private readonly exportQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly uploadService: UploadService,
  ) {}

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

    const filePath = path.join(process.cwd(), record.filePath);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Export file not found. It may have expired or the job is still running.');
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
  }) {
    const tenantId = this.prisma.getTenantId() ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';
    const prisma = new PrismaService({ tenantId, tenantDbUrl } as any);

    return this.generateAvailableStockSummaryReportDataInternal(prisma, opts);
  }

  // Core Available Stock Summary logic shared between UI preview and processor
  async generateAvailableStockSummaryReportDataInternal(
    prisma: PrismaService,
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

    // Location & Warehouse names lookup for Separate mode
    const locationNameMap = new Map<string, string>();
    if (isSeparate) {
      const allLocations = await prisma.location.findMany({ select: { id: true, name: true } });
      const allWarehouses = await prisma.warehouse.findMany({ select: { id: true, name: true } });
      for (const l of allLocations) locationNameMap.set(`loc:${l.id}`, `${l.name} (Outlet)`);
      for (const w of allWarehouses) locationNameMap.set(`wh:${w.id}`, `${w.name} (Warehouse)`);
    }

    // Fetch inventory item ids
    const inventoryItems = await prisma.inventoryItem.findMany({
      where: {
        ...locationOrWarehouseWhere,
        status: 'AVAILABLE',
      },
      select: { itemId: true, locationId: true, warehouseId: true },
    });

    const ledgerItems = await prisma.stockLedger.findMany({
      where: {
        ...locationOrWarehouseWhere,
      },
      select: { itemId: true },
      distinct: ['itemId'],
    });

    const uniqueItemIds = [...new Set([
      ...inventoryItems.map(i => i.itemId),
      ...ledgerItems.map(l => l.itemId),
    ])];

    if (uniqueItemIds.length === 0) {
      return { root: [], grandTotals: this.createEmptyTotals(), items: [], itemMetricsMap: new Map(), flatItemsList: [] };
    }

    // Safely chunk item fetching to prevent database query parameter limit errors
    const CHUNK_SIZE = 1000;
    const items: any[] = [];
    for (let i = 0; i < uniqueItemIds.length; i += CHUNK_SIZE) {
      const chunk = uniqueItemIds.slice(i, i + CHUNK_SIZE);
      const chunkItems = await prisma.item.findMany({
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
      });
      items.push(...chunkItems);
    }

    if (items.length === 0) {
      return { root: [], grandTotals: this.createEmptyTotals(), items: [], itemMetricsMap: new Map(), flatItemsList: [] };
    }

    const matchedItemIds = items.map(i => i.id);

    // Compute BF (Opening balance before startDate) in safe chunks
    const bfMap = new Map<string, number>();
    for (let i = 0; i < matchedItemIds.length; i += CHUNK_SIZE) {
      const chunk = matchedItemIds.slice(i, i + CHUNK_SIZE);
      const groupByCols: ('itemId' | 'locationId' | 'warehouseId')[] = isSeparate ? ['itemId', 'locationId', 'warehouseId'] : ['itemId'];
      
      const bfGroup = await prisma.stockLedger.groupBy({
        by: groupByCols,
        where: {
          ...locationOrWarehouseWhere,
          itemId: { in: chunk },
          createdAt: { lt: startDate },
        },
        _sum: { qty: true },
      });

      for (const row of bfGroup) {
        const locKey = isSeparate
          ? (row.locationId ? `loc:${row.locationId}` : (row.warehouseId ? `wh:${row.warehouseId}` : 'unknown'))
          : 'all';
        const key = `${locKey}_${row.itemId}`;
        bfMap.set(key, (bfMap.get(key) || 0) + Number(row._sum.qty || 0));
      }
    }

    // Query and add OPENING_BALANCE entries within range in safe chunks
    for (let i = 0; i < matchedItemIds.length; i += CHUNK_SIZE) {
      const chunk = matchedItemIds.slice(i, i + CHUNK_SIZE);
      const groupByCols: ('itemId' | 'locationId' | 'warehouseId')[] = isSeparate ? ['itemId', 'locationId', 'warehouseId'] : ['itemId'];

      const inRangeOpeningGroup = await prisma.stockLedger.groupBy({
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
      });

      for (const row of inRangeOpeningGroup) {
        const locKey = isSeparate
          ? (row.locationId ? `loc:${row.locationId}` : (row.warehouseId ? `wh:${row.warehouseId}` : 'unknown'))
          : 'all';
        const key = `${locKey}_${row.itemId}`;
        const currentBf = bfMap.get(key) || 0;
        bfMap.set(key, currentBf + Number(row._sum.qty || 0));
      }
    }

    // Query normal ledger entries within range in safe chunks
    const ledgerEntries: any[] = [];
    for (let i = 0; i < matchedItemIds.length; i += CHUNK_SIZE) {
      const chunk = matchedItemIds.slice(i, i + CHUNK_SIZE);
      const chunkEntries = await prisma.stockLedger.findMany({
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
        },
      });
      ledgerEntries.push(...chunkEntries);
    }

    const toLocOrWhFilters: any[] = [];
    if (locationWhere) toLocOrWhFilters.push({ toLocationId: locationWhere });
    if (warehouseWhere) toLocOrWhFilters.push({ toWarehouseId: warehouseWhere });

    const toLocOrWhWhere = toLocOrWhFilters.length > 1
      ? { OR: toLocOrWhFilters }
      : (toLocOrWhFilters.length === 1 ? toLocOrWhFilters[0] : {});

    // Query transit items in safe chunks
    const transitMap = new Map<string, number>();
    for (let i = 0; i < matchedItemIds.length; i += CHUNK_SIZE) {
      const chunk = matchedItemIds.slice(i, i + CHUNK_SIZE);
      const transitItems = await prisma.transferRequestItem.findMany({
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
      });

      for (const row of transitItems) {
        const qty = Number(row.quantity || 0);
        const tr = row.transferRequest;
        const locKey = isSeparate
          ? (tr.toLocationId ? `loc:${tr.toLocationId}` : (tr.toWarehouseId ? `wh:${tr.toWarehouseId}` : 'unknown'))
          : 'all';
        const key = `${locKey}_${row.itemId}`;
        transitMap.set(key, (transitMap.get(key) || 0) + qty);
      }
    }

    // Query reserved stock for matched items in safe chunks
    const reserveMap = new Map<string, number>();
    for (let i = 0; i < matchedItemIds.length; i += CHUNK_SIZE) {
      const chunk = matchedItemIds.slice(i, i + CHUNK_SIZE);
      const reserveGroup = await prisma.stockReserve.groupBy({
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
      });

      for (const row of reserveGroup) {
        const locKey = isSeparate
          ? (row.warehouseId ? `wh:${row.warehouseId}` : 'all')
          : 'all';
        const key = `${locKey}_${row.itemId}`;
        reserveMap.set(key, (reserveMap.get(key) || 0) + Number(row._sum.quantity || 0));
      }
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

        const unitPrice = item.unitPrice || 0;
        const value = balance * unitPrice;
        const unitCost = item.unitCost || 0;
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
