import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRfqDto } from './dto/create-rfq.dto';
import { UpdateRfqDto, AddVendorsDto } from './dto/update-rfq.dto';

import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';
@Injectable()
export class RfqService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async create(createDto: CreateRfqDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
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

      runInBackground(
        'Create RFQ',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'rfq',
          entity: 'RequestForQuotation',
          entityId: rfq.id,
          description: `Created RFQ ${rfq.rfqNumber} from PR ${pr.prNumber}`,
          newValues: JSON.stringify(createDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return rfq;
    } catch (error: any) {
      runInBackground(
        'Create RFQ (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'rfq',
          entity: 'RequestForQuotation',
          description: `Failed to create RFQ from PR ${createDto.purchaseRequisitionId}`,
          errorMessage: error?.message,
          newValues: JSON.stringify(createDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
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

  async addVendors(id: string, addVendorsDto: AddVendorsDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
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

      const updatedRfq = await this.prisma.requestForQuotation.update({
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

      runInBackground(
        'Add Vendors to RFQ',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'rfq',
          entity: 'RequestForQuotation',
          entityId: id,
          description: `Added vendors to RFQ ${rfq.rfqNumber}`,
          newValues: JSON.stringify(addVendorsDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return updatedRfq;
    } catch (error: any) {
      runInBackground(
        'Add Vendors to RFQ (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'rfq',
          entity: 'RequestForQuotation',
          entityId: id,
          description: `Failed to add vendors to RFQ`,
          errorMessage: error?.message,
          newValues: JSON.stringify(addVendorsDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async markAsSent(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const rfq = await this.findOne(id);

      if (rfq.status !== 'DRAFT') {
        throw new BadRequestException('Only DRAFT RFQs can be marked as SENT');
      }

      if (rfq.vendors.length === 0) {
        throw new BadRequestException('Cannot send RFQ without vendors');
      }

      const updatedRfq = await this.prisma.requestForQuotation.update({
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

      runInBackground(
        'Mark RFQ as Sent',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'rfq',
          entity: 'RequestForQuotation',
          entityId: id,
          description: `Marked RFQ ${rfq.rfqNumber} as SENT`,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return updatedRfq;
    } catch (error: any) {
      runInBackground(
        'Mark RFQ as Sent (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'rfq',
          entity: 'RequestForQuotation',
          entityId: id,
          description: `Failed to mark RFQ as SENT`,
          errorMessage: error?.message,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async update(id: string, updateDto: UpdateRfqDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const rfq = await this.findOne(id);

      if (rfq.status !== 'DRAFT' && updateDto.status !== 'CLOSED') {
        throw new BadRequestException('Only DRAFT RFQs can be edited');
      }

      const updatedRfq = await this.prisma.requestForQuotation.update({
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

      runInBackground(
        'Update RFQ',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'rfq',
          entity: 'RequestForQuotation',
          entityId: id,
          description: `Updated RFQ ${rfq.rfqNumber}`,
          oldValues: JSON.stringify(rfq),
          newValues: JSON.stringify(updateDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return updatedRfq;
    } catch (error: any) {
      runInBackground(
        'Update RFQ (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'rfq',
          entity: 'RequestForQuotation',
          entityId: id,
          description: `Failed to update RFQ`,
          errorMessage: error?.message,
          newValues: JSON.stringify(updateDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async remove(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const rfq = await this.findOne(id);

      if (rfq.status !== 'DRAFT') {
        throw new BadRequestException('Only DRAFT RFQs can be deleted');
      }

      const deleted = await this.prisma.requestForQuotation.delete({
        where: { id },
      });

      runInBackground(
        'Delete RFQ',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'rfq',
          entity: 'RequestForQuotation',
          entityId: id,
          description: `Deleted RFQ ${rfq.rfqNumber}`,
          oldValues: JSON.stringify(rfq),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return deleted;
    } catch (error: any) {
      runInBackground(
        'Delete RFQ (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'rfq',
          entity: 'RequestForQuotation',
          entityId: id,
          description: `Failed to delete RFQ`,
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
