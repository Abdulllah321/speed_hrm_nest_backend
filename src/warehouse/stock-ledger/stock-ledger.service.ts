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
@Injectable()
export class StockLedgerService {
  private readonly logger = new Logger(StockLedgerService.name);

  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
    @InjectQueue('stock-ledger-export') private readonly exportQueue: Queue,
  ) { }

  async findAll(options?: {
    locationId?: string;
    warehouseId?: string;
    movementType?: MovementType;
    itemId?: string;
    referenceType?: string;
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const { warehouseId, locationId, movementType, itemId, referenceType, page = 1, limit = 50, search } = options || {};
    const skip = (page - 1) * limit;

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

    const [data, total] = await Promise.all([
      this.prisma.stockLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
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
      }),
      this.prisma.stockLedger.count({ where }),
    ]);

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
      location: entry.locationId ? (locationMap.get(entry.locationId) ?? null) : null,
    }));

    return {
      status: true,
      data: enrichedData,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
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

    // Fetch related entities in parallel
    const itemIds = [...new Set(groupBy.map((r) => r.itemId))];
    const warehouseIds = [...new Set(groupBy.map((r) => r.warehouseId))];
    const locationIds = [...new Set(groupBy.map((r) => r.locationId).filter(Boolean))] as string[];

    const [items, warehouses, locations] = await Promise.all([
      this.prisma.item.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, itemId: true, sku: true, description: true },
      }),
      this.prisma.warehouse.findMany({
        where: { id: { in: warehouseIds }, isDeleted: false },
        select: { id: true, name: true, code: true },
      }),
      locationIds.length > 0
        ? this.prisma.location.findMany({
            where: { id: { in: locationIds } },
            select: { id: true, name: true, code: true },
          })
        : Promise.resolve([] as { id: string; name: string; code: string }[]),
    ]);

    const itemMap = new Map(items.map((i) => [i.id, i]));
    const warehouseMap = new Map(warehouses.map((w) => [w.id, w]));
    const locationMap = new Map(locations.map((l) => [l.id, l]));

    return groupBy.map((row) => {
      const loc = row.locationId ? locationMap.get(row.locationId) : null;
      const wh = warehouseMap.get(row.warehouseId);
      return {
        itemId: row.itemId,
        warehouseId: row.warehouseId,
        locationId: row.locationId ?? null,
        totalQty: Number(row._sum.qty || 0),
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
              warehouseId,
              // If locationId is provided, check location-specific stock (outlet)
              // Otherwise check warehouse-wide stock
              ...(locationId ? { locationId } : { locationId: null }),
            },
            _sum: {
              qty: true,
            },
          });

          const totalStock = currentStock._sum.qty || new Prisma.Decimal(0);

          if (totalStock.plus(quantity).isNegative()) {
            throw new BadRequestException(
              `Insufficient stock for item ${itemId} in warehouse ${warehouseId}. Current: ${totalStock}, Requested: ${quantity.abs()}`,
            );
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
            rate: rate ? new Prisma.Decimal(rate) : null,
            unitCost: rate ? new Prisma.Decimal(rate) : null,
          },
        });

        runInBackground(
          'Create Stock Ledger Entry',
          this.activityLogs.log({
            userId: ctx?.userId,
            action: 'create',
            module: 'stock-ledger',
            entity: 'StockLedger',
            entityId: entry.id,
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
    locationId: string;
    startDate?: string;
    endDate?: string;
    summaryOnly?: boolean;
  }) {
    const { locationId, startDate: startStr, endDate: endStr, summaryOnly } = options;
    if (!locationId) {
      throw new BadRequestException('locationId is required');
    }

    const now = new Date();
    const startDate = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = endStr ? new Date(endStr) : new Date(now);

    const inventoryItems = await this.prisma.inventoryItem.findMany({
      where: { locationId, status: 'AVAILABLE' },
      select: { itemId: true },
    });
    
    const ledgerItems = await this.prisma.stockLedger.findMany({
      where: { locationId },
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

    const items = await this.prisma.item.findMany({
      where: { id: { in: uniqueItemIds } },
      include: {
        color: true,
        size: true,
        gender: true,
        category: true,
        division: true,
        brand: true,
      },
    });

    if (items.length === 0) {
      return [];
    }

    const matchedItemIds = items.map(i => i.id);

    const bfGroup = await this.prisma.stockLedger.groupBy({
      by: ['itemId'],
      where: {
        locationId,
        itemId: { in: matchedItemIds },
        createdAt: { lt: startDate },
      },
      _sum: {
        qty: true,
      },
    });

    const bfMap = new Map<string, number>();
    for (const row of bfGroup) {
      bfMap.set(row.itemId, Number(row._sum.qty || 0));
    }

    const ledgerEntries = await this.prisma.stockLedger.findMany({
      where: {
        locationId,
        itemId: { in: matchedItemIds },
        createdAt: { gte: startDate, lte: endDate },
      },
      select: {
        itemId: true,
        qty: true,
        referenceType: true,
        movementType: true,
      },
    });

    const transitItems = await this.prisma.transferRequestItem.findMany({
      where: {
        itemId: { in: matchedItemIds },
        transferRequest: {
          toLocationId: locationId,
          status: { in: ['PENDING', 'SOURCE_APPROVED'] },
          transferType: { in: ['WAREHOUSE_TO_OUTLET', 'OUTLET_TO_OUTLET'] },
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

      if (mov === MovementType.ADJUSTMENT) {
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
    const getOrInsert = (arr: any[], keyField: string, keyValue: string, creator: () => any) => {
      let val = arr.find(x => x[keyField] === keyValue);
      if (!val) {
        val = creator();
        arr.push(val);
      }
      return val;
    };

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
      const divisionName = item.division?.name || 'No Division';
      const brandName = item.brand?.name || 'No Brand';
      const genderName = item.gender?.name || 'No Gender';
      const categoryName = item.category?.name || 'No Category';
      const sku = item.sku;
      const articleName = item.description || 'Unknown Article';

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

      const variant = {
        itemId: item.id,
        color: item.color?.name || 'Default',
        size: item.size?.name || 'Default',
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

      const divisionNode = getOrInsert(root, 'division', divisionName, () => ({ division: divisionName, brands: [], totals: createEmptyTotals() }));
      const brandNode = getOrInsert(divisionNode.brands, 'brand', brandName, () => ({ brand: brandName, genders: [], totals: createEmptyTotals() }));
      const genderNode = getOrInsert(brandNode.genders, 'gender', genderName, () => ({ gender: genderName, categories: [], totals: createEmptyTotals() }));
      const categoryNode = getOrInsert(genderNode.categories, 'category', categoryName, () => ({ category: categoryName, articles: [], totals: createEmptyTotals() }));
      const articleNode = getOrInsert(categoryNode.articles, 'sku', sku, () => ({
        sku,
        articleName,
        totals: createEmptyTotals(),
        variants: [],
      }));

      articleNode.variants.push(variant);
      addTotals(articleNode.totals, variant);
    }

    // Compute aggregates recursively
    for (const d of root) {
      for (const b of d.brands) {
        for (const g of b.genders) {
          for (const c of g.categories) {
            for (const a of c.articles) {
              addTotals(c.totals, a.totals);
            }
            addTotals(g.totals, c.totals);
          }
          addTotals(b.totals, g.totals);
        }
        addTotals(d.totals, b.totals);
      }
    }

    // If summaryOnly is true, clean/empty out the variants array to reduce JSON payload size
    if (summaryOnly) {
      for (const d of root) {
        for (const b of d.brands) {
          for (const g of b.genders) {
            for (const c of g.categories) {
              for (const a of c.articles) {
                a.variants = [];
              }
            }
          }
        }
      }
    }

    return root;
  }
}
