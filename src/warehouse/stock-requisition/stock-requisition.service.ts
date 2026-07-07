import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '@prisma/client';
import * as xlsx from 'xlsx';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';
import { TransferRequestService } from '../transfer-request.service';

@Injectable()
export class StockRequisitionService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
    private transferRequestService: TransferRequestService,
  ) {}

  /**
   * Get net available stock of an item in a warehouse (physical AVAILABLE stock minus reserved stock).
   */
  async getNetAvailableStock(tx: Prisma.TransactionClient, itemId: string, warehouseId: string): Promise<number> {
    // 1. Get physical AVAILABLE stock
    const stockItem = await tx.inventoryItem.findFirst({
      where: {
        warehouseId,
        locationId: null,
        itemId,
        status: 'AVAILABLE',
      },
    });
    const physicalQty = stockItem ? Number(stockItem.quantity) : 0;

    // 2. Get active reservations
    const reservations = await tx.stockReserve.aggregate({
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
      },
    });
    const reservedQty = reservations._sum.quantity ? Number(reservations._sum.quantity) : 0;

    return Math.max(0, physicalQty - reservedQty);
  }

  /**
   * Create a new Stock Requisition Note (SRN) and reserve the inventory
   */
  async createRequisition(
    data: {
      fromWarehouseId: string;
      toLocationId: string;
      brandId?: string;
      documentType?: string;
      remarks?: string;
      notes?: string;
      financialYear?: string;
      status?: string;
      items: { itemId: string; quantity: number }[];
    },
    userId: string,
  ) {
    if (!data.items || data.items.length === 0) {
      throw new BadRequestException('SRN must contain at least one item');
    }

    const requisitionNo = `SRN-${Date.now()}`;
    const status = data.status || (data.documentType === 'Outlet Request' ? 'DRAFT' : 'PENDING');
    const isDraft = status === 'DRAFT';

    // Perform check and block in a transaction to prevent race conditions
    return this.prisma.$transaction(async (tx) => {
      // 1. Verify stock and block/reserve (skip if DRAFT)
      if (!isDraft) {
        for (const reqItem of data.items) {
          if (reqItem.quantity <= 0) {
            throw new BadRequestException(`Quantity for item ${reqItem.itemId} must be greater than zero`);
          }

          const netAvailable = await this.getNetAvailableStock(tx, reqItem.itemId, data.fromWarehouseId);
          if (netAvailable < reqItem.quantity) {
            const itemDetail = await tx.item.findUnique({ where: { id: reqItem.itemId }, select: { sku: true, description: true } });
            throw new BadRequestException(
              `Insufficient stock for item ${itemDetail?.sku || reqItem.itemId} (${itemDetail?.description || ''}). ` +
              `Available (unreserved): ${netAvailable}, Requested: ${reqItem.quantity}`,
            );
          }
        }
      }

      // 2. Create StockRequisition
      const requisition = await tx.stockRequisition.create({
        data: {
          requisitionNo,
          fromWarehouseId: data.fromWarehouseId,
          toLocationId: data.toLocationId,
          brandId: data.brandId || null,
          documentType: data.documentType || 'New Arrival',
          remarks: data.remarks || null,
          notes: data.notes || null,
          financialYear: data.financialYear || '25-26',
          status,
          createdById: userId,
          items: {
            create: data.items.map((item) => ({
              itemId: item.itemId,
              quantity: new Prisma.Decimal(item.quantity),
            })),
          },
        },
        include: {
          items: {
            include: {
              item: true,
            },
          },
          fromWarehouse: true,
          toLocation: true,
          brand: true,
        },
      });

      // 3. Create StockReserve records to block the stock (skip if DRAFT)
      if (!isDraft) {
        for (const reqItem of data.items) {
          await tx.stockReserve.create({
            data: {
              itemId: reqItem.itemId,
              warehouseId: data.fromWarehouseId,
              quantity: new Prisma.Decimal(reqItem.quantity),
              referenceType: 'STOCK_REQUISITION',
              referenceId: requisition.id,
              notes: `Reserved for SRN ${requisitionNo}`,
              createdById: userId,
            },
          });
        }
      }

      runInBackground(
        'Log SRN Creation',
        this.activityLogs.log({
          userId,
          action: 'create',
          module: 'stock-requisition',
          entity: 'StockRequisition',
          entityId: requisition.id,
          description: `Created Stock Requisition Note ${requisitionNo} and reserved stock`,
          newValues: JSON.stringify(requisition),
          status: 'success',
        }),
      );

      return requisition;
    });
  }

  /**
   * Update an existing Stock Requisition (only if DRAFT)
   */
  async updateRequisition(
    id: string,
    data: {
      fromWarehouseId?: string;
      toLocationId?: string;
      brandId?: string;
      documentType?: string;
      remarks?: string;
      notes?: string;
      financialYear?: string;
      items?: { itemId: string; quantity: number }[];
    },
    userId: string,
  ) {
    const existing = await this.prisma.stockRequisition.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existing) {
      throw new NotFoundException('Stock Requisition not found');
    }

    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only draft requisitions can be edited');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Delete existing items if new items are provided
      if (data.items) {
        await tx.stockRequisitionItem.deleteMany({
          where: { stockRequisitionId: id },
        });
      }

      // 2. Update requisition metadata
      const updated = await tx.stockRequisition.update({
        where: { id },
        data: {
          fromWarehouseId: data.fromWarehouseId ?? existing.fromWarehouseId,
          toLocationId: data.toLocationId ?? existing.toLocationId,
          brandId: data.brandId !== undefined ? (data.brandId === 'none' ? null : data.brandId) : existing.brandId,
          documentType: data.documentType ?? existing.documentType,
          remarks: data.remarks !== undefined ? data.remarks : existing.remarks,
          notes: data.notes !== undefined ? data.notes : existing.notes,
          financialYear: data.financialYear ?? existing.financialYear,
          items: data.items ? {
            create: data.items.map((item) => ({
              itemId: item.itemId,
              quantity: new Prisma.Decimal(item.quantity),
            })),
          } : undefined,
        },
        include: {
          items: {
            include: {
              item: true,
            },
          },
          fromWarehouse: true,
          toLocation: true,
          brand: true,
        },
      });

      runInBackground(
        'Log SRN Update',
        this.activityLogs.log({
          userId,
          action: 'update',
          module: 'stock-requisition',
          entity: 'StockRequisition',
          entityId: id,
          description: `Updated Stock Requisition Note ${existing.requisitionNo}`,
          oldValues: JSON.stringify(existing),
          newValues: JSON.stringify(updated),
          status: 'success',
        }),
      );

      return updated;
    });
  }

  /**
   * Approve a draft Stock Requisition (checks stock and creates reservations)
   */
  async approveRequisition(id: string, userId: string) {
    const existing = await this.prisma.stockRequisition.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existing) {
      throw new NotFoundException('Stock Requisition not found');
    }

    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only draft requisitions can be approved');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Verify stock and block/reserve
      for (const reqItem of existing.items) {
        const qty = Number(reqItem.quantity);
        if (qty <= 0) {
          throw new BadRequestException(`Quantity for item ${reqItem.itemId} must be greater than zero`);
        }

        const netAvailable = await this.getNetAvailableStock(tx, reqItem.itemId, existing.fromWarehouseId);
        if (netAvailable < qty) {
          const itemDetail = await tx.item.findUnique({ where: { id: reqItem.itemId }, select: { sku: true, description: true } });
          throw new BadRequestException(
            `Insufficient stock for item ${itemDetail?.sku || reqItem.itemId} (${itemDetail?.description || ''}). ` +
            `Available (unreserved): ${netAvailable}, Requested: ${qty}`,
          );
        }
      }

      // 2. Update status to PENDING
      const updated = await tx.stockRequisition.update({
        where: { id },
        data: {
          status: 'PENDING',
        },
        include: {
          items: {
            include: {
              item: true,
            },
          },
          fromWarehouse: true,
          toLocation: true,
          brand: true,
        },
      });

      // 3. Create StockReserve records to block the stock
      for (const reqItem of existing.items) {
        await tx.stockReserve.create({
          data: {
            itemId: reqItem.itemId,
            warehouseId: existing.fromWarehouseId,
            quantity: reqItem.quantity,
            referenceType: 'STOCK_REQUISITION',
            referenceId: existing.id,
            notes: `Reserved for SRN ${existing.requisitionNo}`,
            createdById: userId,
          },
        });
      }

      runInBackground(
        'Log SRN Approval',
        this.activityLogs.log({
          userId,
          action: 'approve',
          module: 'stock-requisition',
          entity: 'StockRequisition',
          entityId: id,
          description: `Approved Stock Requisition Note ${existing.requisitionNo} and reserved stock`,
          newValues: JSON.stringify(updated),
          status: 'success',
        }),
      );

      return updated;
    });
  }

  /**
   * Cancel an SRN and release reservations
   */
  async cancelRequisition(id: string, userId: string) {
    const requisition = await this.prisma.stockRequisition.findUnique({
      where: { id },
    });

    if (!requisition) {
      throw new NotFoundException(`Stock Requisition Note not found`);
    }

    if (requisition.status !== 'PENDING' && requisition.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot cancel requisition in '${requisition.status}' status`);
    }

    return this.prisma.$transaction(async (tx) => {
      if (requisition.status === 'PENDING') {
        // 1. Delete reservations
        await tx.stockReserve.deleteMany({
          where: {
            referenceType: 'STOCK_REQUISITION',
            referenceId: id,
          },
        });
      }

      // 2. Update status to CANCELLED
      const updated = await tx.stockRequisition.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });

      runInBackground(
        'Log SRN Cancellation',
        this.activityLogs.log({
          userId,
          action: 'delete',
          module: 'stock-requisition',
          entity: 'StockRequisition',
          entityId: id,
          description: `Cancelled Stock Requisition ${requisition.requisitionNo} and released reserved stock`,
          status: 'success',
        }),
      );

      return updated;
    });
  }

  /**
   * Get list of Stock Requisitions
   */
  async getRequisitions(filters?: {
    warehouseId?: string;
    locationId?: string;
    brandId?: string;
    status?: string;
  }) {
    const whereClause: Prisma.StockRequisitionWhereInput = {};
    if (filters?.warehouseId) whereClause.fromWarehouseId = filters.warehouseId;
    if (filters?.locationId) whereClause.toLocationId = filters.locationId;
    if (filters?.brandId) whereClause.brandId = filters.brandId;
    if (filters?.status) whereClause.status = filters.status;

    return this.prisma.stockRequisition.findMany({
      where: whereClause,
      include: {
        items: {
          include: {
            item: {
              include: {
                color: true,
                size: true,
                category: true,
                gender: true,
                segment: true,
              },
            },
          },
        },
        fromWarehouse: true,
        toLocation: true,
        brand: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Get single Stock Requisition details
   */
  async getRequisitionById(id: string) {
    const requisition = await this.prisma.stockRequisition.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            item: {
              include: {
                color: true,
                size: true,
                category: true,
                gender: true,
                segment: true,
              },
            },
          },
        },
        fromWarehouse: true,
        toLocation: true,
        brand: true,
      },
    });

    if (!requisition) {
      throw new NotFoundException(`Stock Requisition Note not found`);
    }

    return requisition;
  }

  /**
   * Convert SRN to Stock Transfer Out (STN / TransferRequest)
   * Rules: WH can minus quantity but cannot add
   */
  async convertToSTN(
    requisitionId: string,
    data: {
      items: { itemId: string; quantity: number }[];
      notes?: string;
    },
    userId: string,
  ) {
    const requisition = await this.prisma.stockRequisition.findUnique({
      where: { id: requisitionId },
      include: {
        items: true,
      },
    });

    if (!requisition) {
      throw new NotFoundException(`Stock Requisition Note not found`);
    }

    if (requisition.status !== 'PENDING') {
      throw new BadRequestException(`Requisition status is '${requisition.status}'. Only PENDING requisitions can be converted.`);
    }

    // Map requisition items for easy check
    const reqItemMap = new Map<string, number>(
      requisition.items.map((item) => [item.itemId, Number(item.quantity)]),
    );

    // Validate quantities: WH can minus but cannot add
    for (const stnItem of data.items) {
      const origQty = reqItemMap.get(stnItem.itemId) || 0;
      if (stnItem.quantity > origQty) {
        const itemInfo = await this.prisma.item.findUnique({ where: { id: stnItem.itemId }, select: { sku: true } });
        throw new BadRequestException(
          `Cannot increase quantity for item ${itemInfo?.sku || stnItem.itemId}. Original SRN quantity: ${origQty}, requested STN: ${stnItem.quantity}`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Delete the reservations for this SRN so that the stock becomes available for the transfer request check
      await tx.stockReserve.deleteMany({
        where: {
          referenceType: 'STOCK_REQUISITION',
          referenceId: requisitionId,
        },
      });

      // 2. Validate physical stock availability for final quantities
      for (const stnItem of data.items) {
        if (stnItem.quantity <= 0) continue; // Skip item if quantity reduced to 0

        const stock = await tx.inventoryItem.findFirst({
          where: {
            warehouseId: requisition.fromWarehouseId,
            locationId: null,
            itemId: stnItem.itemId,
            status: 'AVAILABLE',
          },
        });
        const physicalQty = stock ? Number(stock.quantity) : 0;
        if (physicalQty < stnItem.quantity) {
          const itemDetail = await tx.item.findUnique({ where: { id: stnItem.itemId }, select: { sku: true } });
          throw new BadRequestException(
            `Insufficient physical stock in warehouse for ${itemDetail?.sku || stnItem.itemId}. Available: ${physicalQty}, requested STN: ${stnItem.quantity}`,
          );
        }
      }

      // 3. Create the TransferRequest (STN)
      const requestNo = `TR-${Date.now()}`;
      const transfer = await tx.transferRequest.create({
        data: {
          requestNo,
          fromWarehouseId: requisition.fromWarehouseId,
          toLocationId: requisition.toLocationId,
          transferType: 'WAREHOUSE_TO_OUTLET',
          status: 'PENDING', // PENDING means waiting for outlet to receive
          createdById: userId,
          stockRequisitionId: requisitionId,
          notes: data.notes || `Generated from SRN ${requisition.requisitionNo}`,
          items: {
            create: data.items
              .filter((item) => item.quantity > 0)
              .map((item) => ({
                itemId: item.itemId,
                quantity: new Prisma.Decimal(item.quantity),
              })),
          },
        },
        include: {
          items: true,
        },
      });

      // 4. Update the fulfilled quantities and status in the Stock Requisition
      for (const stnItem of data.items) {
        await tx.stockRequisitionItem.update({
          where: {
            stockRequisitionId_itemId: {
              stockRequisitionId: requisitionId,
              itemId: stnItem.itemId,
            },
          },
          data: {
            fulfilledQty: new Prisma.Decimal(stnItem.quantity),
          },
        });
      }

      // Mark SRN status
      const hasAnyQty = data.items.some((i) => i.quantity > 0);
      const srnStatus = hasAnyQty ? 'COMPLETED' : 'CANCELLED';

      await tx.stockRequisition.update({
        where: { id: requisitionId },
        data: { status: srnStatus },
      });

      runInBackground(
        'Log STN Conversion',
        this.activityLogs.log({
          userId,
          action: 'update',
          module: 'stock-requisition',
          entity: 'StockRequisition',
          entityId: requisitionId,
          description: `Converted SRN ${requisition.requisitionNo} to Transfer Request ${transfer.requestNo}. Status updated to ${srnStatus}`,
          status: 'success',
        }),
      );

      return transfer;
    });
  }

  /**
   * Parse manually consolidated Excel sheet to list of valid items and quantities.
   * Matches by SKU or Barcode.
   */
  async parseExcelSheet(buffer: Buffer): Promise<any[]> {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    // Convert to 2D array
    const rows = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1 });

    if (rows.length === 0) {
      throw new BadRequestException('Excel file is empty');
    }

    const itemsList: { sku: string; quantity: number }[] = [];

    // Let's find header index or assume standard structure:
    // Column I (index 8) is Requisition Quantity.
    // Let's find which column contains the SKU or barcode.
    let skuColIndex = 0; // Default to column A
    let qtyColIndex = 8; // Default to Column I (index 8)

    // Try to auto-detect header row
    let headerRowIndex = -1;
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const row = rows[r];
      if (!Array.isArray(row)) continue;
      const skuIdx = row.findIndex((cell) => {
        const val = String(cell).toLowerCase().trim();
        return val === 'sku' || val === 'item code' || val === 'item_code' || val === 'barcode' || val === 'item id';
      });
      const qtyIdx = row.findIndex((cell) => {
        const val = String(cell).toLowerCase().trim();
        return val === 'quantity' || val === 'qty' || val === 'requisition qty' || val === 'req qty' || val === 'column i' || val === 'quantity (column i)';
      });

      if (skuIdx !== -1) {
        skuColIndex = skuIdx;
        headerRowIndex = r;
      }
      if (qtyIdx !== -1) {
        qtyColIndex = qtyIdx;
      }
    }

    const startRow = headerRowIndex !== -1 ? headerRowIndex + 1 : 1;

    for (let i = startRow; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const skuRaw = row[skuColIndex];
      const qtyRaw = row[qtyColIndex];

      if (!skuRaw) continue;

      const sku = String(skuRaw).trim();
      const qty = Number(qtyRaw);

      if (sku && !isNaN(qty) && qty > 0) {
        itemsList.push({ sku, quantity: qty });
      }
    }

    if (itemsList.length === 0) {
      throw new BadRequestException('No valid items with requisition quantity (Column I) found in the Excel sheet.');
    }

    // Resolve SKUs to Database Items
    const resolvedItems: any[] = [];
    for (const entry of itemsList) {
      const dbItem = await this.prisma.item.findFirst({
        where: {
          OR: [
            { sku: entry.sku },
            { barCode: entry.sku },
            { itemId: entry.sku }
          ],
          isActive: true,
        },
        include: {
          color: true,
          size: true,
          category: true,
          gender: true,
          segment: true,
        },
      });

      if (dbItem) {
        resolvedItems.push({
          itemId: dbItem.id,
          sku: dbItem.sku,
          description: dbItem.description,
          color: dbItem.color?.name || null,
          size: dbItem.size?.name || null,
          category: dbItem.category ? { id: dbItem.category.id, name: dbItem.category.name } : null,
          gender: dbItem.gender ? { id: dbItem.gender.id, name: dbItem.gender.name } : null,
          segment: dbItem.segment ? { id: dbItem.segment.id, name: dbItem.segment.name } : null,
          unitPrice: dbItem.unitPrice,
          quantity: entry.quantity,
        });
      }
    }

    return resolvedItems;
  }

  /**
   * Get replenishment candidates based on POS net sales summary and warehouse stock availability
   */
  async getReplenishmentCandidates(query: {
    locationId: string;
    fromWarehouseId: string;
    startDate?: string;
    endDate?: string;
  }) {
    const { locationId, fromWarehouseId, startDate: startStr, endDate: endStr } = query;

    if (!locationId || !fromWarehouseId) {
      throw new BadRequestException('locationId and fromWarehouseId are required');
    }

    const now = new Date();
    
    // Helper to parse dates robustly in local timezone if plain date strings are passed
    const parseLocalDate = (dateStr: string | undefined, isEndOfDay = false): Date => {
      if (!dateStr) {
        if (isEndOfDay) {
          const d = new Date(now);
          d.setHours(23, 59, 59, 999);
          return d;
        } else {
          return new Date(now.getFullYear(), now.getMonth(), 1);
        }
      }
      
      // If it has a time indicator, parse it as-is (e.g. ISO string)
      if (dateStr.includes('T') || dateStr.includes('Z')) {
        const d = new Date(dateStr);
        if (isEndOfDay && !dateStr.includes('T23:59:59')) {
          d.setHours(23, 59, 59, 999);
        }
        return d;
      }
      
      // Plain date string like YYYY-MM-DD
      const timePart = isEndOfDay ? 'T23:59:59.999' : 'T00:00:00.000';
      return new Date(`${dateStr}${timePart}`);
    };

    const startDate = parseLocalDate(startStr, false);
    const endDate = parseLocalDate(endStr, true);

    console.log('getReplenishmentCandidates params:', {
      locationId,
      fromWarehouseId,
      startStr,
      endStr,
      parsedStartDate: startDate.toISOString(),
      parsedEndDate: endDate.toISOString(),
    });

    // 1. Group sold items at the POS location by itemId
    const salesItems = await this.prisma.salesOrderItem.groupBy({
      by: ['itemId'],
      where: {
        salesOrder: {
          locationId,
          status: { in: ['completed', 'partially_returned', 'exchanged'] },
          createdAt: { gte: startDate, lte: endDate },
        },
      },
      _sum: {
        quantity: true,
      },
    });

    if (salesItems.length === 0) {
      return [];
    }

    const itemIds = salesItems.map((si) => si.itemId);

    // 2. Fetch master items
    const items = await this.prisma.item.findMany({
      where: { id: { in: itemIds } },
      include: {
        color: true,
        size: true,
        category: true,
        gender: true,
        segment: true,
      },
    });

    // 3. Fetch physical available stock in warehouse
    const stockItems = await this.prisma.inventoryItem.findMany({
      where: {
        warehouseId: fromWarehouseId,
        locationId: null,
        itemId: { in: itemIds },
        status: 'AVAILABLE',
      },
      select: {
        itemId: true,
        quantity: true,
      },
    });

    // 4. Fetch active reservations in warehouse
    const reservations = await this.prisma.stockReserve.groupBy({
      by: ['itemId'],
      where: {
        itemId: { in: itemIds },
        warehouseId: fromWarehouseId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gte: new Date() } }
        ]
      },
      _sum: {
        quantity: true,
      },
    });

    // Map stocks and reservations
    const physicalStockMap = new Map<string, number>();
    for (const stock of stockItems) {
      physicalStockMap.set(stock.itemId, (physicalStockMap.get(stock.itemId) || 0) + Number(stock.quantity));
    }

    const reservedStockMap = new Map<string, number>();
    for (const res of reservations) {
      reservedStockMap.set(res.itemId, Number(res._sum.quantity || 0));
    }

    // 5. Combine and calculate replenishment qty
    const candidates = items.map((item) => {
      const salesEntry = salesItems.find((si) => si.itemId === item.id);
      const soldQty = salesEntry ? Number(salesEntry._sum.quantity || 0) : 0;

      const physicalQty = physicalStockMap.get(item.id) || 0;
      const reservedQty = reservedStockMap.get(item.id) || 0;
      const netAvailable = Math.max(0, physicalQty - reservedQty);

      const replenishQty = Math.min(soldQty, netAvailable);

      return {
        itemId: item.id,
        sku: item.sku,
        description: item.description || '',
        color: item.color?.name || null,
        size: item.size?.name || null,
        category: item.category ? { id: item.category.id, name: item.category.name } : null,
        gender: item.gender ? { id: item.gender.id, name: item.gender.name } : null,
        segment: item.segment ? { id: item.segment.id, name: item.segment.name } : null,
        unitPrice: Number(item.unitPrice || 0),
        soldQty,
        warehouseAvailableQty: netAvailable,
        quantity: replenishQty, // Suggest this qty
      };
    });

    return candidates;
  }
}

