import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePurchaseRequisitionDto } from './dto/create-purchase-requisition.dto';
import { UpdatePurchaseRequisitionDto } from './dto/update-purchase-requisition.dto';

import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';
@Injectable()
export class PurchaseRequisitionService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async create(createDto: CreatePurchaseRequisitionDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const prNumber = `PR-${Date.now()}`;

      const pr = await this.prisma.purchaseRequisition.create({
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

      runInBackground(
        'Create Purchase Requisition',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'purchase-requisition',
          entity: 'PurchaseRequisition',
          entityId: pr.id,
          description: `Created purchase requisition ${pr.prNumber}`,
          newValues: JSON.stringify(createDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return pr;
    } catch (error: any) {
      runInBackground(
        'Create Purchase Requisition (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'purchase-requisition',
          entity: 'PurchaseRequisition',
          description: `Failed to create purchase requisition`,
          errorMessage: error?.message,
          newValues: JSON.stringify(createDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
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

  async update(id: string, updateDto: UpdatePurchaseRequisitionDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
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

      let updatedPr;
      if (items) {
        if (pr.status !== 'DRAFT')
          throw new BadRequestException(
            'Cannot modify items unless in DRAFT status',
          );

        updatedPr = await this.prisma.$transaction(async (tx) => {
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
      } else {
        updatedPr = await this.prisma.purchaseRequisition.update({
          where: { id },
          data: data,
          include: { items: true },
        });
      }

      runInBackground(
        'Update Purchase Requisition',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'purchase-requisition',
          entity: 'PurchaseRequisition',
          entityId: id,
          description: `Updated purchase requisition ${pr.prNumber}`,
          oldValues: JSON.stringify(pr),
          newValues: JSON.stringify(updateDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return updatedPr;
    } catch (error: any) {
      runInBackground(
        'Update Purchase Requisition (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'purchase-requisition',
          entity: 'PurchaseRequisition',
          entityId: id,
          description: `Failed to update purchase requisition`,
          errorMessage: error?.message,
          newValues: JSON.stringify(updateDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async remove(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const pr = await this.findOne(id);
      if (pr.status !== 'DRAFT') {
        throw new BadRequestException('Only DRAFT requisitions can be deleted');
      }
      const deleted = await this.prisma.purchaseRequisition.delete({ where: { id } });

      runInBackground(
        'Delete Purchase Requisition',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'purchase-requisition',
          entity: 'PurchaseRequisition',
          entityId: id,
          description: `Deleted purchase requisition ${pr.prNumber}`,
          oldValues: JSON.stringify(pr),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return deleted;
    } catch (error: any) {
      runInBackground(
        'Delete Purchase Requisition (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'purchase-requisition',
          entity: 'PurchaseRequisition',
          entityId: id,
          description: `Failed to delete purchase requisition`,
          errorMessage: error?.message,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }
}
