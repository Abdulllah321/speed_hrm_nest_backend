import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVendorQuotationDto } from './dto/create-vendor-quotation.dto';
import { UpdateVendorQuotationDto } from './dto/update-vendor-quotation.dto';
import { Decimal } from '@prisma/client/runtime/client';

@Injectable()
export class VendorQuotationService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: CreateVendorQuotationDto) {
    // Verify RFQ exists and vendor is part of it
    const rfq = await this.prisma.requestForQuotation.findUnique({
      where: { id: createDto.rfqId },
      include: {
        vendors: true,
        purchaseRequisition: {
          include: { items: true },
        },
      },
    });

    if (!rfq) {
      throw new NotFoundException('RFQ not found');
    }

    const isVendorInRfq = rfq.vendors.some(
      (v) => v.vendorId === createDto.vendorId,
    );
    if (!isVendorInRfq) {
      throw new BadRequestException('Vendor is not part of this RFQ');
    }

    // Check if quotation already exists for this vendor and RFQ
    const existing = await this.prisma.vendorQuotation.findUnique({
      where: {
        rfqId_vendorId: {
          rfqId: createDto.rfqId,
          vendorId: createDto.vendorId,
        },
      },
    });

    if (existing) {
      throw new BadRequestException(
        'Quotation already exists for this vendor and RFQ',
      );
    }

    // Validate expiry date
    const now = new Date();
    const expiry = new Date(createDto.expiryDate);
    if (isNaN(expiry.getTime()) || expiry <= now) {
      throw new BadRequestException('Expiry date must be a valid future date');
    }

    // Create quotation with items
    const quotation = await this.prisma.vendorQuotation.create({
      data: {
        rfqId: createDto.rfqId,
        vendorId: createDto.vendorId,
        notes: createDto.notes,
        expiryDate: expiry,
        status: 'SUBMITTED', // Auto-submit as per requirement
        items: createDto.items
          ? {
              create: createDto.items.map((item) => {
                const lineTotal = this.calculateLineTotal(
                  item.quotedQty,
                  item.unitPrice,
                  item.taxPercent || 0,
                  item.discountPercent || 0,
                );
                return {
                  itemId: item.itemId,
                  description: item.description,
                  quotedQty: new Decimal(item.quotedQty),
                  unitPrice: new Decimal(item.unitPrice),
                  fob: new Decimal(item.fob || 0),
                  unitCost: new Decimal(item.unitCost || 0),
                  taxPercent: new Decimal(item.taxPercent || 0),
                  discountPercent: new Decimal(item.discountPercent || 0),
                  lineTotal: new Decimal(lineTotal),
                };
              }),
            }
          : undefined,
      },
      include: {
        items: true,
        vendor: true,
        rfq: {
          include: {
            purchaseRequisition: {
              include: { items: true },
            },
          },
        },
      },
    });

    // Recalculate totals
    return this.recalculateTotals(quotation.id);
  }

  async findAll(rfqId?: string) {
    return this.prisma.vendorQuotation.findMany({
      where: {
        ...(rfqId ? { rfqId } : {}),
        OR: [{ expiryDate: null }, { expiryDate: { gt: new Date() } }],
        NOT: { status: 'EXPIRED' },
      },
      include: {
        items: true,
        vendor: true,
        rfq: {
          include: {
            purchaseRequisition: {
              include: { items: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const quotation = await this.prisma.vendorQuotation.findUnique({
      where: { id },
      include: {
        items: true,
        vendor: true,
        rfq: {
          include: {
            purchaseRequisition: {
              include: { items: true },
            },
          },
        },
      },
    });

    if (!quotation) {
      throw new NotFoundException('Vendor quotation not found');
    }

    if (quotation.expiryDate && quotation.expiryDate <= new Date()) {
      throw new NotFoundException('Vendor quotation expired');
    }

    return quotation;
  }

  async compareQuotations(rfqId: string) {
    const quotations = await this.prisma.vendorQuotation.findMany({
      where: {
        rfqId,
        status: { in: ['SUBMITTED', 'SELECTED', 'REJECTED'] },
        OR: [{ expiryDate: null }, { expiryDate: { gt: new Date() } }],
      },
      include: {
        items: true,
        vendor: true,
        rfq: {
          include: {
            purchaseRequisition: {
              include: { items: true },
            },
          },
        },
      },
      orderBy: { totalAmount: 'asc' },
    });

    if (quotations.length === 0) {
      throw new NotFoundException('No submitted quotations found for this RFQ');
    }

    return quotations;
  }

  async selectQuotation(id: string) {
    const quotation = await this.findOne(id);

    if (quotation.status !== 'SUBMITTED') {
      throw new BadRequestException(
        'Only SUBMITTED quotations can be selected',
      );
    }

    // Use transaction to select one and reject others
    return this.prisma.$transaction(async (tx) => {
      // Reject all other quotations for this RFQ
      await tx.vendorQuotation.updateMany({
        where: {
          rfqId: quotation.rfqId,
          id: { not: id },
          status: 'SUBMITTED',
        },
        data: { status: 'REJECTED' },
      });

      // Select this quotation
      return tx.vendorQuotation.update({
        where: { id },
        data: { status: 'SELECTED' },
        include: {
          items: true,
          vendor: true,
          rfq: {
            include: {
              purchaseRequisition: {
                include: { items: true },
              },
            },
          },
        },
      });
    });
  }

  async submitQuotation(id: string) {
    const quotation = await this.findOne(id);

    if (quotation.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT quotations can be submitted');
    }

    if (quotation.items.length === 0) {
      throw new BadRequestException('Cannot submit quotation without items');
    }

    return this.prisma.vendorQuotation.update({
      where: { id },
      data: { status: 'SUBMITTED' },
      include: {
        items: true,
        vendor: true,
        rfq: {
          include: {
            purchaseRequisition: {
              include: { items: true },
            },
          },
        },
      },
    });
  }

  async update(id: string, updateDto: UpdateVendorQuotationDto) {
    const quotation = await this.findOne(id);

    if (quotation.status !== 'DRAFT' && !updateDto.status) {
      throw new BadRequestException('Only DRAFT quotations can be edited');
    }

    const { items, ...data } = updateDto;

    if (items) {
      if (quotation.status !== 'DRAFT') {
        throw new BadRequestException(
          'Cannot modify items unless in DRAFT status',
        );
      }

      return this.prisma.$transaction(async (tx) => {
        await tx.vendorQuotationItem.deleteMany({
          where: { vendorQuotationId: id },
        });

        const updated = await tx.vendorQuotation.update({
          where: { id },
          data: {
            ...data,
            items: {
              create: items.map((item) => {
                const lineTotal = this.calculateLineTotal(
                  item.quotedQty,
                  item.unitPrice,
                  item.taxPercent || 0,
                  item.discountPercent || 0,
                );
                return {
                  itemId: item.itemId,
                  description: item.description,
                  quotedQty: new Decimal(item.quotedQty),
                  unitPrice: new Decimal(item.unitPrice),
                  fob: new Decimal(item.fob || 0),
                  unitCost: new Decimal(item.unitCost || 0),
                  taxPercent: new Decimal(item.taxPercent || 0),
                  discountPercent: new Decimal(item.discountPercent || 0),
                  lineTotal: new Decimal(lineTotal),
                };
              }),
            },
          },
          include: {
            items: true,
            vendor: true,
            rfq: {
              include: {
                purchaseRequisition: {
                  include: { items: true },
                },
              },
            },
          },
        });

        return this.recalculateTotals(id);
      });
    }

    const updated = await this.prisma.vendorQuotation.update({
      where: { id },
      data: data,
      include: {
        items: true,
        vendor: true,
        rfq: {
          include: {
            purchaseRequisition: {
              include: { items: true },
            },
          },
        },
      },
    });

    return updated;
  }

  async remove(id: string) {
    const quotation = await this.findOne(id);

    if (quotation.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT quotations can be deleted');
    }

    return this.prisma.vendorQuotation.delete({
      where: { id },
    });
  }

  private calculateLineTotal(
    qty: number,
    price: number,
    taxPercent: number,
    discountPercent: number,
  ): number {
    const subtotal = qty * price;
    const discountAmount = subtotal * (discountPercent / 100);
    const afterDiscount = subtotal - discountAmount;
    const taxAmount = afterDiscount * (taxPercent / 100);
    return afterDiscount + taxAmount;
  }

  private async recalculateTotals(quotationId: string) {
    const quotation = await this.prisma.vendorQuotation.findUnique({
      where: { id: quotationId },
      include: { items: true },
    });

    if (!quotation) {
      throw new NotFoundException('Quotation not found');
    }

    let subtotal = new Decimal(0);
    let totalTax = new Decimal(0);
    let totalDiscount = new Decimal(0);

    for (const item of quotation.items) {
      const itemSubtotal = item.quotedQty.mul(item.unitPrice);
      const itemDiscount = itemSubtotal.mul(item.discountPercent.div(100));
      const afterDiscount = itemSubtotal.sub(itemDiscount);
      const itemTax = afterDiscount.mul(item.taxPercent.div(100));

      subtotal = subtotal.add(itemSubtotal);
      totalDiscount = totalDiscount.add(itemDiscount);
      totalTax = totalTax.add(itemTax);
    }

    const totalAmount = subtotal.sub(totalDiscount).add(totalTax);

    return this.prisma.vendorQuotation.update({
      where: { id: quotationId },
      data: {
        subtotal,
        taxAmount: totalTax,
        discountAmount: totalDiscount,
        totalAmount,
      },
      include: {
        items: true,
        vendor: true,
        rfq: {
          include: {
            purchaseRequisition: {
              include: { items: true },
            },
          },
        },
      },
    });
  }
}
