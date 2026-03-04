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
          gdDate: dto.gdDate ? new Date(dto.gdDate) : null,
          season: dto.season,
          category: dto.category,
          shippingInvoiceNo: dto.shippingInvoiceNo,
          currency: dto.currency,
          exchangeRate: dto.exchangeRate,
          status: 'SUBMITTED',
          items: {
            create: dto.items.map((item) => ({
              itemId: item.itemId,
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
              otherChargesPKR: (item as any).otherChargesPKR || 0,
              unitCostPKR: item.unitCostPKR,
              totalCostPKR: item.totalCostPKR,
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
}
