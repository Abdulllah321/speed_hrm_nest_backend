import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateJournalVoucherDto } from './dto/create-journal-voucher.dto';
import { UpdateJournalVoucherDto } from './dto/update-journal-voucher.dto';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class JournalVoucherService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createJournalVoucherDto: CreateJournalVoucherDto) {
    const { details, ...data } = createJournalVoucherDto;

    console.log('dsadsadodsahunhb76tyugfctfc6th76t');
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

    return this.prisma.journalVoucher.create({
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

  async update(id: string, updateJournalVoucherDto: UpdateJournalVoucherDto) {
    const { details, ...data } = updateJournalVoucherDto;

    // Check if exists
    await this.findOne(id);

    // Prepare transaction if details are updated
    // If details are provided, we should probably replace them or update them smarter.
    // For simplicity, let's delete existing and recreate if details are provided.
    // In a real app, this might be more complex to preserve IDs if needed.

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

      return this.prisma.$transaction(async (prisma) => {
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
    }

    return this.prisma.journalVoucher.update({
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

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.journalVoucher.delete({
      where: { id },
    });
  }
}
