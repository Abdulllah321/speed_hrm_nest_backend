import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StockLedgerService } from '../stock-ledger/stock-ledger.service';
import { PostLandedCostDtoWithRates } from './dto/landed-cost.dto';
import { Prisma, MovementType } from '@prisma/client';
import { CreateChargeTypeDto } from './dto/charge-type.dto';

@Injectable()
export class LandedCostService {
  constructor(
    private prisma: PrismaService,
    private stockLedgerService: StockLedgerService,
  ) {}

  private async resolveInventoryAccountId(): Promise<string | null> {
    const stockInTrade = await this.prisma.chartOfAccount.findFirst({
      where: { name: { contains: 'STOCK IN TRADE', mode: 'insensitive' } },
    });
    if (stockInTrade) return stockInTrade.id;

    const stockWarehouse = await this.prisma.chartOfAccount.findFirst({
      where: { name: { contains: 'STOCK - WAREHOUSE', mode: 'insensitive' } },
    });
    if (stockWarehouse) return stockWarehouse.id;

    const genericAsset = await this.prisma.chartOfAccount.findFirst({
      where: { type: 'ASSET', isGroup: false },
      orderBy: { code: 'asc' },
    });
    return genericAsset?.id ?? null;
  }

  async post(dto: PostLandedCostDtoWithRates) {
    const grn = await this.prisma.goodsReceiptNote.findUnique({
      where: { id: dto.grnId },
      include: { items: true, warehouse: true },
    });
    if (!grn) throw new NotFoundException('GRN not found');
    if (grn.status === 'VALUED') {
      throw new BadRequestException('GRN already valued');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1) Create inbound stock ledger entries for each GRN item
      for (const item of grn.items) {
        const itemRecord = await tx.item.findUnique({
          where: { itemId: item.itemId },
          select: { id: true },
        });
        if (!itemRecord) {
          throw new BadRequestException(
            `Item with ID ${item.itemId} not found in database master`,
          );
        }

        await this.stockLedgerService.createEntry(
          {
            itemId: itemRecord.id,
            warehouseId: grn.warehouseId,
            qty: new Prisma.Decimal(item.receivedQty),
            movementType: MovementType.INBOUND,
            referenceType: 'LANDED_COST',
            referenceId: grn.id,
          },
          tx,
        );
      }

      // Journal Voucher creation removed per requirement

      // Mark GRN as VALUED
      const updated = await tx.goodsReceiptNote.update({
        where: { id: grn.id },
        data: { status: 'VALUED' },
        include: { items: true },
      });

      return {
        status: true,
        grnId: updated.id,
        grnStatus: updated.status,
        journalVoucherId: null,
        stockEntriesCreated: updated.items.length,
      };
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
