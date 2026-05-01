import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FinanceAccountConfigService } from '../../finance/finance-account-config/finance-account-config.service';
import { AccountRoleKey } from '../../finance/finance-account-config/dto/finance-account-config.dto';

import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';
@Injectable()
export class SalesInvoiceService {
  constructor(
    private prisma: PrismaService,
    private financeConfig: FinanceAccountConfigService,
    private activityLogs: ActivityLogsService,
  ) {}

  async findAll(search?: string, status?: string) {
    const where: any = {};

    if (search) {
      where.OR = [
        { invoiceNo: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { salesOrder: { orderNo: { contains: search, mode: 'insensitive' } } },
      ];
    }

    if (status && status !== 'all') {
      where.status = status.toUpperCase();
    }

    const invoices = await this.prisma.eRPSalesInvoice.findMany({
      where,
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
      orderBy: { createdAt: 'desc' },
    });

    return { status: true, data: invoices };
  }

  async findOne(id: string) {
    const salesInvoice = await this.prisma.eRPSalesInvoice.findUnique({
      where: { id },
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

    if (!salesInvoice) {
      throw new NotFoundException('Sales invoice not found');
    }

    return { status: true, data: salesInvoice };
  }

  async update(id: string, updateData: any, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const salesInvoiceResponse = await this.findOne(id);
      const salesInvoice = salesInvoiceResponse.data;

      if (salesInvoice.status === 'PAID') {
        throw new BadRequestException('Cannot update paid invoice');
      }

      const updatedInvoice = await this.prisma.eRPSalesInvoice.update({
        where: { id },
        data: updateData,
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

      runInBackground(
        'Update Sales Invoice',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sales-invoice',
          entity: 'ERPSalesInvoice',
          entityId: id,
          description: `Updated sales invoice ${updatedInvoice.invoiceNo}`,
          oldValues: JSON.stringify(salesInvoice),
          newValues: JSON.stringify(updateData),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return { status: true, data: updatedInvoice };
    } catch (error: any) {
      runInBackground(
        'Update Sales Invoice (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sales-invoice',
          entity: 'ERPSalesInvoice',
          entityId: id,
          description: `Failed to update sales invoice`,
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

  async post(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const salesInvoiceResponse = await this.findOne(id);
      const salesInvoice = salesInvoiceResponse.data;

      if (salesInvoice.status !== 'PENDING') {
        throw new BadRequestException('Only draft invoices can be posted');
      }

      const result = await this.prisma.$transaction(async (tx) => {
        const updatedInvoice = await tx.eRPSalesInvoice.update({
          where: { id },
          data: { status: 'POSTED' },
          include: {
            customer: true,
            warehouse: true,
            salesOrder: true,
            items: true,
          },
        });

        // Create journal entry for accounting
        const journalEntryNo = `JE-${Date.now()}`;

        // Resolve accounts from finance configuration
        const [receivableAccountId, salesAccountId] = await Promise.all([
          this.financeConfig.resolveAccount(AccountRoleKey.ACCOUNTS_RECEIVABLE),
          this.financeConfig.resolveAccount(AccountRoleKey.SALES_REVENUE_WHOLESALE),
        ]);

        await tx.journalVoucher.create({
          data: {
            jvNo: journalEntryNo,
            jvDate: new Date(),
            description: `Sales Invoice: ${updatedInvoice.invoiceNo}`,
            details: {
              create: [
                {
                  accountId: receivableAccountId,
                  debit: updatedInvoice.grandTotal,
                  credit: 0,
                },
                {
                  accountId: salesAccountId,
                  debit: 0,
                  credit: updatedInvoice.subtotal,
                },
              ],
            },
          },
        });

        return updatedInvoice;
      });

      runInBackground(
        'Post Sales Invoice',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sales-invoice',
          entity: 'ERPSalesInvoice',
          entityId: id,
          description: `Posted sales invoice ${result.invoiceNo}`,
          oldValues: JSON.stringify(salesInvoice),
          newValues: JSON.stringify({ status: 'POSTED' }),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return { status: true, data: result };
    } catch (error: any) {
      runInBackground(
        'Post Sales Invoice (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sales-invoice',
          entity: 'ERPSalesInvoice',
          entityId: id,
          description: `Failed to post sales invoice`,
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
      const salesInvoiceResponse = await this.findOne(id);
      const salesInvoice = salesInvoiceResponse.data;

      if (salesInvoice.status === 'CANCELLED') {
        throw new BadRequestException('Invoice is already cancelled');
      }

      if (salesInvoice.status === 'PAID') {
        throw new BadRequestException('Cannot cancel paid invoice');
      }

      const updatedInvoice = await this.prisma.eRPSalesInvoice.update({
        where: { id },
        data: { status: 'CANCELLED' },
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

      runInBackground(
        'Cancel Sales Invoice',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sales-invoice',
          entity: 'ERPSalesInvoice',
          entityId: id,
          description: `Cancelled sales invoice ${updatedInvoice.invoiceNo}`,
          oldValues: JSON.stringify(salesInvoice),
          newValues: JSON.stringify({ status: 'CANCELLED' }),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return { status: true, data: updatedInvoice };
    } catch (error: any) {
      runInBackground(
        'Cancel Sales Invoice (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'sales-invoice',
          entity: 'ERPSalesInvoice',
          entityId: id,
          description: `Failed to cancel sales invoice`,
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