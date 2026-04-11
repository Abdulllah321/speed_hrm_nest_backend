import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StockLedgerService } from '../../warehouse/stock-ledger/stock-ledger.service';
import { CreateDeliveryChallanDto } from '../dto/delivery-challan.dto';

@Injectable()
export class DeliveryChallanService {
  constructor(
    private prisma: PrismaService,
    private stockLedgerService: StockLedgerService,
  ) {}

  async create(createData: CreateDeliveryChallanDto) {
    const { salesOrderId, driverName, vehicleNo, transportMode, items } = createData;

    return await this.prisma.$transaction(async (tx) => {
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

      if (salesOrder.status !== 'CONFIRMED') {
        throw new BadRequestException('Sales order must be confirmed to create delivery challan');
      }

      // Generate challan number
      const lastChallan = await tx.deliveryChallan.findFirst({
        orderBy: { createdAt: 'desc' },
      });
      const lastNumber = lastChallan ? parseInt(lastChallan.challanNo.split('-')[1]) : 0;
      const challanNo = `DC-${String(lastNumber + 1).padStart(3, '0')}`;

      // Calculate totals
      const totalQty = items.reduce((sum: number, item: any) => sum + item.deliveredQty, 0);
      const totalAmount = items.reduce((sum: number, item: any) => 
        sum + (item.deliveredQty * parseFloat(item.salePrice)), 0
      );

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
            create: items.map((item: any) => {
              // Find the corresponding sales order item to get ordered quantity
              const salesOrderItem = salesOrder.items.find((soItem: any) => soItem.itemId === item.itemId);
              
              return {
                itemId: item.itemId,
                orderedQty: salesOrderItem?.quantity || item.deliveredQty,
                deliveredQty: item.deliveredQty,
                salePrice: parseFloat(item.salePrice),
                total: item.deliveredQty * parseFloat(item.salePrice),
              };
            }),
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

        await this.stockLedgerService.createEntry({
          itemId: item.itemId,
          warehouseId: salesOrder.warehouseId,
          qty: -Number(item.deliveredQty), // Negative for outbound
          rate: Number(item.salePrice),
          movementType: 'OUTBOUND' as any,
          referenceType: 'DELIVERY_CHALLAN',
          referenceId: challan.id,
        }, tx);

        // Update inventory levels
        const existingInventory = await tx.inventoryItem.findFirst({
          where: {
            itemId: item.itemId,
            warehouseId: salesOrder.warehouseId,
            locationId: null, // Main warehouse stock
          },
        });

        if (existingInventory) {
          const newQty = Number(existingInventory.quantity) - Number(item.deliveredQty);
          if (newQty < 0) {
            throw new BadRequestException(`Insufficient stock for item ${item.itemId}. Available: ${existingInventory.quantity}, Required: ${item.deliveredQty}`);
          }
          
          await tx.inventoryItem.update({
            where: { id: existingInventory.id },
            data: { quantity: newQty },
          });
        } else {
          throw new BadRequestException(`Item ${item.itemId} not found in warehouse inventory`);
        }
      }

      return { status: true, data: challan };
    });
  }

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

    const challans = await this.prisma.deliveryChallan.findMany({
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

    return { status: true, data: challans };
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

    console.log('FindOne - Challan ID:', id);
    console.log('FindOne - Challan status from DB:', deliveryChallan.status);
    console.log('FindOne - Challan invoices count:', deliveryChallan.invoices?.length || 0);

    return { status: true, data: deliveryChallan };
  }

  async update(id: string, updateData: any) {
    const deliveryChallanResponse = await this.findOne(id);
    const deliveryChallan = deliveryChallanResponse.data;

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

  async cancel(id: string) {
    const deliveryChallanResponse = await this.findOne(id);
    const deliveryChallan = deliveryChallanResponse.data; // Extract data from response

    if (deliveryChallan.status === 'DELIVERED') {
      throw new BadRequestException('Cannot cancel delivered challan');
    }

    if (deliveryChallan.status === 'CANCELLED') {
      throw new BadRequestException('Challan is already cancelled');
    }

    return await this.prisma.$transaction(async (tx) => {
      // Update challan status
      const updatedChallan = await tx.deliveryChallan.update({
        where: { id },
        data: { status: 'CANCELLED' },
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

      // Reverse inventory entries - add stock back
      for (const item of deliveryChallan.items) {
        if (!deliveryChallan.warehouseId) {
          throw new BadRequestException('Delivery challan must have a warehouse assigned');
        }

        // Create reverse stock ledger entry (INBOUND to cancel the OUTBOUND)
        await this.stockLedgerService.createEntry({
          itemId: item.itemId,
          warehouseId: deliveryChallan.warehouseId,
          qty: Number(item.deliveredQty), // Positive for inbound (reversing outbound)
          rate: Number(item.salePrice),
          movementType: 'INBOUND' as any,
          referenceType: 'DELIVERY_CHALLAN_CANCEL',
          referenceId: id,
        }, tx);

        // Update inventory levels - add stock back
        const existingInventory = await tx.inventoryItem.findFirst({
          where: {
            itemId: item.itemId,
            warehouseId: deliveryChallan.warehouseId,
            locationId: null, // Main warehouse stock
          },
        });

        if (existingInventory) {
          await tx.inventoryItem.update({
            where: { id: existingInventory.id },
            data: { 
              quantity: Number(existingInventory.quantity) + Number(item.deliveredQty) 
            },
          });
        } else {
          // Create new inventory entry if it doesn't exist
          await tx.inventoryItem.create({
            data: {
              itemId: item.itemId,
              warehouseId: deliveryChallan.warehouseId,
              quantity: Number(item.deliveredQty),
              status: 'ACTIVE',
            },
          });
        }
      }

      return { status: true, data: updatedChallan };
    });
  }

  async deliver(id: string) {
    const deliveryChallan = await this.findOne(id);
    const challanData = deliveryChallan.data; // Extract data from response

    if (challanData.status !== 'PENDING') {
      throw new BadRequestException('Only pending challans can be delivered');
    }

    const updatedChallan = await this.prisma.deliveryChallan.update({
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

    return { status: true, data: updatedChallan };
  }

  async createInvoice(id: string, data: any) {
    // First, let's do a direct database query to see the actual status
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

    console.log('=== DIRECT DB QUERY ===');
    console.log('Challan ID:', id);
    console.log('Direct query result:', directQuery);
    console.log('Status from direct query:', directQuery?.status);
    console.log('Invoices from direct query:', directQuery?.invoices);
    console.log('======================');

    const deliveryChallanResponse = await this.findOne(id);
    const deliveryChallan = deliveryChallanResponse.data; // Extract data from response

    console.log('Creating invoice for challan:', id);
    console.log('Challan status:', deliveryChallan.status);
    console.log('Challan status type:', typeof deliveryChallan.status);
    console.log('Status comparison:', deliveryChallan.status === 'DELIVERED');
    console.log('Existing invoices:', deliveryChallan.invoices?.length || 0);

    // Check if already invoiced
    if (deliveryChallan.status === 'INVOICED') {
      throw new BadRequestException('This delivery challan has already been invoiced');
    }

    // Check if challan already has invoices
    if (deliveryChallan.invoices && deliveryChallan.invoices.length > 0) {
      throw new BadRequestException('This delivery challan already has an invoice created');
    }

    if (deliveryChallan.status !== 'DELIVERED') {
      throw new BadRequestException(`Only delivered challans can be invoiced. Current status: "${deliveryChallan.status}" (type: ${typeof deliveryChallan.status}). Please mark the challan as delivered first.`);
    }

    return await this.prisma.$transaction(async (tx) => {
      // Generate invoice number
      const lastInvoice = await tx.eRPSalesInvoice.findFirst({
        orderBy: { invoiceNo: 'desc' },
      });
      
      const lastNumber = lastInvoice?.invoiceNo ? parseInt(lastInvoice.invoiceNo.split('-')[1]) : 0;
      const invoiceNo = `INV-${String(lastNumber + 1).padStart(3, '0')}`;

      const invoice = await tx.eRPSalesInvoice.create({
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
            create: await Promise.all(deliveryChallan.items.map(async (item: any) => {
              // Fetch item cost from item master
              const itemRecord = await tx.item.findUnique({
                where: { id: item.itemId },
                select: { unitCost: true }
              });
              
              return {
                itemId: item.itemId,
                quantity: item.deliveredQty,
                costPrice: itemRecord?.unitCost || 0,
                salePrice: item.salePrice,
                total: item.total,
              };
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

      return { status: true, data: invoice };
    });
  }
}