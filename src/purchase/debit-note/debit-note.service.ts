import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DebitNoteService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.debitNote.findMany({
      include: {
        purchaseReturn: true,
        purchaseInvoice: true,
        supplier: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const debitNote = await this.prisma.debitNote.findUnique({
      where: { id },
      include: {
        purchaseReturn: true,
        purchaseInvoice: true,
        supplier: true,
      },
    });

    if (!debitNote) {
      throw new NotFoundException(`Debit Note with ID ${id} not found`);
    }

    return debitNote;
  }

  async findBySupplier(supplierId: string) {
    return this.prisma.debitNote.findMany({
      where: { supplierId },
      include: {
        purchaseReturn: true,
        purchaseInvoice: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByInvoice(purchaseInvoiceId: string) {
    return this.prisma.debitNote.findMany({
      where: { purchaseInvoiceId },
      include: {
        purchaseReturn: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
