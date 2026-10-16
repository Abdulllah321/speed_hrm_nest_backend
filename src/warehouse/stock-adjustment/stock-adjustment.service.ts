import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MovementType, Prisma } from '@prisma/client';
import { StockLedgerService } from '../stock-ledger/stock-ledger.service';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';

@Injectable()
export class StockAdjustmentService {
  constructor(
    private prisma: PrismaService,
    private stockLedgerService: StockLedgerService,
    private activityLogs: ActivityLogsService,
  ) {}

  /**
   * Generates the next sequential Stock Adjustment number for the current fiscal year.
   * Fiscal year runs July 1 – June 30 (Pakistan standard).
   * Format: SADJ-YY-YY-NNNNN  e.g. SADJ-25-26-00001
   *
   * @param tx  Optional Prisma transaction client (use when called inside $transaction)
   */
  private async generateAdjustmentNumber(tx?: any): Promise<string> {
    const client = tx || this.prisma;

    // Determine current fiscal year bounds
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed; July = 6
    const startYear = month >= 6 ? year : year - 1;
    const endYear = startYear + 1;
    const fy = `${String(startYear % 100).padStart(2, '0')}-${String(endYear % 100).padStart(2, '0')}`;
    const prefix = `SADJ-${fy}-`;

    // Find the last Stock Adjustment issued in this fiscal year
    const fiscalYearStartDate = new Date(Date.UTC(startYear, 6, 1, 0, 0, 0, 0));
    const lastAdj = await client.stockAdjustment.findFirst({
      where: {
        adjustmentNo: { startsWith: prefix },
        createdAt: { gte: fiscalYearStartDate },
      },
      orderBy: { createdAt: 'desc' },
      select: { adjustmentNo: true },
    });

    let seq = 1;
    if (lastAdj?.adjustmentNo) {
      const parts = lastAdj.adjustmentNo.split('-');
      const lastSeq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastSeq)) {
        seq = lastSeq + 1;
      }
    }

    // Collision guard — loop until we find an unused number
    let adjustmentNo = `${prefix}${String(seq).padStart(5, '0')}`;
    let exists = await client.stockAdjustment.findUnique({
      where: { adjustmentNo },
      select: { id: true },
    });
    while (exists) {
      seq++;
      adjustmentNo = `${prefix}${String(seq).padStart(5, '0')}`;
      exists = await client.stockAdjustment.findUnique({
        where: { adjustmentNo },
        select: { id: true },
      });
    }

    return adjustmentNo;
  }

  private async applyStockMovement(
    tx: Prisma.TransactionClient,
    opts: {
      itemId: string;
      locationId: string | null;
      warehouseId: string | null;
      qty: number;
      rate?: number | Prisma.Decimal | null;
      referenceId: string;
      referenceType: string;
      adjustmentDate?: Date;
    },
  ) {
    const {
      itemId,
      locationId,
      warehouseId,
      qty,
      rate,
      referenceId,
      referenceType,
      adjustmentDate,
    } = opts;

    if (qty === 0) return;

    const isPositive = qty > 0;
    const isOutlet = Boolean(locationId);
    const targetLocationId = isOutlet ? locationId : null;
    const targetWarehouseId = isOutlet ? null : warehouseId;

    const whereStock: Prisma.InventoryItemWhereInput = {
      itemId,
      status: 'AVAILABLE',
      ...(isOutlet
        ? { locationId: targetLocationId }
        : { warehouseId: targetWarehouseId, locationId: null }),
    };

    const existingStock = await tx.inventoryItem.findFirst({
      where: whereStock,
    });

    if (isPositive) {
      if (existingStock) {
        await tx.inventoryItem.update({
          where: { id: existingStock.id },
          data: {
            quantity: { increment: new Prisma.Decimal(qty) },
            ...(isOutlet ? { warehouseId: null } : {}),
          },
        });
      } else {
        await tx.inventoryItem.create({
          data: {
            warehouseId: targetWarehouseId,
            locationId: targetLocationId,
            itemId,
            quantity: new Prisma.Decimal(qty),
            status: 'AVAILABLE',
          },
        });
      }
    } else {
      if (existingStock) {
        await tx.inventoryItem.update({
          where: { id: existingStock.id },
          data: {
            quantity: {
              decrement: new Prisma.Decimal(Math.abs(qty)),
            },
            ...(isOutlet ? { warehouseId: null } : {}),
          },
        });
      } else {
        await tx.inventoryItem.create({
          data: {
            warehouseId: targetWarehouseId,
            locationId: targetLocationId,
            itemId,
            quantity: new Prisma.Decimal(qty), // negative
            status: 'AVAILABLE',
          },
        });
      }
    }

    // Resolve warehouseId for stockLedger
    let ledgerWarehouseId = warehouseId;
    if (!ledgerWarehouseId && targetLocationId) {
      const loc = await tx.location.findUnique({
        where: { id: targetLocationId },
        select: { warehouseId: true },
      });
      ledgerWarehouseId = loc?.warehouseId || null;
    }
    if (!ledgerWarehouseId) {
      const defaultWarehouse = await tx.warehouse.findFirst({
        where: { isActive: true, isDeleted: false },
        select: { id: true },
      });
      ledgerWarehouseId = defaultWarehouse?.id || '';
    }

    await this.stockLedgerService.createEntry(
      {
        itemId,
        warehouseId: ledgerWarehouseId,
        locationId: targetLocationId,
        qty,
        movementType: MovementType.ADJUSTMENT,
        referenceType,
        referenceId,
        rate: rate ? (rate as any) : undefined,
        createdAt: adjustmentDate || new Date(),
      },
      tx,
    );
  }

  async findAll(options?: {
    warehouseId?: string;
    locationId?: string;
    status?: string;
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const {
      warehouseId,
      locationId,
      status,
      page = 1,
      limit = 50,
      search,
    } = options || {};
    const skip = (page - 1) * limit;

    const where: Prisma.StockAdjustmentWhereInput = {
      ...(warehouseId && { warehouseId }),
      ...(locationId && {
        OR: [
          { locationId },
          { items: { some: { locationId } } },
        ],
      }),
      ...(status && { status }),
      ...(search && {
        OR: [
          { adjustmentNo: { contains: search, mode: 'insensitive' } },
          { reason: { contains: search, mode: 'insensitive' } },
          { warehouse: { name: { contains: search, mode: 'insensitive' } } },
          { location: { name: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.stockAdjustment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          warehouse: { select: { id: true, name: true, code: true } },
          location: { select: { id: true, name: true, code: true } },
          items: {
            include: {
              item: {
                select: {
                  id: true,
                  itemId: true,
                  sku: true,
                  barCode: true,
                  description: true,
                  unitPrice: true,
                  brand: { select: { id: true, name: true } },
                  category: { select: { id: true, name: true } },
                  color: { select: { id: true, name: true } },
                  division: { select: { id: true, name: true } },
                  gender: { select: { id: true, name: true } },
                  silhouette: { select: { id: true, name: true } },
                  size: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.stockAdjustment.count({ where }),
    ]);

    // Enrich items with location details and swapItem details manually
    const locationIds = [
      ...new Set(
        data
          .flatMap((adj) => adj.items.map((item) => item.locationId))
          .filter(Boolean),
      ),
    ] as string[];

    const locationMap = new Map<string, { name: string; code: string }>();
    if (locationIds.length > 0) {
      const locations = await this.prisma.location.findMany({
        where: { id: { in: locationIds } },
        select: { id: true, name: true, code: true },
      });
      for (const loc of locations) {
        locationMap.set(loc.id, loc);
      }
    }

    const swapItemIds = [
      ...new Set(
        data
          .flatMap((adj) => adj.items.map((item) => item.swapItemId))
          .filter(Boolean),
      ),
    ] as string[];

    const swapItemMap = new Map<string, any>();
    if (swapItemIds.length > 0) {
      const items = await this.prisma.item.findMany({
        where: { id: { in: swapItemIds } },
        select: {
          id: true,
          itemId: true,
          sku: true,
          barCode: true,
          description: true,
          unitPrice: true,
          brand: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
          color: { select: { id: true, name: true } },
          division: { select: { id: true, name: true } },
          gender: { select: { id: true, name: true } },
          silhouette: { select: { id: true, name: true } },
          size: { select: { id: true, name: true } },
        },
      });
      for (const item of items) {
        swapItemMap.set(item.id, item);
      }
    }

    const enrichedData = data.map((adj) => ({
      ...adj,
      items: adj.items.map((item) => ({
        ...item,
        location: item.locationId
          ? (locationMap.get(item.locationId) ?? null)
          : null,
        swapItem: item.swapItemId
          ? (swapItemMap.get(item.swapItemId) ?? null)
          : null,
      })),
    }));

    return {
      status: true,
      data: enrichedData,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const adj = await this.prisma.stockAdjustment.findUnique({
      where: { id },
      include: {
        warehouse: { select: { id: true, name: true, code: true } },
        location: { select: { id: true, name: true, code: true } },
        items: {
          include: {
            item: {
              select: {
                id: true,
                itemId: true,
                sku: true,
                barCode: true,
                description: true,
                unitPrice: true,
                brand: { select: { id: true, name: true } },
                category: { select: { id: true, name: true } },
                color: { select: { id: true, name: true } },
                division: { select: { id: true, name: true } },
                gender: { select: { id: true, name: true } },
                silhouette: { select: { id: true, name: true } },
                size: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!adj) {
      throw new NotFoundException('Stock adjustment not found');
    }

    // Enrich with location and swapItem manually
    const locationIds = adj.items
      .map((item) => item.locationId)
      .filter(Boolean) as string[];
    const locationMap = new Map<string, { name: string; code: string }>();
    if (locationIds.length > 0) {
      const locations = await this.prisma.location.findMany({
        where: { id: { in: locationIds } },
        select: { id: true, name: true, code: true },
      });
      for (const loc of locations) {
        locationMap.set(loc.id, loc);
      }
    }

    const swapItemIds = adj.items
      .map((item) => item.swapItemId)
      .filter(Boolean) as string[];
    const swapItemMap = new Map<string, any>();
    if (swapItemIds.length > 0) {
      const items = await this.prisma.item.findMany({
        where: { id: { in: swapItemIds } },
        select: {
          id: true,
          itemId: true,
          sku: true,
          barCode: true,
          description: true,
          unitPrice: true,
          brand: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
          color: { select: { id: true, name: true } },
          division: { select: { id: true, name: true } },
          gender: { select: { id: true, name: true } },
          silhouette: { select: { id: true, name: true } },
          size: { select: { id: true, name: true } },
        },
      });
      for (const item of items) {
        swapItemMap.set(item.id, item);
      }
    }

    return {
      ...adj,
      items: adj.items.map((item) => ({
        ...item,
        location: item.locationId
          ? (locationMap.get(item.locationId) ?? null)
          : null,
        swapItem: item.swapItemId
          ? (swapItemMap.get(item.swapItemId) ?? null)
          : null,
      })),
    };
  }

  async create(
    dto: CreateStockAdjustmentDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    const adjustmentNo = await this.generateAdjustmentNumber();

    const isOutlet = Boolean(
      dto.locationId || dto.items.some((i) => i.locationId),
    );
    let finalLocationId: string | null = null;
    let finalWarehouseId: string | null = null;

    if (isOutlet) {
      finalLocationId =
        dto.locationId ||
        dto.items.find((i) => i.locationId)?.locationId ||
        null;
      finalWarehouseId = null; // Strictly null for outlet adjustment
    } else {
      finalLocationId = null; // Strictly null for warehouse adjustment
      finalWarehouseId = dto.warehouseId || null;
      if (!finalWarehouseId) {
        const warehouse = await this.prisma.warehouse.findFirst({
          where: { isActive: true, isDeleted: false },
        });
        if (!warehouse) {
          throw new BadRequestException(
            'No active warehouse found in the system',
          );
        }
        finalWarehouseId = warehouse.id;
      }
    }

    // Get current stock levels and rates for all items
    const resolvedItems = await Promise.all(
      dto.items.map(async (item) => {
        // Query item UUID and unit price
        const itemRecord = await this.prisma.item.findFirst({
          where: {
            OR: [{ id: item.itemId }, { itemId: item.itemId }],
          },
          select: { id: true, unitPrice: true },
        });

        if (!itemRecord) {
          throw new BadRequestException(
            `Item with ID ${item.itemId} not found`,
          );
        }

        const targetItemLocationId = isOutlet
          ? item.locationId || finalLocationId
          : null;

        // If client passed currentQty (what was confirmed on the screen), honor it.
        // Otherwise, aggregate from inventory items.
        let currentQty: number;
        if (item.currentQty !== undefined && item.currentQty !== null) {
          currentQty = Number(item.currentQty);
        } else {
          const whereStock: Prisma.InventoryItemWhereInput = {
            itemId: itemRecord.id,
            status: 'AVAILABLE',
            ...(targetItemLocationId
              ? { locationId: targetItemLocationId }
              : { warehouseId: finalWarehouseId, locationId: null }),
          };

          const stockAgg = await this.prisma.inventoryItem.aggregate({
            where: whereStock,
            _sum: {
              quantity: true,
            },
          });

          currentQty = stockAgg._sum.quantity
            ? Number(stockAgg._sum.quantity)
            : 0;
        }

        const adjustedQty = item.physicalQty - currentQty;
        const finalRate =
          item.rate !== undefined ? item.rate : itemRecord.unitPrice || 0;

        return {
          itemId: itemRecord.id,
          locationId: targetItemLocationId,
          currentQty: new Prisma.Decimal(currentQty),
          physicalQty: new Prisma.Decimal(item.physicalQty),
          adjustedQty: new Prisma.Decimal(adjustedQty),
          rate: new Prisma.Decimal(finalRate),
          swapItemId: item.swapItemId || null,
        };
      }),
    );

    return this.prisma.$transaction(async (tx) => {
      const adj = await tx.stockAdjustment.create({
        data: {
          adjustmentNo,
          warehouseId: finalWarehouseId,
          locationId: finalLocationId,
          reason: dto.reason,
          notes: dto.notes,
          status: dto.status || 'DRAFT',
          adjustmentType: dto.adjustmentType || 'STANDARD',
          createdById: ctx?.userId,
          items: {
            create: resolvedItems,
          },
        },
        include: {
          items: true,
        },
      });

      // Apply the adjustment effect to stock immediately on creation
      for (const line of adj.items) {
        const adjustedQty = Number(line.adjustedQty);
        if (adjustedQty === 0) continue;

        await this.applyStockMovement(tx, {
          itemId: line.itemId,
          locationId: line.locationId || finalLocationId,
          warehouseId: finalWarehouseId,
          qty: adjustedQty,
          rate: line.rate,
          referenceId: adj.id,
          referenceType: 'STOCK_ADJUSTMENT',
          adjustmentDate: adj.adjustmentDate,
        });
      }

      runInBackground(
        'Create Stock Adjustment',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'stock-adjustment',
          entity: 'StockAdjustment',
          entityId: adj.id,
          description: `Created stock adjustment ${adj.adjustmentNo}`,
          newValues: JSON.stringify(dto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return adj;
    });
  }

  async update(
    id: string,
    dto: CreateStockAdjustmentDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    const existing = await this.prisma.stockAdjustment.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existing) {
      throw new NotFoundException('Stock adjustment not found');
    }

    if (existing.status !== 'DRAFT' && existing.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(
        'Can only update stock adjustments in DRAFT or PENDING_APPROVAL status',
      );
    }

    const isOutlet = Boolean(
      dto.locationId ||
        existing.locationId ||
        dto.items.some((i) => i.locationId),
    );
    let finalLocationId: string | null = null;
    let finalWarehouseId: string | null = null;

    if (isOutlet) {
      finalLocationId =
        dto.locationId ||
        existing.locationId ||
        dto.items.find((i) => i.locationId)?.locationId ||
        null;
      finalWarehouseId = null;
    } else {
      finalLocationId = null;
      finalWarehouseId = dto.warehouseId || existing.warehouseId || null;
      if (!finalWarehouseId) {
        const warehouse = await this.prisma.warehouse.findFirst({
          where: { isActive: true, isDeleted: false },
        });
        if (warehouse) {
          finalWarehouseId = warehouse.id;
        }
      }
    }

    // Resolve items
    const resolvedItems = await Promise.all(
      dto.items.map(async (item) => {
        const itemRecord = await this.prisma.item.findFirst({
          where: {
            OR: [{ id: item.itemId }, { itemId: item.itemId }],
          },
          select: { id: true, unitPrice: true },
        });

        if (!itemRecord) {
          throw new BadRequestException(
            `Item with ID ${item.itemId} not found`,
          );
        }

        const targetItemLocationId = isOutlet
          ? item.locationId || finalLocationId
          : null;

        let currentQty: number;
        if (item.currentQty !== undefined && item.currentQty !== null) {
          currentQty = Number(item.currentQty);
        } else {
          const whereStock: Prisma.InventoryItemWhereInput = {
            itemId: itemRecord.id,
            status: 'AVAILABLE',
            ...(targetItemLocationId
              ? { locationId: targetItemLocationId }
              : { warehouseId: finalWarehouseId, locationId: null }),
          };

          const stockAgg = await this.prisma.inventoryItem.aggregate({
            where: whereStock,
            _sum: {
              quantity: true,
            },
          });

          currentQty = stockAgg._sum.quantity
            ? Number(stockAgg._sum.quantity)
            : 0;
        }

        const adjustedQty = item.physicalQty - currentQty;
        const finalRate =
          item.rate !== undefined ? item.rate : itemRecord.unitPrice || 0;

        return {
          itemId: itemRecord.id,
          locationId: targetItemLocationId,
          currentQty: new Prisma.Decimal(currentQty),
          physicalQty: new Prisma.Decimal(item.physicalQty),
          adjustedQty: new Prisma.Decimal(adjustedQty),
          rate: new Prisma.Decimal(finalRate),
          swapItemId: item.swapItemId || null,
        };
      }),
    );

    return this.prisma.$transaction(async (tx) => {
      // Revert previous stock movements for existing items
      for (const line of existing.items) {
        const adjustedQty = Number(line.adjustedQty);
        if (adjustedQty === 0) continue;

        await this.applyStockMovement(tx, {
          itemId: line.itemId,
          locationId: line.locationId || existing.locationId,
          warehouseId: existing.warehouseId,
          qty: -adjustedQty,
          rate: line.rate,
          referenceId: existing.id,
          referenceType: 'STOCK_ADJUSTMENT_UPDATE',
          adjustmentDate: new Date(),
        });
      }

      // Delete existing items
      await tx.stockAdjustmentItem.deleteMany({
        where: { stockAdjustmentId: id },
      });

      // Update header and recreate items
      const updated = await tx.stockAdjustment.update({
        where: { id },
        data: {
          warehouseId: finalWarehouseId,
          locationId: finalLocationId,
          reason: dto.reason,
          notes: dto.notes,
          status: dto.status || existing.status,
          adjustmentType: dto.adjustmentType || existing.adjustmentType,
          items: {
            create: resolvedItems,
          },
        },
        include: { items: true },
      });

      // Apply new stock movements for updated items
      for (const line of updated.items) {
        const adjustedQty = Number(line.adjustedQty);
        if (adjustedQty === 0) continue;

        await this.applyStockMovement(tx, {
          itemId: line.itemId,
          locationId: line.locationId || finalLocationId,
          warehouseId: finalWarehouseId,
          qty: adjustedQty,
          rate: line.rate,
          referenceId: updated.id,
          referenceType: 'STOCK_ADJUSTMENT',
          adjustmentDate: updated.adjustmentDate,
        });
      }

      runInBackground(
        'Update Stock Adjustment',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'stock-adjustment',
          entity: 'StockAdjustment',
          entityId: updated.id,
          description: `Updated stock adjustment draft ${updated.adjustmentNo}`,
          newValues: JSON.stringify(dto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return updated;
    });
  }

  async delete(
    id: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    const existing = await this.prisma.stockAdjustment.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existing) {
      throw new NotFoundException('Stock adjustment not found');
    }

    return this.prisma.$transaction(async (tx) => {
      // If adjustment was not REJECTED, stock effect was active, so reverse it
      if (existing.status !== 'REJECTED' && existing.status !== 'CANCELLED') {
        for (const line of existing.items) {
          const adjustedQty = Number(line.adjustedQty);
          if (adjustedQty === 0) continue;

          await this.applyStockMovement(tx, {
            itemId: line.itemId,
            locationId: line.locationId || existing.locationId,
            warehouseId: existing.warehouseId,
            qty: -adjustedQty, // reverse
            rate: line.rate,
            referenceId: existing.id,
            referenceType: 'STOCK_ADJUSTMENT_DELETION',
            adjustmentDate: new Date(),
          });
        }

        // Delete associated stock ledger entries
        await tx.stockLedger.deleteMany({
          where: {
            referenceId: existing.id,
            referenceType: {
              in: [
                'STOCK_ADJUSTMENT',
                'STOCK_ADJUSTMENT_REJECTION',
                'STOCK_ADJUSTMENT_UPDATE',
                'STOCK_ADJUSTMENT_DELETION',
              ],
            },
          },
        });
      }

      await tx.stockAdjustment.delete({
        where: { id },
      });

      runInBackground(
        'Delete Stock Adjustment',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'stock-adjustment',
          entity: 'StockAdjustment',
          entityId: id,
          description: `Deleted stock adjustment ${existing.adjustmentNo} (${existing.status})`,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return { status: true, message: 'Stock adjustment deleted successfully' };
    });
  }

  async submit(
    id: string,
    dto?: {
      items?: { itemId: string; physicalQty: number; rate?: number }[];
      notes?: string;
    },
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    const adj = await this.prisma.stockAdjustment.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!adj) {
      throw new NotFoundException('Stock adjustment not found');
    }

    if (adj.status !== 'DRAFT' && adj.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(
        'Stock adjustment is already submitted, rejected or cancelled',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // If manager updated quantities or instructions during approval
      if (dto) {
        if (dto.notes !== undefined) {
          await tx.stockAdjustment.update({
            where: { id },
            data: { notes: dto.notes },
          });
        }

        if (dto.items && dto.items.length > 0) {
          for (const updatedItem of dto.items) {
            const existingItem = adj.items.find(
              (i) => i.itemId === updatedItem.itemId,
            );
            if (existingItem) {
              const oldAdjustedQty = Number(existingItem.adjustedQty);
              const newAdjustedQty =
                updatedItem.physicalQty - Number(existingItem.currentQty);
              const deltaToApply = newAdjustedQty - oldAdjustedQty;

              // Only the delta difference between manager's count and initial request is applied
              if (deltaToApply !== 0) {
                await this.applyStockMovement(tx, {
                  itemId: existingItem.itemId,
                  locationId: existingItem.locationId || adj.locationId,
                  warehouseId: adj.warehouseId,
                  qty: deltaToApply,
                  rate:
                    updatedItem.rate !== undefined
                      ? updatedItem.rate
                      : existingItem.rate,
                  referenceId: adj.id,
                  referenceType: 'STOCK_ADJUSTMENT',
                  adjustmentDate: adj.adjustmentDate,
                });
              }

              await tx.stockAdjustmentItem.update({
                where: { id: existingItem.id },
                data: {
                  physicalQty: new Prisma.Decimal(updatedItem.physicalQty),
                  adjustedQty: new Prisma.Decimal(newAdjustedQty),
                  rate:
                    updatedItem.rate !== undefined
                      ? new Prisma.Decimal(updatedItem.rate)
                      : existingItem.rate,
                },
              });
            }
          }
        }
      }

      // Update Header Status to SUBMITTED
      // Note: If no quantities were altered by manager, stock was already affected on creation.
      const updated = await tx.stockAdjustment.update({
        where: { id },
        data: {
          status: 'SUBMITTED',
          approvedById: ctx?.userId,
          adjustmentDate: adj.adjustmentDate || new Date(),
        },
      });

      runInBackground(
        'Submit Stock Adjustment',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'stock-adjustment',
          entity: 'StockAdjustment',
          entityId: updated.id,
          description: `Submitted stock adjustment ${updated.adjustmentNo}`,
          newValues: JSON.stringify({ status: 'SUBMITTED' }),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return updated;
    });
  }

  async reject(
    id: string,
    dto?: { notes?: string },
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    const adj = await this.prisma.stockAdjustment.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!adj) {
      throw new NotFoundException('Stock adjustment not found');
    }

    if (adj.status !== 'PENDING_APPROVAL' && adj.status !== 'DRAFT') {
      throw new BadRequestException(
        'Only draft or pending approval adjustments can be rejected',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Revert the stock effect applied on creation
      for (const line of adj.items) {
        const adjustedQty = Number(line.adjustedQty);
        if (adjustedQty === 0) continue;

        await this.applyStockMovement(tx, {
          itemId: line.itemId,
          locationId: line.locationId || adj.locationId,
          warehouseId: adj.warehouseId,
          qty: -adjustedQty, // reverse effect
          rate: line.rate,
          referenceId: adj.id,
          referenceType: 'STOCK_ADJUSTMENT_REJECTION',
          adjustmentDate: new Date(),
        });
      }

      const updated = await tx.stockAdjustment.update({
        where: { id },
        data: {
          status: 'REJECTED',
          approvedById: ctx?.userId,
          ...(dto?.notes !== undefined && { notes: dto.notes }),
        },
      });

      runInBackground(
        'Reject Stock Adjustment',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'stock-adjustment',
          entity: 'StockAdjustment',
          entityId: updated.id,
          description: `Rejected stock adjustment request ${updated.adjustmentNo}`,
          newValues: JSON.stringify({ status: 'REJECTED' }),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return updated;
    });
  }
}
