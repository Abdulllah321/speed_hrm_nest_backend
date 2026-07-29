import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryItem } from '@prisma/client';

import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { runInBackground } from '../common/utils/run-in-background.util';
@Injectable()
export class InventoryService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) { }

  async getStockLevel(itemId: string, warehouseId: string): Promise<any> {
    const inventory = await this.prisma.inventoryItem.groupBy({
      by: ['itemId'],
      where: {
        itemId,
        warehouseId,
        status: 'AVAILABLE',
      },
      _sum: {
        quantity: true,
      },
    });
    const physicalQty = Number(inventory[0]?._sum?.quantity || 0);

    const reservations = await this.prisma.stockReserve.aggregate({
      where: {
        itemId,
        warehouseId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gte: new Date() } }
        ]
      },
      _sum: {
        quantity: true,
      }
    });
    const reservedQty = Number(reservations._sum.quantity || 0);
    const netQty = Math.max(0, physicalQty - reservedQty);

    return {
      itemId,
      warehouseId,
      totalQuantity: netQty,
    };
  }

  async getDetailedStock(itemId: string): Promise<any[]> {
    const items = await this.prisma.inventoryItem.findMany({
      where: { itemId, status: 'AVAILABLE' },
    });

    const enriched = await Promise.all(
      items.map(async (item) => {
        const warehouse = await this.prisma.warehouse.findUnique({
          where: { id: item.warehouseId },
          select: { id: true, name: true },
        });

        let locationData: any = {};
        if (item.locationId) {
          // Check Master Location (Shop/Outlet)
          const masterLoc = await this.prisma.location.findUnique({
            where: { id: item.locationId },
            select: { id: true, name: true },
          });
          if (masterLoc) locationData = masterLoc;
        }

        let quantity = Number(item.quantity);
        if (!item.locationId) { // It is warehouse stock
          const reservations = await this.prisma.stockReserve.aggregate({
            where: {
              itemId: item.itemId,
              warehouseId: item.warehouseId,
              OR: [
                { expiresAt: null },
                { expiresAt: { gte: new Date() } }
              ]
            },
            _sum: {
              quantity: true,
            }
          });
          const reservedQty = Number(reservations._sum.quantity || 0);
          quantity = Math.max(0, quantity - reservedQty);
        }

        return {
          ...item,
          quantity,
          location: {
            ...locationData,
            warehouse: warehouse,
          },
        };
      }),
    );

    return enriched;
  }

  async findSpecificBatch(
    itemId: string,
  ): Promise<InventoryItem[]> {
    return this.prisma.inventoryItem.findMany({
      where: { itemId },
    });
  }

  async searchInventory(
    query: string = '',
    warehouseId?: string,
    locationId?: string,
    filters?: {
      brandIds?: string[];
      categoryIds?: string[];
      silhouetteIds?: string[];
      genderIds?: string[];
    }
  ) {
    const filterWhere: any = {};
    if (filters?.brandIds?.length) filterWhere.brandId = { in: filters.brandIds };
    if (filters?.categoryIds?.length) filterWhere.categoryId = { in: filters.categoryIds };
    if (filters?.silhouetteIds?.length) filterWhere.silhouetteId = { in: filters.silhouetteIds };
    if (filters?.genderIds?.length) filterWhere.genderId = { in: filters.genderIds };

    const items = await this.prisma.item.findMany({
      where: {
        OR: query
          ? [
              { sku: { contains: query, mode: 'insensitive' } },
              { description: { contains: query, mode: 'insensitive' } },
              { barCode: { contains: query, mode: 'insensitive' } },
            ]
          : undefined,
        isActive: true,
        ...filterWhere,
      },
      take: 50,
      select: {
        id: true,
        sku: true,
        barCode: true,
        description: true,
        unitPrice: true,
        taxRate1: true,
        imageUrl: true,
        brand: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        silhouette: { select: { id: true, name: true } },
        gender: { select: { id: true, name: true } },
        color: { select: { id: true, name: true } },
        size: { select: { id: true, name: true } },
        segment: { select: { id: true, name: true } },
      },
    });

    const itemIds = items.map((i) => i.id);

    let stockMap: Map<string, number>;

    if (locationId) {
      // Outlet stock: use InventoryItem directly
      const inventoryItems = await this.prisma.inventoryItem.findMany({
        where: {
          itemId: { in: itemIds },
          locationId,
          status: 'AVAILABLE',
        },
        select: { itemId: true, quantity: true },
      });
      stockMap = new Map(
        inventoryItems.map((inv) => [inv.itemId, Number(inv.quantity)]),
      );
    } else if (warehouseId) {
      // Warehouse stock: use StockLedger minus active reservations
      const stockEntries = await this.prisma.stockLedger.groupBy({
        by: ['itemId'],
        where: {
          itemId: { in: itemIds },
          warehouseId,
          locationId: null,
        },
        _sum: { qty: true },
      });

      const reservations = await this.prisma.stockReserve.groupBy({
        by: ['itemId'],
        where: {
          itemId: { in: itemIds },
          warehouseId,
          OR: [
            { expiresAt: null },
            { expiresAt: { gte: new Date() } }
          ]
        },
        _sum: { quantity: true },
      });

      const resMap = new Map(
        reservations.map((r) => [r.itemId, Number(r._sum.quantity) || 0])
      );

      stockMap = new Map(
        stockEntries.map((a) => {
          const physical = Number(a._sum.qty) || 0;
          const reserved = resMap.get(a.itemId) || 0;
          return [a.itemId, Math.max(0, physical - reserved)];
        }),
      );
    } else {
      // Global search (no warehouse/location filter) — sum all available inventory minus active reservations for warehouse items
      const inventoryItems = await this.prisma.inventoryItem.findMany({
        where: {
          itemId: { in: itemIds },
          status: 'AVAILABLE',
        },
        select: { itemId: true, quantity: true, warehouseId: true, locationId: true },
      });

      const reservations = await this.prisma.stockReserve.findMany({
        where: {
          itemId: { in: itemIds },
          OR: [
            { expiresAt: null },
            { expiresAt: { gte: new Date() } }
          ]
        },
        select: { itemId: true, warehouseId: true, quantity: true },
      });

      const resMap = new Map<string, number>();
      for (const res of reservations) {
        const key = `${res.itemId}_${res.warehouseId}`;
        resMap.set(key, (resMap.get(key) || 0) + Number(res.quantity));
      }

      const globalMap = new Map<string, number>();
      for (const inv of inventoryItems) {
        let qty = Number(inv.quantity);
        if (!inv.locationId) {
          const key = `${inv.itemId}_${inv.warehouseId}`;
          const reserved = resMap.get(key) || 0;
          qty = Math.max(0, qty - reserved);
        }
        globalMap.set(inv.itemId, (globalMap.get(inv.itemId) || 0) + qty);
      }
      stockMap = globalMap;
    }

    const result = items.map((item) => ({
      ...item,
      totalQuantity: stockMap.get(item.id) || 0,
    }));

    return result;
  }

  async getStocksByCenter(centerId: string): Promise<{ items: Array<{ BarCode: string; ExStock: number }> }> {
    if (!centerId) {
      return { items: [] };
    }

    const cleanCenterId = String(centerId).trim();

    const items = await this.prisma.$queryRaw<Array<{ BarCode: string; ExStock: number }>>`
      WITH target_center AS (
        SELECT id AS loc_id, warehouse_id AS wh_id
        FROM "Location"
        WHERE (id = ${cleanCenterId} OR code = ${cleanCenterId} OR short_code = ${cleanCenterId}) AND "isDeleted" = false
        LIMIT 1
      ),
      target_wh AS (
        SELECT id AS wh_id
        FROM "Warehouse"
        WHERE (id = ${cleanCenterId} OR code = ${cleanCenterId}) AND "isDeleted" = false
        LIMIT 1
      ),
      resolved AS (
        SELECT 
          COALESCE((SELECT loc_id FROM target_center), ${cleanCenterId}) AS loc_id,
          COALESCE((SELECT wh_id FROM target_center), (SELECT wh_id FROM target_wh)) AS wh_id
      ),
      inv_agg AS (
        SELECT 
          i."itemId",
          SUM(i.quantity) AS physical_qty
        FROM "InventoryItem" i, resolved r
        WHERE i.status = 'AVAILABLE'
          AND (
            (r.loc_id IS NOT NULL AND i."locationId" = r.loc_id)
            OR (r.loc_id IS NULL AND r.wh_id IS NOT NULL AND i."warehouseId" = r.wh_id AND i."locationId" IS NULL)
          )
        GROUP BY i."itemId"
      ),
      res_agg AS (
        SELECT 
          sr."itemId",
          SUM(sr.quantity) AS reserved_qty
        FROM "StockReserve" sr, resolved r
        WHERE (r.wh_id IS NOT NULL AND sr."warehouseId" = r.wh_id)
          AND (sr."expiresAt" IS NULL OR sr."expiresAt" >= NOW())
        GROUP BY sr."itemId"
      )
      SELECT 
        TRIM(item."barCode") AS "BarCode",
        GREATEST(0, COALESCE(SUM(inv.physical_qty - COALESCE(res.reserved_qty, 0)), 0))::float AS "ExStock"
      FROM "Item" item
      LEFT JOIN inv_agg inv ON (inv."itemId" = item.id OR inv."itemId" = item."itemId")
      LEFT JOIN res_agg res ON (res."itemId" = item.id OR res."itemId" = item."itemId")
      WHERE item."isActive" = true 
        AND item."barCode" IS NOT NULL 
        AND TRIM(item."barCode") != ''
      GROUP BY TRIM(item."barCode")
    `;

    return { items: items || [] };
  }

}

