import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StockLedgerService } from '../stock-ledger/stock-ledger.service';
import { CreateLandedCostDto } from './dto/landed-cost.dto';
import { Prisma, MovementType } from '@prisma/client';
import { CreateChargeTypeDto } from './dto/charge-type.dto';

@Injectable()
export class LandedCostService {
  constructor(
    private prisma: PrismaService,
    private stockLedgerService: StockLedgerService,
  ) { }

  private resolveInboundUnitRate(data: {
    qty: number | Prisma.Decimal;
    unitCostPKR?: number | Prisma.Decimal | null;
    totalCostPKR?: number | Prisma.Decimal | null;
    unitPrice?: number | Prisma.Decimal | null;
  }): Prisma.Decimal {
    const qty = new Prisma.Decimal(data.qty || 0);
    const unitCostPKR = new Prisma.Decimal(data.unitCostPKR || 0);
    const totalCostPKR = new Prisma.Decimal(data.totalCostPKR || 0);
    const unitPrice = new Prisma.Decimal(data.unitPrice || 0);

    // Primary source for landed-cost inbound is always total/qty.
    if (qty.gt(0) && totalCostPKR.gt(0)) {
      return totalCostPKR.div(qty);
    }

    if (unitCostPKR.gt(0)) {
      return unitCostPKR;
    }

    if (unitPrice.gt(0)) {
      return unitPrice;
    }

    return new Prisma.Decimal(0);
  }

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

  async create(dto: CreateLandedCostDto) {
    const grn = await this.prisma.goodsReceiptNote.findUnique({
      where: { id: dto.grnId },
      include: { items: true },
    });
    if (!grn) throw new NotFoundException('GRN not found');
    if (grn.status === 'VALUED') {
      throw new BadRequestException('GRN already valued');
    }

    // Generate Landed Cost Number
    const count = await this.prisma.landedCost.count();
    const landedCostNumber = `LC-${(count + 1).toString().padStart(6, '0')}`;

    return this.prisma.$transaction(async (tx) => {
      // 1) Prepare and resolve items to UUIDs
      const resolvedItems = await Promise.all(
        dto.items.map(async (item) => {
          const itemRecord = await tx.item.findFirst({
            where: {
              OR: [{ id: item.itemId }, { itemId: item.itemId }],
            },
            select: { id: true },
          });

          if (!itemRecord) {
            throw new BadRequestException(`Item with ID or code ${item.itemId} not found`);
          }

          return {
            ...item,
            itemId: itemRecord.id, // Ensure we use the UUID
            normalizedUnitCostPKR: this.resolveInboundUnitRate({
              qty: item.qty,
              unitCostPKR: item.unitCostPKR,
              totalCostPKR: item.totalCostPKR,
              unitPrice: item.unitPrice,
            }),
          };
        }),
      );

      // 2) Create Landed Cost Header
      const landedCost = await tx.landedCost.create({
        data: {
          landedCostNumber,
          date: new Date(),
          grnId: dto.grnId,
          purchaseOrderId: dto.purchaseOrderId,
          supplierId: dto.supplierId,
          lcNo: dto.lcNo,
          blNo: dto.blNo,
          blDate: dto.blDate ? new Date(dto.blDate) : null,
          countryOfOrigin: dto.countryOfOrigin,
          gdNo: dto.gdNo,
          season: dto.season,
          category: dto.category,
          shippingInvoiceNo: dto.shippingInvoiceNo,
          currency: dto.currency,
          exchangeRate: dto.exchangeRate,
          status: 'SUBMITTED',
          items: {
            create: resolvedItems.map((item) => ({
              itemId: item.itemId,
              sku: item.sku,
              description: item.description,
              hsCode: item.hsCode,
              qty: item.qty,
              unitFob: item.unitFob,
              invoiceForeign: item.qty * item.unitFob,
              freightForeign: item.freightForeign,
              exchangeRate: dto.exchangeRate,
              invoicePKR: item.qty * item.unitFob * dto.exchangeRate,
              insuranceCharges: item.insuranceCharges,
              landingCharges: item.landingCharges,
              assessableValue: item.assessableValue,
              customsDutyRate: (item as any).customsDutyRate || 0,
              customsDutyAmount: (item as any).customsDutyAmount || 0,
              regulatoryDutyRate: (item as any).regulatoryDutyRate || 0,
              regulatoryDutyAmount: (item as any).regulatoryDutyAmount || 0,
              additionalCustomsDutyRate: (item as any).additionalCustomsDutyRate || 0,
              additionalCustomsDutyAmount: (item as any).additionalCustomsDutyAmount || 0,
              salesTaxRate: (item as any).salesTaxRate || 0,
              salesTaxAmount: (item as any).salesTaxAmount || 0,
              additionalSalesTaxRate: (item as any).additionalSalesTaxRate || 0,
              additionalSalesTaxAmount: (item as any).additionalSalesTaxAmount || 0,
              incomeTaxRate: (item as any).incomeTaxRate || 0,
              incomeTaxAmount: (item as any).incomeTaxAmount || 0,
              exciseChargesAmount: (item as any).exciseChargesAmount || 0,
              unitCostPKR: item.normalizedUnitCostPKR,
              totalCostPKR: item.totalCostPKR,
              // MIS Proportional Breakdown
              misFreightUSD: item.misFreightUSD || 0,
              misFreightPKR: item.misFreightPKR || 0,
              misDoThcPKR: item.misDoThcPKR || 0,
              misBankPKR: item.misBankPKR || 0,
              misInsurancePKR: item.misInsurancePKR || 0,
              misClgFwdPKR: item.misClgFwdPKR || 0,
              totalOtherCharges:
                (item.misFreightPKR || 0) +
                (item.misDoThcPKR || 0) +
                (item.misBankPKR || 0) +
                (item.misInsurancePKR || 0) +
                (item.misClgFwdPKR || 0),
              // MIS Metadata Snapshot
              misFreightInvNo: item.misFreightInvNo,
              misFreightDate: item.misFreightDate,
              misDoThcPoNo: item.misDoThcPoNo,
              misDoThcDate: item.misDoThcDate,
              misInsurancePolicyNo: item.misInsurancePolicyNo,
              misClgFwdBillNo: item.misClgFwdBillNo,
            })),
          },
        },
        include: { items: true },
      });

      // Calculate totals for header update (optional but good for denormalization)
      let totalQuantity = 0;
      let totalInvoiceForeign = 0;
      let totalInvoicePKR = 0;
      let totalLandedCost = 0;

      for (const item of dto.items) {
        totalQuantity += item.qty;
        totalInvoiceForeign += item.qty * item.unitFob;
        totalInvoicePKR += item.qty * item.unitFob * dto.exchangeRate;
        totalLandedCost += item.totalCostPKR;
      }

      await tx.landedCost.update({
        where: { id: landedCost.id },
        data: {
          totalQuantity,
          totalInvoiceForeign,
          totalInvoicePKR,
          totalLandedCost,
          // MIS Totals Snapshot (Header)
          freightUSD: dto.freightUSD || 0,
          freightExRate: dto.freightExRate || 1,
          freightPKR: dto.freightPKR || 0,
          freightInvNo: dto.freightInvNo,
          freightDate: dto.freightDate,
          doThcCharges: dto.doThcCharges || 0,
          doThcPoNo: dto.doThcPoNo,
          doThcDate: dto.doThcDate,
          bankCharges: dto.bankCharges || 0,
          insuranceChargesH: dto.insuranceChargesH || 0,
          insurancePolicyNo: dto.insurancePolicyNo,
          clgFwdCharges: dto.clgFwdCharges || 0,
          clgFwdBillNo: dto.clgFwdBillNo,
        },
      });

      // 3) Update Stock Ledger for each item with the new Landed Cost
      for (const item of resolvedItems) {
        // The itemId is already resolved to a valid UUID in Step 1
        const itemRecord = { id: item.itemId };
        const weightedAvgRate = await this.calculateAndApplyWeightedAverage(
          tx,
          itemRecord.id,
          grn.warehouseId,
          new Prisma.Decimal(item.qty),
          item.normalizedUnitCostPKR,
        );

        await this.stockLedgerService.createEntry(
          {
            itemId: itemRecord.id,
            warehouseId: grn.warehouseId,
            qty: new Prisma.Decimal(item.qty),
            movementType: MovementType.INBOUND,
            referenceType: 'LANDED_COST',
            referenceId: landedCost.id,
            rate: weightedAvgRate,
          },
          tx,
        );

        // Update InventoryItem (warehouse stock)
        const existingStock = await tx.inventoryItem.findFirst({
          where: {
            warehouseId: grn.warehouseId,
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
              quantity: { increment: new Prisma.Decimal(item.qty) }
            },
          });
        } else {
          // Create new warehouse stock entry
          await tx.inventoryItem.create({
            data: {
              warehouseId: grn.warehouseId,
              locationId: null, // NULL = warehouse stock
              itemId: itemRecord.id,
              quantity: new Prisma.Decimal(item.qty),
              status: 'AVAILABLE',
            },
          });
        }
      }

      // 3) Mark GRN as VALUED
      await tx.goodsReceiptNote.update({
        where: { id: grn.id },
        data: { status: 'VALUED' },
      });

      return landedCost;
    });
  }

  async list() {
    return this.prisma.landedCost.findMany({
      include: {
        grn: true,
        supplier: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(id: string) {
    const landedCost = await this.prisma.landedCost.findUnique({
      where: { id },
      include: {
        grn: {
          include: {
            items: true,
            purchaseOrder: {
              include: {
                items: true,
              },
            },
          },
        },
        supplier: true,
        items: true,
      },
    });

    if (!landedCost) {
      throw new NotFoundException(`Landed Cost record with ID ${id} not found`);
    }

    return landedCost;
  }

  async listChargeTypes() {
    const items = await this.prisma.landedCostChargeType.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      include: {
        account: { select: { id: true, name: true, code: true, type: true } },
      },
    });
    return { status: true, data: items };
  }

  async createChargeType(dto: CreateChargeTypeDto) {
    const exists = await this.prisma.landedCostChargeType.findUnique({
      where: { name: dto.name },
    });
    if (exists) {
      throw new BadRequestException('Charge type name must be unique');
    }
    const account = await this.prisma.chartOfAccount.findUnique({
      where: { id: dto.accountId },
      select: { id: true, isGroup: true },
    });
    if (!account || account.isGroup) {
      throw new BadRequestException('Invalid account selected');
    }
    const created = await this.prisma.landedCostChargeType.create({
      data: {
        name: dto.name,
        accountId: dto.accountId,
      },
    });
    return { status: true, data: created };
  }

  async createLocal(dto: CreateLandedCostDto) {
    const grn = await this.prisma.goodsReceiptNote.findUnique({
      where: { id: dto.grnId },
      include: {
        items: true,
        purchaseOrder: {
          include: {
            purchaseRequisition: true,
          },
        },
      },
    });
    if (!grn) throw new NotFoundException('GRN not found');
    if (grn.status === 'VALUED') {
      throw new BadRequestException('GRN already valued');
    }

    // Check if this needs landed cost
    const po = grn.purchaseOrder;
    const goodsType = po?.goodsType || po?.purchaseRequisition?.goodsType;
    const isFresh = goodsType === 'FRESH';
    const isDirectPo =
      !po?.purchaseRequisitionId && !po?.vendorQuotationId && !po?.rfqId;

    if (!isDirectPo && !isFresh) {
      throw new BadRequestException(
        'This GRN does not require landed cost processing.',
      );
    }

    // Generate Landed Cost Number
    const count = await this.prisma.landedCost.count();
    const landedCostNumber = `LC-${(count + 1).toString().padStart(6, '0')}`;

    return this.prisma.$transaction(async (tx) => {
      // 1) Resolve items to UUIDs and prepare for creation
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
              `Item with ID or code ${item.itemId} not found`,
            );
          }

          const normalizedRate = this.resolveInboundUnitRate({
            qty: item.qty,
            unitPrice: item.unitPrice || item.unitFob,
            unitCostPKR: item.unitCostPKR,
            totalCostPKR: item.totalCostPKR,
          });

          return {
            ...item,
            itemId: itemRecord.id,
            normalizedRate,
          };
        }),
      );

      // 2) Create Landed Cost Header
      const landedCost = await tx.landedCost.create({
        data: {
          landedCostNumber,
          date: new Date(),
          grnId: dto.grnId,
          purchaseOrderId: po?.id,
          supplierId: dto.supplierId,
          lcNo: dto.lcNo,
          blNo: dto.blNo,
          blDate: dto.blDate ? new Date(dto.blDate) : null,
          countryOfOrigin: dto.countryOfOrigin,
          gdNo: dto.gdNo,
          season: dto.season,
          category: dto.category,
          shippingInvoiceNo: dto.shippingInvoiceNo,
          currency: dto.currency || 'PKR',
          exchangeRate: dto.exchangeRate || 1,
          status: 'VALUED',
          items: {
            create: resolvedItems.map((item) => ({
              itemId: item.itemId,
              sku: item.sku,
              description: item.description,
              hsCode: item.hsCode,
              qty: item.qty,
              unitFob: item.unitFob,
              invoiceForeign: item.qty * item.unitFob,
              freightForeign: item.freightForeign || 0,
              exchangeRate: dto.exchangeRate || 1,
              invoicePKR: item.qty * item.unitFob * (dto.exchangeRate || 1),
              insuranceCharges: item.insuranceCharges || 0,
              landingCharges: item.landingCharges || 0,
              assessableValue: item.assessableValue || item.qty * item.unitFob,
              unitCostPKR: item.normalizedRate,
              totalCostPKR: item.totalCostPKR || item.qty * item.normalizedRate.toNumber(),
              // Populate taxes if provided (though usually 0 for local)
              customsDutyRate: item.customsDutyRate || 0,
              customsDutyAmount: item.customsDutyAmount || 0,
              regulatoryDutyRate: item.regulatoryDutyRate || 0,
              regulatoryDutyAmount: item.regulatoryDutyAmount || 0,
              salesTaxRate: item.salesTaxRate || 0,
              salesTaxAmount: item.salesTaxAmount || 0,
              incomeTaxRate: item.incomeTaxRate || 0,
              incomeTaxAmount: item.incomeTaxAmount || 0,
            })),
          },
        },
      });

      // Update calculations for header
      let totalQuantity = 0;
      let totalInvoiceForeign = 0;
      let totalLandedCost = 0;

      for (const item of resolvedItems) {
        totalQuantity += item.qty;
        totalInvoiceForeign += item.qty * item.unitFob;
        totalLandedCost += item.totalCostPKR || (item.qty * item.normalizedRate.toNumber());
      }

      await tx.landedCost.update({
        where: { id: landedCost.id },
        data: {
          totalQuantity,
          totalInvoiceForeign,
          totalInvoicePKR: totalInvoiceForeign * (dto.exchangeRate || 1),
          totalLandedCost,
        },
      });

      // 3) Update stock ledger and inventory
      for (const item of resolvedItems) {
        const weightedAvgRate = await this.calculateAndApplyWeightedAverage(
          tx,
          item.itemId,
          grn.warehouseId,
          new Prisma.Decimal(item.qty),
          item.normalizedRate,
        );

        await this.stockLedgerService.createEntry(
          {
            itemId: item.itemId,
            warehouseId: grn.warehouseId,
            qty: new Prisma.Decimal(item.qty),
            movementType: MovementType.INBOUND,
            referenceType: 'LANDED_COST',
            referenceId: landedCost.id, // Use LandedCost ID
            rate: weightedAvgRate,
          },
          tx,
        );

        // Update InventoryItem
        const existingStock = await tx.inventoryItem.findFirst({
          where: {
            warehouseId: grn.warehouseId,
            locationId: null,
            itemId: item.itemId,
            status: 'AVAILABLE',
          },
        });

        if (existingStock) {
          await tx.inventoryItem.update({
            where: { id: existingStock.id },
            data: {
              quantity: { increment: new Prisma.Decimal(item.qty) },
            },
          });
        } else {
          await tx.inventoryItem.create({
            data: {
              warehouseId: grn.warehouseId,
              locationId: null,
              itemId: item.itemId,
              quantity: new Prisma.Decimal(item.qty),
              status: 'AVAILABLE',
            },
          });
        }
      }

      // 4) Mark GRN as VALUED
      await tx.goodsReceiptNote.update({
        where: { id: grn.id },
        data: { status: 'VALUED' },
      });

      // 5) Update PO status to CLOSED
      if (po) {
        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: 'CLOSED' },
        });
      }

      return landedCost;
    });
  }

  async post(dto: { grnId: string; charges: { accountId: string; amount: number }[] }) {
    const grn = await this.prisma.goodsReceiptNote.findUnique({
      where: { id: dto.grnId },
      include: { items: true },
    });
    if (!grn) throw new NotFoundException('GRN not found');
    if (grn.status === 'VALUED') {
      throw new BadRequestException('GRN already valued');
    }

    return this.prisma.$transaction(async (tx) => {
      // Simple posting logic - just mark GRN as valued and create stock entries
      for (const grnItem of grn.items) {
        const itemRecord = await tx.item.findFirst({
          where: {
            OR: [{ id: grnItem.itemId }, { itemId: grnItem.itemId }],
          },
          select: { id: true },
        });
        if (!itemRecord) continue;
        const weightedAvgRate = await this.calculateAndApplyWeightedAverage(
          tx,
          itemRecord.id,
          grn.warehouseId,
          grnItem.receivedQty,
          new Prisma.Decimal(0),
        );

        await this.stockLedgerService.createEntry(
          {
            itemId: itemRecord.id,
            warehouseId: grn.warehouseId,
            qty: grnItem.receivedQty,
            movementType: MovementType.INBOUND,
            referenceType: 'LANDED_COST',
            referenceId: grn.id,
            rate: weightedAvgRate,
          },
          tx,
        );
      }

      await tx.goodsReceiptNote.update({
        where: { id: grn.id },
        data: { status: 'VALUED' },
      });

      return { success: true, grnStatus: 'VALUED' };
    });
  }
}
