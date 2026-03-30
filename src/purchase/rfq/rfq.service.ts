import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRfqDto } from './dto/create-rfq.dto';
import { UpdateRfqDto, AddVendorsDto } from './dto/update-rfq.dto';

@Injectable()
export class RfqService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: CreateRfqDto) {
    // Verify PR exists and is APPROVED
    const pr = await this.prisma.purchaseRequisition.findUnique({
      where: { id: createDto.purchaseRequisitionId },
      include: { items: true },
    });

    if (!pr) {
      throw new NotFoundException('Purchase Requisition not found');
    }

    if (pr.status !== 'APPROVED') {
      throw new BadRequestException(
        'Only APPROVED Purchase Requisitions can be converted to RFQ',
      );
    }

    // Generate RFQ number
    const rfqNumber = `RFQ-${Date.now()}`;

    // Create RFQ with optional vendors
    const rfq = await this.prisma.requestForQuotation.create({
      data: {
        rfqNumber,
        purchaseRequisitionId: createDto.purchaseRequisitionId,
        notes: createDto.notes,
        status: 'DRAFT',
        vendors: createDto.vendorIds
          ? {
              create: createDto.vendorIds.map((vendorId) => ({
                vendorId,
                responseStatus: 'PENDING',
              })),
            }
          : undefined,
      },
      include: {
        vendors: {
          include: {
            vendor: true,
          },
        },
        purchaseRequisition: {
          include: {
            items: { include: { item: true } },
          },
        },
      },
    });

    // Update PR status to CONVERTED_TO_RFQ
    await this.prisma.purchaseRequisition.update({
      where: { id: createDto.purchaseRequisitionId },
      data: { status: 'CONVERTED_TO_RFQ' },
    });

    return rfq;
  }

  async findAll(status?: string) {
    return this.prisma.requestForQuotation.findMany({
      where: status && status !== 'ALL' ? { status } : {},
      include: {
        vendors: {
          include: {
            vendor: true,
          },
        },
        purchaseRequisition: {
          include: {
            items: { include: { item: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const rfq = await this.prisma.requestForQuotation.findUnique({
      where: { id },
      include: {
        vendors: {
          include: {
            vendor: true,
          },
        },
        purchaseRequisition: {
          include: {
            items: { include: { item: true } },
          },
        },
      },
    });

    if (!rfq) {
      throw new NotFoundException('RFQ not found');
    }

    return rfq;
  }

  async addVendors(id: string, addVendorsDto: AddVendorsDto) {
    const rfq = await this.findOne(id);

    if (rfq.status !== 'DRAFT') {
      throw new BadRequestException('Vendors can only be added to DRAFT RFQs');
    }

    // Add vendors (skip duplicates)
    const existingVendorIds = rfq.vendors.map((v) => v.vendorId);
    const newVendorIds = addVendorsDto.vendorIds.filter(
      (id) => !existingVendorIds.includes(id),
    );

    if (newVendorIds.length === 0) {
      throw new BadRequestException(
        'All vendors are already added to this RFQ',
      );
    }

    return this.prisma.requestForQuotation.update({
      where: { id },
      data: {
        vendors: {
          create: newVendorIds.map((vendorId) => ({
            vendorId,
            responseStatus: 'PENDING',
          })),
        },
      },
      include: {
        vendors: {
          include: {
            vendor: true,
          },
        },
        purchaseRequisition: {
          include: {
            items: { include: { item: true } },
          },
        },
      },
    });
  }

  async markAsSent(id: string) {
    const rfq = await this.findOne(id);

    if (rfq.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT RFQs can be marked as SENT');
    }

    if (rfq.vendors.length === 0) {
      throw new BadRequestException('Cannot send RFQ without vendors');
    }

    return this.prisma.requestForQuotation.update({
      where: { id },
      data: {
        status: 'SENT',
        vendors: {
          updateMany: {
            where: { rfqId: id },
            data: { sentAt: new Date() },
          },
        },
      },
      include: {
        vendors: {
          include: {
            vendor: true,
          },
        },
        purchaseRequisition: {
          include: {
            items: { include: { item: true } },
          },
        },
      },
    });
  }

  async update(id: string, updateDto: UpdateRfqDto) {
    const rfq = await this.findOne(id);

    if (rfq.status !== 'DRAFT' && updateDto.status !== 'CLOSED') {
      throw new BadRequestException('Only DRAFT RFQs can be edited');
    }

    return this.prisma.requestForQuotation.update({
      where: { id },
      data: {
        notes: updateDto.notes,
        status: updateDto.status,
      },
      include: {
        vendors: {
          include: {
            vendor: true,
          },
        },
        purchaseRequisition: {
          include: {
            items: { include: { item: true } },
          },
        },
      },
    });
  }

  async remove(id: string) {
    const rfq = await this.findOne(id);

    if (rfq.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT RFQs can be deleted');
    }

    return this.prisma.requestForQuotation.delete({
      where: { id },
    });
  }
}
