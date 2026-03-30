import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePurchaseRequisitionDto } from './dto/create-purchase-requisition.dto';
import { UpdatePurchaseRequisitionDto } from './dto/update-purchase-requisition.dto';

@Injectable()
export class PurchaseRequisitionService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: CreatePurchaseRequisitionDto) {
    const prNumber = `PR-${Date.now()}`;

    return this.prisma.purchaseRequisition.create({
      data: {
        prNumber,
        department: createDto.department,
        type: createDto.type || 'local',
        goodsType: createDto.goodsType || 'CONSUMABLE', // Default to CONSUMABLE
        requestDate: createDto.requestDate || new Date(),
        notes: createDto.notes,
        status: 'SUBMITTED',
        items: {
          create: createDto.items.map((item) => ({
            itemId: item.itemId,
            requiredQty: item.requiredQty,
          })),
        },
      },
      include: { items: { include: { item: true } } },
    });
  }

  async findAll(status?: string) {
    return this.prisma.purchaseRequisition.findMany({
      where: status && status !== 'ALL' ? { status } : {},
      include: { items: { include: { item: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const pr = await this.prisma.purchaseRequisition.findUnique({
      where: { id },
      include: { items: { include: { item: true } } },
    });
    if (!pr) throw new NotFoundException(`Purchase Requisition not found`);
    return pr;
  }

  async update(id: string, updateDto: UpdatePurchaseRequisitionDto) {
    const pr = await this.findOne(id);

    if (pr.status !== 'DRAFT' && !updateDto.status) {
      throw new BadRequestException('Only DRAFT requisitions can be edited');
    }

    if (
      updateDto.status &&
      (updateDto.status === 'APPROVED' || updateDto.status === 'REJECTED')
    ) {
      if (pr.status !== 'SUBMITTED') {
        throw new BadRequestException(
          'Only SUBMITTED requisitions can be approved or rejected',
        );
      }
    }

    const { items, ...data } = updateDto;

    if (items) {
      if (pr.status !== 'DRAFT')
        throw new BadRequestException(
          'Cannot modify items unless in DRAFT status',
        );

      return this.prisma.$transaction(async (tx) => {
        await tx.purchaseRequisitionItem.deleteMany({
          where: { purchaseRequisitionId: id },
        });
        return tx.purchaseRequisition.update({
          where: { id },
          data: {
            ...data,
            items: {
              create: items.map((item) => ({
                itemId: item.itemId,
                requiredQty: item.requiredQty,
              })),
            },
          },
          include: { items: true },
        });
      });
    }

    return this.prisma.purchaseRequisition.update({
      where: { id },
      data: data,
      include: { items: true },
    });
  }

  async remove(id: string) {
    const pr = await this.findOne(id);
    if (pr.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT requisitions can be deleted');
    }
    return this.prisma.purchaseRequisition.delete({ where: { id } });
  }
}
