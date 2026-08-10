import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CreditNoteService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.creditNote.findMany({
      include: {
        customer: true,
        salesReturn: {
          include: {
            items: true,
          },
        },
        salesInvoice: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const creditNote = await this.prisma.creditNote.findUnique({
      where: { id },
      include: {
        customer: true,
        salesReturn: {
          include: {
            items: {
              include: {
                item: {
                  include: {
                    brand: true,
                    size: true,
                    color: true,
                  },
                },
              },
            },
            warehouse: true,
          },
        },
        salesInvoice: true,
      },
    });

    if (!creditNote) {
      throw new NotFoundException('Credit Note not found');
    }

    return creditNote;
  }
}
