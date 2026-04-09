import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { CreateReceiptVoucherDto } from './dto/create-receipt-voucher.dto';
import { UpdateReceiptVoucherDto } from './dto/update-receipt-voucher.dto';

@Injectable()
export class ReceiptVoucherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
  ) {}

  async create(dto: CreateReceiptVoucherDto) {
    const { details, invoices, ...data } = dto;

    const totalCredit = details.reduce((s, d) => s + Number(d.credit), 0);
    const debitAmount = Number(data.debitAmount);

    if (Math.abs(totalCredit - debitAmount) > 0.01) {
      throw new BadRequestException('Total Credit must equal Debit Amount');
    }
    if (debitAmount === 0) {
      throw new BadRequestException('Transaction amount must be greater than 0');
    }

    // ── Validate invoice receipts ────────────────────────────────────────────
    if (invoices && invoices.length > 0) {
      let totalInvoiceAmount = 0;
      for (const inv of invoices) {
        const si = await this.prisma.eRPSalesInvoice.findUnique({
          where: { id: inv.salesInvoiceId },
        });
        if (!si) throw new BadRequestException(`Sales invoice not found: ${inv.salesInvoiceId}`);
        if (si.status === 'CANCELLED') throw new BadRequestException(`Invoice ${si.invoiceNo} is cancelled`);
        if (Number(si.balanceAmount) < Number(inv.receivedAmount) - 0.01) {
          throw new BadRequestException(
            `Receipt ${inv.receivedAmount} exceeds balance ${si.balanceAmount} for invoice ${si.invoiceNo}`
          );
        }
        totalInvoiceAmount += Number(inv.receivedAmount);
      }
      if (totalInvoiceAmount > debitAmount + 0.01) {
        throw new BadRequestException(
          `Invoice receipts total (${totalInvoiceAmount}) cannot exceed voucher debit amount (${debitAmount})`
        );
      }
    }

    return this.prisma.$transaction(async (prisma) => {
      // Create the receipt voucher
      const rv = await prisma.receiptVoucher.create({
        data: {
          type: data.type,
          rvNo: data.rvNo,
          rvDate: data.rvDate,
          refBillNo: data.refBillNo,
          billDate: data.billDate,
          chequeNo: data.chequeNo,
          chequeDate: data.chequeDate,
          debitAccountId: data.debitAccountId,
          debitAmount: data.debitAmount,
          customerId: data.customerId || undefined,
          description: data.description,
          status: data.status || 'approved',
          details: { 
            create: details.map(d => ({
              accountId: d.accountId,
              credit: Number(d.credit)
            }))
          },
        },
        include: {
          details: { include: { account: true } },
          debitAccount: true,
        },
      });

      // ── Update sales invoice payment statuses ────────────────────────────
      if (invoices && invoices.length > 0) {
        for (const inv of invoices) {
          const si = await prisma.eRPSalesInvoice.findUnique({ where: { id: inv.salesInvoiceId } });
          if (si) {
            const newPaid = Number(si.paidAmount) + Number(inv.receivedAmount);
            const newBalance = Number(si.grandTotal) - newPaid;
            let paymentStatus = 'UNPAID';
            if (newBalance <= 0.01) paymentStatus = 'FULLY_PAID';
            else if (newPaid > 0) paymentStatus = 'PARTIALLY_PAID';

            const invoiceStatus = newBalance <= 0.01 ? 'PAID' : newPaid > 0 ? 'PARTIAL' : 'PENDING';

            await prisma.eRPSalesInvoice.update({
              where: { id: inv.salesInvoiceId },
              data: {
                paidAmount: newPaid,
                balanceAmount: Math.max(0, newBalance),
                paymentStatus,
                status: invoiceStatus as any,
              },
            });

            await prisma.receiptVoucherToInvoice.create({
              data: {
                receiptVoucherId: rv.id,
                salesInvoiceId: inv.salesInvoiceId,
                receivedAmount: inv.receivedAmount,
              },
            });
          }
        }
      }

      // ── Post journal lines ───────────────────────────────────────────────
      // Debit: bank/cash account (money coming in)
      // Credit: A/R or customer account (reduces receivable)
      const creditLines = details.map(d => ({
        accountId: d.accountId,
        debit: 0,
        credit: Number(d.credit),
      }));
      const debitLines = [{ accountId: data.debitAccountId, debit: debitAmount, credit: 0 }];

      await this.accounting.postLines([...debitLines, ...creditLines], {
        sourceType: 'RECEIPT_VOUCHER',
        sourceId: rv.id,
        sourceRef: rv.rvNo,
        description: data.description || `Receipt Voucher: ${rv.rvNo}`,
        transactionDate: new Date(data.rvDate),
      }, prisma);

      return rv;
    });
  }

  async findAll(type?: string) {
    const where = type ? { type } : {};
    return this.prisma.receiptVoucher.findMany({
      where,
      include: {
        details: { include: { account: true } },
        debitAccount: true,
        invoices: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const rv = await this.prisma.receiptVoucher.findUnique({
      where: { id },
      include: {
        details: { include: { account: true } },
        debitAccount: true,
        invoices: true,
      },
    });
    if (!rv) throw new NotFoundException(`Receipt Voucher with ID ${id} not found`);
    return rv;
  }

  async update(id: string, dto: UpdateReceiptVoucherDto) {
    const { details, invoices: _invoices, ...data } = dto as any;
    await this.findOne(id);

    // Only scalar fields that Prisma accepts on update
    const scalarData = {
      ...(data.type !== undefined && { type: data.type }),
      ...(data.rvNo !== undefined && { rvNo: data.rvNo }),
      ...(data.rvDate !== undefined && { rvDate: data.rvDate }),
      ...(data.refBillNo !== undefined && { refBillNo: data.refBillNo }),
      ...(data.billDate !== undefined && { billDate: data.billDate }),
      ...(data.chequeNo !== undefined && { chequeNo: data.chequeNo }),
      ...(data.chequeDate !== undefined && { chequeDate: data.chequeDate }),
      ...(data.debitAccountId !== undefined && { debitAccountId: data.debitAccountId }),
      ...(data.debitAmount !== undefined && { debitAmount: data.debitAmount }),
      ...(data.customerId !== undefined && { customerId: data.customerId }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.status !== undefined && { status: data.status }),
    };

    if (details) {
      return this.prisma.$transaction(async (prisma) => {
        await prisma.receiptVoucherDetail.deleteMany({ where: { receiptVoucherId: id } });
        return prisma.receiptVoucher.update({
          where: { id },
          data: { ...scalarData, details: { create: details } },
          include: { details: { include: { account: true } }, debitAccount: true },
        });
      });
    }

    return this.prisma.receiptVoucher.update({
      where: { id },
      data: scalarData,
      include: { details: { include: { account: true } }, debitAccount: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.receiptVoucher.delete({ where: { id } });
  }

  // ── Customer / Invoice helpers ─────────────────────────────────────────────

  async getAllCustomers() {
    return this.prisma.customer.findMany({
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async getPendingInvoicesByCustomer(customerId: string) {
    return this.prisma.eRPSalesInvoice.findMany({
      where: {
        customerId,
        status: { in: ['POSTED', 'PARTIAL'] }, // Changed from PENDING to POSTED
        balanceAmount: { gt: 0 }, // Only invoices with outstanding balance
      },
      select: {
        id: true,
        invoiceNo: true,
        invoiceDate: true,
        grandTotal: true,
        paidAmount: true,
        balanceAmount: true,
        status: true,
        paymentStatus: true,
      },
      orderBy: { invoiceDate: 'asc' },
    });
  }
}
