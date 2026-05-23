import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateJournalVoucherDto } from './dto/create-journal-voucher.dto';
import { UpdateJournalVoucherDto } from './dto/update-journal-voucher.dto';
import { PrismaService } from '../../database/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';

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
        // 1. Persist the voucher + detail lines
        const created = await prisma.journalVoucher.create({
          data: {
            ...data,
            details: {
              create: details.map(d => ({
                accountId:       d.accountId,
                tagAccountId:    d.tagAccountId?.trim() || null,
                debit:           d.debit,
                credit:          d.credit,
                narration:       d.narration || null,
                refBillNo:       d.refBillNo || null,
                isTaxApplicable: d.isTaxApplicable ?? false,
              })),
            },
          },
          include: {
            details: { include: { account: true, tagAccount: true } },
          },
        });

        // 2. Post to AccountTransaction ledger ONLY IF approved
        if (created.status === 'approved') {
          await this.accounting.postLines(
            details.map(d => ({
              accountId:       d.accountId,
              tagAccountId:    d.tagAccountId?.trim() || undefined,
              debit:           Number(d.debit),
              credit:          Number(d.credit),
              narration:       d.narration       || data.description || undefined,
              refBillNo:       d.refBillNo       || undefined,
              isTaxApplicable: d.isTaxApplicable ?? false,
            })),
            {
              sourceType:      'JOURNAL_VOUCHER',
              sourceId:        created.id,
              sourceRef:       created.jvNo,
              description:     data.description,
              transactionDate: new Date(data.jvDate),
            },
            prisma,
          );
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

  async findAll() {
    return this.prisma.journalVoucher.findMany({
      include: {
        details: { include: { account: true, tagAccount: true } },
      },
      orderBy: { jvDate: 'desc' },
    });
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

      let updated: any;

      if (details) {
        const totalDebit  = details.reduce((s, d) => s + Number(d.debit),  0);
        const totalCredit = details.reduce((s, d) => s + Number(d.credit), 0);

        if (Math.abs(totalDebit - totalCredit) > 0.01) {
          throw new Error('Total Debit must equal Total Credit');
        }

        updated = await this.prisma.$transaction(async (prisma) => {
          // Delete old detail lines
          await prisma.journalVoucherDetail.deleteMany({ where: { journalVoucherId: id } });

          // Reverse old AccountTransaction entries for this voucher ONLY IF previously approved
          if (existing.status === 'approved') {
            const oldLines = existing.details.map((d: any) => ({
              accountId:  d.accountId,
              tagAccountId: d.tagAccountId ?? undefined,
              debit:  Number(d.debit),
              credit: Number(d.credit),
            }));
            if (oldLines.length > 0) {
              await this.accounting.reverseLines(oldLines, {
                sourceType:      'JOURNAL_VOUCHER',
                sourceId:        id,
                sourceRef:       `${existing.jvNo}-REV`,
                description:     `Reversal on edit of ${existing.jvNo}`,
                transactionDate: new Date(),
              }, prisma);
            }
          }

          // Save updated voucher + new detail lines
          const saved = await prisma.journalVoucher.update({
            where: { id },
            data: {
              ...data,
              details: {
                create: details.map(d => ({
                  accountId:       d.accountId,
                  tagAccountId:    d.tagAccountId?.trim() || null,
                  debit:           d.debit,
                  credit:          d.credit,
                  narration:       d.narration || null,
                  refBillNo:       d.refBillNo || null,
                  isTaxApplicable: d.isTaxApplicable ?? false,
                })),
              },
            },
            include: {
              details: { include: { account: true, tagAccount: true } },
            },
          });

          // Post new AccountTransaction entries ONLY IF approved
          const targetStatus = data.status || existing.status;
          if (targetStatus === 'approved') {
            await this.accounting.postLines(
              details.map(d => ({
                accountId:       d.accountId,
                tagAccountId:    d.tagAccountId?.trim() || undefined,
                debit:           Number(d.debit),
                credit:          Number(d.credit),
                narration:       d.narration       || (data as any).description || existing.description || undefined,
                refBillNo:       d.refBillNo       || undefined,
                isTaxApplicable: d.isTaxApplicable ?? false,
              })),
              {
                sourceType:      'JOURNAL_VOUCHER',
                sourceId:        id,
                sourceRef:       saved.jvNo,
                description:     (data as any).description || existing.description,
                transactionDate: new Date((data as any).jvDate || existing.jvDate),
              },
              prisma,
            );
          }

          return saved;
        });
      } else {
        // If details are not updated, but status has changed
        updated = await this.prisma.$transaction(async (prisma) => {
          const saved = await prisma.journalVoucher.update({
            where: { id },
            data,
            include: {
              details: { include: { account: true, tagAccount: true } },
            },
          });

          // Handle state transitions
          if (existing.status !== 'approved' && saved.status === 'approved') {
            // Pending/Rejected -> Approved: post ledger transactions
            const linesToPost = saved.details.map((d: any) => ({
              accountId:       d.accountId,
              tagAccountId:    d.tagAccountId ?? undefined,
              debit:           Number(d.debit),
              credit:          Number(d.credit),
              narration:       d.narration || saved.description || undefined,
              refBillNo:       d.refBillNo || undefined,
              isTaxApplicable: d.isTaxApplicable ?? false,
            }));
            await this.accounting.postLines(linesToPost, {
              sourceType:      'JOURNAL_VOUCHER',
              sourceId:        id,
              sourceRef:       saved.jvNo,
              description:     saved.description,
              transactionDate: new Date(saved.jvDate),
            }, prisma);
          } else if (existing.status === 'approved' && saved.status !== 'approved') {
            // Approved -> Pending/Rejected: reverse ledger transactions
            const oldLines = existing.details.map((d: any) => ({
              accountId:  d.accountId,
              tagAccountId: d.tagAccountId ?? undefined,
              debit:  Number(d.debit),
              credit: Number(d.credit),
            }));
            if (oldLines.length > 0) {
              await this.accounting.reverseLines(oldLines, {
                sourceType:      'JOURNAL_VOUCHER',
                sourceId:        id,
                sourceRef:       `${existing.jvNo}-REV`,
                description:     `Reversal on status change of ${existing.jvNo}`,
                transactionDate: new Date(),
              }, prisma);
            }
          }

          return saved;
        });
      }

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
        // Reverse AccountTransaction entries before deleting ONLY if approved
        if (existing.status === 'approved') {
          const oldLines = existing.details.map((d: any) => ({
            accountId:   d.accountId,
            tagAccountId: d.tagAccountId ?? undefined,
            debit:  Number(d.debit),
            credit: Number(d.credit),
          }));
          if (oldLines.length > 0) {
            await this.accounting.reverseLines(oldLines, {
              sourceType:      'JOURNAL_VOUCHER',
              sourceId:        id,
              sourceRef:       `${existing.jvNo}-DEL`,
              description:     `Reversal on deletion of ${existing.jvNo}`,
              transactionDate: new Date(),
            }, prisma);
          }
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
}
