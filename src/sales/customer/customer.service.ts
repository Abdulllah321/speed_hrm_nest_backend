import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer-dto';

@Injectable()
export class CustomerService {
  constructor(private prisma: PrismaService) { }

  async create(createDto: CreateCustomerDto) {
    try {
      const customer = await this.prisma.customer.create({
        data: createDto,
      });
      return {
        status: true,
        data: customer,
        message: 'Customer created successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async findAll(search?: string) {
    try {
      const customers = await this.prisma.customer.findMany({
        where: search
          ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
              { contactNo: { contains: search, mode: 'insensitive' } },
            ],
          }
          : {},
        orderBy: { createdAt: 'desc' },
      });
      return { status: true, data: customers };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async findOne(id: string) {
    try {
      const customer = await this.prisma.customer.findUnique({ where: { id } });
      return {
        status: !!customer,
        data: customer,
        message: customer ? undefined : 'Customer not found',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async update(id: string, updateDto: UpdateCustomerDto) {
    try {
      const customer = await this.prisma.customer.update({
        where: { id },
        data: updateDto,
      });
      return {
        status: true,
        data: customer,
        message: 'Customer updated successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async remove(id: string) {
    try {
      await this.prisma.customer.delete({ where: { id } });
      return { status: true, message: 'Customer deleted successfully' };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  // ─── Customer Ledger ──────────────────────────────────────────────
  async getCustomerLedger(customerId?: string, search?: string) {
    try {
      const where: any = {};
      
      if (customerId) {
        where.id = customerId;
      }
      
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
          { contactNo: { contains: search, mode: 'insensitive' } },
        ];
      }

      const customers = await this.prisma.customer.findMany({
        where,
        select: {
          id: true,
          code: true,
          name: true,
          contactNo: true,
          email: true,
          address: true,
          balance: true,
          salesInvoices: {
            select: {
              id: true,
              invoiceNo: true,
              invoiceDate: true,
              grandTotal: true,
              paidAmount: true,
              status: true,
            },
            orderBy: { invoiceDate: 'desc' },
            take: 10,
          },
          salesOrders: {
            select: {
              id: true,
              orderNo: true,
              orderDate: true,
              grandTotal: true,
              status: true,
            },
            orderBy: { orderDate: 'desc' },
            take: 10,
          },
        },
        orderBy: { name: 'asc' },
      });

      // Calculate summary for each customer
      const ledgerData = await Promise.all(
        customers.map(async (customer) => {
          // ERP Sales Invoices
          const invoiceStats = await this.prisma.eRPSalesInvoice.aggregate({
            where: { customerId: customer.id },
            _sum: {
              grandTotal: true,
              paidAmount: true,
            },
            _count: true,
          });

          // ERP Sales Orders
          const orderStats = await this.prisma.eRPSalesOrder.aggregate({
            where: { customerId: customer.id },
            _sum: {
              grandTotal: true,
            },
            _count: true,
          });

          // POS Sales (completed orders only)
          const posSalesStats = await this.prisma.salesOrder.aggregate({
            where: { 
              customerId: customer.id,
              status: { in: ['completed', 'partially_returned', 'returned'] },
            },
            _sum: {
              grandTotal: true,
            },
            _count: true,
          });

          // POS Credit Sales (only unpaid, not partial)
          const posCreditStats = await this.prisma.salesOrder.aggregate({
            where: {
              customerId: customer.id,
              status: 'completed',
              paymentStatus: 'unpaid', // Only truly unpaid orders
            },
            _sum: {
              grandTotal: true,
            },
            _count: true,
          });

          const totalInvoiced = Number(invoiceStats._sum?.grandTotal || 0);
          const totalPaid = Number(invoiceStats._sum?.paidAmount || 0);
          const totalOrders = Number(orderStats._sum?.grandTotal || 0);
          const totalPosSales = Number(posSalesStats._sum?.grandTotal || 0);
          const totalPosCredit = Number(posCreditStats._sum?.grandTotal || 0);
          
          // POS sales are considered paid immediately unless it's a credit sale
          // Outstanding = ERP invoices unpaid + POS credit sales
          const outstandingBalance = (totalInvoiced - totalPaid) + totalPosCredit;

          return {
            ...customer,
            stats: {
              totalInvoices: invoiceStats._count,
              totalInvoiced,
              totalPaid,
              outstandingBalance,
              totalOrders: orderStats._count,
              totalOrdersAmount: totalOrders,
              totalPosSales: posSalesStats._count,
              totalPosSalesAmount: totalPosSales,
              totalPosCredit: posCreditStats._count,
              totalPosCreditAmount: totalPosCredit,
              grandTotalSales: totalInvoiced + totalOrders + totalPosSales,
            },
          };
        })
      );

      return { status: true, data: ledgerData };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  // ─── Get detailed transactions for a customer ─────────────────────
  async getCustomerTransactions(customerId: string) {
    try {
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        include: {
          salesInvoices: {
            orderBy: { invoiceDate: 'desc' },
            include: {
              items: {
                include: {
                  item: {
                    select: {
                      description: true,
                      sku: true,
                    },
                  },
                },
              },
            },
          },
          salesOrders: {
            orderBy: { orderDate: 'desc' },
            include: {
              items: {
                include: {
                  item: {
                    select: {
                      description: true,
                      sku: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!customer) {
        return { status: false, message: 'Customer not found', data: null };
      }

      // Fetch POS sales for this customer
      const posSales = await this.prisma.salesOrder.findMany({
        where: {
          customerId: customerId,
          status: { in: ['completed', 'partially_returned', 'returned'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          orderNumber: true,
          grandTotal: true,
          paymentMethod: true,
          paymentStatus: true,
          status: true,
          createdAt: true,
          items: {
            include: {
              item: {
                select: {
                  description: true,
                  sku: true,
                },
              },
            },
          },
        },
      });

      return { 
        status: true, 
        data: {
          ...customer,
          posSales,
        },
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }
}
