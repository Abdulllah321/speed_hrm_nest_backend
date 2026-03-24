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
      // 1) Create Landed Cost Header
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
            create: dto.items.map((item) => ({
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
              unitCostPKR: item.unitCostPKR,
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

      // 2) Update Stock Ledger for each item with the new Landed Cost
      for (const item of dto.items) {
        const itemRecord = await tx.item.findUnique({
          where: { itemId: item.itemId },
          select: { id: true },
        });
        if (!itemRecord) {
          throw new BadRequestException(`Item with code ${item.itemId} not found`);
        }

        await this.stockLedgerService.createEntry(
          {
            itemId: itemRecord.id,
            warehouseId: grn.warehouseId,
            qty: new Prisma.Decimal(item.qty),
            movementType: MovementType.INBOUND,
            referenceType: 'LANDED_COST',
            referenceId: landedCost.id,
            rate: new Prisma.Decimal(item.unitCostPKR),
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

  async createLocal(dto: any) {
    const grn = await this.prisma.goodsReceiptNote.findUnique({
      where: { id: dto.grnId },
      include: { 
        items: true, 
        purchaseOrder: {
          include: {
            purchaseRequisition: true
          }
        }
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
    const isDirectPo = !po?.purchaseRequisitionId && !po?.vendorQuotationId && !po?.rfqId;
    
    if (!isDirectPo && !isFresh) {
      throw new BadRequestException('This GRN does not require landed cost processing.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Update stock ledger for fresh goods or direct PO
      for (const item of dto.items) {
        const itemRecord = await tx.item.findUnique({
          where: { itemId: item.itemId },
          select: { id: true },
        });
        if (!itemRecord) {
          throw new BadRequestException(`Item with code ${item.itemId} not found`);
        }

        await this.stockLedgerService.createEntry(
          {
            itemId: itemRecord.id,
            warehouseId: grn.warehouseId,
            qty: new Prisma.Decimal(item.qty),
            movementType: MovementType.INBOUND,
            referenceType: 'LANDED_COST',
            referenceId: grn.id,
            rate: new Prisma.Decimal(item.unitPrice),
          },
          tx,
        );

        // Update InventoryItem (warehouse stock)
        const existingStock = await tx.inventoryItem.findFirst({
          where: {
            warehouseId: grn.warehouseId,
            locationId: null,
            itemId: itemRecord.id,
            status: 'AVAILABLE',
          },
        });

        if (existingStock) {
          await tx.inventoryItem.update({
            where: { id: existingStock.id },
            data: { 
              quantity: { increment: new Prisma.Decimal(item.qty) }
            },
          });
        } else {
          await tx.inventoryItem.create({
            data: {
              warehouseId: grn.warehouseId,
              locationId: null,
              itemId: itemRecord.id,
              quantity: new Prisma.Decimal(item.qty),
              status: 'AVAILABLE',
            },
          });
        }
      }

      // Mark GRN as VALUED
      await tx.goodsReceiptNote.update({
        where: { id: grn.id },
        data: { status: 'VALUED' },
      });

      // Update PO status to CLOSED
      if (grn.purchaseOrder) {
        await tx.purchaseOrder.update({
          where: { id: grn.purchaseOrder.id },
          data: { status: 'CLOSED' },
        });
      }

      return { success: true, grnStatus: 'VALUED' };
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
        const itemRecord = await tx.item.findUnique({
          where: { itemId: grnItem.itemId },
          select: { id: true },
        });
        if (!itemRecord) continue;

        await this.stockLedgerService.createEntry(
          {
            itemId: itemRecord.id,
            warehouseId: grn.warehouseId,
            qty: grnItem.receivedQty,
            movementType: MovementType.INBOUND,
            referenceType: 'LANDED_COST',
            referenceId: grn.id,
            rate: new Prisma.Decimal(0), // Will be updated with actual cost
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
