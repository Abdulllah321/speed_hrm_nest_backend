import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSalesOrderDto, UpdateSalesOrderDto } from '../dto/sales-order.dto';

import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';
@Injectable()
export class SalesOrderService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async findAll(search?: string, status?: string) {
    const where: any = {};

    if (search) {
      where.OR = [
        { orderNo: { contains: search, mode: 'insensitive' as const } },
        { customer: { name: { contains: search, mode: 'insensitive' as const } } },
        { customer: { code: { contains: search, mode: 'insensitive' as const } } },
      ];
    }

    if (status && status !== 'all') {
      where.status = status.toUpperCase();
    }

    const orders = await this.prisma.eRPSalesOrder.findMany({
      where,
      include: {
        customer: true,
        warehouse: true,
        items: {
          include: {
            item: true,
          },
        },
        _count: {
          select: {
            deliveryChallans: true,
            invoices: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { status: true, data: orders };
  }

  async findAvailableForDelivery() {
    // Find confirmed orders that don't have delivery challans yet
    const orders = await this.prisma.eRPSalesOrder.findMany({
      where: {
        status: 'WAREHOUSE_VERIFIED' as any,
        deliveryChallans: {
          none: {} // No delivery challans created yet
        }
      },
      include: {
        customer: true,
        warehouse: true,
        items: {
          include: {
            item: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { status: true, data: orders };
  }

  async findOne(id: string) {
    console.log('Finding sales order with ID:', id); // Debug log
    
    // First, let's check if any sales orders exist at all
    const allOrders = await this.prisma.eRPSalesOrder.findMany({
      take: 5,
      select: { id: true, orderNo: true }
    });
    console.log('Sample orders in database:', allOrders); // Debug log
    
    const salesOrder = await this.prisma.eRPSalesOrder.findUnique({
      where: { id },
      include: {
        customer: true,
        warehouse: true,
        items: {
          include: {
            item: {
              include: {
                brand: true,
                category: true,
                subCategory: true,
                size: true,
                color: true,
                gender: true,
                division: true,
              },
            },
          },
        },
        deliveryChallans: true,
        invoices: true,
      },
    });

    console.log('Found sales order:', salesOrder ? 'Yes' : 'No'); // Debug log

    if (!salesOrder) {
      throw new NotFoundException(`Sales order with ID ${id} not found`);
    }

    return { status: true, data: salesOrder };
  }

  async create(createSalesOrderDto: CreateSalesOrderDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      // Generate order number (PI format: SO-YYYY-0001)
      const currentYear = new Date().getFullYear();
      const prefix = 'SO';
      const lastOrder = await this.prisma.eRPSalesOrder.findFirst({
        where: {
          OR: [
            { orderNo: { startsWith: 'SO' } },
            { orderNo: { startsWith: 'SI' } },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
      
      let nextNumber = 1;
      if (lastOrder?.orderNo) {
        const lastSeq = parseInt(lastOrder.orderNo.split('-').pop() || '0', 10);
        if (!isNaN(lastSeq)) {
          nextNumber = lastSeq + 1;
        }
      }
      const orderNo = `${prefix}-${currentYear}-${String(nextNumber).padStart(4, '0')}`;

      // Validate customer exists
      const customer = await this.prisma.customer.findUnique({
        where: { id: createSalesOrderDto.customerId },
      });
      if (!customer) {
        throw new BadRequestException('Customer not found');
      }

      // Determine margins
      const baseMargin = createSalesOrderDto.baseMargin !== undefined ? Number(createSalesOrderDto.baseMargin) : Number((customer as any).baseMargin || 0);
      const cashMargin = createSalesOrderDto.cashMargin !== undefined ? Number(createSalesOrderDto.cashMargin) : Number((customer as any).cashMargin || 0);
      const marginPct = baseMargin + cashMargin;

      // 1. First pass to fetch item data and calculate grossTotal & subtotal
      const itemRecords = await Promise.all(createSalesOrderDto.items.map(async (item) => {
        const itemRecord = await this.prisma.item.findUnique({
          where: { id: item.itemId },
          select: { unitCost: true, taxRate1: true }
        });
        const retailPrice = Number(item.salePrice || 0);
        const itemTaxRate = Number(itemRecord?.taxRate1 || 18);
        const quantity = Number(item.quantity || 0);
        const manualDiscount = Number(item.discount || 0);

        const wostUnit = retailPrice / (1 + itemTaxRate / 100);
        const wostTotal = wostUnit * quantity;

        return {
          itemId: item.itemId,
          quantity,
          costPrice: itemRecord?.unitCost || 0,
          salePrice: retailPrice,
          taxRate: itemTaxRate,
          wostTotal,
          manualDiscount
        };
      }));

      const grossTotal = itemRecords.reduce((sum, it) => sum + it.wostTotal, 0);
      const baseMarginAmount = (grossTotal * baseMargin) / 100;
      const cashMarginAmount = (grossTotal * cashMargin) / 100;
      const totalMarginDeduction = baseMarginAmount + cashMarginAmount;
      const subtotal = grossTotal - totalMarginDeduction;

      // 2. Determine manual discount pct
      const orderDiscountAmount = Number(createSalesOrderDto.discount || 0);
      const orderDiscountPct = subtotal > 0 ? (orderDiscountAmount / subtotal) * 100 : 0;

      // 3. Second pass to calculate FBR tax on discounted base and final item totals
      let taxAmount = 0;
      const processedItems = itemRecords.map((item) => {
        const marginDiscount = item.wostTotal * (marginPct / 100);
        const afterDiscount = item.wostTotal - marginDiscount;

        // Apply additional order discount percentage to the afterDiscount base
        const discountedBase = afterDiscount * (1 - orderDiscountPct / 100);
        const itemTaxAmount = discountedBase * (item.taxRate / 100);
        const itemTotal = (discountedBase + itemTaxAmount) - item.manualDiscount;

        taxAmount += itemTaxAmount;

        return {
          itemId: item.itemId,
          quantity: item.quantity,
          costPrice: item.costPrice,
          salePrice: item.salePrice,
          discount: marginDiscount + item.manualDiscount,
          total: itemTotal,
        };
      });

      const grandTotal = (subtotal - orderDiscountAmount) + taxAmount;

      // Validate warehouse if provided
      if (createSalesOrderDto.warehouseId) {
        const warehouse = await this.prisma.warehouse.findUnique({
          where: { id: createSalesOrderDto.warehouseId },
        });
        if (!warehouse) {
          throw new BadRequestException('Warehouse not found');
        }
      }

      // Create sales order with items
      const created = await this.prisma.eRPSalesOrder.create({
        data: {
          orderNo,
          customerId: createSalesOrderDto.customerId,
          warehouseId: createSalesOrderDto.warehouseId,
          baseMargin,
          cashMargin,
          baseMarginAmount,
          cashMarginAmount,
          subtotal,
          taxRate: createSalesOrderDto.taxRate || 0,
          taxAmount,
          discount: createSalesOrderDto.discount || 0,
          grandTotal,
          items: {
            create: processedItems.map((item) => ({
              itemId: item.itemId,
              quantity: item.quantity,
              costPrice: item.costPrice,
              salePrice: item.salePrice,
              discount: item.discount,
              total: item.total,
            })),
          },
        } as any,
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

      runInBackground(
        'Create Sales Order',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'sales-order',
          entity: 'ERPSalesOrder',
          entityId: created.id,
          description: `Created sales order ${created.orderNo}`,
          newValues: JSON.stringify(createSalesOrderDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return created;
    } catch (error: any) {
      runInBackground(
        'Create Sales Order (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'sales-order',
          entity: 'ERPSalesOrder',
          description: `Failed to create sales order`,
          errorMessage: error?.message,
          newValues: JSON.stringify(createSalesOrderDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async update(id: string, updateSalesOrderDto: UpdateSalesOrderDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const salesOrderResponse = await this.findOne(id);
      const salesOrder = salesOrderResponse.data; // Extract data from response

      if (salesOrder.status === 'CONFIRMED') {
        throw new BadRequestException('Cannot update confirmed sales order');
      }

      // If items or margins are being updated, recalculate totals
      let updateData: any = { ...updateSalesOrderDto };
      let itemsToCreate: any[] | undefined = undefined;

      const baseMargin = updateSalesOrderDto.baseMargin !== undefined ? Number(updateSalesOrderDto.baseMargin) : Number((salesOrder as any).baseMargin || 0);
      const cashMargin = updateSalesOrderDto.cashMargin !== undefined ? Number(updateSalesOrderDto.cashMargin) : Number((salesOrder as any).cashMargin || 0);

      if (updateSalesOrderDto.items) {
        const marginPct = baseMargin + cashMargin;

        const itemRecords = await Promise.all(updateSalesOrderDto.items.map(async (item) => {
          const itemRecord = await this.prisma.item.findUnique({
            where: { id: item.itemId },
            select: { unitCost: true, taxRate1: true }
          });
          
          const retailPrice = Number(item.salePrice || 0);
          const itemTaxRate = Number(itemRecord?.taxRate1 || 18);
          const quantity = Number(item.quantity || 0);
          const manualDiscount = Number(item.discount || 0);

          const wostUnit = retailPrice / (1 + itemTaxRate / 100);
          const wostTotal = wostUnit * quantity;

          return {
            itemId: item.itemId,
            quantity,
            costPrice: itemRecord?.unitCost || 0,
            salePrice: retailPrice,
            taxRate: itemTaxRate,
            wostTotal,
            manualDiscount
          };
        }));

        const grossTotal = itemRecords.reduce((sum, it) => sum + it.wostTotal, 0);
        const baseMarginAmount = (grossTotal * baseMargin) / 100;
        const cashMarginAmount = (grossTotal * cashMargin) / 100;
        const totalMarginDeduction = baseMarginAmount + cashMarginAmount;
        const subtotal = grossTotal - totalMarginDeduction;

        const discountVal = Number(updateSalesOrderDto.discount !== undefined ? updateSalesOrderDto.discount : salesOrder.discount) || 0;
        const orderDiscountPct = subtotal > 0 ? (discountVal / subtotal) * 100 : 0;

        let taxAmount = 0;
        const processedItems = itemRecords.map((item) => {
          const marginDiscount = item.wostTotal * (marginPct / 100);
          const afterDiscount = item.wostTotal - marginDiscount;

          // Apply additional order discount percentage to the afterDiscount base
          const discountedBase = afterDiscount * (1 - orderDiscountPct / 100);
          const itemTaxAmount = discountedBase * (item.taxRate / 100);
          const itemTotal = (discountedBase + itemTaxAmount) - item.manualDiscount;

          taxAmount += itemTaxAmount;

          return {
            itemId: item.itemId,
            quantity: item.quantity,
            costPrice: item.costPrice,
            salePrice: item.salePrice,
            discount: marginDiscount + item.manualDiscount,
            total: itemTotal,
          };
        });

        const grandTotal = (subtotal - discountVal) + taxAmount;

        updateData = {
          ...updateData,
          baseMargin,
          cashMargin,
          baseMarginAmount,
          cashMarginAmount,
          subtotal,
          taxAmount,
          grandTotal,
        };

        // Delete existing items and create new ones
        await this.prisma.eRPSalesOrderItem.deleteMany({
          where: { salesOrderId: id },
        });

        itemsToCreate = processedItems.map((item) => ({
          itemId: item.itemId,
          quantity: item.quantity,
          costPrice: item.costPrice,
          salePrice: item.salePrice,
          discount: item.discount,
          total: item.total,
        }));
      }

      const updated = await this.prisma.eRPSalesOrder.update({
        where: { id },
        data: {
          customerId: updateData.customerId,
          warehouseId: updateData.warehouseId,
          status: updateData.status,
          baseMargin: updateData.baseMargin,
          cashMargin: updateData.cashMargin,
          baseMarginAmount: updateData.baseMarginAmount,
          cashMarginAmount: updateData.cashMarginAmount,
          subtotal: updateData.subtotal,
          taxRate: updateData.taxRate,
          taxAmount: updateData.taxAmount,
          discount: updateData.discount,
          grandTotal: updateData.grandTotal,
          items: itemsToCreate ? {
            create: itemsToCreate,
          } : undefined,
        } as any,
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

      runInBackground(
        'Update Sales Order',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sales-order',
          entity: 'ERPSalesOrder',
          entityId: updated.id,
          description: `Updated sales order ${updated.orderNo}`,
          oldValues: JSON.stringify(salesOrder),
          newValues: JSON.stringify(updateSalesOrderDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return updated;
    } catch (error: any) {
      runInBackground(
        'Update Sales Order (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sales-order',
          entity: 'ERPSalesOrder',
          entityId: id,
          description: `Failed to update sales order`,
          errorMessage: error?.message,
          newValues: JSON.stringify(updateSalesOrderDto),
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
      const salesOrderResponse = await this.findOne(id);
      const salesOrder = salesOrderResponse.data;

      if (salesOrder.status === 'CONFIRMED') {
        throw new BadRequestException('Cannot delete confirmed sales order');
      }

      await this.prisma.eRPSalesOrderItem.deleteMany({
        where: { salesOrderId: id },
      });

      const deleted = await this.prisma.eRPSalesOrder.delete({
        where: { id },
      });

      runInBackground(
        'Delete Sales Order',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'sales-order',
          entity: 'ERPSalesOrder',
          entityId: id,
          description: `Deleted sales order ${deleted.orderNo}`,
          oldValues: JSON.stringify(salesOrder),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return { status: true, message: 'Sales order deleted successfully' };
    } catch (error: any) {
      runInBackground(
        'Delete Sales Order (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'sales-order',
          entity: 'ERPSalesOrder',
          entityId: id,
          description: `Failed to delete sales order`,
          errorMessage: error?.message,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async confirm(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const salesOrderResponse = await this.findOne(id);
      const salesOrder = salesOrderResponse.data;

      if (salesOrder.status !== 'DRAFT') {
        throw new BadRequestException('Only draft orders can be confirmed');
      }

      const updated = await this.prisma.eRPSalesOrder.update({
        where: { id },
        data: { status: 'CONFIRMED' },
        include: {
          customer: true,
          warehouse: true,
          items: true,
        },
      });

      runInBackground(
        'Confirm Sales Order',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sales-order',
          entity: 'ERPSalesOrder',
          entityId: updated.id,
          description: `Confirmed sales order ${updated.orderNo}`,
          oldValues: JSON.stringify(salesOrder),
          newValues: JSON.stringify({ status: 'CONFIRMED' }),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return updated;
    } catch (error: any) {
      runInBackground(
        'Confirm Sales Order (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sales-order',
          entity: 'ERPSalesOrder',
          entityId: id,
          description: `Failed to confirm sales order`,
          errorMessage: error?.message,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async verify(id: string, items: any[], ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const salesOrderResponse = await this.findOne(id);
      const salesOrder = salesOrderResponse.data;

      if (salesOrder.status !== 'CONFIRMED' && salesOrder.status !== 'WAREHOUSE_VERIFIED') {
        throw new BadRequestException('Only confirmed orders can be verified by warehouse');
      }

      const result = await this.prisma.$transaction(async (tx) => {
        const baseMargin = Number((salesOrder as any).baseMargin || 0);
        const cashMargin = Number((salesOrder as any).cashMargin || 0);
        const marginPct = baseMargin + cashMargin;
        const orderDiscount = Number(salesOrder.discount || 0);

        // Fetch taxRate1 for each item and process totals
        const itemRecords = await Promise.all(items.map(async (item: any) => {
          const itemRecord = await tx.item.findUnique({
            where: { id: item.itemId },
            select: { unitCost: true, taxRate1: true }
          });
          const retailPrice = Number(item.salePrice || 0);
          const itemTaxRate = Number(itemRecord?.taxRate1 || 18);
          const quantity = Number(item.quantity || 0);

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
        const totalMarginDeduction = baseMarginAmount + cashMarginAmount;
        const subtotal = grossTotal - totalMarginDeduction;

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

        // Update items with new quantities and totals
        for (const item of processedItems) {
          await tx.eRPSalesOrderItem.updateMany({
            where: {
              salesOrderId: id,
              itemId: item.itemId,
            },
            data: {
              quantity: item.quantity,
              discount: item.discount,
              total: item.total,
            },
          });
        }

        // Update sales order status and totals
        const updated = await tx.eRPSalesOrder.update({
          where: { id },
          data: {
            status: 'WAREHOUSE_VERIFIED' as any,
            baseMarginAmount,
            cashMarginAmount,
            subtotal,
            taxAmount,
            grandTotal,
          } as any,
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

        return updated;
      });

      runInBackground(
        'Warehouse Verify Sales Order',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sales-order',
          entity: 'ERPSalesOrder',
          entityId: result.id,
          description: `Warehouse verified sales order ${result.orderNo}`,
          oldValues: JSON.stringify(salesOrder),
          newValues: JSON.stringify({ status: 'WAREHOUSE_VERIFIED', items }),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return result;
    } catch (error: any) {
      runInBackground(
        'Warehouse Verify Sales Order (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sales-order',
          entity: 'ERPSalesOrder',
          entityId: id,
          description: `Failed to warehouse verify sales order`,
          errorMessage: error?.message,
          newValues: JSON.stringify(items),
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
      const salesOrderResponse = await this.findOne(id);
      const salesOrder = salesOrderResponse.data;

      if (salesOrder.status === 'CANCELLED') {
        throw new BadRequestException('Order is already cancelled');
      }

      const updated = await this.prisma.eRPSalesOrder.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });

      runInBackground(
        'Cancel Sales Order',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sales-order',
          entity: 'ERPSalesOrder',
          entityId: updated.id,
          description: `Cancelled sales order ${updated.orderNo}`,
          oldValues: JSON.stringify(salesOrder),
          newValues: JSON.stringify({ status: 'CANCELLED' }),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return updated;
    } catch (error: any) {
      runInBackground(
        'Cancel Sales Order (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sales-order',
          entity: 'ERPSalesOrder',
          entityId: id,
          description: `Failed to cancel sales order`,
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