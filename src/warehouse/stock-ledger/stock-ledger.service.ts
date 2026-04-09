import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MovementType, Prisma } from '@prisma/client';

@Injectable()
export class StockLedgerService {
  constructor(private prisma: PrismaService) { }

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
        warehouseId,
        locationId,
      },
      _sum: {
        qty: true,
      },
    });

    // Enrich with Item, Warehouse, and Location details
    const enriched = await Promise.all(
      groupBy.map(async (entry) => {
        const item = await this.prisma.item.findUnique({
          where: { id: entry.itemId },
          select: { itemId: true, sku: true, description: true },
        });

        const warehouse = await this.prisma.warehouse.findUnique({
          where: { id: entry.warehouseId },
          select: { name: true, code: true },
        });

        let location: { name: string; code: string; type: string } | null = null;
        if (entry.locationId) {
          const masterLoc = await this.prisma.location.findUnique({
            where: { id: entry.locationId },
            select: { name: true, code: true },
          });
          if (masterLoc) {
            location = { ...masterLoc, type: 'SHOP' };
          }
        }

        return {
          itemId: entry.itemId,
          warehouseId: entry.warehouseId,
          locationId: entry.locationId,
          totalQty: entry._sum.qty || new Prisma.Decimal(0),
          item,
          warehouse,
          location,
        };
      }),
    );

    return enriched;
  }

  async createEntry(
    data: {
      itemId: string;
      warehouseId: string;
      qty: number | Prisma.Decimal;
      movementType: MovementType;
      referenceType: string;
      referenceId: string;
      locationId?: string | null;
      rate?: number | Prisma.Decimal;
    },
    tx?: Prisma.TransactionClient,
  ) {
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
      return transaction.stockLedger.create({
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
    };

    if (tx) {
      return operation(tx);
    } else {
      return this.prisma.$transaction(operation);
    }
  }
}
