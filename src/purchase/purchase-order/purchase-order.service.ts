import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreatePurchaseOrderDto,
  AwardFromRfqDto,
  CreateMultiDirectPurchaseOrderDto,
} from './dto/purchase-order.dto';
import { Decimal } from '@prisma/client/runtime/client';

import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';
@Injectable()
export class PurchaseOrderService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async findAll() {
    return this.prisma.purchaseOrder.findMany({
      include: {
        vendor: true,
        vendorQuotation: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findPendingQuotations() {
    // Find all quotations that are SELECTED but don't have a Purchase Order yet
    const quotations = await this.prisma.vendorQuotation.findMany({
      where: {
        status: 'SELECTED',
        purchaseOrders: {
          none: {},
        },
      },
      include: {
        vendor: true,
        rfq: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return quotations;
  }

  async findOne(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        items: { include: { item: true } },
        vendor: true,
        vendorQuotation: {
          include: {
            rfq: {
              include: {
                purchaseRequisition: true,
              },
            },
          },
        },
      },
    });

    if (!po) {
      throw new NotFoundException('Purchase Order not found');
    }

    return po;
  }

  async create(createDto: CreatePurchaseOrderDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    if (createDto.vendorQuotationId) {
      return this.createFromQuotation(createDto, ctx);
    }
    return this.createDirect(createDto, ctx);
  }

  private async createDirect(createDto: CreatePurchaseOrderDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      if (
        !createDto.vendorId ||
        !createDto.items ||
        createDto.items.length === 0
      ) {
        throw new BadRequestException(
          'Vendor and items are required for direct Purchase Order',
        );
      }

      const poNumber = `PO-${Date.now()}`;

      let subtotal = new Decimal(0);

      const itemsData = createDto.items.map((item) => {
        const qty = new Decimal(item.quantity);
        const price = new Decimal(item.unitPrice);

        const lineTotal = qty.mul(price);
        subtotal = subtotal.add(lineTotal);

        return {
          itemId: item.itemId,
          description: item.description,
          quantity: qty,
          unitPrice: price,
          taxPercent: new Decimal(0),
          discountPercent: new Decimal(0),
          lineTotal: lineTotal,
        };
      });

      const totalAmount = subtotal;

      const createdPo = await this.prisma.$transaction(async (tx) => {
        let finalOrderType = createDto.orderType;
        let finalGoodsType = createDto.goodsType;

        if ((!finalOrderType || !finalGoodsType) && createDto.purchaseRequisitionId) {
          const pr = await tx.purchaseRequisition.findUnique({
            where: { id: createDto.purchaseRequisitionId },
          });
          if (pr) {
            if (!finalOrderType) finalOrderType = pr.type?.toUpperCase();
            if (!finalGoodsType) finalGoodsType = pr.goodsType?.toUpperCase();
          }
        }

        return tx.purchaseOrder.create({
          data: {
            poNumber,
            vendorId: createDto.vendorId!,
            purchaseRequisitionId: createDto.purchaseRequisitionId || null,
            notes: createDto.notes,
            expectedDeliveryDate: createDto.expectedDeliveryDate
              ? new Date(createDto.expectedDeliveryDate)
              : null,
            orderType: finalOrderType || null,
            goodsType: finalGoodsType || null,
            status: 'OPEN',
            subtotal,
            taxAmount: new Decimal(0),
            discountAmount: new Decimal(0),
            totalAmount,
            items: {
              create: itemsData,
            },
          },
          include: {
            items: true,
            vendor: true,
          },
        });
      });

      runInBackground(
        'Create Direct Purchase Order',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'purchase-order',
          entity: 'PurchaseOrder',
          entityId: createdPo.id,
          description: `Created direct purchase order ${createdPo.poNumber}`,
          newValues: JSON.stringify(createDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return createdPo;
    } catch (error: any) {
      runInBackground(
        'Create Direct Purchase Order (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'purchase-order',
          entity: 'PurchaseOrder',
          description: 'Failed to create direct purchase order',
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

  private async createFromQuotation(createDto: CreatePurchaseOrderDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const quotation = await this.prisma.vendorQuotation.findUnique({
        where: { id: createDto.vendorQuotationId },
        include: {
          items: true,
          vendor: true,
          rfq: {
            include: {
              purchaseRequisition: true,
            },
          },
        },
      });

      if (!quotation) {
        throw new NotFoundException('Vendor Quotation not found');
      }

      if (quotation.status !== 'SELECTED') {
        throw new BadRequestException(
          'Purchase Order can only be created from a SELECTED quotation',
        );
      }

      if (quotation.expiryDate && quotation.expiryDate <= new Date()) {
        throw new BadRequestException(
          'Cannot create Purchase Order: quotation has expired',
        );
      }

      // Check if PO already exists for this quotation
      const existingPo = await this.prisma.purchaseOrder.findFirst({
        where: { vendorQuotationId: quotation.id },
      });

      if (existingPo) {
        throw new BadRequestException(
          'Purchase Order already exists for this quotation',
        );
      }

      const poNumber = `PO-${Date.now()}`; // Simple PO number generation

      const po = await this.prisma.$transaction(async (tx) => {
        return tx.purchaseOrder.create({
          data: {
            poNumber,
            vendorQuotationId: quotation.id,
            vendorId: quotation.vendorId,
            rfqId: quotation.rfqId,
            notes: createDto.notes,
            expectedDeliveryDate: createDto.expectedDeliveryDate
              ? new Date(createDto.expectedDeliveryDate)
              : null,
            orderType: createDto.orderType || quotation.rfq?.purchaseRequisition?.type?.toUpperCase() || null,
            goodsType: createDto.goodsType || quotation.rfq?.purchaseRequisition?.goodsType || null,
            status: 'OPEN',
            subtotal: quotation.subtotal,
            taxAmount: quotation.taxAmount,
            discountAmount: quotation.discountAmount,
            totalAmount: quotation.totalAmount,
            items: {
              create: quotation.items.map((item) => ({
                itemId: item.itemId,
                description: item.description,
                quantity: item.quotedQty,
                unitPrice: item.unitPrice,
                taxPercent: item.taxPercent,
                discountPercent: item.discountPercent,
                lineTotal: item.lineTotal,
              })),
            },
          },
          include: {
            items: true,
            vendor: true,
          },
        });
      });

      runInBackground(
        'Create Purchase Order from Quotation',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'purchase-order',
          entity: 'PurchaseOrder',
          entityId: po.id,
          description: `Created purchase order ${po.poNumber} from RFQ ${quotation.rfq.rfqNumber}`,
          newValues: JSON.stringify(createDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return po;
    } catch (error: any) {
      runInBackground(
        'Create Purchase Order from Quotation (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'purchase-order',
          entity: 'PurchaseOrder',
          description: 'Failed to create purchase order from quotation',
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

  async updateStatus(id: string, status: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const updated = await this.prisma.purchaseOrder.update({
        where: { id },
        data: { status },
      });

      runInBackground(
        'Update Purchase Order Status',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'purchase-order',
          entity: 'PurchaseOrder',
          entityId: id,
          description: `Updated purchase order status to ${status} for ${updated.poNumber}`,
          newValues: JSON.stringify({ status }),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return updated;
    } catch (error: any) {
      runInBackground(
        'Update Purchase Order Status (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'purchase-order',
          entity: 'PurchaseOrder',
          entityId: id,
          description: `Failed to update purchase order status to ${status}`,
          errorMessage: error?.message,
          newValues: JSON.stringify({ status }),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async awardFromRfq(dto: AwardFromRfqDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const rfq = await this.prisma.requestForQuotation.findUnique({
        where: { id: dto.rfqId },
        include: {
          purchaseRequisition: {
            include: { items: true },
          },
        },
      });

      if (!rfq) {
        throw new NotFoundException('RFQ not found');
      }

      const prItemsMap = new Map<string, Decimal>();
      for (const item of rfq.purchaseRequisition?.items || []) {
        const qty = new Decimal(item.requiredQty as any);
        prItemsMap.set(item.itemId, qty);
      }

      const awardedTotals = new Map<string, Decimal>();
      for (const group of dto.awards) {
        for (const ai of group.items) {
          const prev = awardedTotals.get(ai.itemId) || new Decimal(0);
          awardedTotals.set(ai.itemId, prev.add(new Decimal(ai.quantity)));
        }
      }

      for (const [itemId, total] of awardedTotals) {
        const prQty = prItemsMap.get(itemId);
        if (prQty && total.gt(prQty)) {
          throw new BadRequestException(
            'Awarded quantity exceeds PR required quantity',
          );
        }
      }

      const created = await this.prisma.$transaction(async (tx) => {
        const results: any[] = [];

        for (const group of dto.awards) {
          const quotation = await tx.vendorQuotation.findUnique({
            where: { id: group.vendorQuotationId },
            include: {
              items: true,
              vendor: true,
              rfq: true,
            },
          });

          if (!quotation) {
            throw new NotFoundException('Vendor Quotation not found');
          }
          if (quotation.rfqId !== dto.rfqId) {
            throw new BadRequestException('Quotation does not belong to RFQ');
          }

          let subtotal = new Decimal(0);
          let taxAmount = new Decimal(0);
          let discountAmount = new Decimal(0);

          const itemsData = group.items.map((ai) => {
            const qi = quotation.items.find((q) => q.itemId === ai.itemId);
            if (!qi) {
              throw new BadRequestException('Item not found in quotation');
            }
            const qty = new Decimal(ai.quantity);
            const price = new Decimal(qi.unitPrice);
            const tax = new Decimal(qi.taxPercent || 0);
            const discount = new Decimal(qi.discountPercent || 0);

            const baseLine = qty.mul(price);
            const lineTax = baseLine.mul(tax).div(100);
            const lineDiscount = baseLine.mul(discount).div(100);
            const lineTotal = baseLine.add(lineTax).sub(lineDiscount);

            subtotal = subtotal.add(baseLine);
            taxAmount = taxAmount.add(lineTax);
            discountAmount = discountAmount.add(lineDiscount);

            return {
              itemId: qi.itemId,
              description: qi.description,
              quantity: qty,
              unitPrice: price,
              taxPercent: tax,
              discountPercent: discount,
              lineTotal: lineTotal,
            };
          });

          const totalAmount = subtotal.add(taxAmount).sub(discountAmount);
          const poNumber = `PO-${Date.now()}`;

          const po = await tx.purchaseOrder.create({
            data: {
              poNumber,
              vendorQuotationId: quotation.id,
              vendorId: quotation.vendorId,
              rfqId: quotation.rfqId,
              notes: group.notes,
              expectedDeliveryDate: group.expectedDeliveryDate
                ? new Date(group.expectedDeliveryDate)
                : null,
              orderType: group.orderType || rfq.purchaseRequisition?.type?.toUpperCase() || null,
              goodsType: group.goodsType || rfq.purchaseRequisition?.goodsType || null,
              status: 'OPEN',
              subtotal,
              taxAmount,
              discountAmount,
              totalAmount,
              items: {
                create: itemsData,
              },
            },
            include: {
              items: true,
              vendor: true,
            },
          });

          results.push(po);
        }

        return results;
      });

      runInBackground(
        'Award from RFQ',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'purchase-order',
          entity: 'PurchaseOrder',
          description: `Awarded ${created.length} purchase orders from RFQ ${rfq.rfqNumber}`,
          newValues: JSON.stringify(dto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return created;
    } catch (error: any) {
      runInBackground(
        'Award from RFQ (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'purchase-order',
          entity: 'PurchaseOrder',
          description: 'Failed to award purchase orders from RFQ',
          errorMessage: error?.message,
          newValues: JSON.stringify(dto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async createMultiDirect(dto: CreateMultiDirectPurchaseOrderDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      if (!dto.awards || dto.awards.length === 0) {
        throw new BadRequestException('No vendor groups provided');
      }

      const created = await this.prisma.$transaction(async (tx) => {
        const results: any[] = [];

        for (const group of dto.awards) {
          if (!group.vendorId || !group.items || group.items.length === 0) {
            throw new BadRequestException(
              'Each group must include vendorId and items',
            );
          }

          let subtotal = new Decimal(0);

          const itemsData = group.items.map((item) => {
            const qty = new Decimal(item.quantity);
            const price = new Decimal(item.unitPrice);

            const lineTotal = qty.mul(price);
            subtotal = subtotal.add(lineTotal);

            return {
              itemId: item.itemId,
              description: item.description,
              quantity: qty,
              unitPrice: price,
              taxPercent: new Decimal(0),
              discountPercent: new Decimal(0),
              lineTotal,
            };
          });

          const totalAmount = subtotal;
          const poNumber = `PO-${Date.now()}`;

          const po = await tx.purchaseOrder.create({
            data: {
              poNumber,
              vendorId: group.vendorId,
              notes: group.notes,
              expectedDeliveryDate: group.expectedDeliveryDate
                ? new Date(group.expectedDeliveryDate)
                : null,
              orderType: group.orderType || null,
              goodsType: group.goodsType || null,
              status: 'OPEN',
              subtotal,
              taxAmount: new Decimal(0),
              discountAmount: new Decimal(0),
              totalAmount,
              items: { create: itemsData },
            },
            include: {
              items: true,
              vendor: true,
            },
          });

          results.push(po);
        }

        return results;
      });

      runInBackground(
        'Create Multi Direct Purchase Orders',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'purchase-order',
          entity: 'PurchaseOrder',
          description: `Created ${created.length} multi-direct purchase orders`,
          newValues: JSON.stringify(dto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return created;
    } catch (error: any) {
      runInBackground(
        'Create Multi Direct Purchase Orders (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'purchase-order',
          entity: 'PurchaseOrder',
          description: 'Failed to create multi-direct purchase orders',
          errorMessage: error?.message,
          newValues: JSON.stringify(dto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }
}
