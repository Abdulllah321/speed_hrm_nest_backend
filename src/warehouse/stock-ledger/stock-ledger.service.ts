import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
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
    warehouseId?: string;
    movementType?: MovementType;
    itemId?: string;
    referenceType?: string;
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const { warehouseId, movementType, itemId, referenceType, page = 1, limit = 50, search } = options || {};
    const skip = (page - 1) * limit;

    const where: any = {
      ...(warehouseId && { warehouseId }),
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
}
