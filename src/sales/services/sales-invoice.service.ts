import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SalesInvoiceService {
  constructor(private prisma: PrismaService) {}

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
        // stockLedgers: true, // Removed - using referenceId approach instead
      },
    });

    if (!salesInvoice) {
      throw new NotFoundException('Sales invoice not found');
    }

    return { status: true, data: salesInvoice };
  }

  async update(id: string, updateData: any) {
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

    return { status: true, data: updatedInvoice };
  }

  async post(id: string) {
    const salesInvoiceResponse = await this.findOne(id);
    const salesInvoice = salesInvoiceResponse.data;

    if (salesInvoice.status !== 'PENDING') {
      throw new BadRequestException('Only pending invoices can be posted');
    }

    // Start transaction
    return this.prisma.$transaction(async (tx) => {
      // Update invoice status to POSTED (not PAID)
      const updatedInvoice = await tx.eRPSalesInvoice.update({
        where: { id },
        data: { 
          status: 'POSTED',  // Changed from 'PAID' to 'POSTED'
          balanceAmount: salesInvoice.grandTotal, // Set balance amount to full amount
          paidAmount: 0, // No payment received yet
          paymentStatus: 'UNPAID' // Set payment status to unpaid
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

      // NOTE: Stock ledger entries are now created at delivery challan stage
      // No need to create OUTBOUND entries here as inventory is already out

      // Create journal entry for accounting
      const journalEntryNo = `JE-${Date.now()}`;
      
      // Get accounts receivable account (assuming it exists)
      const receivableAccount = await tx.chartOfAccount.findFirst({
        where: { name: { contains: 'Accounts Receivable', mode: 'insensitive' } },
      });

      const salesAccount = await tx.chartOfAccount.findFirst({
        where: { name: { contains: 'Sales Revenue', mode: 'insensitive' } },
      });

      if (receivableAccount && salesAccount) {
        await tx.journalVoucher.create({
          data: {
            jvNo: journalEntryNo,
            jvDate: new Date(),
            description: `Sales Invoice: ${updatedInvoice.invoiceNo}`,
            details: {
              create: [
                {
                  accountId: receivableAccount.id,
                  debit: updatedInvoice.grandTotal,
                  credit: 0,
                },
                {
                  accountId: salesAccount.id,
                  debit: 0,
                  credit: updatedInvoice.subtotal,
                },
              ],
            },
          },
        });
      }

      return { status: true, data: updatedInvoice };
    });
  }

  async cancel(id: string) {
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

    return { status: true, data: updatedInvoice };
  }
}