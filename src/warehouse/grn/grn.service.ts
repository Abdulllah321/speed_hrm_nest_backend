import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateGrnDto } from './dto/grn.dto';
import { MovementType, Prisma } from '@prisma/client';
import { StockLedgerService } from '../stock-ledger/stock-ledger.service';

@Injectable()
export class GrnService {
  constructor(
    private prisma: PrismaService,
    private stockLedgerService: StockLedgerService,
  ) { }

  async findAll() {
    return this.prisma.goodsReceiptNote.findMany({
      include: {
        items: true,
        purchaseOrder: {
          select: { poNumber: true, vendorId: true, items: true },
        },
        warehouse: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const grn = await this.prisma.goodsReceiptNote.findUnique({
      where: { id },
      include: {
        items: true,
        purchaseOrder: true,
        warehouse: true,
      },
    });

    if (!grn) {
      throw new NotFoundException('GRN not found');
    }

    return grn;
  }

  async create(dto: CreateGrnDto) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: dto.purchaseOrderId },
      include: { items: true, vendorQuotation: true },
    });

    if (!po) {
      throw new NotFoundException('Purchase Order not found');
    }

    if (
      po.status === 'CLOSED' ||
      po.status === 'CANCELLED' ||
      po.status === 'DRAFT'
    ) {
      throw new BadRequestException(
        `Cannot receive goods for PO in ${po.status} status`,
      );
    }

    const grnNumber = `GRN-${Date.now()}`;
    const isProcurementLinkedFlow = Boolean(
      (po as any).vendorQuotationId ||
      (po as any).rfqId ||
      (po as any).purchaseRequisitionId,
    );

    return this.prisma.$transaction(async (tx) => {
      // Fetch Item ID mapping
      // GRN Item uses itemId as the string ID (e.g. "2121"), but StockLedger needs the internal UUID of the Item
      // We need to find the Item UUID based on the itemId string provided in dto.items

      // 1. Create GRN
      const grn = await tx.goodsReceiptNote.create({
        data: {
          grnNumber,
          purchaseOrderId: dto.purchaseOrderId,
          warehouseId: dto.warehouseId,
          status: isProcurementLinkedFlow ? 'VALUED' : 'RECEIVED_UNVALUED',
          notes: dto.notes,
          items: {
            create: dto.items.map((item) => ({
              itemId: item.itemId,
              description: item.description,
              receivedQty: new Prisma.Decimal(item.receivedQty),
            })),
          },
        },
        include: { items: true },
      });

      // 2. Process each item
      for (const grnItem of dto.items) {
        const poItem = po.items.find((i) => i.itemId === grnItem.itemId);
        if (!poItem) {
          throw new BadRequestException(
            `Item ${grnItem.itemId} not found in PO`,
          );
        }

        // Resolve internal Item UUID from itemId (e.g. "2121")
        const itemRecord = await tx.item.findUnique({
          where: { itemId: grnItem.itemId },
          select: { id: true },
        });

        if (!itemRecord) {
          throw new BadRequestException(
            `Item with ID ${grnItem.itemId} not found in database master`,
          );
        }

        const remainingQty = new Prisma.Decimal(poItem.quantity).minus(
          new Prisma.Decimal(poItem.receivedQty),
        );
        if (new Prisma.Decimal(grnItem.receivedQty).gt(remainingQty)) {
          throw new BadRequestException(
            `Received quantity exceeds remaining quantity for item ${grnItem.itemId}. Remaining: ${remainingQty}`,
          );
        }

        // 3. Update PO Item receivedQty
        await tx.purchaseOrderItem.update({
          where: { id: poItem.id },
          data: {
            receivedQty: { increment: new Prisma.Decimal(grnItem.receivedQty) },
          },
        });

        // 4. Create stock ledger entry immediately for RFQ/VQ/PR-linked PO
        if (isProcurementLinkedFlow) {
          await this.stockLedgerService.createEntry(
            {
              itemId: itemRecord.id,
              warehouseId: dto.warehouseId,
              qty: new Prisma.Decimal(grnItem.receivedQty),
              movementType: MovementType.INBOUND,
              referenceType: 'GRN',
              referenceId: grn.id,
              rate: poItem.unitPrice ? new Prisma.Decimal(poItem.unitPrice) : undefined,
            },
            tx,
          );

          // 5. Update InventoryItem (warehouse stock)
          const existingStock = await tx.inventoryItem.findFirst({
            where: {
              warehouseId: dto.warehouseId,
              locationId: null, // Warehouse stock
              itemId: itemRecord.id,
              status: 'AVAILABLE',
            },
          });

          if (existingStock) {
            // Update existing warehouse stock
            await tx.inventoryItem.update({
              where: { id: existingStock.id },
              data: { 
                quantity: { increment: new Prisma.Decimal(grnItem.receivedQty) }
              },
            });
          } else {
            // Create new warehouse stock entry
            await tx.inventoryItem.create({
              data: {
                warehouseId: dto.warehouseId,
                locationId: null, // NULL = warehouse stock
                itemId: itemRecord.id,
                quantity: new Prisma.Decimal(grnItem.receivedQty),
                status: 'AVAILABLE',
              },
            });
          }
        }
      }

      // 5. Update PO Status
      const updatedPo = await tx.purchaseOrder.findUnique({
        where: { id: dto.purchaseOrderId },
        include: { items: true },
      });

      if (!updatedPo) {
        throw new BadRequestException('Failed to update Purchase Order status');
      }

      const allReceived = updatedPo.items.every((item) =>
        new Prisma.Decimal(item.receivedQty).gte(
          new Prisma.Decimal(item.quantity),
        ),
      );

      await tx.purchaseOrder.update({
        where: { id: dto.purchaseOrderId },
        data: {
          status: allReceived ? 'CLOSED' : 'PARTIALLY_RECEIVED',
        },
      });

      return grn;
    });
  }
}
