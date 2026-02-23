import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReceiptVoucherDto } from './dto/create-receipt-voucher.dto';
import { UpdateReceiptVoucherDto } from './dto/update-receipt-voucher.dto';

@Injectable()
export class ReceiptVoucherService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createReceiptVoucherDto: CreateReceiptVoucherDto) {
    const { details, ...data } = createReceiptVoucherDto;

    // Validate totals
    const totalCredit = details.reduce(
      (sum, item) => sum + Number(item.credit),
      0,
    );
    const debitAmount = Number(data.debitAmount);

    if (Math.abs(totalCredit - debitAmount) > 0.01) {
      throw new Error('Total Credit must equal Debit Amount');
    }

    return this.prisma.receiptVoucher.create({
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
        debitAccount: true,
      },
    });
  }

  async findAll(type?: string) {
    const where = type ? { type } : {};
    return this.prisma.receiptVoucher.findMany({
      where,
      include: {
        details: {
          include: {
            account: true,
          },
        },
        debitAccount: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const receiptVoucher = await this.prisma.receiptVoucher.findUnique({
      where: { id },
      include: {
        details: {
          include: {
            account: true,
          },
        },
        debitAccount: true,
      },
    });

    if (!receiptVoucher) {
      throw new NotFoundException(`Receipt Voucher with ID ${id} not found`);
    }

    return receiptVoucher;
  }

  async update(id: string, updateReceiptVoucherDto: UpdateReceiptVoucherDto) {
    const { details, ...data } = updateReceiptVoucherDto;

    await this.findOne(id);

    if (details) {
      const totalCredit = details.reduce(
        (sum, item) => sum + Number(item.credit),
        0,
      );
      // Logic similar to create/payment voucher for validation if needed

      return this.prisma.$transaction(async (prisma) => {
        await prisma.receiptVoucherDetail.deleteMany({
          where: { receiptVoucherId: id },
        });

        return prisma.receiptVoucher.update({
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
            debitAccount: true,
          },
        });
      });
    }

    return this.prisma.receiptVoucher.update({
      where: { id },
      data,
      include: {
        details: {
          include: {
            account: true,
          },
        },
        debitAccount: true,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.receiptVoucher.delete({
      where: { id },
    });
  }
}
