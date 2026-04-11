import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSalesOrderDto, UpdateSalesOrderDto } from '../dto/sales-order.dto';

@Injectable()
export class SalesOrderService {
  constructor(private prisma: PrismaService) {}

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
        status: 'CONFIRMED',
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
            item: true,
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

  async create(createSalesOrderDto: CreateSalesOrderDto) {
    // Generate order number
    const lastOrder = await this.prisma.eRPSalesOrder.findFirst({
      orderBy: { orderNo: 'desc' },
    });
    
    const lastNumber = lastOrder?.orderNo ? parseInt(lastOrder.orderNo.split('-')[1]) : 0;
    const orderNo = `SO-${String(lastNumber + 1).padStart(3, '0')}`;

    // Calculate totals
    let subtotal = 0;
    const processedItems = createSalesOrderDto.items.map(item => {
      const itemTotal = (item.salePrice * item.quantity) - (item.discount || 0);
      subtotal += itemTotal;
      return {
        ...item,
        total: itemTotal,
      };
    });

    const taxAmount = subtotal * (createSalesOrderDto.taxRate || 0) / 100;
    const grandTotal = subtotal + taxAmount - (createSalesOrderDto.discount || 0);

    // Validate customer exists
    const customer = await this.prisma.customer.findUnique({
      where: { id: createSalesOrderDto.customerId },
    });
    if (!customer) {
      throw new BadRequestException('Customer not found');
    }

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
    return this.prisma.eRPSalesOrder.create({
      data: {
        orderNo,
        customerId: createSalesOrderDto.customerId,
        warehouseId: createSalesOrderDto.warehouseId,
        subtotal,
        taxRate: createSalesOrderDto.taxRate || 0,
        taxAmount,
        discount: createSalesOrderDto.discount || 0,
        grandTotal,
        items: {
          create: await Promise.all(processedItems.map(async (item) => {
            // Fetch item cost from item master
            const itemRecord = await this.prisma.item.findUnique({
              where: { id: item.itemId },
              select: { unitCost: true }
            });
            
            console.log(`Item ${item.itemId} cost:`, itemRecord?.unitCost);
            
            return {
              itemId: item.itemId,
              quantity: item.quantity,
              costPrice: itemRecord?.unitCost || 0,
              salePrice: item.salePrice,
              discount: item.discount || 0,
              total: item.total,
            };
          })),
        },
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
    });
  }

  async update(id: string, updateSalesOrderDto: UpdateSalesOrderDto) {
    const salesOrderResponse = await this.findOne(id);
    const salesOrder = salesOrderResponse.data; // Extract data from response

    if (salesOrder.status === 'CONFIRMED') {
      throw new BadRequestException('Cannot update confirmed sales order');
    }

    // If items are being updated, recalculate totals
    let updateData: any = { ...updateSalesOrderDto };

    if (updateSalesOrderDto.items) {
      let subtotal = 0;
      const processedItems = updateSalesOrderDto.items.map(item => {
        const itemTotal = (item.salePrice * item.quantity) - (item.discount || 0);
        subtotal += itemTotal;
        return {
          ...item,
          total: itemTotal,
        };
      });

      const taxAmount = subtotal * (Number(updateSalesOrderDto.taxRate) || Number(salesOrder.taxRate)) / 100;
      const grandTotal = subtotal + taxAmount - (Number(updateSalesOrderDto.discount) || Number(salesOrder.discount));

      updateData = {
        ...updateData,
        subtotal,
        taxAmount,
        grandTotal,
      };

      // Delete existing items and create new ones
      await this.prisma.eRPSalesOrderItem.deleteMany({
        where: { salesOrderId: id },
      });
    }

    const updatedOrder = await this.prisma.eRPSalesOrder.update({
      where: { id },
      data: updateData,
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

    // Create new items if provided
    if (updateSalesOrderDto.items) {
      const itemsWithCost = await Promise.all(
        updateSalesOrderDto.items.map(async (item) => {
          // Fetch item cost from item master
          const itemRecord = await this.prisma.item.findUnique({
            where: { id: item.itemId },
            select: { unitCost: true }
          });
          
          return {
            salesOrderId: id,
            itemId: item.itemId,
            quantity: item.quantity,
            costPrice: itemRecord?.unitCost || 0,
            salePrice: item.salePrice,
            discount: item.discount || 0,
            total: (item.salePrice * item.quantity) - (item.discount || 0),
          };
        })
      );

      await this.prisma.eRPSalesOrderItem.createMany({
        data: itemsWithCost,
      });
    }

    return this.findOne(id);
  }

  async confirm(id: string) {
    const salesOrderResponse = await this.findOne(id);
    const salesOrder = salesOrderResponse.data; // Extract data from response

    if (salesOrder.status !== 'DRAFT') {
      throw new BadRequestException('Only draft orders can be confirmed');
    }

    // TODO: Add stock validation here
    // Check if all items have sufficient stock

    return this.prisma.eRPSalesOrder.update({
      where: { id },
      data: { status: 'CONFIRMED' },
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
  }

  async cancel(id: string) {
    const salesOrderResponse = await this.findOne(id);
    const salesOrder = salesOrderResponse.data; // Extract data from response

    if (salesOrder.status === 'CANCELLED') {
      throw new BadRequestException('Order is already cancelled');
    }

    if (salesOrder.deliveryChallans.length > 0) {
      throw new BadRequestException('Cannot cancel order with delivery challans');
    }

    return this.prisma.eRPSalesOrder.update({
      where: { id },
      data: { status: 'CANCELLED' },
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
  }

  async createDeliveryChallan(id: string, data: any) {
    const salesOrderResponse = await this.findOne(id);
    const salesOrder = salesOrderResponse.data; // Extract data from response

    if (salesOrder.status !== 'CONFIRMED') {
      throw new BadRequestException('Only confirmed orders can have delivery challans');
    }

    // Generate challan number
    const lastChallan = await this.prisma.deliveryChallan.findFirst({
      orderBy: { challanNo: 'desc' },
    });
    
    const lastNumber = lastChallan?.challanNo ? parseInt(lastChallan.challanNo.split('-')[1]) : 0;
    const challanNo = `DC-${String(lastNumber + 1).padStart(3, '0')}`;

    return this.prisma.deliveryChallan.create({
      data: {
        challanNo,
        salesOrderId: id,
        customerId: salesOrder.customerId,
        warehouseId: salesOrder.warehouseId,
        driverName: data.driverName,
        vehicleNo: data.vehicleNo,
        transportMode: data.transportMode,
        totalQty: salesOrder.items.reduce((sum, item) => sum + item.quantity, 0),
        totalAmount: salesOrder.grandTotal,
        items: {
          create: salesOrder.items.map(item => ({
            itemId: item.itemId,
            orderedQty: item.quantity,
            deliveredQty: item.quantity, // Default to full delivery
            salePrice: item.salePrice,
            total: item.total,
          })),
        },
      },
      include: {
        salesOrder: true,
        customer: true,
        items: {
          include: {
            item: true,
          },
        },
      },
    });
  }
}