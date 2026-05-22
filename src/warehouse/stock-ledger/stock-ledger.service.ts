import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MovementType, Prisma } from '@prisma/client';

import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';
@Injectable()
export class StockLedgerService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) { }

  async findAll(options?: {
    warehouseId?: string;
    movementType?: MovementType;
    itemId?: string;
    referenceType?: string;
    page?: number;
    limit?: number;
  }) {
    const { warehouseId, movementType, itemId, referenceType, page = 1, limit = 50 } = options || {};
    const skip = (page - 1) * limit;

    const where: any = {
      ...(warehouseId && { warehouseId }),
      ...(movementType && { movementType }),
      ...(itemId && { itemId }),
      ...(referenceType && { referenceType }),
    };

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
}
