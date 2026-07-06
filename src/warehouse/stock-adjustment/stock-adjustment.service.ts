import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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

  async findAll(options?: {
    warehouseId?: string;
    locationId?: string;
    status?: string;
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const { warehouseId, locationId, status, page = 1, limit = 50, search } = options || {};
    const skip = (page - 1) * limit;

    const where: Prisma.StockAdjustmentWhereInput = {
      ...(warehouseId && { warehouseId }),
      ...(locationId && {
        items: {
          some: {
            locationId,
          },
        },
      }),
      ...(status && { status }),
      ...(search && {
        OR: [
          { adjustmentNo: { contains: search, mode: 'insensitive' } },
          { reason: { contains: search, mode: 'insensitive' } },
          { warehouse: { name: { contains: search, mode: 'insensitive' } } },
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
          warehouse: { select: { name: true, code: true } },
          items: {
            include: {
              item: {
                select: {
                  id: true,
                  itemId: true,
                  sku: true,
                  description: true,
                  unitPrice: true,
                  category: { select: { id: true, name: true } },
                  color: { select: { id: true, name: true } },
                  division: { select: { id: true, name: true } },
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
          description: true,
          unitPrice: true,
          category: { select: { id: true, name: true } },
          color: { select: { id: true, name: true } },
          division: { select: { id: true, name: true } },
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
        location: item.locationId ? (locationMap.get(item.locationId) ?? null) : null,
        swapItem: item.swapItemId ? (swapItemMap.get(item.swapItemId) ?? null) : null,
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
        items: {
          include: {
            item: {
              select: {
                id: true,
                itemId: true,
                sku: true,
                description: true,
                unitPrice: true,
                category: { select: { id: true, name: true } },
                color: { select: { id: true, name: true } },
                division: { select: { id: true, name: true } },
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
    const locationIds = adj.items.map((item) => item.locationId).filter(Boolean) as string[];
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

    const swapItemIds = adj.items.map((item) => item.swapItemId).filter(Boolean) as string[];
    const swapItemMap = new Map<string, any>();
    if (swapItemIds.length > 0) {
      const items = await this.prisma.item.findMany({
        where: { id: { in: swapItemIds } },
        select: {
          id: true,
          itemId: true,
          sku: true,
          description: true,
          unitPrice: true,
          category: { select: { id: true, name: true } },
          color: { select: { id: true, name: true } },
          division: { select: { id: true, name: true } },
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
        location: item.locationId ? (locationMap.get(item.locationId) ?? null) : null,
        swapItem: item.swapItemId ? (swapItemMap.get(item.swapItemId) ?? null) : null,
      })),
    };
  }

  async create(dto: CreateStockAdjustmentDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    const adjustmentNo = `SADJ-${Date.now()}`;

    let warehouseId = dto.warehouseId;
    if (!warehouseId) {
      const warehouse = await this.prisma.warehouse.findFirst({
        where: { isActive: true, isDeleted: false },
      });
      if (!warehouse) {
        throw new BadRequestException('No active warehouse found in the system');
      }
      warehouseId = warehouse.id;
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
          throw new BadRequestException(`Item with ID ${item.itemId} not found`);
        }

        // Query current stock levels
        const existingStock = await this.prisma.inventoryItem.findFirst({
          where: {
            warehouseId,
            locationId: item.locationId || null,
            itemId: itemRecord.id,
            status: 'AVAILABLE',
          },
        });

        const currentQty = existingStock ? Number(existingStock.quantity) : 0;
        const adjustedQty = item.physicalQty - currentQty;
        const finalRate = item.rate !== undefined ? item.rate : (itemRecord.unitPrice || 0);

        return {
          itemId: itemRecord.id,
          locationId: item.locationId || null,
          currentQty: new Prisma.Decimal(currentQty),
          physicalQty: new Prisma.Decimal(item.physicalQty),
          adjustedQty: new Prisma.Decimal(adjustedQty),
          rate: new Prisma.Decimal(finalRate),
          swapItemId: item.swapItemId || null,
        };
      }),
    );

    const adj = await this.prisma.stockAdjustment.create({
      data: {
        adjustmentNo,
        warehouseId,
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

    runInBackground(
      'Create Stock Adjustment',
      this.activityLogs.log({
        userId: ctx?.userId,
        action: 'create',
        module: 'stock-adjustment',
        entity: 'StockAdjustment',
        entityId: adj.id,
        description: `Created stock adjustment draft ${adj.adjustmentNo}`,
        newValues: JSON.stringify(dto),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      }),
    );

    return adj;
  }

  async update(id: string, dto: CreateStockAdjustmentDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    const existing = await this.prisma.stockAdjustment.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existing) {
      throw new NotFoundException('Stock adjustment not found');
    }

    if (existing.status !== 'DRAFT' && existing.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Can only update stock adjustments in DRAFT or PENDING_APPROVAL status');
    }

    const warehouseId = dto.warehouseId || existing.warehouseId;

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
          throw new BadRequestException(`Item with ID ${item.itemId} not found`);
        }

        const existingStock = await this.prisma.inventoryItem.findFirst({
          where: {
            warehouseId,
            locationId: item.locationId || null,
            itemId: itemRecord.id,
            status: 'AVAILABLE',
          },
        });

        const currentQty = existingStock ? Number(existingStock.quantity) : 0;
        const adjustedQty = item.physicalQty - currentQty;
        const finalRate = item.rate !== undefined ? item.rate : (itemRecord.unitPrice || 0);

        return {
          itemId: itemRecord.id,
          locationId: item.locationId || null,
          currentQty: new Prisma.Decimal(currentQty),
          physicalQty: new Prisma.Decimal(item.physicalQty),
          adjustedQty: new Prisma.Decimal(adjustedQty),
          rate: new Prisma.Decimal(finalRate),
          swapItemId: item.swapItemId || null,
        };
      }),
    );

    return this.prisma.$transaction(async (tx) => {
      // Delete existing items
      await tx.stockAdjustmentItem.deleteMany({
        where: { stockAdjustmentId: id },
      });

      // Update header and recreate items
      const updated = await tx.stockAdjustment.update({
        where: { id },
        data: {
          warehouseId,
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

  async delete(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    const existing = await this.prisma.stockAdjustment.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Stock adjustment not found');
    }

    if (existing.status !== 'DRAFT' && existing.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Can only delete stock adjustments in DRAFT or PENDING_APPROVAL status');
    }

    await this.prisma.stockAdjustment.delete({
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
        description: `Deleted stock adjustment draft ${existing.adjustmentNo}`,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      }),
    );

    return { status: true, message: 'Stock adjustment deleted successfully' };
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
      throw new BadRequestException('Stock adjustment is already submitted, rejected or cancelled');
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
            const existingItem = adj.items.find((i) => i.itemId === updatedItem.itemId);
            if (existingItem) {
              const adjustedQty = updatedItem.physicalQty - Number(existingItem.currentQty);
              await tx.stockAdjustmentItem.update({
                where: { id: existingItem.id },
                data: {
                  physicalQty: new Prisma.Decimal(updatedItem.physicalQty),
                  adjustedQty: new Prisma.Decimal(adjustedQty),
                  rate: updatedItem.rate !== undefined ? new Prisma.Decimal(updatedItem.rate) : existingItem.rate,
                },
              });
            }
          }
        }
      }

      // Re-fetch adjustment items to get updated quantities
      const updatedAdj = await tx.stockAdjustment.findUnique({
        where: { id },
        include: { items: true },
      });
      const linesToPost = updatedAdj ? updatedAdj.items : adj.items;

      for (const line of linesToPost) {
        const adjustedQty = Number(line.adjustedQty);
        if (adjustedQty === 0) continue;

        const isPositive = adjustedQty > 0;

        // Process stock update in InventoryItem
        const existingStock = await tx.inventoryItem.findFirst({
          where: {
            warehouseId: adj.warehouseId,
            locationId: line.locationId || null,
            itemId: line.itemId,
            status: 'AVAILABLE',
          },
        });

        if (isPositive) {
          // Increment Stock
          if (existingStock) {
            await tx.inventoryItem.update({
              where: { id: existingStock.id },
              data: { quantity: { increment: new Prisma.Decimal(adjustedQty) } },
            });
          } else {
            await tx.inventoryItem.create({
              data: {
                warehouseId: adj.warehouseId,
                locationId: line.locationId || null,
                itemId: line.itemId,
                quantity: new Prisma.Decimal(adjustedQty),
                status: 'AVAILABLE',
              },
            });
          }
        } else {
          // Decrement Stock
          if (!existingStock || Number(existingStock.quantity) < Math.abs(adjustedQty)) {
            throw new BadRequestException(
              `Insufficient stock for item ${line.itemId} in warehouse. Current: ${
                existingStock ? Number(existingStock.quantity) : 0
              }, Required Adjustment: ${adjustedQty}`,
            );
          }

          await tx.inventoryItem.update({
            where: { id: existingStock.id },
            data: { quantity: { decrement: new Prisma.Decimal(Math.abs(adjustedQty)) } },
          });
        }

        // Create Stock Ledger entry
        await this.stockLedgerService.createEntry(
          {
            itemId: line.itemId,
            warehouseId: adj.warehouseId,
            locationId: line.locationId || null,
            qty: adjustedQty, // Positive or negative
            movementType: MovementType.ADJUSTMENT,
            referenceType: 'STOCK_ADJUSTMENT',
            referenceId: adj.id,
            rate: line.rate,
          },
          tx,
        );
      }

      // Update Header Status to SUBMITTED
      const updated = await tx.stockAdjustment.update({
        where: { id },
        data: {
          status: 'SUBMITTED',
          approvedById: ctx?.userId,
          adjustmentDate: new Date(),
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
    });

    if (!adj) {
      throw new NotFoundException('Stock adjustment not found');
    }

    if (adj.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Only pending approval adjustments can be rejected');
    }

    const updated = await this.prisma.stockAdjustment.update({
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
  }
}
