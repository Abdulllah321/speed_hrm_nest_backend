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

      if (data.status === 'pending_approval' && !data.checkerId) {
        (data as any).checkerId = ctx?.userId || null;
        (data as any).checkedAt = new Date();
      }
      if (data.status === 'approved' && !data.authorizerId) {
        (data as any).authorizerId = ctx?.userId || null;
        (data as any).approvedAt = new Date();
      }

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
                  refBillNo2:      d.refBillNo2 || null,
                  taxType:         d.taxType ?? 'Taxable',
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
                refBillNo2:      d.refBillNo2      || undefined,
                taxType:         d.taxType ?? 'Taxable',
              })),
              {
                sourceType:      'JOURNAL_VOUCHER',
                sourceId:        id,
                sourceRef:       saved.jvNo,
                description:     (data as any).description || existing.description || undefined,
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
              refBillNo2:      d.refBillNo2 || undefined,
              taxType:         d.taxType ?? 'Taxable',
            }));
            await this.accounting.postLines(linesToPost, {
              sourceType:      'JOURNAL_VOUCHER',
              sourceId:        id,
              sourceRef:       saved.jvNo,
              description:     saved.description ?? undefined,
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
      const updated = await prisma.journalVoucher.update({
        where: { id },
        data: updateData,
        include: {
          details: { include: { account: true, tagAccount: true } },
        },
      });

      if (status === 'approved') {
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
}
