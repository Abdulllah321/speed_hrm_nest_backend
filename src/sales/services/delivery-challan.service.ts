import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DeliveryChallanService {
  constructor(private prisma: PrismaService) {}

  async findAll(search?: string, status?: string) {
    const where: any = {};

    if (search) {
      where.OR = [
        { challanNo: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { salesOrder: { orderNo: { contains: search, mode: 'insensitive' } } },
      ];
    }

    if (status && status !== 'all') {
      where.status = status.toUpperCase();
    }

    return this.prisma.deliveryChallan.findMany({
      where,
      include: {
        customer: true,
        warehouse: true,
        salesOrder: true,
        items: {
          include: {
            item: true,
          },
        },
        _count: {
          select: {
            invoices: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const deliveryChallan = await this.prisma.deliveryChallan.findUnique({
      where: { id },
      include: {
        customer: true,
        warehouse: true,
        salesOrder: true,
        items: {
          include: {
            item: true,
          },
        },
        invoices: true,
      },
    });

    if (!deliveryChallan) {
      throw new NotFoundException('Delivery challan not found');
    }

    return deliveryChallan;
  }

  async update(id: string, updateData: any) {
    const deliveryChallan = await this.findOne(id);

    if (deliveryChallan.status === 'DELIVERED') {
      throw new BadRequestException('Cannot update delivered challan');
    }

    return this.prisma.deliveryChallan.update({
      where: { id },
      data: updateData,
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
  }

  async deliver(id: string) {
    const deliveryChallan = await this.findOne(id);

    if (deliveryChallan.status !== 'PENDING') {
      throw new BadRequestException('Only pending challans can be delivered');
    }

    return this.prisma.deliveryChallan.update({
      where: { id },
      data: { status: 'DELIVERED' },
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
  }

  async createInvoice(id: string, data: any) {
    const deliveryChallan = await this.findOne(id);

    if (deliveryChallan.status !== 'DELIVERED') {
      throw new BadRequestException('Only delivered challans can be invoiced');
    }

    // Generate invoice number
    const lastInvoice = await this.prisma.eRPSalesInvoice.findFirst({
      orderBy: { invoiceNo: 'desc' },
    });
    
    const lastNumber = lastInvoice?.invoiceNo ? parseInt(lastInvoice.invoiceNo.split('-')[1]) : 0;
    const invoiceNo = `INV-${String(lastNumber + 1).padStart(3, '0')}`;

    return this.prisma.eRPSalesInvoice.create({
      data: {
        invoiceNo,
        salesOrderId: deliveryChallan.salesOrderId,
        deliveryChallanId: id,
        customerId: deliveryChallan.customerId,
        warehouseId: deliveryChallan.warehouseId,
        subtotal: deliveryChallan.totalAmount,
        taxRate: data.taxRate || 0,
        taxAmount: Number(deliveryChallan.totalAmount) * (data.taxRate || 0) / 100,
        discount: data.discount || 0,
        grandTotal: Number(deliveryChallan.totalAmount) + (Number(deliveryChallan.totalAmount) * (data.taxRate || 0) / 100) - (data.discount || 0),
        items: {
          create: deliveryChallan.items.map(item => ({
            itemId: item.itemId,
            quantity: item.deliveredQty,
            costPrice: 0, // Will be fetched from item
            salePrice: item.salePrice,
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
  }
}