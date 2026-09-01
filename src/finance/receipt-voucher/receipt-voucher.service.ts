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

  async create(dto: CreateReceiptVoucherDto, ctx?: { userId?: string }) {
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

      const targetStatus = data.status || 'pending_check';

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
          makerId: data.makerId || ctx?.userId || null,
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

  private buildStatusWhere(status?: string) {
    if (!status || status === 'all') return undefined;
    const s = status.toLowerCase().trim();
    if (s === 'pending_check' || s === 'pending') {
      return { in: ['pending_check', 'pending', 'PENDING_CHECK', 'PENDING'] };
    }
    if (s === 'pending_approval' || s === 'pending_approve') {
      return { in: ['pending_approval', 'pending_approve', 'PENDING_APPROVAL', 'PENDING_APPROVE'] };
    }
    if (s === 'approved') {
      return { in: ['approved', 'APPROVED'] };
    }
    if (s === 'rejected') {
      return { in: ['rejected', 'REJECTED'] };
    }
    if (s === 'draft') {
      return { in: ['draft', 'DRAFT'] };
    }
    return { equals: status, mode: 'insensitive' };
  }

  async findAll(filters?: {
    type?: string;
    status?: string;
    fromDate?: string;
    toDate?: string;
    accountId?: string;
    page?: number;
    limit?: number;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const { type, status, fromDate, toDate, accountId, page, limit, search, sortBy, sortOrder } = filters || {};

    const where: any = {};

    if (type && type !== 'all') {
      where.type = { equals: type, mode: 'insensitive' };
    } else {
      where.type = { not: 'rs_rv' };
    }

    const statusWhere = this.buildStatusWhere(status);
    if (statusWhere) where.status = statusWhere;

    if (fromDate || toDate) {
      where.rvDate = {};
      if (fromDate) where.rvDate.gte = new Date(fromDate);
      if (toDate) where.rvDate.lte = new Date(toDate);
    }

    if (accountId && accountId !== 'all') {
      where.OR = [
        { debitAccountId: accountId },
        { details: { some: { accountId } } },
      ];
    }

    if (search) {
      const cleanSearch = search.trim();
      const searchConditions: any[] = [
        { rvNo: { contains: cleanSearch, mode: 'insensitive' } },
        { folio: { contains: cleanSearch, mode: 'insensitive' } },
        { description: { contains: cleanSearch, mode: 'insensitive' } },
        { refBillNo: { contains: cleanSearch, mode: 'insensitive' } },
        { refBillNo2: { contains: cleanSearch, mode: 'insensitive' } },
        { chequeNo: { contains: cleanSearch, mode: 'insensitive' } },
        { receivedFrom: { contains: cleanSearch, mode: 'insensitive' } },
        { debitAccount: { name: { contains: cleanSearch, mode: 'insensitive' } } },
        { debitAccount: { code: { contains: cleanSearch, mode: 'insensitive' } } },
        { customer: { name: { contains: cleanSearch, mode: 'insensitive' } } },
        { customer: { code: { contains: cleanSearch, mode: 'insensitive' } } },
        { details: { some: { narration: { contains: cleanSearch, mode: 'insensitive' } } } },
        { details: { some: { refBillNo: { contains: cleanSearch, mode: 'insensitive' } } } },
        { details: { some: { refBillNo2: { contains: cleanSearch, mode: 'insensitive' } } } },
        { details: { some: { account: { name: { contains: cleanSearch, mode: 'insensitive' } } } } },
        { details: { some: { account: { code: { contains: cleanSearch, mode: 'insensitive' } } } } },
        { details: { some: { tagAccount: { name: { contains: cleanSearch, mode: 'insensitive' } } } } },
        { details: { some: { tagAccount: { code: { contains: cleanSearch, mode: 'insensitive' } } } } },
      ];

      const numericStr = cleanSearch.replace(/,/g, '');
      if (numericStr !== '' && !isNaN(Number(numericStr))) {
        const num = Number(numericStr);
        searchConditions.push(
          { debitAmount: num },
          { details: { some: { debit: num } } },
          { details: { some: { credit: num } } },
        );
      }

      if (where.OR) {
        where.AND = [
          { OR: where.OR },
          { OR: searchConditions },
        ];
        delete where.OR;
      } else {
        where.OR = searchConditions;
      }
    }

    const orderDir = sortOrder === 'asc' ? ('asc' as const) : ('desc' as const);
    let orderBy: any = { rvDate: orderDir };
    if (sortBy === 'rvNo') orderBy = { rvNo: orderDir };
    else if (sortBy === 'rvDate') orderBy = { rvDate: orderDir };
    else if (sortBy === 'status') orderBy = { status: orderDir };
    else if (sortBy === 'createdAt') orderBy = { createdAt: orderDir };
    else if (sortBy === 'type') orderBy = { type: orderDir };
    else if (sortBy === 'folio') orderBy = { folio: orderDir };
    else if (sortBy === 'debitAmount') orderBy = { debitAmount: orderDir };

    const queryOptions: any = {
      where,
      include: {
        details: { include: { account: true, tagAccount: true } },
        debitAccount: true,
        customer: true,
      },
      orderBy,
    };

    if (page !== undefined && limit !== undefined) {
      queryOptions.skip = (page - 1) * limit;
      queryOptions.take = limit;
    }

    const [data, total] = await Promise.all([
      this.prisma.receiptVoucher.findMany(queryOptions),
      this.prisma.receiptVoucher.count({ where }),
    ]);

    if (page !== undefined && limit !== undefined) {
      return {
        data,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      } as any;
    }

    return data as any;
  }

  async findMissingTagAccounts(type?: string) {
    const whereClause: any = {
      details: {
        some: {
          OR: [
            { tagAccountId: null },
            { tagAccountId: '' },
          ],
        },
      },
    };
    if (type) whereClause.type = type;

    const vouchers = await this.prisma.receiptVoucher.findMany({
      where: whereClause,
      include: {
        details: {
          include: {
            account: { select: { id: true, code: true, name: true } },
            tagAccount: { select: { id: true, code: true, name: true } },
          },
        },
        debitAccount: { select: { id: true, code: true, name: true } },
        customer: { select: { id: true, name: true } },
      },
      orderBy: { rvDate: 'desc' },
    });

    const data = vouchers.map((rv) => {
      const affectedDetails = rv.details.filter(d => !d.tagAccountId || d.tagAccountId.trim() === '');
      return {
        id: rv.id,
        rvNo: rv.rvNo,
        type: rv.type,
        rvDate: rv.rvDate,
        status: rv.status,
        debitAccount: rv.debitAccount,
        customer: rv.customer,
        totalDetailsCount: rv.details.length,
        missingTagDetailsCount: affectedDetails.length,
        missingTagDetails: affectedDetails.map((d) => ({
          id: d.id,
          accountId: d.accountId,
          accountCode: d.account?.code || 'N/A',
          accountName: d.account?.name || 'N/A',
          debit: Number(d.debit || 0),
          credit: Number(d.credit || 0),
          narration: d.narration,
          refBillNo: d.refBillNo,
        })),
      };
    });

    return {
      status: true,
      totalVouchersWithMissingTag: data.length,
      totalAffectedDetailLines: data.reduce((sum, v) => sum + v.missingTagDetailsCount, 0),
      data,
    };
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

    return this.prisma.$transaction(async (prisma) => {
      if (existing.status === 'approved') {
        await this.unpostReceiptVoucherFromLedger(id, prisma);
      }

      const targetStatus = data.status || existing.status;
      let updated: any;

      if (details) {
        await prisma.receiptVoucherDetail.deleteMany({ where: { receiptVoucherId: id } });
        updated = await prisma.receiptVoucher.update({
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
      } else {
        updated = await prisma.receiptVoucher.update({
          where: { id },
          data: scalarData,
          include: { details: { include: { account: true, tagAccount: true } }, debitAccount: true, customer: true },
        });
      }

      if (targetStatus === 'approved') {
        await this.postReceiptVoucherToLedger(id, prisma);
      }

      return updated;
    });
  }

  async remove(id: string) {
    const existing = await this.findOne(id);
   
    return this.prisma.$transaction(async (prisma) => {
      if (existing.status === 'approved') {
        await this.unpostReceiptVoucherFromLedger(id, prisma);
      }
      return prisma.receiptVoucher.delete({ where: { id } });
    });
  }

  async updateStatus(id: string, status: string, remarks?: string, ctx?: { userId?: string }) {
    const existing = await this.findOne(id);

    const validStatuses = ['draft', 'pending_check', 'pending_approval', 'approved', 'rejected'];
    if (!validStatuses.includes(status)) {
      throw new BadRequestException('Invalid status. Must be draft, pending_check, pending_approval, approved, or rejected');
    }

    const updateData: any = { status };
    if (remarks) updateData.remarks = remarks;

    if (status === 'pending_approval') {
      updateData.checkerId = ctx?.userId || null;
      updateData.checkedAt = new Date();
    } else if (status === 'approved') {
      updateData.authorizerId = ctx?.userId || null;
      updateData.approvedAt = new Date();
    } else if (status === 'rejected') {
      updateData.rejectionReason = remarks || null;
    }

    return this.prisma.$transaction(async (prisma) => {
      if (existing.status === 'approved' && status !== 'approved') {
        await this.unpostReceiptVoucherFromLedger(id, prisma);
      }

      const updated = await prisma.receiptVoucher.update({
        where: { id },
        data: updateData,
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

      if (existing.status !== 'approved' && status === 'approved') {
        await this.postReceiptVoucherToLedger(id, prisma);
      }

      return updated;
    });
  }

  async unapprove(id: string, remarks?: string, ctx?: { userId?: string }) {
    return this.updateStatus(id, 'pending_check', remarks || 'Unapproved voucher', ctx);
  }

  private async unpostReceiptVoucherFromLedger(voucherId: string, prisma: any) {
    const voucher = await prisma.receiptVoucher.findUnique({
      where: { id: voucherId },
      include: { details: true },
    });
    if (!voucher) return;

    const invoices = await prisma.receiptVoucherToInvoice.findMany({
      where: { receiptVoucherId: voucherId },
    });

    // 1. Revert Sales Invoice payment amounts and statuses
    if (invoices && invoices.length > 0) {
      for (const inv of invoices) {
        const si = await prisma.eRPSalesInvoice.findUnique({ where: { id: inv.salesInvoiceId } });
        if (si) {
          const newPaid = Math.max(0, Number(si.paidAmount) - Number(inv.receivedAmount));
          const newBalance = Number(si.grandTotal) - newPaid;
          let paymentStatus = 'UNPAID';
          if (newBalance <= 0.01) paymentStatus = 'FULLY_PAID';
          else if (newPaid > 0) paymentStatus = 'PARTIALLY_PAID';

          const invoiceStatus = newBalance <= 0.01 ? 'PAID' : newPaid > 0 ? 'PARTIAL' : 'POSTED';

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

    // 2. Unpost GL transactions
    await this.accounting.unpostLines('RECEIPT_VOUCHER', voucherId, prisma);
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
      const existingTx = await prisma.accountTransaction.findFirst({
        where: {
          sourceId: voucher.id,
          sourceType: 'RECEIPT_VOUCHER',
        },
        select: { id: true },
      });
      if (existingTx) {
        return;
      }

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
      select: { id: true, traderId: true, subCode: true, name: true } as any,
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

  async markAsPrinted(id: string, ctx?: { userId?: string }) {
    const existing = await this.prisma.receiptVoucher.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Receipt Voucher with ID ${id} not found`);
    }

    const updated = await this.prisma.receiptVoucher.update({
      where: { id },
      data: { lastPrintedAt: new Date() },
    });

    runInBackground(
      'Log Receipt Voucher Printed',
      this.activityLogs.log({
        userId: ctx?.userId,
        action: 'print',
        module: 'receipt-voucher',
        entity: 'ReceiptVoucher',
        entityId: id,
        description: `Printed receipt voucher ${updated.rvNo}`,
        status: 'success',
      }),
    );

    return updated;
  }
}
