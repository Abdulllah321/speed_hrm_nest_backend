import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { CreateReceiptVoucherDto } from './dto/create-receipt-voucher.dto';
import { UpdateReceiptVoucherDto } from './dto/update-receipt-voucher.dto';

import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';
import { generateNextRvNumber, generateNextFolioNumber } from '../../common/utils/voucher-number.util';
@Injectable()
export class ReceiptVoucherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private activityLogs: ActivityLogsService,
  ) {}

  async create(dto: CreateReceiptVoucherDto) {
    const { details, invoices, ...data } = dto;

    const totalDebit = details.reduce((sum, item) => sum + Number(item.debit || 0), 0);
    const totalCredit = details.reduce((sum, item) => sum + Number(item.credit || 0), 0);

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new BadRequestException('Total Debit must equal Total Credit');
    }

    if (totalDebit === 0) {
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
      if (totalInvoiceAmount > totalDebit + 0.01) {
        throw new BadRequestException(
          `Invoice receipts total (${totalInvoiceAmount}) cannot exceed voucher debit amount (${totalDebit})`
        );
      }
    }

    return this.prisma.$transaction(async (prisma) => {
      const finalRvNo = await generateNextRvNumber(prisma, data.type, data.rvDate);
      const sequentialFolio = await generateNextFolioNumber(prisma, data.rvDate);

      // Derive debitAccountId from the first debit detail line
      const firstDebitDetail = details.find(d => Number(d.debit) > 0);
      const resolvedDebitAccountId = firstDebitDetail?.accountId ?? data.debitAccountId;
      const resolvedDebitAmount = data.debitAmount || totalDebit || 0;

      const targetStatus = data.status || 'pending';

      // Create the receipt voucher
      const rv = await prisma.receiptVoucher.create({
        data: {
          type: data.type,
          rvNo: finalRvNo,
          folio: sequentialFolio,
          rvDate: data.rvDate,
          refBillNo: data.refBillNo,
          billDate: data.billDate,
          chequeNo: data.chequeNo,
          chequeDate: data.chequeDate,
          debitAccountId: resolvedDebitAccountId,
          debitAmount: resolvedDebitAmount,
          customerId: data.customerId || undefined,
          isAdvance: data.isAdvance ?? false,
          taxType: data.taxType ?? 'Taxable',
          description: data.description,
          status: targetStatus,
          details: { 
            create: details
              .filter(d => Number(d.debit) > 0 || Number(d.credit) > 0)
              .map(d => ({
                accountId:       d.accountId,
                tagAccountId:    d.tagAccountId?.trim() || null,
                debit:           Number(d.debit) || 0,
                credit:          Number(d.credit) || 0,
                narration:       d.narration || data.description || null,
                refBillNo:       d.refBillNo || data.refBillNo || null,
                refBillNo2:      d.refBillNo2 || null,
                taxType: d.taxType ?? data.taxType ?? 'Taxable',
              }))
          },
        },
        include: {
          details: { include: { account: true, tagAccount: true } },
          debitAccount: true,
          customer: true,
        },
      });

      // ── Create invoice links (always) ──
      if (invoices && invoices.length > 0) {
        for (const inv of invoices) {
          await prisma.receiptVoucherToInvoice.create({
            data: {
              receiptVoucherId: rv.id,
              salesInvoiceId: inv.salesInvoiceId,
              receivedAmount: inv.receivedAmount,
            },
          });
        }
      }

      if (targetStatus === 'approved') {
        await this.postReceiptVoucherToLedger(rv.id, prisma);
      }

      return rv;
    });
  }

  async findAll(type?: string) {
    const where = type ? { type } : {};
    return this.prisma.receiptVoucher.findMany({
      where,
      include: {
        details: { include: { account: true, tagAccount: true } },
        debitAccount: true,
        customer: true,
        invoices: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const rv = await this.prisma.receiptVoucher.findUnique({
      where: { id },
      include: {
        details: { include: { account: true, tagAccount: true } },
        debitAccount: true,
        customer: true,
        invoices: true,
      },
    });
    if (!rv) throw new NotFoundException(`Receipt Voucher with ID ${id} not found`);
    return rv;
  }

  async update(id: string, dto: UpdateReceiptVoucherDto) {
    const { details, invoices: _invoices, ...data } = dto as any;
    const existing = await this.findOne(id);

    if (existing.status !== 'pending') {
      throw new BadRequestException('Receipt Voucher can only be edited when it is in pending status');
    }

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
      ...(data.isAdvance !== undefined && { isAdvance: data.isAdvance }),
      ...(data.taxType !== undefined && { taxType: data.taxType }),
    };

    if (details) {
      return this.prisma.$transaction(async (prisma) => {
        await prisma.receiptVoucherDetail.deleteMany({ where: { receiptVoucherId: id } });
        return prisma.receiptVoucher.update({
          where: { id },
          data: {
            ...scalarData,
            details: {
              create: details
                .filter(d => Number(d.debit) > 0 || Number(d.credit) > 0)
                .map(d => ({
                  accountId:       d.accountId,
                  tagAccountId:    d.tagAccountId?.trim() || null,
                  debit:           Number(d.debit) || 0,
                  credit:          Number(d.credit) || 0,
                  narration:       d.narration || data.description || null,
                  refBillNo:       d.refBillNo || data.refBillNo || null,
                  refBillNo2:      d.refBillNo2 || null,
                  taxType: d.taxType ?? data.taxType ?? 'Taxable',
                })),
            },
          },
          include: { details: { include: { account: true, tagAccount: true } }, debitAccount: true, customer: true },
        });
      });
    }

    return this.prisma.receiptVoucher.update({
      where: { id },
      data: scalarData,
      include: { details: { include: { account: true, tagAccount: true } }, debitAccount: true, customer: true },
    });
  }

  async remove(id: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'pending') {
      throw new BadRequestException('Receipt Voucher can only be deleted when it is in pending status');
    }
    return this.prisma.receiptVoucher.delete({ where: { id } });
  }

  async updateStatus(id: string, status: string, remarks?: string) {
    const existing = await this.findOne(id);

    const validStatuses = ['pending', 'approved', 'rejected'];
    if (!validStatuses.includes(status)) {
      throw new BadRequestException('Invalid status. Must be pending, approved, or rejected');
    }

    if (existing.status !== 'pending') {
      throw new BadRequestException('Receipt Voucher status can only be changed when it is in pending status');
    }

    return this.prisma.$transaction(async (prisma) => {
      const updated = await prisma.receiptVoucher.update({
        where: { id },
        data: {
          status,
          ...(remarks && { description: remarks }),
        },
        include: {
          details: {
            include: {
              account: true,
            },
          },
          debitAccount: true,
          customer: true,
        },
      });

      if (status === 'approved') {
        await this.postReceiptVoucherToLedger(id, prisma);
      }

      return updated;
    });
  }

  private async postReceiptVoucherToLedger(voucherId: string, prisma: any) {
    const voucher = await prisma.receiptVoucher.findUnique({
      where: { id: voucherId },
      include: {
        details: true,
      },
    });
    if (!voucher) return;

    const details = voucher.details;
    const totalDebit = details.reduce((sum, item) => sum + Number(item.debit || 0), 0);

    const invoices = await prisma.receiptVoucherToInvoice.findMany({
      where: { receiptVoucherId: voucherId },
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
        }
      }
    }

    // ── Post journal lines ───────────────────────────────────────────────
    if (totalDebit > 0) {
      const allLines = details
        .filter(d => Number(d.debit) > 0 || Number(d.credit) > 0)
        .map(d => ({
          accountId:       d.accountId,
          tagAccountId:    d.tagAccountId?.trim() || undefined,
          debit:           Number(d.debit) || 0,
          credit:          Number(d.credit) || 0,
          narration:       d.narration || voucher.description || undefined,
          refBillNo:       d.refBillNo || voucher.refBillNo || undefined,
          refBillNo2:      d.refBillNo2 || undefined,
          taxType: d.taxType ?? 'Taxable',
        }));

      await this.accounting.postLines(allLines, {
        sourceType: 'RECEIPT_VOUCHER',
        sourceId: voucher.id,
        sourceRef: voucher.rvNo,
        description: voucher.description || `Receipt Voucher: ${voucher.rvNo}`,
        transactionDate: new Date(voucher.rvDate),
      }, prisma);
    }
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
