import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { CreateJournalVoucherDto } from './dto/create-journal-voucher.dto';
import { UpdateJournalVoucherDto } from './dto/update-journal-voucher.dto';
import { PrismaService } from '../../database/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';
import { generateNextJvNumber, generateNextFolioNumber } from '../../common/utils/voucher-number.util';

@Injectable()
export class JournalVoucherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private activityLogs: ActivityLogsService,
  ) {}

  async create(
    createJournalVoucherDto: CreateJournalVoucherDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const { details, ...data } = createJournalVoucherDto;

      // ── Validate debit = credit ──────────────────────────────────────────
      const totalDebit  = details.reduce((s, d) => s + Number(d.debit),  0);
      const totalCredit = details.reduce((s, d) => s + Number(d.credit), 0);

      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        throw new Error('Total Debit must equal Total Credit');
      }

      const jv = await this.prisma.$transaction(async (prisma) => {
        const sequentialJvNo = await generateNextJvNumber(prisma, data.jvDate);
        const sequentialFolio = await generateNextFolioNumber(prisma, data.jvDate);

        // 1. Persist the voucher + detail lines
        const created = await prisma.journalVoucher.create({
          data: {
            ...data,
            makerId: data.makerId || ctx?.userId || null,
            status: data.status || 'pending_check',
            jvNo: sequentialJvNo,
            folio: sequentialFolio,
            details: {
              create: details.map(d => ({
                accountId:       d.accountId,
                tagAccountId:    d.tagAccountId?.trim() || null,
                debit:           d.debit,
                credit:          d.credit,
                narration:       d.narration || null,
                refBillNo:       d.refBillNo || null,
                refBillNo2:      d.refBillNo2 || null,
                taxType:         d.taxType ?? 'Taxable',
              })),
            },
          },
          include: {
            details: { include: { account: true, tagAccount: true } },
          },
        });

        // 2. Post to AccountTransaction ledger ONLY IF approved and not already posted
        if (created.status === 'approved') {
          const existingTx = await prisma.accountTransaction.findFirst({
            where: { sourceType: 'JOURNAL_VOUCHER', sourceId: created.id },
            select: { id: true },
          });
          if (!existingTx) {
            await this.accounting.postLines(
              details.map(d => ({
                accountId:       d.accountId,
                tagAccountId:    d.tagAccountId?.trim() || undefined,
                debit:           Number(d.debit),
                credit:          Number(d.credit),
                narration:       d.narration       || data.description || undefined,
                refBillNo:       d.refBillNo       || undefined,
                refBillNo2:      d.refBillNo2      || undefined,
                taxType:         d.taxType ?? 'Taxable',
              })),
              {
                sourceType:      'JOURNAL_VOUCHER',
                sourceId:        created.id,
                sourceRef:       created.jvNo,
                description:     data.description ?? undefined,
                transactionDate: new Date(data.jvDate),
              },
              prisma,
            );
          }
        }

        return created;
      });

      runInBackground(
        'Create Journal Voucher',
        this.activityLogs.log({
          userId:      ctx?.userId,
          action:      'create',
          module:      'finance',
          entity:      'JournalVoucher',
          entityId:    jv.id,
          description: `Created journal voucher ${jv.jvNo}`,
          newValues:   JSON.stringify(createJournalVoucherDto),
          ipAddress:   ctx?.ipAddress,
          userAgent:   ctx?.userAgent,
          status:      'success',
        }),
      );

      return jv;
    } catch (error: any) {
      runInBackground(
        'Create Journal Voucher (Failure)',
        this.activityLogs.log({
          userId:       ctx?.userId,
          action:       'create',
          module:       'finance',
          entity:       'JournalVoucher',
          description:  `Failed to create journal voucher`,
          errorMessage: error?.message,
          newValues:    JSON.stringify(createJournalVoucherDto),
          ipAddress:    ctx?.ipAddress,
          userAgent:    ctx?.userAgent,
          status:       'failure',
        }),
      );
      throw error;
    }
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
    status?: string;
    fromDate?: string;
    toDate?: string;
    accountId?: string;
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const { status, fromDate, toDate, accountId, page, limit, search } = filters || {};

    const where: any = {};

    const statusWhere = this.buildStatusWhere(status);
    if (statusWhere) where.status = statusWhere;

    if (fromDate || toDate) {
      where.jvDate = {};
      if (fromDate) where.jvDate.gte = new Date(fromDate);
      if (toDate) where.jvDate.lte = new Date(toDate);
    }

    if (accountId && accountId !== 'all') {
      where.details = { some: { accountId } };
    }

    if (search) {
      const cleanSearch = search.trim();
      const searchConditions: any[] = [
        { jvNo: { contains: cleanSearch, mode: 'insensitive' } },
        { folio: { contains: cleanSearch, mode: 'insensitive' } },
        { description: { contains: cleanSearch, mode: 'insensitive' } },
        { details: { some: { narration: { contains: cleanSearch, mode: 'insensitive' } } } },
        { details: { some: { refBillNo: { contains: cleanSearch, mode: 'insensitive' } } } },
        { details: { some: { refBillNo2: { contains: cleanSearch, mode: 'insensitive' } } } },
        { details: { some: { account: { name: { contains: cleanSearch, mode: 'insensitive' } } } } },
        { details: { some: { account: { code: { contains: cleanSearch, mode: 'insensitive' } } } } },
        { details: { some: { tagAccount: { name: { contains: cleanSearch, mode: 'insensitive' } } } } },
        { details: { some: { tagAccount: { code: { contains: cleanSearch, mode: 'insensitive' } } } } },
      ];

      // Match numbers or formatted amounts e.g., "17,938.76" -> 17938.76
      const numericStr = cleanSearch.replace(/,/g, '');
      if (numericStr !== '' && !isNaN(Number(numericStr))) {
        const num = Number(numericStr);
        searchConditions.push(
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

    const queryOptions: any = {
      where,
      include: {
        details: { include: { account: true, tagAccount: true } },
      },
      orderBy: { jvDate: 'desc' },
    };

    if (page !== undefined && limit !== undefined) {
      queryOptions.skip = (page - 1) * limit;
      queryOptions.take = limit;
    }

    const [data, total] = await Promise.all([
      this.prisma.journalVoucher.findMany(queryOptions),
      this.prisma.journalVoucher.count({ where }),
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

  async findOne(id: string) {
    const jv = await this.prisma.journalVoucher.findUnique({
      where: { id },
      include: {
        details: { include: { account: true, tagAccount: true } },
      },
    });

    if (!jv) throw new NotFoundException(`Journal Voucher with ID ${id} not found`);
    return jv;
  }

  async update(
    id: string,
    updateJournalVoucherDto: UpdateJournalVoucherDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const { details, ...data } = updateJournalVoucherDto;
      const existing = await this.findOne(id);

      if (data.status === 'pending_approval' && !data.checkerId) {
        (data as any).checkerId = ctx?.userId || null;
        (data as any).checkedAt = new Date();
      }
      if (data.status === 'approved' && !data.authorizerId) {
        (data as any).authorizerId = ctx?.userId || null;
        (data as any).approvedAt = new Date();
      }

      let updated: any;

      updated = await this.prisma.$transaction(async (prisma) => {
        if (existing.status === 'approved') {
          await this.accounting.unpostLines('JOURNAL_VOUCHER', id, prisma);
        }

        if (details) {
          await prisma.journalVoucherDetail.deleteMany({ where: { journalVoucherId: id } });
        }

        const saved = await prisma.journalVoucher.update({
          where: { id },
          data: {
            ...data,
            ...(details && {
              details: {
                create: details.map(d => ({
                  accountId:       d.accountId,
                  tagAccountId:    d.tagAccountId?.trim() || null,
                  debit:           d.debit,
                  credit:          d.credit,
                  narration:       d.narration || null,
                  refBillNo:       d.refBillNo || null,
                  refBillNo2:      d.refBillNo2 || null,
                  taxType:         d.taxType ?? 'Taxable',
                })),
              },
            }),
          },
          include: {
            details: { include: { account: true, tagAccount: true } },
          },
        });

        const targetStatus = data.status || existing.status;
        if (targetStatus === 'approved') {
          await this.accounting.postLines(
            saved.details.map((d: any) => ({
              accountId:       d.accountId,
              tagAccountId:    d.tagAccountId?.trim() || undefined,
              debit:           Number(d.debit),
              credit:          Number(d.credit),
              narration:       d.narration       || saved.description || undefined,
              refBillNo:       d.refBillNo       || undefined,
              refBillNo2:      d.refBillNo2      || undefined,
              taxType:         d.taxType ?? 'Taxable',
            })),
            {
              sourceType:      'JOURNAL_VOUCHER',
              sourceId:        id,
              sourceRef:       saved.jvNo,
              description:     saved.description ?? undefined,
              transactionDate: new Date(saved.jvDate),
            },
            prisma,
          );
        }

        return saved;
      });

      runInBackground(
        'Update Journal Voucher',
        this.activityLogs.log({
          userId:      ctx?.userId,
          action:      'update',
          module:      'finance',
          entity:      'JournalVoucher',
          entityId:    id,
          description: `Updated journal voucher ${updated.jvNo ?? id}`,
          oldValues:   JSON.stringify(existing),
          newValues:   JSON.stringify(updateJournalVoucherDto),
          ipAddress:   ctx?.ipAddress,
          userAgent:   ctx?.userAgent,
          status:      'success',
        }),
      );

      return updated;
    } catch (error: any) {
      runInBackground(
        'Update Journal Voucher (Failure)',
        this.activityLogs.log({
          userId:       ctx?.userId,
          action:       'update',
          module:       'finance',
          entity:       'JournalVoucher',
          entityId:     id,
          description:  `Failed to update journal voucher ${id}`,
          errorMessage: error?.message,
          newValues:    JSON.stringify(updateJournalVoucherDto),
          ipAddress:    ctx?.ipAddress,
          userAgent:    ctx?.userAgent,
          status:       'failure',
        }),
      );
      throw error;
    }
  }

  async remove(
    id: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const existing = await this.findOne(id);

      await this.prisma.$transaction(async (prisma) => {
        if (existing.status === 'approved') {
          await this.accounting.unpostLines('JOURNAL_VOUCHER', id, prisma);
        }

        await prisma.journalVoucher.delete({ where: { id } });
      });

      runInBackground(
        'Delete Journal Voucher',
        this.activityLogs.log({
          userId:      ctx?.userId,
          action:      'delete',
          module:      'finance',
          entity:      'JournalVoucher',
          entityId:    id,
          description: `Deleted journal voucher ${existing.jvNo}`,
          oldValues:   JSON.stringify(existing),
          ipAddress:   ctx?.ipAddress,
          userAgent:   ctx?.userAgent,
          status:      'success',
        }),
      );

      return { id, deleted: true };
    } catch (error: any) {
      runInBackground(
        'Delete Journal Voucher (Failure)',
        this.activityLogs.log({
          userId:       ctx?.userId,
          action:       'delete',
          module:       'finance',
          entity:       'JournalVoucher',
          entityId:     id,
          description:  `Failed to delete journal voucher ${id}`,
          errorMessage: error?.message,
          ipAddress:    ctx?.ipAddress,
          userAgent:    ctx?.userAgent,
          status:       'failure',
        }),
      );
      throw error;
    }
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
        await this.accounting.unpostLines('JOURNAL_VOUCHER', id, prisma);
      }

      const updated = await prisma.journalVoucher.update({
        where: { id },
        data: updateData,
        include: {
          details: { include: { account: true, tagAccount: true } },
        },
      });

      if (existing.status !== 'approved' && status === 'approved') {
        await this.accounting.postLines(
          updated.details.map(d => ({
            accountId:       d.accountId,
            tagAccountId:    d.tagAccountId?.trim() || undefined,
            debit:           Number(d.debit),
            credit:          Number(d.credit),
            narration:       d.narration       || updated.description || undefined,
            refBillNo:       d.refBillNo       || undefined,
            refBillNo2:      d.refBillNo2      || undefined,
            taxType:         d.taxType ?? 'Taxable',
          })),
          {
            sourceType:      'JOURNAL_VOUCHER',
            sourceId:        updated.id,
            sourceRef:       updated.jvNo,
            description:     updated.description ?? undefined,
            transactionDate: new Date(updated.jvDate),
          },
          prisma,
        );
      }

      return updated;
    });
  }

  async unapprove(id: string, remarks?: string, ctx?: { userId?: string }) {
    return this.updateStatus(id, 'pending_check', remarks || 'Unapproved voucher', ctx);
  }

  async markAsPrinted(id: string, ctx?: { userId?: string }) {
    const existing = await this.prisma.journalVoucher.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Journal Voucher with ID ${id} not found`);
    }

    const updated = await this.prisma.journalVoucher.update({
      where: { id },
      data: { lastPrintedAt: new Date() },
    });

    runInBackground(
      'Log Journal Voucher Printed',
      this.activityLogs.log({
        userId: ctx?.userId,
        action: 'print',
        module: 'journal-voucher',
        entity: 'JournalVoucher',
        entityId: id,
        description: `Printed journal voucher ${updated.jvNo}`,
        status: 'success',
      }),
    );

    return updated;
  }
}
