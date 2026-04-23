import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateGrnDto } from './dto/grn.dto';
import { MovementType, Prisma } from '@prisma/client';
import { StockLedgerService } from '../stock-ledger/stock-ledger.service';

@Injectable()
export class GrnService {
  private readonly logger = new Logger(GrnService.name);

  constructor(
    private prisma: PrismaService,
    private stockLedgerService: StockLedgerService,
  ) { }

  private async calculateAndApplyWeightedAverage(
    tx: Prisma.TransactionClient,
    itemId: string,
    warehouseId: string,
    incomingQty: Prisma.Decimal,
    incomingRate: Prisma.Decimal,
  ): Promise<Prisma.Decimal> {
    const currentStock = await tx.inventoryItem.aggregate({
      where: {
        itemId,
        warehouseId,
        locationId: null,
        status: 'AVAILABLE',
      },
      _sum: {
        quantity: true,
      },
    });

    const oldQty = currentStock._sum.quantity || new Prisma.Decimal(0);
    const item = await tx.item.findUnique({
      where: { id: itemId },
      select: { unitCost: true },
    });
    const oldAvg = new Prisma.Decimal(item?.unitCost || 0);

    const totalQty = oldQty.plus(incomingQty);
    const weightedAvg = totalQty.gt(0)
      ? oldQty.mul(oldAvg).plus(incomingQty.mul(incomingRate)).div(totalQty)
      : incomingRate;

    await tx.item.update({
      where: { id: itemId },
      data: { unitCost: weightedAvg.toNumber() },
    });

    await tx.tenantItemSetting.upsert({
      where: { itemId },
      create: {
        itemId,
        averageCost: weightedAvg,
      },
      update: {
        averageCost: weightedAvg,
      },
    });

    return weightedAvg;
  }

  async findAll() {
    return this.prisma.goodsReceiptNote.findMany({
      include: {
        items: {
          include: {
            item: {
              include: {
                hsCode: true,
                category: { select: { name: true } },
              },
            },
          },
        },
        purchaseOrder: {
          select: {
            poNumber: true,
            vendorId: true,
            purchaseRequisitionId: true,
            vendorQuotationId: true,
            rfqId: true,
            goodsType: true,
            orderType: true,
            items: true,
            vendor: {
              select: { id: true, name: true, code: true },
            },
            purchaseRequisition: {
              select: { goodsType: true },
            },
          },
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
        items: {
          include: {
            item: true,
          },
        },
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
    this.logger.log(`Starting GRN creation for PO: ${dto.purchaseOrderId}`);
    this.logger.debug(`GRN DTO: ${JSON.stringify(dto)}`);

    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: dto.purchaseOrderId },
      include: {
        items: true,
        vendorQuotation: true,
        purchaseRequisition: true // Include PR to check goods type
      },
    });

    if (!po) {
      this.logger.error(`Purchase Order not found: ${dto.purchaseOrderId}`);
      throw new NotFoundException('Purchase Order not found');
    }

    this.logger.log(`Found PO: ${po.poNumber}, Status: ${po.status}`);

    if (
      po.status === 'CLOSED' ||
      po.status === 'CANCELLED' ||
      po.status === 'DRAFT'
    ) {
      this.logger.error(`Cannot receive goods for PO in ${po.status} status`);
      throw new BadRequestException(
        `Cannot receive goods for PO in ${po.status} status`,
      );
    }

    const grnNumber = `GRN-${Date.now()}`;
    this.logger.log(`Generated GRN Number: ${grnNumber}`);

    // Determine flow type and goods type
    const isRfqVqFlow = Boolean(po.vendorQuotationId || po.rfqId);
    const isPrDirectFlow = Boolean(po.purchaseRequisitionId && !po.vendorQuotationId && !po.rfqId);
    const isDirectPoFlow = Boolean(!po.purchaseRequisitionId && !po.vendorQuotationId && !po.rfqId);

    this.logger.log(`Flow Analysis - RFQ/VQ: ${isRfqVqFlow}, PR Direct: ${isPrDirectFlow}, Direct PO: ${isDirectPoFlow}`);

    let shouldUpdateInventory = false;
    let grnStatus = 'RECEIVED_UNVALUED';

    if (isDirectPoFlow) {
      // Direct PO flow: Always goes through Landed Cost (current logic)
      shouldUpdateInventory = false;
      grnStatus = 'RECEIVED_UNVALUED';
      this.logger.log(`Direct PO Flow - shouldUpdateInventory: ${shouldUpdateInventory}, status: ${grnStatus}`);
    } else if (isRfqVqFlow || isPrDirectFlow) {
      // PR-linked flows: Check goods type
      // For RFQ→VQ→PO flow, purchaseRequisitionId is null on PO but goodsType is
      // copied from PR during PO creation (createFromQuotation / awardFromRfq).
      // Always prefer po.goodsType first, fall back to po.purchaseRequisition?.goodsType.
      const prGoodsType = po.goodsType || po.purchaseRequisition?.goodsType;
      const isConsumable = prGoodsType === 'CONSUMABLE' || !prGoodsType; // Default to consumable

      this.logger.log(`Resolved Goods Type: ${prGoodsType} (po.goodsType=${po.goodsType}, pr.goodsType=${po.purchaseRequisition?.goodsType}), isConsumable: ${isConsumable}`);

      if (isConsumable) {
        // CONSUMABLE: Update inventory at GRN
        shouldUpdateInventory = true;
        grnStatus = 'VALUED';
      } else {
        // FRESH: Wait for Landed Cost
        shouldUpdateInventory = false;
        grnStatus = 'RECEIVED_UNVALUED';
      }
      this.logger.log(`PR Flow - shouldUpdateInventory: ${shouldUpdateInventory}, status: ${grnStatus}`);
    }

    this.logger.log(`Starting database transaction for GRN creation`);

    return this.prisma.$transaction(async (tx) => {
      try {
        // 0. Resolve items to UUIDs
        const resolvedItems = await Promise.all(
          dto.items.map(async (item) => {
            const itemRecord = await tx.item.findFirst({
              where: {
                OR: [{ id: item.itemId }, { itemId: item.itemId }],
              },
              select: { id: true },
            });

            if (!itemRecord) {
              throw new BadRequestException(
                `Item with ID or code ${item.itemId} not found in database master`,
              );
            }

            return {
              ...item,
              itemId: itemRecord.id, // Use the proper UUID
            };
          }),
        );

        this.logger.log(`Creating GRN record in database`);

        // 1. Create GRN
        const grn = await tx.goodsReceiptNote.create({
          data: {
            grnNumber,
            purchaseOrderId: dto.purchaseOrderId,
            warehouseId: dto.warehouseId,
            status: grnStatus,
            notes: dto.notes,
            orderType: po.orderType || null,
            goodsType: po.goodsType || po.purchaseRequisition?.goodsType || null,
            items: {
              create: resolvedItems.map((item) => ({
                itemId: item.itemId,
                description: item.description,
                receivedQty: new Prisma.Decimal(item.receivedQty),
              })),
            },
          },
          include: { items: true },
        });

        this.logger.log(`GRN created successfully with ID: ${grn.id}`);

        // 2. Process each item
        this.logger.log(`Processing ${resolvedItems.length} items`);
        for (const grnItem of resolvedItems) {
          this.logger.debug(`Processing item: ${grnItem.itemId}, qty: ${grnItem.receivedQty}`);
          
          const poItem = po.items.find((i) => i.itemId === grnItem.itemId || i.id === grnItem.itemId);
          if (!poItem) {
            this.logger.error(`Item ${grnItem.itemId} not found in PO`);
            throw new BadRequestException(
              `Item ${grnItem.itemId} not found in PO`,
            );
          }

          // Use the itemId which is already resolved to a UUID
          const itemRecord = { id: grnItem.itemId };

          const remainingQty = new Prisma.Decimal(poItem.quantity).minus(
            new Prisma.Decimal(poItem.receivedQty),
          );
          
          this.logger.debug(`Item ${grnItem.itemId} - Ordered: ${poItem.quantity}, Received: ${poItem.receivedQty}, Remaining: ${remainingQty}, Current GRN: ${grnItem.receivedQty}`);
          
          if (new Prisma.Decimal(grnItem.receivedQty).gt(remainingQty)) {
            this.logger.error(`Received quantity exceeds remaining quantity for item ${grnItem.itemId}. Remaining: ${remainingQty}`);
            throw new BadRequestException(
              `Received quantity exceeds remaining quantity for item ${grnItem.itemId}. Remaining: ${remainingQty}`,
            );
          }

          // 3. Update PO Item receivedQty
          this.logger.debug(`Updating PO item receivedQty for item: ${grnItem.itemId}`);
          await tx.purchaseOrderItem.update({
            where: { id: poItem.id },
            data: {
              receivedQty: { increment: new Prisma.Decimal(grnItem.receivedQty) },
            },
          });

          // 4. Create stock ledger entry only if shouldUpdateInventory is true
          if (shouldUpdateInventory) {
            const incomingRate = poItem.unitPrice
              ? new Prisma.Decimal(poItem.unitPrice)
              : new Prisma.Decimal(0);
            const weightedAvgRate = await this.calculateAndApplyWeightedAverage(
              tx,
              itemRecord.id,
              dto.warehouseId,
              new Prisma.Decimal(grnItem.receivedQty),
              incomingRate,
            );

            this.logger.debug(`Creating stock ledger entry for item: ${grnItem.itemId}`);
            await this.stockLedgerService.createEntry(
              {
                itemId: itemRecord.id,
                warehouseId: dto.warehouseId,
                qty: new Prisma.Decimal(grnItem.receivedQty),
                movementType: MovementType.INBOUND,
                referenceType: 'GRN',
                referenceId: grn.id,
                rate: weightedAvgRate,
              },
              tx,
            );

            // 5. Update InventoryItem (warehouse stock) only if shouldUpdateInventory is true
            this.logger.debug(`Updating inventory for item: ${grnItem.itemId}`);
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
              this.logger.debug(`Updating existing stock for item: ${grnItem.itemId}`);
              await tx.inventoryItem.update({
                where: { id: existingStock.id },
                data: {
                  quantity: { increment: new Prisma.Decimal(grnItem.receivedQty) }
                },
              });
            } else {
              // Create new warehouse stock entry
              this.logger.debug(`Creating new stock entry for item: ${grnItem.itemId}`);
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
          } else {
            this.logger.debug(`Skipping inventory update for item: ${grnItem.itemId} (shouldUpdateInventory: false)`);
          }
          // For FINISH GOODS or Direct PO, inventory will be updated later via Landed Cost
        }

        // 6. Update PO Status
        this.logger.log(`Updating PO status`);
        const updatedPo = await tx.purchaseOrder.findUnique({
          where: { id: dto.purchaseOrderId },
          include: { items: true },
        });

        if (!updatedPo) {
          this.logger.error('Failed to update Purchase Order status');
          throw new BadRequestException('Failed to update Purchase Order status');
        }

        const allReceived = updatedPo.items.every((item) =>
          new Prisma.Decimal(item.receivedQty).gte(
            new Prisma.Decimal(item.quantity),
          ),
        );

        this.logger.log(`All items received: ${allReceived}`);

        // Determine PO status based on flow and goods type
        let poStatus = 'PARTIALLY_RECEIVED';
        if (allReceived) {
          if (shouldUpdateInventory) {
            // CONSUMABLE goods or flows that update inventory immediately
            poStatus = 'CLOSED';
          } else {
            // FINISH GOODS or Direct PO - wait for Landed Cost
            poStatus = 'RECEIVED';
          }
        }

        this.logger.log(`Updating PO status to: ${poStatus}`);
        await tx.purchaseOrder.update({
          where: { id: dto.purchaseOrderId },
          data: {
            status: poStatus,
          },
        });

        this.logger.log(`GRN creation completed successfully. GRN ID: ${grn.id}, Number: ${grn.grnNumber}`);
        return grn;
        
      } catch (error) {
        this.logger.error(`Error in GRN transaction: ${error.message}`, error.stack);
        throw error;
      }
    });
  }
}
