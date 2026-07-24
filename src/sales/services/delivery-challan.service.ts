import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MovementType } from '@prisma/client';
import { StockLedgerService } from '../../warehouse/stock-ledger/stock-ledger.service';
import { CreateDeliveryChallanDto } from '../dto/delivery-challan.dto';

import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';
@Injectable()
export class DeliveryChallanService {
  constructor(
    private prisma: PrismaService,
    private stockLedgerService: StockLedgerService,
    private activityLogs: ActivityLogsService,
  ) {}

  async create(createData: CreateDeliveryChallanDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const { salesOrderId, driverName, vehicleNo, transportMode, items } = createData;

      const result = await this.prisma.$transaction(async (tx) => {
        // Get sales order details
        const salesOrder = await tx.eRPSalesOrder.findUnique({
          where: { id: salesOrderId },
          include: {
            customer: true,
            warehouse: true,
            items: {
              include: {
                item: true,
              },
            },
          },
        });

        if (!salesOrder) {
          throw new NotFoundException('Sales order not found');
        }

        if (salesOrder.status !== 'WAREHOUSE_VERIFIED') {
          throw new BadRequestException('Sales order must be warehouse verified to create delivery challan');
        }

        // Generate challan number (PI format: DC-YYYY-0001)
        const currentYear = new Date().getFullYear();
        const prefix = 'DC';
        const lastChallan = await tx.deliveryChallan.findFirst({
          where: {
            challanNo: { startsWith: prefix },
          },
          orderBy: { createdAt: 'desc' },
        });

        let nextChallanSeq = 1;
        if (lastChallan?.challanNo) {
          const lastSeq = parseInt(lastChallan.challanNo.split('-').pop() || '0', 10);
          if (!isNaN(lastSeq)) {
            nextChallanSeq = lastSeq + 1;
          }
        }
        const challanNo = `${prefix}-${currentYear}-${String(nextChallanSeq).padStart(4, '0')}`;

        // Calculate totals using FBR WOST logic like sales order
        const baseMargin = Number((salesOrder as any).baseMargin || 0);
        const cashMargin = Number((salesOrder as any).cashMargin || 0);
        const marginPct = baseMargin + cashMargin;
        const orderDiscount = Number(salesOrder.discount || 0);

        // Fetch all item taxRates first
        const itemRecords = await Promise.all(items.map(async (item: any) => {
          const salesOrderItem = salesOrder.items.find((soItem: any) => soItem.itemId === item.itemId);
          const itemRecord = salesOrderItem?.item || await tx.item.findUnique({
            where: { id: item.itemId },
            select: { unitCost: true, taxRate1: true }
          });
          
          const retailPrice = Number(item.salePrice || 0);
          const itemTaxRate = Number((itemRecord as any)?.taxRate1 || 18);
          const deliveredQty = Number(item.deliveredQty || 0);

          // WOST: Retail / (1 + TaxRate/100)
          const wostUnit = retailPrice / (1 + itemTaxRate / 100);
          const wostTotal = wostUnit * deliveredQty;

          return {
            itemId: item.itemId,
            orderedQty: salesOrderItem?.quantity || deliveredQty,
            deliveredQty,
            costPrice: salesOrderItem?.costPrice || (itemRecord as any)?.unitCost || 0,
            salePrice: retailPrice,
            taxRate: itemTaxRate,
            wostTotal
          };
        }));

        const grossTotal = itemRecords.reduce((sum, it) => sum + it.wostTotal, 0);
        const baseMarginAmount = (grossTotal * baseMargin) / 100;
        const cashMarginAmount = (grossTotal * cashMargin) / 100;
        const subtotal = grossTotal - baseMarginAmount - cashMarginAmount;

        const orderDiscountPct = subtotal > 0 ? (orderDiscount / subtotal) * 100 : 0;

        let taxAmount = 0;
        const processedItems = itemRecords.map((item) => {
          const marginDiscount = item.wostTotal * (marginPct / 100);
          const afterDiscount = item.wostTotal - marginDiscount;

          // Apply additional order discount percentage to the afterDiscount base
          const discountedBase = afterDiscount * (1 - orderDiscountPct / 100);
          const itemTaxAmount = discountedBase * (item.taxRate / 100);
          const itemTotal = (discountedBase + itemTaxAmount);

          taxAmount += itemTaxAmount;

          return {
            itemId: item.itemId,
            orderedQty: item.orderedQty,
            deliveredQty: item.deliveredQty,
            salePrice: item.salePrice,
            discount: marginDiscount,
            total: itemTotal,
          };
        });

        const totalAmount = (subtotal - orderDiscount) + taxAmount;
        const totalQty = items.reduce((sum: number, item: any) => sum + item.deliveredQty, 0);

        const challan = await tx.deliveryChallan.create({
          data: {
            challanNo,
            salesOrderId,
            customerId: salesOrder.customerId,
            warehouseId: salesOrder.warehouseId,
            challanDate: new Date(),
            driverName,
            vehicleNo,
            transportMode: transportMode || 'ROAD',
            status: 'PENDING',
            totalQty,
            totalAmount,
            items: {
              create: processedItems.map((item: any) => ({
                itemId: item.itemId,
                orderedQty: item.orderedQty,
                deliveredQty: item.deliveredQty,
                salePrice: item.salePrice,
                total: item.total,
              })),
            },
          },
          include: {
            customer: true,
            warehouse: true,
            salesOrder: true,
            items: {
              include: {
                item: true,
              },
            },
          },
        });

        // Create stock ledger entries for inventory outbound (Physical delivery)
        for (const item of items) {
          if (!salesOrder.warehouseId) {
            throw new BadRequestException('Sales order must have a warehouse assigned');
          }

          // Create stock ledger entry
          await this.stockLedgerService.createEntry({
            itemId: item.itemId,
            warehouseId: salesOrder.warehouseId as string,
            qty: -Number(item.deliveredQty),
            movementType: MovementType.OUTBOUND,
            referenceType: 'DELIVERY_CHALLAN',
            referenceId: challan.id,
            rate: Number(item.salePrice),
          }, tx);
        }

        return challan;
      });

      runInBackground(
        'Create Delivery Challan',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'delivery-challan',
          entity: 'DeliveryChallan',
          entityId: result.id,
          description: `Created delivery challan ${result.challanNo} for sales order ${result.salesOrder.orderNo}`,
          newValues: JSON.stringify(createData),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return { status: true, data: result };
    } catch (error: any) {
      runInBackground(
        'Create Delivery Challan (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'delivery-challan',
          entity: 'DeliveryChallan',
          description: `Failed to create delivery challan`,
          errorMessage: error?.message,
          newValues: JSON.stringify(createData),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async findAll(search?: string, status?: string) {
    const where: any = {};
    if (search) {
      where.OR = [
        { challanNo: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { driverName: { contains: search, mode: 'insensitive' } },
        { vehicleNo: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status && status !== 'all') {
      where.status = status;
    }

    const data = await this.prisma.deliveryChallan.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, traderId: true, subCode: true } as any },
        warehouse: { select: { id: true, name: true } },
        salesOrder: { select: { id: true, orderNo: true } },
        _count: { select: { invoices: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { status: true, data };
  }

  async findOne(id: string) {
    const challan = await this.prisma.deliveryChallan.findUnique({
      where: { id },
      include: {
        customer: true,
        warehouse: true,
        salesOrder: true,
        items: {
          include: {
            item: {
              include: {
                brand: true,
                category: true,
                subCategory: true,
                size: true,
              },
            },
          },
        },
        invoices: {
          select: {
            id: true,
            invoiceNo: true,
            grandTotal: true,
            createdAt: true,
          }
        }
      },
    });

    if (!challan) {
      throw new NotFoundException(`Delivery challan with ID ${id} not found`);
    }

    return { status: true, data: challan };
  }

  async update(id: string, updateData: any, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existingResponse = await this.findOne(id);
      const existing = existingResponse.data;

      if (existing.status !== 'PENDING') {
        throw new BadRequestException('Only pending challans can be updated');
      }

      const updated = await this.prisma.deliveryChallan.update({
        where: { id },
        data: {
          driverName: updateData.driverName,
          vehicleNo: updateData.vehicleNo,
          transportMode: updateData.transportMode,
        },
        include: {
          customer: true,
          warehouse: true,
        },
      });

      runInBackground(
        'Update Delivery Challan',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'delivery-challan',
          entity: 'DeliveryChallan',
          entityId: id,
          description: `Updated delivery challan ${updated.challanNo}`,
          oldValues: JSON.stringify(existing),
          newValues: JSON.stringify(updateData),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return { status: true, data: updated };
    } catch (error: any) {
      runInBackground(
        'Update Delivery Challan (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'delivery-challan',
          entity: 'DeliveryChallan',
          entityId: id,
          description: `Failed to update delivery challan`,
          errorMessage: error?.message,
          newValues: JSON.stringify(updateData),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async deliver(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const challanResponse = await this.findOne(id);
      const challan = challanResponse.data;

      if (challan.status !== 'PENDING') {
        throw new BadRequestException('Only pending challans can be marked as delivered');
      }

      const updated = await this.prisma.deliveryChallan.update({
        where: { id },
        data: { 
          status: 'DELIVERED',
          deliveryDate: new Date(),
        },
      });

      runInBackground(
        'Deliver Delivery Challan',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'delivery-challan',
          entity: 'DeliveryChallan',
          entityId: id,
          description: `Marked delivery challan ${challan.challanNo} as DELIVERED`,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return { status: true, data: updated };
    } catch (error: any) {
      runInBackground(
        'Deliver Delivery Challan (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'delivery-challan',
          entity: 'DeliveryChallan',
          entityId: id,
          description: `Failed to mark delivery challan as delivered`,
          errorMessage: error?.message,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async cancel(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const challanResponse = await this.findOne(id);
      const challan = challanResponse.data;

      if (challan.status === 'CANCELLED') {
        throw new BadRequestException('Challan is already cancelled');
      }

      if (challan.status === 'INVOICED') {
        throw new BadRequestException('Cannot cancel an invoiced challan. Delete the invoice first.');
      }

      const result = await this.prisma.$transaction(async (tx) => {
        // Reverse stock ledger entries
        for (const item of challan.items) {
          await this.stockLedgerService.createEntry({
            itemId: item.itemId,
            warehouseId: challan.warehouseId as string,
            qty: Number(item.deliveredQty),
            movementType: MovementType.INBOUND,
            referenceType: 'DELIVERY_CHALLAN_CANCEL',
            referenceId: challan.id,
            rate: Number(item.salePrice),
          }, tx);
        }

        return await tx.deliveryChallan.update({
          where: { id },
          data: { status: 'CANCELLED' },
        });
      });

      runInBackground(
        'Cancel Delivery Challan',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'delivery-challan',
          entity: 'DeliveryChallan',
          entityId: id,
          description: `Cancelled delivery challan ${challan.challanNo}`,
          oldValues: JSON.stringify(challan),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return { status: true, data: result };
    } catch (error: any) {
      runInBackground(
        'Cancel Delivery Challan (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'delivery-challan',
          entity: 'DeliveryChallan',
          entityId: id,
          description: `Failed to cancel delivery challan`,
          errorMessage: error?.message,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async createInvoice(id: string, data: any, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const directQuery = await this.prisma.deliveryChallan.findUnique({
        where: { id },
        select: { 
          id: true, 
          status: true, 
          challanNo: true,
          invoices: {
            select: { id: true, invoiceNo: true }
          }
        }
      });

      const deliveryChallanResponse = await this.findOne(id);
      const deliveryChallan = deliveryChallanResponse.data;

      // Check if already invoiced
      if (deliveryChallan.status === 'INVOICED' || (deliveryChallan.invoices && deliveryChallan.invoices.length > 0)) {
        throw new BadRequestException('This delivery challan has already been invoiced');
      }

      if (deliveryChallan.status !== 'DELIVERED') {
        throw new BadRequestException(`Only delivered challans can be invoiced. Current status: ${deliveryChallan.status}`);
      }

      const result = await this.prisma.$transaction(async (tx) => {
        // Generate invoice number (PI format: INV-YYYY-0001)
        const currentYear = new Date().getFullYear();
        const prefix = 'INV';
        const lastInvoice = await tx.eRPSalesInvoice.findFirst({
          where: {
            OR: [
              { invoiceNo: { startsWith: 'INV' } },
              { invoiceNo: { startsWith: 'SI' } },
            ],
          },
          orderBy: { createdAt: 'desc' },
        });

        let nextInvSeq = 1;
        if (lastInvoice?.invoiceNo) {
          const lastSeq = parseInt(lastInvoice.invoiceNo.split('-').pop() || '0', 10);
          if (!isNaN(lastSeq)) {
            nextInvSeq = lastSeq + 1;
          }
        }
        const invoiceNo = `${prefix}-${currentYear}-${String(nextInvSeq).padStart(4, '0')}`;

        // Calculate correct invoice totals using FBR WOST logic
        const baseMargin = Number(deliveryChallan.salesOrder?.baseMargin ?? 0);
        const cashMargin = Number(deliveryChallan.salesOrder?.cashMargin ?? 0);
        const marginPct = baseMargin + cashMargin;
        const orderDiscount = Number(deliveryChallan.salesOrder?.discount ?? 0);

        const itemRecords = await Promise.all(deliveryChallan.items.map(async (item: any) => {
          const itemRecord = await tx.item.findUnique({
            where: { id: item.itemId },
            select: { unitCost: true, taxRate1: true }
          });
          
          const retailPrice = Number(item.salePrice || 0);
          const itemTaxRate = Number(itemRecord?.taxRate1 ?? 18);
          const quantity = Number(item.deliveredQty || 0);

          const wostUnit = retailPrice / (1 + itemTaxRate / 100);
          const wostTotal = wostUnit * quantity;

          return {
            itemId: item.itemId,
            quantity,
            costPrice: itemRecord?.unitCost || 0,
            salePrice: retailPrice,
            taxRate: itemTaxRate,
            wostTotal
          };
        }));

        const grossTotal = itemRecords.reduce((sum, it) => sum + it.wostTotal, 0);
        const baseMarginAmount = (grossTotal * baseMargin) / 100;
        const cashMarginAmount = (grossTotal * cashMargin) / 100;
        const subtotal = grossTotal - baseMarginAmount - cashMarginAmount;

        const orderDiscountPct = subtotal > 0 ? (orderDiscount / subtotal) * 100 : 0;

        let taxAmount = 0;
        const processedItems = itemRecords.map((item) => {
          const marginDiscount = item.wostTotal * (marginPct / 100);
          const afterDiscount = item.wostTotal - marginDiscount;

          // Apply additional order discount percentage to the afterDiscount base
          const discountedBase = afterDiscount * (1 - orderDiscountPct / 100);
          const itemTaxAmount = discountedBase * (item.taxRate / 100);
          const itemTotal = (discountedBase + itemTaxAmount);

          taxAmount += itemTaxAmount;

          return {
            itemId: item.itemId,
            quantity: item.quantity,
            costPrice: item.costPrice,
            salePrice: item.salePrice,
            discount: marginDiscount,
            total: itemTotal,
          };
        });

        const grandTotal = (subtotal - orderDiscount) + taxAmount;

        const invoice = await tx.eRPSalesInvoice.create({
          data: {
            invoiceNo,
            salesOrderId: deliveryChallan.salesOrderId,
            deliveryChallanId: id,
            customerId: deliveryChallan.customerId,
            warehouseId: deliveryChallan.warehouseId,
            subtotal,
            baseMargin,
            cashMargin,
            baseMarginAmount,
            cashMarginAmount,
            taxRate: Number(deliveryChallan.salesOrder?.taxRate || 0),
            taxAmount,
            discount: orderDiscount,
            grandTotal,
            balanceAmount: grandTotal,
            paymentStatus: "UNPAID",
            items: {
              create: processedItems.map((item: any) => ({
                itemId: item.itemId,
                quantity: item.quantity,
                costPrice: item.costPrice,
                salePrice: item.salePrice,
                discount: item.discount,
                total: item.total,
              })),
            },
          },
          include: {
            customer: true,
            warehouse: true,
            salesOrder: true,
            deliveryChallan: true,
            items: {
              include: {
                item: true,
              },
            },
          },
        });

        // Update delivery challan status to INVOICED
        await tx.deliveryChallan.update({
          where: { id },
          data: { status: 'INVOICED' },
        });

        return invoice;
      });

      runInBackground(
        'Create Sales Invoice from Challan',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'sales-invoice',
          entity: 'ERPSalesInvoice',
          entityId: result.id,
          description: `Created sales invoice ${result.invoiceNo} from delivery challan ${deliveryChallan.challanNo}`,
          newValues: JSON.stringify(data),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return { status: true, data: result };
    } catch (error: any) {
      runInBackground(
        'Create Sales Invoice from Challan (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'sales-invoice',
          entity: 'ERPSalesInvoice',
          description: `Failed to create sales invoice from delivery challan`,
          errorMessage: error?.message,
          newValues: JSON.stringify(data),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }
}