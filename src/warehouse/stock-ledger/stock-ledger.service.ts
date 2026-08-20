import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as ExcelJS from 'exceljs';
import * as puppeteer from 'puppeteer';
import { PrismaService } from '../../prisma/prisma.service';
import { MovementType, Prisma } from '@prisma/client';

import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';
import { chunkArray } from '../../common/utils/chunk.util';
@Injectable()
export class StockLedgerService {
  private readonly logger = new Logger(StockLedgerService.name);

  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
    @InjectQueue('stock-ledger-export') private readonly exportQueue: Queue,
  ) { }

  getPrismaClient(): PrismaService {
    return this.prisma;
  }

  async findAll(options?: {
    locationId?: string;
    warehouseId?: string;
    movementType?: MovementType;
    itemId?: string;
    referenceType?: string;
    cursor?: bigint;    // last seen id for cursor pagination
    limit?: number;
    search?: string;
  }) {
    const { warehouseId, locationId, movementType, itemId, referenceType, cursor, limit = 50, search } = options || {};

    const where: any = {
      ...(warehouseId && { warehouseId }),
      ...(locationId && { locationId }),
      ...(movementType && { movementType }),
      ...(itemId && { itemId }),
      ...(referenceType && { referenceType }),
    };

    if (search) {
      const searchLower = search.toLowerCase().trim();
      const cleanSearch = search.startsWith("#") ? search.slice(1) : search;

      // 1. Resolve matching locations
      const matchingLocations = await this.prisma.location.findMany({
        where: { name: { contains: search, mode: 'insensitive' } },
        select: { id: true },
      });
      const locationIds = matchingLocations.map((l) => l.id);

      // 2. Resolve friendly reference types to enum values
      const REVERSE_REFERENCE_LABELS: Record<string, string[]> = {
        "grn": ["GRN"],
        "pos sale": ["POS_SALE"],
        "pos return": ["POS_RETURN"],
        "pos void": ["POS_VOID"],
        "transfer": ["TRANSFER_REQUEST"],
        "return transfer": ["RETURN_REQUEST"],
        "outlet transfer in": ["OUTLET_TRANSFER_IN"],
        "outlet transfer out": ["OUTLET_TRANSFER_OUT"],
        "stock movement": ["STOCK_MOVEMENT"],
        "return movement": ["RETURN_MOVEMENT"],
        "adjustment": ["ADJUSTMENT"],
        "landed cost": ["LANDED_COST"],
        "opening bal": ["OPENING_BALANCE"],
        "delivery challan": ["DELIVERY_CHALLAN"],
        "purchase return": ["PURCHASE_RETURN", "PURCHASE_RETURN_LC", "PURCHASE_RETURN_GRN"],
        "bulk upload": ["BULK_STOCK_UPLOAD"],
        "pos claim return": ["POS_CLAIM_APPROVED"],
        "claim acknowledged": ["CLAIM_ACKNOWLEDGED"],
      };

      const matchedEnumValues: string[] = [];
      for (const [friendly, enums] of Object.entries(REVERSE_REFERENCE_LABELS)) {
        if (friendly.includes(searchLower) || searchLower.includes(friendly)) {
          matchedEnumValues.push(...enums);
        }
      }

      // 3. Resolve direction (movementType)
      let matchedMovementType: MovementType | undefined = undefined;
      if (searchLower === "inbound" || searchLower === "in") {
        matchedMovementType = MovementType.INBOUND;
      } else if (searchLower === "outbound" || searchLower === "out") {
        matchedMovementType = MovementType.OUTBOUND;
      }

      // 4. Resolve quantity
      const searchNum = parseFloat(searchLower);
      const isSearchNum = !isNaN(searchNum);

      where.OR = [
        { item: { sku: { contains: search, mode: 'insensitive' } } },
        { item: { description: { contains: search, mode: 'insensitive' } } },
        { warehouse: { name: { contains: search, mode: 'insensitive' } } },
        { referenceId: { contains: cleanSearch, mode: 'insensitive' } },
        { referenceType: { contains: search, mode: 'insensitive' } },
        ...(locationIds.length > 0 ? [{ locationId: { in: locationIds } }] : []),
        ...(matchedEnumValues.length > 0 ? [{ referenceType: { in: matchedEnumValues } }] : []),
        ...(matchedMovementType ? [{ movementType: matchedMovementType }] : []),
        ...(isSearchNum ? [{ qty: searchNum }] : []),
      ];
    }

    const data = await this.prisma.stockLedger.findMany({
        where,
        orderBy: { id: 'desc' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: limit,
        select: {
          id: true,
          itemId: true,
          warehouseId: true,
          qty: true,
          rate: true,
          unitCost: true,
          movementType: true,
          referenceType: true,
          referenceId: true,
          locationId: true,
          createdAt: true,
          item: { select: { itemId: true, sku: true, description: true } },
          warehouse: { select: { name: true } },
        },
      });

    // Enrich entries with location name (locationId is a plain FK with no Prisma relation)
    const locationIds = [...new Set(data.map((d) => d.locationId).filter(Boolean))] as string[];
    const locationMap = new Map<string, { name: string; code: string }>();
    if (locationIds.length > 0) {
      const locations = await this.prisma.location.findMany({
        where: { id: { in: locationIds } },
        select: { id: true, name: true, code: true },
      });
      for (const loc of locations) {
        locationMap.set(loc.id, { name: loc.name, code: loc.code });
      }
    }

    const enrichedData = data.map((entry) => ({
      ...entry,
      id: entry.id.toString(), // serialize BigInt to string for JSON
      location: entry.locationId ? (locationMap.get(entry.locationId) ?? null) : null,
    }));

    const nextCursor = data.length === limit ? data[data.length - 1].id.toString() : null;

    return {
      status: true,
      data: enrichedData,
      meta: { limit, nextCursor, hasMore: nextCursor !== null },
    };
  }

  async getStockLevels(options?: { warehouseId?: string; locationId?: string } | string) {
    let warehouseId: string | undefined;
    let locationId: string | undefined;

    if (typeof options === 'string') {
      warehouseId = options;
    } else if (options) {
      warehouseId = options.warehouseId;
      locationId = options.locationId;
    }

    const groupBy = await this.prisma.stockLedger.groupBy({
      by: ['itemId', 'warehouseId', 'locationId'],
      where: {
        ...(warehouseId ? { warehouseId } : {}),
        ...(locationId ? { locationId } : {}),
      },
      _sum: {
        qty: true,
      },
    });

    // Fetch related entities in parallel (with chunking for large item ID lists)
    const itemIds = [...new Set(groupBy.map((r) => r.itemId))];
    const warehouseIds = [...new Set(groupBy.map((r) => r.warehouseId))];
    const locationIds = [...new Set(groupBy.map((r) => r.locationId).filter(Boolean))] as string[];

    const itemChunks = chunkArray(itemIds, 1000);
    const itemsNested = await Promise.all(
      itemChunks.map((chunk) =>
        this.prisma.item.findMany({
          where: { id: { in: chunk } },
          select: { id: true, itemId: true, sku: true, description: true },
        }),
      ),
    );
    const items = itemsNested.flat();

    const warehouses = warehouseIds.length > 0
      ? await this.prisma.warehouse.findMany({
          where: { id: { in: warehouseIds }, isDeleted: false },
          select: { id: true, name: true, code: true },
        })
      : [];

    const locations = locationIds.length > 0
      ? await this.prisma.location.findMany({
          where: { id: { in: locationIds } },
          select: { id: true, name: true, code: true },
        })
      : [];

    const reservationsNested = await Promise.all(
      itemChunks.map((chunk) =>
        this.prisma.stockReserve.groupBy({
          by: ['itemId', 'warehouseId'],
          where: {
            itemId: { in: chunk },
            warehouseId: { in: warehouseIds },
            OR: [
              { expiresAt: null },
              { expiresAt: { gte: new Date() } }
            ]
          },
          _sum: {
            quantity: true,
          }
        }),
      ),
    );
    const reservations = reservationsNested.flat();

    const itemMap = new Map(items.map((i) => [i.id, i]));
    const warehouseMap = new Map(warehouses.map((w) => [w.id, w]));
    const locationMap = new Map(locations.map((l) => [l.id, l]));

    const resMap = new Map<string, number>();
    for (const res of reservations) {
      const key = `${res.itemId}_${res.warehouseId}`;
      resMap.set(key, Number(res._sum.quantity || 0));
    }

    return groupBy.map((row) => {
      const loc = row.locationId ? locationMap.get(row.locationId) : null;
      const wh = warehouseMap.get(row.warehouseId);

      let totalQty = Number(row._sum.qty || 0);
      if (!row.locationId) {
        const key = `${row.itemId}_${row.warehouseId}`;
        const reserved = resMap.get(key) || 0;
        totalQty = Math.max(0, totalQty - reserved);
      }

      return {
        itemId: row.itemId,
        warehouseId: row.warehouseId,
        locationId: row.locationId ?? null,
        totalQty,
        item: itemMap.get(row.itemId) ?? null,
        warehouse: wh ? { name: wh.name, code: wh.code } : null,
        location: loc
          ? {
              name: loc.name,
              code: loc.code,
              warehouse: wh ? { name: wh.name } : null,
            }
          : null,
      };
    });
  }

  async createEntry(
    data: {
      itemId: string;
      warehouseId: string;
      qty: number;
      movementType: MovementType;
      referenceType: string;
      referenceId: string;
      locationId?: string | null;
      rate?: number | Prisma.Decimal;
    },
    tx?: Prisma.TransactionClient,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const {
        itemId,
        warehouseId,
        qty,
        movementType,
        referenceType,
        referenceId,
        locationId,
        rate,
      } = data;
      const quantity = new Prisma.Decimal(qty);

      // Validate Quantity Direction
      if (
        (movementType === MovementType.INBOUND ||
          movementType === MovementType.OPENING_BALANCE) &&
        quantity.isNegative()
      ) {
        throw new BadRequestException(
          `Quantity must be positive for ${movementType}`,
        );
      }
      if (movementType === MovementType.OUTBOUND && quantity.isPositive()) {
        throw new BadRequestException(
          `Quantity must be negative for ${movementType}`,
        );
      }

      const prisma = tx || this.prisma;

      const operation = async (transaction: Prisma.TransactionClient) => {
        // Concurrency Safe Negative Stock Check for OUTBOUND
        if (quantity.isNegative()) {
          const currentStock = await transaction.stockLedger.aggregate({
            where: {
              itemId,
              // If locationId is provided, check location-specific stock (outlet) across all entries at that location
              // Otherwise check warehouse-wide stock (where locationId is null)
              ...(locationId ? { locationId } : { warehouseId, locationId: null }),
            },
            _sum: {
              qty: true,
            },
          });

          const totalStock = currentStock._sum.qty || new Prisma.Decimal(0);

          if (totalStock.plus(quantity).isNegative()) {
            throw new BadRequestException(
              `Insufficient stock for item ${itemId}${locationId ? ` in outlet/location ${locationId}` : ` in warehouse ${warehouseId}`}. Current: ${totalStock}, Requested: ${quantity.abs()}`,
            );
          }
        }

        // Resolve rate from TenantItemSetting (or fallback to Item unitCost) if not provided
        let resolvedRate = rate;
        if (resolvedRate === undefined || resolvedRate === null) {
          const setting = await transaction.tenantItemSetting.findUnique({
            where: { itemId },
            select: { averageCost: true, standardCost: true, valuationMethod: true },
          });
          if (setting) {
            resolvedRate = (setting.valuationMethod === 'STANDARD' ? setting.standardCost : setting.averageCost) ?? undefined;
          }
          if (resolvedRate === undefined || resolvedRate === null) {
            const item = await transaction.item.findUnique({
              where: { id: itemId },
              select: { unitCost: true },
            });
            resolvedRate = item?.unitCost ? new Prisma.Decimal(item.unitCost) : new Prisma.Decimal(0);
          }
        }

        // Create Immutable Ledger Entry
        const entry = await transaction.stockLedger.create({
          data: {
            itemId,
            warehouseId,
            qty: quantity,
            movementType,
            referenceType,
            referenceId,
            locationId,
            rate: resolvedRate ? new Prisma.Decimal(resolvedRate) : null,
            unitCost: resolvedRate ? new Prisma.Decimal(resolvedRate) : null,
          },
        });

        runInBackground(
          'Create Stock Ledger Entry',
          this.activityLogs.log({
            userId: ctx?.userId,
            action: 'create',
            module: 'stock-ledger',
            entity: 'StockLedger',
            entityId: entry.id.toString(),
            description: `Created stock ledger entry for item ${itemId}`,
            newValues: JSON.stringify(data),
            ipAddress: ctx?.ipAddress,
            userAgent: ctx?.userAgent,
            status: 'success',
          }),
        );

        return entry;
      };

      if (tx) {
        return operation(tx);
      } else {
        return this.prisma.$transaction(operation);
      }
    } catch (error: any) {
      runInBackground(
        'Create Stock Ledger Entry (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'stock-ledger',
          entity: 'StockLedger',
          description: `Failed to create stock ledger entry for item ${data.itemId}`,
          errorMessage: error?.message,
          newValues: JSON.stringify(data),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async queueExport(opts: {
    locationId?: string;
    userId: string;
    warehouseId?: string;
    movementType?: MovementType;
    itemId?: string;
    referenceType?: string;
    search?: string;
  }): Promise<{ jobId: string }> {
    const jobId = uuidv4();

    // Read tenant credentials from the live request context
    const tenantId    = this.prisma.getTenantId()    ?? '';
    const tenantDbUrl = this.prisma.getTenantDbUrl() ?? '';

    await this.exportQueue.add(
      {
        jobId,
        userId:   opts.userId,
        tenantId,
        tenantDbUrl,
        warehouseId: opts.warehouseId,
        locationId: opts.locationId,
        movementType: opts.movementType,
        itemId: opts.itemId,
        referenceType: opts.referenceType,
        search: opts.search,
      },
      {
        jobId,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
        timeout: 2 * 60 * 60 * 1000,
      },
    );

    this.logger.log(`[StockLedgerExport] Queued job ${jobId} for user ${opts.userId} (tenant: ${tenantId})`);
    return { jobId };
  }

  async getJobStatus(jobId: string): Promise<{ state: string; progress: number }> {
    const job = await this.exportQueue.getJob(jobId);
    if (!job) throw new NotFoundException(`Export job ${jobId} not found`);
    const state    = await job.getState();
    const progress = typeof job.progress() === 'number' ? (job.progress() as number) : 0;
    return { state, progress };
  }

  async streamExportFile(jobId: string, res: any): Promise<void> {
    const filePath = path.join(process.cwd(), 'uploads', 'exports', `export-${jobId}.xlsx`);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Export file not found. It may have expired or the job is still running.');
    }

    const stat      = fs.statSync(filePath);
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename  = `stock-ledger-export-${timestamp}.xlsx`;

    const stream = fs.createReadStream(filePath);
    stream.on('close', () => {
      fs.unlink(filePath, (err) => {
        if (err) this.logger.warn(`Could not delete export file: ${err.message}`);
        else     this.logger.log(`[StockLedgerExport] Cleaned up ${filePath}`);
      });
    });
    stream.on('error', (err) => {
      this.logger.error(`[StockLedgerExport] Stream error: ${err.message}`);
    });

    res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename="${filename}"`);
    res.header('Content-Length', stat.size);
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(stream);
  }

  async getStockActivityReport(options: {
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
  }) {
    const { locationId, warehouseId, startDate: startStr, endDate: endStr } = options;

    const locIds = locationId ? locationId.split(',').map(s => s.trim()).filter(Boolean) : [];
    const locationWhere = locIds.length > 1 ? { in: locIds } : (locIds.length === 1 ? locIds[0] : undefined);

    const whIds = warehouseId ? warehouseId.split(',').map(s => s.trim()).filter(Boolean) : [];
    const warehouseWhere = whIds.length > 1 ? { in: whIds } : (whIds.length === 1 ? whIds[0] : undefined);

    const locOrWhFilters: any[] = [];
    if (locationWhere) locOrWhFilters.push({ locationId: locationWhere });
    if (warehouseWhere) locOrWhFilters.push({ warehouseId: warehouseWhere });

    const locationOrWarehouseWhere = locOrWhFilters.length > 1
      ? { OR: locOrWhFilters }
      : (locOrWhFilters.length === 1 ? locOrWhFilters[0] : {});

    const showBrand = options.showBrand !== false;
    const showDivision = options.showDivision !== false;
    const showCategory = options.showCategory !== false;
    const showGender = options.showGender !== false;
    const showSilhouette = options.showSilhouette !== false;
    const showArticle = options.showArticle !== false;
    const showVariant = options.showVariant !== undefined ? options.showVariant : !options.summaryOnly;

    const levels: string[] = [];
    if (showBrand) levels.push('brand');
    if (showDivision) levels.push('division');
    if (showCategory) levels.push('category');
    if (showGender) levels.push('gender');
    if (showSilhouette) levels.push('silhouette');
    if (showArticle) levels.push('article');
    if (showVariant) levels.push('variant');

    if (levels.length === 0) {
      levels.push('brand');
    }

    const now = new Date();
    const getDefaultFiscalYearStart = (ref: Date) => {
      const year = ref.getFullYear();
      const month = ref.getMonth(); // 0 = Jan, 6 = July
      const fyYear = month >= 6 ? year : year - 1;
      return new Date(fyYear, 6, 1, 0, 0, 0, 0);
    };

    const startDate = startStr ? new Date(startStr) : getDefaultFiscalYearStart(now);
    const endDate = endStr ? new Date(endStr) : new Date(now);

    const inventoryItems = await this.prisma.inventoryItem.findMany({
      where: {
        ...locationOrWarehouseWhere,
        status: 'AVAILABLE',
      },
      select: { itemId: true },
    });
    
    const ledgerItems = await this.prisma.stockLedger.findMany({
      where: locationOrWarehouseWhere,
      select: { itemId: true },
      distinct: ['itemId'],
    });

    const uniqueItemIds = [...new Set([
      ...inventoryItems.map(i => i.itemId),
      ...ledgerItems.map(l => l.itemId),
    ])];

    if (uniqueItemIds.length === 0) {
      return [];
    }

    const uniqueItemChunks = chunkArray(uniqueItemIds, 1000);
    const itemsNested = await Promise.all(
      uniqueItemChunks.map((chunk) =>
        this.prisma.item.findMany({
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

    if (items.length === 0) {
      return [];
    }

    const matchedItemIds = items.map(i => i.id);
    const matchedItemChunks = chunkArray(matchedItemIds, 1000);

    const bfMap = new Map<string, number>();
    for (const chunk of matchedItemChunks) {
      const bfGroup = await this.prisma.stockLedger.groupBy({
        by: ['itemId'],
        where: {
          ...locationOrWarehouseWhere,
          itemId: { in: chunk },
          createdAt: { lt: startDate },
        },
        _sum: {
          qty: true,
        },
      });

      for (const row of bfGroup) {
        bfMap.set(row.itemId, Math.max(0, Number(row._sum.qty || 0)));
      }

      // Query and add any OPENING_BALANCE entries that were created within the date range
      const inRangeOpeningGroup = await this.prisma.stockLedger.groupBy({
        by: ['itemId'],
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
        const currentBf = bfMap.get(row.itemId) || 0;
        bfMap.set(row.itemId, Math.max(0, currentBf + Number(row._sum.qty || 0)));
      }
    }

    const ledgerEntries: any[] = [];
    for (const chunk of matchedItemChunks) {
      const chunkEntries = await this.prisma.stockLedger.findMany({
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

    const transitItems: any[] = [];
    for (const chunk of matchedItemChunks) {
      const chunkTransit = await this.prisma.transferRequestItem.findMany({
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
        },
      });
      transitItems.push(...chunkTransit);
    }

    const transitMap = new Map<string, number>();
    for (const row of transitItems) {
      const qty = Number(row.quantity || 0);
      transitMap.set(row.itemId, (transitMap.get(row.itemId) || 0) + qty);
    }

    const itemMetricsMap = new Map<string, {
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
      const itemId = entry.itemId;
      let m = itemMetricsMap.get(itemId);
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
        };
        itemMetricsMap.set(itemId, m);
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

    const root: any[] = [];

    const createEmptyTotals = () => ({
      bf: 0, fromWarehouse: 0, fromOutlet: 0, totalTrfIn: 0,
      toWarehouse: 0, toOutlet: 0, totalTrfOut: 0, exchg: 0,
      refund: 0, claim: 0, sales: 0, adj: 0, availableStock: 0,
      transit: 0, balance: 0,
    });

    const addTotals = (target: any, source: any) => {
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
    };

    for (const item of items) {
      const bf = bfMap.get(item.id) || 0;
      const transit = transitMap.get(item.id) || 0;
      const m = itemMetricsMap.get(item.id) || {
        fromWarehouse: 0, fromOutlet: 0, toWarehouse: 0, toOutlet: 0,
        exchg: 0, refund: 0, claim: 0, sales: 0, adj: 0,
      };

      const totalTrfIn = m.fromWarehouse + m.fromOutlet;
      const totalTrfOut = m.toWarehouse + m.toOutlet;
      const availableStock = bf + totalTrfIn - totalTrfOut + m.exchg + m.refund + m.claim - m.sales + m.adj;
      const balance = availableStock + transit;

      const variantMetrics = {
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
            totals: createEmptyTotals(),
            ...extraFields,
            children: [],
          };
          currentLevelNodes.push(existingNode);
        }

        addTotals(existingNode.totals, variantMetrics);

        if (i < levels.length - 1) {
          currentLevelNodes = existingNode.children;
        }
      }
    }

    return root;
  }

  async getStockTransactionDetailReport(
    options: {
      locationId?: string;
      warehouseId?: string;
      startDate?: string;
      endDate?: string;
      itemId?: string;
      search?: string;
      showBrand?: boolean;
      showDivision?: boolean;
      showCategory?: boolean;
      showGender?: boolean;
      showSilhouette?: boolean;
      showArticle?: boolean;
      showVariant?: boolean;
    },
    tx?: Prisma.TransactionClient | PrismaService,
  ) {
    const prisma = tx || this.prisma;
    const { locationId, warehouseId, itemId, search, startDate: startStr, endDate: endStr } = options;

    const showBrand = options.showBrand !== false;
    const showDivision = options.showDivision !== false;
    const showCategory = options.showCategory !== false;
    const showGender = options.showGender !== false;
    const showSilhouette = options.showSilhouette !== false;
    const showArticle = options.showArticle !== false;
    const showVariant = options.showVariant !== false;

    const levels: string[] = [];
    if (showBrand) levels.push('brand');
    if (showDivision) levels.push('division');
    if (showCategory) levels.push('category');
    if (showGender) levels.push('gender');
    if (showSilhouette) levels.push('silhouette');
    if (showArticle) levels.push('article');
    if (showVariant) levels.push('variant');

    if (levels.length === 0) {
      levels.push('brand');
    }

    const now = new Date();
    const startDate = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = endStr ? new Date(endStr) : new Date(now);

    const locIds = locationId ? locationId.split(',').map(s => s.trim()).filter(Boolean) : [];
    const locationWhere = locIds.length > 1 ? { in: locIds } : (locIds.length === 1 ? locIds[0] : undefined);

    const whIds = warehouseId ? warehouseId.split(',').map(s => s.trim()).filter(Boolean) : [];
    const warehouseWhere = whIds.length > 1 ? { in: whIds } : (whIds.length === 1 ? whIds[0] : undefined);

    const locOrWhFilters: any[] = [];
    if (locationWhere) locOrWhFilters.push({ locationId: locationWhere });
    if (warehouseWhere) locOrWhFilters.push({ warehouseId: warehouseWhere });

    const locationOrWarehouseWhere = locOrWhFilters.length > 1
      ? { OR: locOrWhFilters }
      : (locOrWhFilters.length === 1 ? locOrWhFilters[0] : {});

    // 1. Resolve matching Item IDs from inventory levels & ledger
    const inventoryItems = await prisma.inventoryItem.findMany({
      where: {
        ...locationOrWarehouseWhere,
        status: 'AVAILABLE',
        ...(itemId && { itemId }),
      },
      select: { itemId: true },
    });

    const ledgerItems = await prisma.stockLedger.findMany({
      where: {
        ...locationOrWarehouseWhere,
        ...(itemId && { itemId }),
      },
      select: { itemId: true },
      distinct: ['itemId'],
    });

    const uniqueItemIds = [...new Set([
      ...inventoryItems.map(i => i.itemId),
      ...ledgerItems.map(l => l.itemId),
    ])];

    if (uniqueItemIds.length === 0) {
      return { root: [], grandTotals: { openingBalance: 0, closingBalance: 0, inTransitQty: 0 } };
    }

    const uniqueItemChunks = chunkArray(uniqueItemIds, 1000);
    const itemsNested = await Promise.all(
      uniqueItemChunks.map((chunk) =>
        prisma.item.findMany({
          where: {
            AND: [
              {
                OR: [
                  { id: { in: chunk } },
                  { itemId: { in: chunk } },
                ],
              },
              search ? {
                OR: [
                  { sku: { contains: search, mode: 'insensitive' } },
                  { description: { contains: search, mode: 'insensitive' } },
                ],
              } : {},
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

    const matchedItemIds = items.map(i => i.id);
    if (matchedItemIds.length === 0) {
      return { root: [], grandTotals: { openingBalance: 0, closingBalance: 0, inTransitQty: 0 } };
    }

    const matchedItemChunks = chunkArray(matchedItemIds, 1000);

    // 3. Fetch Opening Balances (B/F) before startDate
    const bfMap = new Map<string, number>();
    for (const chunk of matchedItemChunks) {
      const bfGroup = await prisma.stockLedger.groupBy({
        by: ['itemId'],
        where: {
          ...locationOrWarehouseWhere,
          itemId: { in: chunk },
          createdAt: { lt: startDate },
        },
        _sum: { qty: true },
      });

      for (const row of bfGroup) {
        bfMap.set(row.itemId, Number(row._sum.qty || 0));
      }

      // Include opening balances posted within date range (e.g. bulk uploads or opening balance type)
      const inRangeOpeningGroup = await prisma.stockLedger.groupBy({
        by: ['itemId'],
        where: {
          ...locationOrWarehouseWhere,
          itemId: { in: chunk },
          createdAt: { gte: startDate, lte: endDate },
          OR: [
            { movementType: MovementType.OPENING_BALANCE },
            { referenceType: 'OPENING_BALANCE' },
            { referenceType: 'BULK_STOCK_UPLOAD' },
          ],
        },
        _sum: { qty: true },
      });

      for (const row of inRangeOpeningGroup) {
        const currentBf = bfMap.get(row.itemId) || 0;
        bfMap.set(row.itemId, currentBf + Number(row._sum.qty || 0));
      }
    }

    // 4. Fetch Ledger Entries within date range (excluding opening entries)
    const ledgerEntries: any[] = [];
    for (const chunk of matchedItemChunks) {
      const chunkEntries = await prisma.stockLedger.findMany({
        where: {
          ...locationOrWarehouseWhere,
          itemId: { in: chunk },
          createdAt: { gte: startDate, lte: endDate },
          NOT: [
            { movementType: MovementType.OPENING_BALANCE },
            { referenceType: 'OPENING_BALANCE' },
            { referenceType: 'BULK_STOCK_UPLOAD' },
          ],
        },
        orderBy: { createdAt: 'asc' },
      });
      ledgerEntries.push(...chunkEntries);
    }

    const toLocOrWhFilters: any[] = [];
    if (locationWhere) toLocOrWhFilters.push({ toLocationId: locationWhere });
    if (warehouseWhere) toLocOrWhFilters.push({ toWarehouseId: warehouseWhere });

    const toLocOrWhWhere = toLocOrWhFilters.length > 1
      ? { OR: toLocOrWhFilters }
      : (toLocOrWhFilters.length === 1 ? toLocOrWhFilters[0] : {});

    // 5. Fetch In-Transit Requests
    const transitRequests: any[] = [];
    for (const chunk of matchedItemChunks) {
      const chunkRequests = await prisma.transferRequestItem.findMany({
        where: {
          itemId: { in: chunk },
          transferRequest: {
            status: { in: ['PENDING', 'PENDING_CHECKER', 'PENDING_AUTHORIZER', 'PENDING_APPROVER', 'APPROVED', 'SOURCE_APPROVED'] },
            ...toLocOrWhWhere,
          },
        },
        include: {
          transferRequest: {
            include: {
              fromWarehouse: { select: { name: true } },
              fromLocation: { select: { name: true } },
            },
          },
        },
      });
      transitRequests.push(...chunkRequests);
    }

    // 6. Enrich reference documents to avoid N+1 queries
    const grnIds = new Set<string>();
    const salesOrderIds = new Set<string>();
    const transferIds = new Set<string>();
    const claimIds = new Set<string>();
    const adjustmentIds = new Set<string>();

    for (const entry of ledgerEntries) {
      const refId = entry.referenceId;
      if (!refId) continue;
      const refType = entry.referenceType;

      if (refType === 'GRN') {
        grnIds.add(refId);
      } else if (['POS_SALE', 'POS_RETURN', 'POS_REFUND', 'POS_VOID', 'POS_EXCHANGE_IN', 'POS_EXCHANGE_OUT'].includes(refType)) {
        salesOrderIds.add(refId);
      } else if (['TRANSFER_REQUEST', 'OUTLET_TRANSFER_IN', 'OUTLET_TRANSFER_OUT', 'RETURN_REQUEST', 'CLAIM_RETURN', 'CLAIM_TO_PLM', 'CLAIM_RETURN_REQUEST'].includes(refType)) {
        transferIds.add(refId);
      } else if (refType === 'POS_CLAIM_APPROVED') {
        claimIds.add(refId);
      } else if (['STOCK_ADJUSTMENT', 'ADJUSTMENT'].includes(refType)) {
        adjustmentIds.add(refId);
      }
    }

    const fetchInChunks = async <T>(ids: string[], fetchFn: (chunk: string[]) => Promise<T[]>): Promise<T[]> => {
      const chunks = chunkArray(ids, 1000);
      const results = await Promise.all(chunks.map(c => fetchFn(c)));
      return results.flat();
    };

    const [grns, salesOrders, transfers, claims, adjustments] = await Promise.all([
      grnIds.size > 0 ? fetchInChunks([...grnIds], (c) => prisma.goodsReceiptNote.findMany({
        where: { id: { in: c } },
        select: { id: true, grnNumber: true },
      })) : Promise.resolve([]),
      salesOrderIds.size > 0 ? fetchInChunks([...salesOrderIds], (c) => prisma.salesOrder.findMany({
        where: { id: { in: c } },
        select: { id: true, orderNumber: true, returnNumber: true, refundNumber: true },
      })) : Promise.resolve([]),
      transferIds.size > 0 ? fetchInChunks([...transferIds], (c) => prisma.transferRequest.findMany({
        where: { id: { in: c } },
        select: {
          id: true,
          requestNo: true,
          fromWarehouse: { select: { name: true } },
          fromLocation: { select: { name: true } },
          toWarehouse: { select: { name: true } },
          toLocation: { select: { name: true } },
        },
      })) : Promise.resolve([]),
      claimIds.size > 0 ? fetchInChunks([...claimIds], (c) => prisma.posClaim.findMany({
        where: { id: { in: c } },
        select: { id: true, claimNumber: true },
      })) : Promise.resolve([]),
      adjustmentIds.size > 0 ? fetchInChunks([...adjustmentIds], (c) => prisma.stockAdjustment.findMany({
        where: { id: { in: c } },
        select: { id: true, adjustmentNo: true },
      })) : Promise.resolve([]),
    ]);

    const grnsTyped = grns as any[];
    const salesOrdersTyped = salesOrders as any[];
    const transfersTyped = transfers as any[];
    const claimsTyped = claims as any[];
    const adjustmentsTyped = adjustments as any[];

    const grnMap = new Map<string, any>(grnsTyped.map(g => [g.id, g]));
    const salesOrderMap = new Map<string, any>(salesOrdersTyped.map(s => [s.id, s]));
    const transferMap = new Map<string, any>(transfersTyped.map(t => [t.id, t]));
    const claimMap = new Map<string, any>(claimsTyped.map(c => [c.id, c]));
    const adjustmentMap = new Map<string, any>(adjustmentsTyped.map(a => [a.id, a]));

    // Map entries to detailed transactions grouped by itemId
    const itemTransactionsMap = new Map<string, any[]>();
    const getOrCreateTxsList = (id: string) => {
      let list = itemTransactionsMap.get(id);
      if (!list) {
        list = [];
        itemTransactionsMap.set(id, list);
      }
      return list;
    };

    for (const entry of ledgerEntries) {
      const itemId = entry.itemId;
      const txs = getOrCreateTxsList(itemId);

      const qty = Number(entry.qty || 0);
      const refId = entry.referenceId;
      const refType = entry.referenceType;

      let docType = refType;
      let docRef = refId || '-';
      let remarks = '';

      if (refType === 'GRN') {
        docType = 'Stock RIR';
        const g = grnMap.get(refId);
        docRef = g?.grnNumber || refId || '-';
        remarks = 'Received From Warehouse';
      } else if (['TRANSFER_REQUEST', 'OUTLET_TRANSFER_IN', 'OUTLET_TRANSFER_OUT', 'RETURN_REQUEST', 'CLAIM_RETURN', 'CLAIM_TO_PLM', 'CLAIM_RETURN_REQUEST'].includes(refType)) {
        const t = transferMap.get(refId);
        docRef = t?.requestNo || refId || '-';
        if (qty > 0) {
          docType = 'Transfer In';
          const sourceName = t?.fromWarehouse?.name || t?.fromLocation?.name || 'Warehouse/Location';
          remarks = `Received From ${sourceName}`;
        } else {
          docType = 'Transfer Out';
          const destName = t?.toWarehouse?.name || t?.toLocation?.name || 'Warehouse/Location';
          remarks = `Transferred to ${destName}`;
        }
      } else if (refType === 'POS_SALE') {
        docType = 'Sale Retail';
        const s = salesOrderMap.get(refId);
        docRef = s?.orderNumber || refId || '-';
        remarks = 'Retail Sales';
      } else if (['POS_RETURN', 'POS_EXCHANGE_IN'].includes(refType)) {
        docType = 'Sale exchanges';
        const s = salesOrderMap.get(refId);
        docRef = s?.returnNumber || s?.orderNumber || refId || '-';
        remarks = 'Sale Return / Exchange';
      } else if (['POS_REFUND', 'POS_VOID'].includes(refType)) {
        docType = 'Sale Void';
        const s = salesOrderMap.get(refId);
        docRef = s?.refundNumber || s?.orderNumber || refId || '-';
        remarks = 'Sale Void / Refund';
      } else if (refType === 'POS_EXCHANGE_OUT') {
        docType = 'Sale exchanges';
        const s = salesOrderMap.get(refId);
        docRef = s?.orderNumber || refId || '-';
        remarks = 'Sale Exchange Out';
      } else if (refType === 'POS_CLAIM_APPROVED') {
        docType = 'Claims';
        const c = claimMap.get(refId);
        docRef = c?.claimNumber || refId || '-';
        remarks = 'POS Claim Approved';
      } else if (['STOCK_ADJUSTMENT', 'ADJUSTMENT'].includes(refType)) {
        docType = 'Adjustment';
        const a = adjustmentMap.get(refId);
        docRef = a?.adjustmentNo || refId || '-';
        remarks = 'Stock Adjustment';
      } else if (refType === 'BULK_STOCK_UPLOAD') {
        docType = 'Opening Balance';
        remarks = 'Bulk Stock Upload';
      } else if (refType === 'OPENING_BALANCE') {
        docType = 'Opening Balance';
        remarks = 'Opening Balance';
      }

      const inQty = qty > 0 ? qty : 0;
      const outQty = qty < 0 ? Math.abs(qty) : 0;

      txs.push({
        id: entry.id,
        date: entry.createdAt,
        docType,
        docRef,
        docRefId: refId,
        remarks,
        inQty,
        outQty,
        isInTransit: false,
      });
    }

    // Map In-Transit items
    for (const transit of transitRequests) {
      const itemId = transit.itemId;
      const txs = getOrCreateTxsList(itemId);

      const qty = Number(transit.quantity || 0);
      const tr = transit.transferRequest;
      const sourceName = tr?.fromWarehouse?.name || tr?.fromLocation?.name || 'Warehouse/Location';

      txs.push({
        id: transit.id,
        date: tr.requestDate || tr.createdAt,
        docType: 'Transfer In (Transit)',
        docRef: tr.requestNo,
        docRefId: tr.id,
        remarks: `In Transit from ${sourceName}`,
        inQty: qty,
        outQty: 0,
        isInTransit: true,
      });
    }

    // 7. Group items by SKU if showVariant is false, else keep them per item
    const skuGroupsMap = new Map<string, {
      sku: string;
      description: string;
      brand: string;
      division: string;
      category: string;
      gender: string;
      silhouette: string;
      color: string;
      size: string;
      openingBalance: number;
      closingBalance: number;
      inTransitQty: number;
      transactions: any[];
    }[]>();

    for (const item of items) {
      const key = showVariant ? item.id : item.sku;
      let group = skuGroupsMap.get(key);
      if (!group) {
        group = [];
        skuGroupsMap.set(key, group);
      }

      const bf = bfMap.get(item.id) || 0;
      const txs = itemTransactionsMap.get(item.id) || [];

      group.push({
        sku: item.sku,
        description: item.description || '',
        brand: item.brand?.name || 'No Brand',
        division: item.division?.name || 'No Division',
        category: item.category?.name || 'No Category',
        gender: item.gender?.name || 'No Gender',
        silhouette: item.silhouette?.name || 'No Silhouette',
        color: item.color?.name || 'Default',
        size: item.size?.name || 'Default',
        openingBalance: bf,
        closingBalance: bf, // calculated below
        inTransitQty: 0,
        transactions: txs,
      });
    }

    // Compile the flat list of products with finalized running balances
    const itemDataList: any[] = [];
    for (const [key, variants] of skuGroupsMap.entries()) {
      if (variants.length === 0) continue;

      if (!showVariant) {
        // Summary mode: merge all variants of the SKU
        const first = variants[0];
        let totalBf = 0;
        let pooledTxs: any[] = [];

        for (const v of variants) {
          totalBf += v.openingBalance;
          pooledTxs.push(...v.transactions);
        }

        // Sort combined transactions chronologically
        pooledTxs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        let runningBalance = totalBf;
        let totalTransit = 0;
        const processedTxs: any[] = [];

        for (const t of pooledTxs) {
          if (t.isInTransit) {
            totalTransit += t.inQty;
            processedTxs.push({ ...t, balance: '-' });
          } else {
            runningBalance += (t.inQty - t.outQty);
            processedTxs.push({ ...t, balance: runningBalance });
          }
        }

        itemDataList.push({
          sku: first.sku,
          description: first.description,
          brand: first.brand,
          division: first.division,
          category: first.category,
          gender: first.gender,
          silhouette: first.silhouette,
          color: '-',
          size: '-',
          openingBalance: totalBf,
          closingBalance: runningBalance,
          inTransitQty: totalTransit,
          transactions: processedTxs,
        });
      } else {
        // Detailed mode: keep individual variants
        for (const v of variants) {
          v.transactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

          let runningBalance = v.openingBalance;
          let transitSum = 0;
          const processedTxs: any[] = [];

          for (const t of v.transactions) {
            if (t.isInTransit) {
              transitSum += t.inQty;
              processedTxs.push({ ...t, balance: '-' });
            } else {
              runningBalance += (t.inQty - t.outQty);
              processedTxs.push({ ...t, balance: runningBalance });
            }
          }

          itemDataList.push({
            sku: v.sku,
            description: v.description,
            brand: v.brand,
            division: v.division,
            category: v.category,
            gender: v.gender,
            silhouette: v.silhouette,
            color: v.color,
            size: v.size,
            openingBalance: v.openingBalance,
            closingBalance: runningBalance,
            inTransitQty: transitSum,
            transactions: processedTxs,
          });
        }
      }
    }

    // 8. Build recursive tree hierarchy based on configured levels
    const root: any[] = [];
    const createEmptyTotals = () => ({
      openingBalance: 0,
      closingBalance: 0,
      inTransitQty: 0,
    });

    const addTotals = (target: any, source: any) => {
      target.openingBalance += source.openingBalance;
      target.closingBalance += source.closingBalance;
      target.inTransitQty += source.inTransitQty;
    };

    for (const itemData of itemDataList) {
      let currentLevelNodes = root;
      const metrics = {
        openingBalance: itemData.openingBalance,
        closingBalance: itemData.closingBalance,
        inTransitQty: itemData.inTransitQty,
      };

      for (let i = 0; i < levels.length; i++) {
        const levelName = levels[i];
        let nodeVal = '';
        let extraFields: any = {};

        if (levelName === 'brand') {
          nodeVal = itemData.brand;
        } else if (levelName === 'division') {
          nodeVal = itemData.division;
        } else if (levelName === 'category') {
          nodeVal = itemData.category;
        } else if (levelName === 'gender') {
          nodeVal = itemData.gender;
        } else if (levelName === 'silhouette') {
          nodeVal = itemData.silhouette;
        } else if (levelName === 'article') {
          nodeVal = itemData.sku;
          extraFields.sku = itemData.sku;
          extraFields.articleName = itemData.description;
        } else if (levelName === 'variant') {
          nodeVal = `${itemData.color}-${itemData.size}`;
          extraFields.color = itemData.color;
          extraFields.size = itemData.size;
        }

        let existingNode = currentLevelNodes.find(n => n.level === levelName && n.value === nodeVal);
        if (!existingNode) {
          existingNode = {
            level: levelName,
            value: nodeVal,
            totals: createEmptyTotals(),
            ...extraFields,
            children: [],
          };
          if (i === levels.length - 1) {
            existingNode.transactions = itemData.transactions;
            existingNode.openingBalance = itemData.openingBalance;
            existingNode.closingBalance = itemData.closingBalance;
            existingNode.inTransitQty = itemData.inTransitQty;
          }
          currentLevelNodes.push(existingNode);
        }

        addTotals(existingNode.totals, metrics);

        if (i < levels.length - 1) {
          currentLevelNodes = existingNode.children;
        }
      }
    }

    // Grand totals
    const grandTotals = createEmptyTotals();
    for (const node of root) {
      addTotals(grandTotals, node.totals);
    }

    return { root, grandTotals };
  }

  /**
   * Retroactively syncs all SalesOrders (uploaded history + live orders),
   * returns/voids, and generates initial OPENING_BALANCE ledger entries so that
   * stock ledgers and inventory levels reflect accurate history without negative stock gaps.
   */
  async syncAllSalesAndReturnsToStockLedger(options?: {
    locationId?: string;
  }): Promise<{
    openingEntriesCreated: number;
    salesLedgerEntriesCreated: number;
    returnEntriesCreated: number;
    inventoryItemsSynced: number;
  }> {
    this.logger.log(
      `[StockLedgerSync] Starting full stock ledger & inventory backfill... (locationId: ${options?.locationId || 'ALL'})`,
    );

    // 1. Resolve active locations & default warehouses
    const locationWhere: any = { isDeleted: false };
    if (options?.locationId) {
      locationWhere.id = options.locationId;
    }
    const locations = await this.prisma.location.findMany({
      where: locationWhere,
      select: { id: true, name: true, warehouseId: true },
    });

    const defaultWarehouse = await this.prisma.warehouse.findFirst({
      where: { isActive: true },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    const locationWarehouseMap = new Map<string, string>();
    for (const loc of locations) {
      const whId = loc.warehouseId || defaultWarehouse?.id;
      if (whId) {
        locationWarehouseMap.set(loc.id, whId);
      }
    }

    // 2. Fetch all sales orders with items
    const salesOrderWhere: any = {};
    if (options?.locationId) {
      salesOrderWhere.locationId = options.locationId;
    }

    const allSalesOrders = await this.prisma.salesOrder.findMany({
      where: salesOrderWhere,
      select: {
        id: true,
        orderNumber: true,
        locationId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        items: {
          select: {
            id: true,
            itemId: true,
            quantity: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    this.logger.log(
      `[StockLedgerSync] Found ${allSalesOrders.length} sales orders to inspect.`,
    );

    // 3. Batch check existing StockLedger entries for POS_SALE, POS_RETURN, POS_VOID
    const existingLedgers = await this.prisma.stockLedger.findMany({
      where: {
        referenceType: { in: ['POS_SALE', 'POS_RETURN', 'POS_VOID', 'OPENING_BALANCE', 'BULK_STOCK_UPLOAD'] },
        ...(options?.locationId ? { locationId: options.locationId } : {}),
      },
      select: {
        id: true,
        itemId: true,
        locationId: true,
        referenceType: true,
        referenceId: true,
        movementType: true,
      },
    });

    const existingSalesLedgerSet = new Set<string>(); // key: `${orderId}_${itemId}`
    const existingOpeningSet = new Set<string>();     // key: `${itemId}_${locationId}`
    const existingReturnSet = new Set<string>();      // key: `${orderId}_${itemId}`

    for (const entry of existingLedgers) {
      if (entry.referenceType === 'POS_SALE') {
        existingSalesLedgerSet.add(`${entry.referenceId}_${entry.itemId}`);
      } else if (entry.referenceType === 'OPENING_BALANCE' || entry.referenceType === 'BULK_STOCK_UPLOAD') {
        if (entry.locationId) {
          existingOpeningSet.add(`${entry.itemId}_${entry.locationId}`);
        }
      } else if (entry.referenceType === 'POS_RETURN' || entry.referenceType === 'POS_VOID') {
        existingReturnSet.add(`${entry.referenceId}_${entry.itemId}`);
      }
    }

    // 4. Calculate required OPENING_BALANCE per (itemId, locationId) where opening entry is missing
    let openingEntriesCreated = 0;
    const openingLedgerBatch: any[] = [];

    // Group item sales and returns by locationId & itemId
    const salesQtyMap = new Map<string, number>();  // key: `${itemId}_${locationId}` → sum qty
    const returnQtyMap = new Map<string, number>(); // key: `${itemId}_${locationId}` → sum qty
    const earliestDateMap = new Map<string, Date>(); // key: `${itemId}_${locationId}` → earliest Date

    for (const order of allSalesOrders) {
      const locId = order.locationId;
      if (!locId) continue;

      for (const item of order.items) {
        const key = `${item.itemId}_${locId}`;

        // Track earliest transaction date
        const existingEarliest = earliestDateMap.get(key);
        if (!existingEarliest || order.createdAt < existingEarliest) {
          earliestDateMap.set(key, order.createdAt);
        }

        if (order.status === 'voided') {
          returnQtyMap.set(key, (returnQtyMap.get(key) || 0) + Number(item.quantity));
        } else {
          salesQtyMap.set(key, (salesQtyMap.get(key) || 0) + Number(item.quantity));
        }
      }
    }

    // Also collect all distinct items from InventoryItem
    const allInventoryItems = await this.prisma.inventoryItem.findMany({
      where: options?.locationId ? { locationId: options.locationId } : {},
      select: { itemId: true, locationId: true, warehouseId: true, quantity: true },
    });

    const inventoryQtyMap = new Map<string, number>(); // key: `${itemId}_${locationId}`
    for (const inv of allInventoryItems) {
      if (inv.locationId) {
        const key = `${inv.itemId}_${inv.locationId}`;
        inventoryQtyMap.set(key, (inventoryQtyMap.get(key) || 0) + Number(inv.quantity));
      }
    }

    // Combine all unique (itemId, locationId) pairs
    const allItemLocKeys = new Set<string>([
      ...salesQtyMap.keys(),
      ...inventoryQtyMap.keys(),
    ]);

    for (const key of allItemLocKeys) {
      if (existingOpeningSet.has(key)) continue; // Already has opening balance entry

      const [itemId, locId] = key.split('_');
      const whId = locationWarehouseMap.get(locId) || defaultWarehouse?.id;
      if (!whId) continue;

      const totalSales = salesQtyMap.get(key) || 0;
      const totalReturns = returnQtyMap.get(key) || 0;
      const currentInv = inventoryQtyMap.get(key) || 0;

      // Estimated Opening Stock = current inventory + total sold - total returned
      let estimatedOpening = Math.max(0, currentInv + totalSales - totalReturns);
      if (estimatedOpening === 0 && totalSales > 0) {
        estimatedOpening = totalSales - totalReturns;
      }

      if (estimatedOpening > 0) {
        const earliestOrderDate = earliestDateMap.get(key) || new Date();
        const openingDate = new Date(earliestOrderDate.getTime() - 60000); // 1 minute before first sale

        openingLedgerBatch.push({
          itemId,
          warehouseId: whId,
          locationId: locId,
          qty: new Prisma.Decimal(estimatedOpening),
          movementType: MovementType.OPENING_BALANCE,
          referenceType: 'OPENING_BALANCE',
          referenceId: 'AUTO_OPENING_BAL',
          createdAt: openingDate,
        });

        existingOpeningSet.add(key);
      }
    }

    if (openingLedgerBatch.length > 0) {
      await this.prisma.stockLedger.createMany({
        data: openingLedgerBatch,
      });
      openingEntriesCreated = openingLedgerBatch.length;
      this.logger.log(`[StockLedgerSync] Created ${openingEntriesCreated} OPENING_BALANCE entries.`);
    }

    // 5. Backfill Sales Orders (OUTBOUND POS_SALE)
    let salesLedgerEntriesCreated = 0;
    const salesLedgerBatch: any[] = [];

    for (const order of allSalesOrders) {
      if (order.status === 'voided') continue;
      const locId = order.locationId;
      if (!locId) continue;
      const whId = locationWarehouseMap.get(locId) || defaultWarehouse?.id;
      if (!whId) continue;

      for (const item of order.items) {
        const key = `${order.id}_${item.itemId}`;
        if (existingSalesLedgerSet.has(key)) continue;

        salesLedgerBatch.push({
          itemId: item.itemId,
          warehouseId: whId,
          locationId: locId,
          qty: new Prisma.Decimal(-item.quantity), // Negative for OUTBOUND
          movementType: MovementType.OUTBOUND,
          referenceType: 'POS_SALE',
          referenceId: order.id,
          createdAt: order.createdAt,
        });

        existingSalesLedgerSet.add(key);
      }
    }

    if (salesLedgerBatch.length > 0) {
      const CHUNK = 1000;
      for (let i = 0; i < salesLedgerBatch.length; i += CHUNK) {
        const chunk = salesLedgerBatch.slice(i, i + CHUNK);
        await this.prisma.stockLedger.createMany({ data: chunk });
      }
      salesLedgerEntriesCreated = salesLedgerBatch.length;
      this.logger.log(`[StockLedgerSync] Created ${salesLedgerEntriesCreated} POS_SALE OUTBOUND ledger entries.`);
    }

    // 6. Backfill Voided / Returned Orders (INBOUND POS_VOID / POS_RETURN)
    let returnEntriesCreated = 0;
    const returnLedgerBatch: any[] = [];

    for (const order of allSalesOrders) {
      if (order.status !== 'voided') continue;
      const locId = order.locationId;
      if (!locId) continue;
      const whId = locationWarehouseMap.get(locId) || defaultWarehouse?.id;
      if (!whId) continue;

      for (const item of order.items) {
        const key = `${order.id}_${item.itemId}`;
        if (existingReturnSet.has(key)) continue;

        returnLedgerBatch.push({
          itemId: item.itemId,
          warehouseId: whId,
          locationId: locId,
          qty: new Prisma.Decimal(item.quantity), // Positive for INBOUND
          movementType: MovementType.INBOUND,
          referenceType: 'POS_VOID',
          referenceId: order.id,
          createdAt: order.updatedAt || order.createdAt,
        });

        existingReturnSet.add(key);
      }
    }

    if (returnLedgerBatch.length > 0) {
      await this.prisma.stockLedger.createMany({ data: returnLedgerBatch });
      returnEntriesCreated = returnLedgerBatch.length;
      this.logger.log(`[StockLedgerSync] Created ${returnEntriesCreated} POS_VOID INBOUND ledger entries.`);
    }

    // 7. Sync & Rebalance InventoryItem table to match Stock Ledger total sums
    this.logger.log('[StockLedgerSync] Rebalancing InventoryItem table from Stock Ledger sums...');
    const ledgerSums = await this.prisma.stockLedger.groupBy({
      by: ['itemId', 'warehouseId', 'locationId'],
      where: options?.locationId ? { locationId: options.locationId } : {},
      _sum: { qty: true },
    });

    let inventoryItemsSynced = 0;
    for (const group of ledgerSums) {
      const totalQty = Number(group._sum.qty || 0);

      const existingInv = await this.prisma.inventoryItem.findFirst({
        where: {
          itemId: group.itemId,
          warehouseId: group.warehouseId,
          locationId: group.locationId,
          batchNumber: null,
          serialNumber: null,
          status: 'AVAILABLE',
        },
        select: { id: true },
      });

      if (existingInv) {
        await this.prisma.inventoryItem.update({
          where: { id: existingInv.id },
          data: { quantity: new Prisma.Decimal(totalQty) },
        });
      } else {
        await this.prisma.inventoryItem.create({
          data: {
            itemId: group.itemId,
            warehouseId: group.warehouseId,
            locationId: group.locationId,
            quantity: new Prisma.Decimal(totalQty),
            status: 'AVAILABLE',
          },
        });
      }
      inventoryItemsSynced++;
    }

    this.logger.log(
      `[StockLedgerSync] Completed! Created: ${openingEntriesCreated} opening entries, ${salesLedgerEntriesCreated} sales entries, ${returnEntriesCreated} return entries. Rebalanced ${inventoryItemsSynced} inventory items.`,
    );

    return {
      openingEntriesCreated,
      salesLedgerEntriesCreated,
      returnEntriesCreated,
      inventoryItemsSynced,
    };
  }
}


