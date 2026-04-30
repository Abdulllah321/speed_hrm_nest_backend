import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateJournalVoucherDto } from './dto/create-journal-voucher.dto';
import { UpdateJournalVoucherDto } from './dto/update-journal-voucher.dto';
import { PrismaService } from '../../database/prisma.service';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';

@Injectable()
export class JournalVoucherService {
  constructor(
    private readonly prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async create(
    createJournalVoucherDto: CreateJournalVoucherDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const { details, ...data } = createJournalVoucherDto;

      // Validate that debit equals credit
      const totalDebit = details.reduce(
        (sum, item) => sum + Number(item.debit),
        0,
      );
      const totalCredit = details.reduce(
        (sum, item) => sum + Number(item.credit),
        0,
      );

      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        throw new Error('Total Debit must equal Total Credit');
      }

      const jv = await this.prisma.journalVoucher.create({
        data: {
          ...data,
          details: {
            create: details,
          },
        },
        include: {
          details: {
            include: {
              account: true,
            },
          },
        },
      });

      runInBackground(
        'Create Journal Voucher',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'finance',
          entity: 'JournalVoucher',
          entityId: jv.id,
          description: `Created journal voucher ${jv.jvNo ?? jv.id}`,
          newValues: JSON.stringify(createJournalVoucherDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return jv;
    } catch (error: any) {
      runInBackground(
        'Create Journal Voucher (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'finance',
          entity: 'JournalVoucher',
          description: `Failed to create journal voucher`,
          errorMessage: error?.message,
          newValues: JSON.stringify(createJournalVoucherDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async findAll() {
    return this.prisma.journalVoucher.findMany({
      include: {
        details: {
          include: {
            account: true,
          },
        },
      },
      orderBy: {
        jvDate: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const journalVoucher = await this.prisma.journalVoucher.findUnique({
      where: { id },
      include: {
        details: {
          include: {
            account: true,
          },
        },
      },
    });

    if (!journalVoucher) {
      throw new NotFoundException(`Journal Voucher with ID ${id} not found`);
    }

    return journalVoucher;
  }

  async update(
    id: string,
    updateJournalVoucherDto: UpdateJournalVoucherDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const { details, ...data } = updateJournalVoucherDto;

      // Check if exists
      const existing = await this.findOne(id);

      let updated: any;

      if (details) {
        const totalDebit = details.reduce(
          (sum, item) => sum + Number(item.debit),
          0,
        );
        const totalCredit = details.reduce(
          (sum, item) => sum + Number(item.credit),
          0,
        );

        if (Math.abs(totalDebit - totalCredit) > 0.01) {
          throw new Error('Total Debit must equal Total Credit');
        }

        updated = await this.prisma.$transaction(async (prisma) => {
          await prisma.journalVoucherDetail.deleteMany({
            where: { journalVoucherId: id },
          });

          return prisma.journalVoucher.update({
            where: { id },
            data: {
              ...data,
              details: {
                create: details,
              },
            },
            include: {
              details: {
                include: {
                  account: true,
                },
              },
            },
          });
        });
      } else {
        updated = await this.prisma.journalVoucher.update({
          where: { id },
          data,
          include: {
            details: {
              include: {
                account: true,
              },
            },
          },
        });
      }

      runInBackground(
        'Update Journal Voucher',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'finance',
          entity: 'JournalVoucher',
          entityId: id,
          description: `Updated journal voucher ${updated.jvNumber ?? id}`,
          oldValues: JSON.stringify(existing),
          newValues: JSON.stringify(updateJournalVoucherDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return updated;
    } catch (error: any) {
      runInBackground(
        'Update Journal Voucher (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'finance',
          entity: 'JournalVoucher',
          entityId: id,
          description: `Failed to update journal voucher ${id}`,
          errorMessage: error?.message,
          newValues: JSON.stringify(updateJournalVoucherDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
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

      const deleted = await this.prisma.journalVoucher.delete({
        where: { id },
      });

      runInBackground(
        'Delete Journal Voucher',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'finance',
          entity: 'JournalVoucher',
          entityId: id,
          description: `Deleted journal voucher ${existing.jvNo ?? id}`,
          oldValues: JSON.stringify(existing),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return deleted;
    } catch (error: any) {
      runInBackground(
        'Delete Journal Voucher (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'finance',
          entity: 'JournalVoucher',
          entityId: id,
          description: `Failed to delete journal voucher ${id}`,
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
