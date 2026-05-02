import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer-dto';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';

// Customers visible in ERP: ERP-only + shared
const ERP_TYPES = ['ERP', 'BOTH'] as const;
// Customers visible in POS: POS-only + shared
const POS_TYPES = ['POS', 'BOTH'] as const;

@Injectable()
export class CustomerService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) { }

  // ─── ERP: Create (defaults to ERP type) ──────────────────────────
  async create(createDto: CreateCustomerDto, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const customer = await this.prisma.customer.create({
        data: {
          ...createDto,
          customerType: createDto.customerType ?? 'ERP',
        },
      });

      runInBackground(
        `Created customer ${customer.name}`,
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'sales-customers',
          entity: 'Customer',
          entityId: customer.id,
          description: `Created customer ${customer.name}`,
          newValues: JSON.stringify(createDto),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );

      return { status: true, data: customer, message: 'Customer created successfully' };
    } catch (error: any) {
      runInBackground(
        'Failed to create customer',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'create',
          module: 'sales-customers',
          entity: 'Customer',
          description: 'Failed to create customer',
          errorMessage: error.message,
          newValues: JSON.stringify(createDto),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );
      return { status: false, message: error.message, data: null };
    }
  }

  // ─── ERP: List (ERP + BOTH only) ─────────────────────────────────
  async findAll(search?: string) {
    try {
      const customers = await this.prisma.customer.findMany({
        where: {
          customerType: { in: ERP_TYPES as unknown as any },
          ...(search && {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
              { contactNo: { contains: search, mode: 'insensitive' } },
            ],
          }),
        },
        orderBy: { createdAt: 'desc' },
      });
      return { status: true, data: customers };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  // ─── Shared: Get single by ID (no type restriction — used by both sides) ──
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

  // ─── Shared: Update ───────────────────────────────────────────────
  async update(id: string, updateDto: UpdateCustomerDto, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.customer.findUnique({ where: { id } });
      const customer = await this.prisma.customer.update({
        where: { id },
        data: updateDto,
      });

      runInBackground(
        `Updated customer ${customer.name}`,
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'sales-customers',
          entity: 'Customer',
          entityId: id,
          description: `Updated customer ${customer.name}`,
          oldValues: JSON.stringify(existing),
          newValues: JSON.stringify(updateDto),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );

      return { status: true, data: customer, message: 'Customer updated successfully' };
    } catch (error: any) {
      runInBackground(
        'Failed to update customer',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'sales-customers',
          entity: 'Customer',
          entityId: id,
          description: 'Failed to update customer',
          errorMessage: error.message,
          newValues: JSON.stringify(updateDto),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );
      return { status: false, message: error.message, data: null };
    }
  }

  // ─── Shared: Delete ───────────────────────────────────────────────
  async remove(id: string, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prisma.customer.findUnique({ where: { id } });
      await this.prisma.customer.delete({ where: { id } });

      runInBackground(
        `Deleted customer ${existing?.name}`,
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'sales-customers',
          entity: 'Customer',
          entityId: id,
          description: `Deleted customer ${existing?.name}`,
          oldValues: JSON.stringify(existing),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );

      return { status: true, message: 'Customer deleted successfully' };
    } catch (error: any) {
      runInBackground(
        'Failed to delete customer',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'delete',
          module: 'sales-customers',
          entity: 'Customer',
          entityId: id,
          description: 'Failed to delete customer',
          errorMessage: error.message,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'failure',
        }),
      );
      return { status: false, message: error.message, data: null };
    }
  }

  // ─── POS: Create (defaults to POS type) ──────────────────────────
  async posCreate(createDto: CreateCustomerDto, ctx: { userId?: string; ipAddress?: string; userAgent?: string }) {
    return this.create(
      { ...createDto, customerType: createDto.customerType ?? 'POS' },
      ctx,
    );
  }

  // ─── POS: List (POS + BOTH only) ─────────────────────────────────
  async posFindAll(search?: string) {
    try {
      const customers = await this.prisma.customer.findMany({
        where: {
          customerType: { in: POS_TYPES as unknown as any },
          ...(search && {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
              { contactNo: { contains: search, mode: 'insensitive' } },
            ],
          }),
        },
        orderBy: { createdAt: 'desc' },
      });
      return { status: true, data: customers };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  // ─── ERP Customer Ledger (ERP + BOTH customers only) ─────────────
  async getCustomerLedger(customerId?: string, search?: string) {
    try {
      const where: any = {
        customerType: { in: ERP_TYPES },
      };

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
          customerType: true,
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

      const ledgerData = await Promise.all(
        customers.map(async (customer) => {
          const invoiceStats = await this.prisma.eRPSalesInvoice.aggregate({
            where: { customerId: customer.id },
            _sum: { grandTotal: true, paidAmount: true },
            _count: true,
          });

          const orderStats = await this.prisma.eRPSalesOrder.aggregate({
            where: { customerId: customer.id },
            _sum: { grandTotal: true },
            _count: true,
          });

          const posSalesStats = await this.prisma.salesOrder.aggregate({
            where: {
              customerId: customer.id,
              status: { in: ['completed', 'partially_returned', 'returned'] },
            },
            _sum: { grandTotal: true },
            _count: true,
          });

          const posCreditStats = await this.prisma.salesOrder.aggregate({
            where: {
              customerId: customer.id,
              status: 'completed',
              paymentStatus: 'unpaid',
            },
            _sum: { grandTotal: true },
            _count: true,
          });

          const totalInvoiced = Number(invoiceStats._sum?.grandTotal || 0);
          const totalPaid = Number(invoiceStats._sum?.paidAmount || 0);
          const totalOrders = Number(orderStats._sum?.grandTotal || 0);
          const totalPosSales = Number(posSalesStats._sum?.grandTotal || 0);
          const totalPosCredit = Number(posCreditStats._sum?.grandTotal || 0);
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
        }),
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
                  item: { select: { description: true, sku: true } },
                },
              },
            },
          },
          salesOrders: {
            orderBy: { orderDate: 'desc' },
            include: {
              items: {
                include: {
                  item: { select: { description: true, sku: true } },
                },
              },
            },
          },
        },
      });

      if (!customer) {
        return { status: false, message: 'Customer not found', data: null };
      }

      const posSales = await this.prisma.salesOrder.findMany({
        where: {
          customerId,
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
          tenderType: true,
          status: true,
          locationId: true,
          createdAt: true,
          items: {
            include: {
              item: { select: { description: true, sku: true } },
            },
          },
        },
      });

      // Enrich with location names
      const locationIds = [...new Set(posSales.map(s => s.locationId).filter(Boolean))] as string[];
      const locationMap = new Map<string, string>();
      if (locationIds.length > 0) {
        const locs = await this.prisma.location.findMany({
          where: { id: { in: locationIds } },
          select: { id: true, name: true },
        });
        for (const loc of locs) locationMap.set(loc.id, loc.name);
      }

      const enrichedPosSales = posSales.map(s => ({
        ...s,
        locationName: s.locationId ? (locationMap.get(s.locationId) ?? null) : null,
      }));

      return { status: true, data: { ...customer, posSales: enrichedPosSales } };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  // ─── Record credit payment — mark selected orders as paid ─────────
  async recordCreditPayment(
    customerId: string,
    dto: { orderIds: string[]; paymentMethod: string; notes?: string; cardLast4?: string; slipRef?: string },
    ctx: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!dto.orderIds?.length) {
        return { status: false, message: 'No orders selected.' };
      }

      // Verify all orders belong to this customer and are unpaid
      const orders = await this.prisma.salesOrder.findMany({
        where: {
          id: { in: dto.orderIds },
          customerId,
          paymentStatus: 'unpaid',
        },
        select: { id: true, grandTotal: true, orderNumber: true },
      });

      if (orders.length === 0) {
        return { status: false, message: 'No matching unpaid orders found.' };
      }

      const totalPaid = orders.reduce((sum, o) => sum + Number(o.grandTotal), 0);

      await this.prisma.$transaction(async (tx) => {
        // Mark each order as paid
        await tx.salesOrder.updateMany({
          where: { id: { in: orders.map(o => o.id) } },
          data: {
            paymentStatus: 'paid',
            paymentMethod: dto.paymentMethod,
          },
        });

        // Decrement customer balance
        await tx.customer.update({
          where: { id: customerId },
          data: { balance: { decrement: totalPaid } },
        });
      });

      runInBackground(
        `Credit payment recorded for customer ${customerId}`,
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'sales-customers',
          entity: 'Customer',
          entityId: customerId,
          description: `Recorded credit payment of PKR ${totalPaid} for ${orders.length} order(s)`,
          newValues: JSON.stringify(dto),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );

      return {
        status: true,
        message: `Payment recorded for ${orders.length} order(s). Total: PKR ${totalPaid.toLocaleString()}`,
        data: { orderCount: orders.length, totalPaid },
      };
    } catch (error: any) {
      return { status: false, message: error.message };
    }
  }
}
