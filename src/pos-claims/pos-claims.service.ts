import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Decimal } from '@prisma/client/runtime/client';
import { MovementType } from '@prisma/client';

import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { runInBackground } from '../common/utils/run-in-background.util';
import { StockMovementService } from '../warehouse/stock-movement.service';
import { StockLedgerService } from '../warehouse/stock-ledger/stock-ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaMasterService } from '../database/prisma-master.service';

@Injectable()
export class PosClaimsService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
    private stockMovementService: StockMovementService,
    private stockLedgerService: StockLedgerService,
    private notifications: NotificationsService,
    private prismaMaster: PrismaMasterService,
  ) {}

  private async getCurrentItemRate(tx: any, itemId: string): Promise<number> {
    const item = await tx.item.findUnique({
      where: { id: itemId },
      select: { unitCost: true },
    });
    return Number(item?.unitCost || 0);
  }

  private async generateClaimNumber(
    locationId?: string | null,
    tx?: any,
  ): Promise<string> {
    const prismaClient = tx || this.prisma;

    let cleanCode = 'LOC';
    if (locationId) {
      const location = await prismaClient.location.findUnique({
        where: { id: locationId },
        select: { name: true, shortCode: true, code: true },
      });
      if (location) {
        const rawCode =
          location.shortCode?.trim() || location.code?.trim() || location.name;
        cleanCode =
          rawCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'LOC';
      }
    }

    // Fiscal Year Start (Pakistan: July 1st)
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed, July is 6
    const fiscalYearStartYear = month >= 6 ? year : year - 1;
    const fiscalYearEndYear = fiscalYearStartYear + 1;
    const fiscalYearStr = fiscalYearEndYear.toString().slice(-2); // e.g. '27'

    const matchPrefix = `CLM-${cleanCode}${fiscalYearStr}-`;
    const altPrefix = `CLM-${cleanCode}-${fiscalYearStr}-`;

    // Find all claims for this location / fiscal year prefix to get maximum sequence
    const allClaims = await prismaClient.posClaim.findMany({
      where: {
        OR: [
          { claimNumber: { startsWith: matchPrefix } },
          { claimNumber: { startsWith: altPrefix } },
        ],
      },
      select: { claimNumber: true },
    });

    let seq = 1;
    for (const c of allClaims) {
      if (c.claimNumber) {
        const parts = c.claimNumber.split('-');
        const lastPart = parts[parts.length - 1];
        if (/^\d+$/.test(lastPart)) {
          const parsed = parseInt(lastPart, 10);
          if (parsed >= seq) seq = parsed + 1;
        }
      }
    }

    let nextClaimNumber = `${matchPrefix}${String(seq).padStart(5, '0')}`;
    let exists = await prismaClient.posClaim.findUnique({
      where: { claimNumber: nextClaimNumber },
      select: { id: true },
    });

    while (exists) {
      seq++;
      nextClaimNumber = `${matchPrefix}${String(seq).padStart(5, '0')}`;
      exists = await prismaClient.posClaim.findUnique({
        where: { claimNumber: nextClaimNumber },
        select: { id: true },
      });
    }

    return nextClaimNumber;
  }

  async create(
    dto: any,
    createdBy?: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const {
        salesOrderId,
        claimType,
        reasonCode,
        reasonNotes,
        customerName,
        customerPhone,
        items,
      } = dto;

      const order = await this.prisma.salesOrder.findUnique({
        where: { id: salesOrderId },
      });
      if (!order) throw new NotFoundException('Sales order not found');
      if (order.status === 'voided')
        throw new BadRequestException('Cannot claim a voided order');

      const claimNumber = await this.generateClaimNumber(order.locationId);
      const claimedAmount = items.reduce(
        (s: number, i: any) =>
          s + Number(i.unitPaidPrice) * Number(i.claimedQty),
        0,
      );

      const customerPrefix =
        customerName || customerPhone
          ? `[Customer: ${customerName || '-'} | Phone: ${customerPhone || '-'}]`
          : '';
      const fullNotes = [customerPrefix, reasonNotes]
        .filter(Boolean)
        .join('\n');

      const claim = await this.prisma.posClaim.create({
        data: {
          claimNumber,
          salesOrderId,
          claimType: claimType || 'RETURN',
          reasonCode: reasonCode || 'DEFECTIVE',
          reasonNotes: fullNotes || null,
          status: 'SUBMITTED',
          claimedAmount: new Decimal(claimedAmount),
          createdBy: createdBy || null,
          items: {
            create: items.map((i: any) => ({
              salesOrderItemId: i.salesOrderItemId,
              itemId: i.itemId,
              claimedQty: Number(i.claimedQty),
              unitPaidPrice: new Decimal(i.unitPaidPrice),
              claimedAmount: new Decimal(
                Number(i.unitPaidPrice) * Number(i.claimedQty),
              ),
              itemStatus: 'PENDING',
            })),
          },
        },
        include: {
          items: {
            include: { item: { select: { description: true, sku: true } } },
          },
          salesOrder: { select: { orderNumber: true } },
        },
      });

      runInBackground(
        'Create POS Claim',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'pos-claims',
          entity: 'PosClaim',
          entityId: claim.id,
          description: `Submitted POS claim ${claim.claimNumber} for order ${order.orderNumber}`,
          newValues: JSON.stringify(dto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      // 🔔 Notify PLM users about new claim submission
      runInBackground(
        'Notify PLM - New Claim',
        this.notifyPLMUsers({
          title: 'New Claim Submitted',
          message: `Claim ${claim.claimNumber} submitted for order ${order.orderNumber}. Amount: Rs. ${claimedAmount.toLocaleString()}`,
          category: 'claims',
          priority: 'normal',
          actionType: 'view_claim',
          actionPayload: { claimId: claim.id, claimNumber: claim.claimNumber },
          entityType: 'PosClaim',
          entityId: claim.id,
        }),
      );

      return {
        status: true,
        data: claim,
        message: `Claim ${claimNumber} submitted successfully`,
      };
    } catch (error: any) {
      runInBackground(
        'Create POS Claim (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'pos-claims',
          entity: 'PosClaim',
          description: `Failed to submit POS claim`,
          errorMessage: error?.message,
          newValues: JSON.stringify(dto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async findAll(params: { status?: string; limit?: number; page?: number }) {
    const { status, limit = 50, page = 1 } = params;
    const where: any = {};
    if (status && status !== 'ALL') where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.posClaim.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: (page - 1) * limit,
        include: {
          salesOrder: { select: { orderNumber: true } },
          items: {
            select: {
              id: true,
              claimedQty: true,
              approvedQty: true,
              claimedAmount: true,
              approvedAmount: true,
              itemStatus: true,
            },
          },
        },
      }),
      this.prisma.posClaim.count({ where }),
    ]);

    return {
      status: true,
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const claim = await this.prisma.posClaim.findUnique({
      where: { id },
      include: {
        salesOrder: { select: { orderNumber: true, grandTotal: true } },
        items: {
          include: {
            item: {
              select: {
                description: true,
                sku: true,
                barCode: true,
                size: { select: { name: true } },
              },
            },
          },
        },
        voucher: {
          select: {
            id: true,
            code: true,
            voucherType: true,
            faceValue: true,
            expiresAt: true,
            isActive: true,
            isRedeemed: true,
          },
        },
      },
    });
    if (!claim) throw new NotFoundException('Claim not found');

    if (!claim.voucher) {
      const fallbackVoucher = await this.prisma.voucher.findFirst({
        where: {
          OR: [
            { description: { contains: claim.claimNumber } },
            { code: { startsWith: 'CLM-' }, sourceOrderId: claim.salesOrderId },
          ],
        },
        select: {
          id: true,
          code: true,
          voucherType: true,
          faceValue: true,
          expiresAt: true,
          isActive: true,
          isRedeemed: true,
        },
      });
      if (fallbackVoucher) {
        (claim as any).voucher = fallbackVoucher;
      }
    }

    return { status: true, data: claim };
  }

  async startReview(
    id: string,
    reviewedBy?: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const claim = await this.prisma.posClaim.findUnique({ where: { id } });
      if (!claim) throw new NotFoundException('Claim not found');
      if (claim.status !== 'SUBMITTED')
        throw new BadRequestException(`Claim is already ${claim.status}`);

      const updated = await this.prisma.posClaim.update({
        where: { id },
        data: { status: 'UNDER_REVIEW', reviewedBy: reviewedBy || null },
      });

      runInBackground(
        'Start POS Claim Review',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'pos-claims',
          entity: 'PosClaim',
          entityId: updated.id,
          description: `Started review for POS claim ${updated.claimNumber}`,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return {
        status: true,
        data: updated,
        message: 'Claim is now under review',
      };
    } catch (error: any) {
      runInBackground(
        'Start POS Claim Review (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'pos-claims',
          entity: 'PosClaim',
          entityId: id,
          description: `Failed to start review for POS claim`,
          errorMessage: error?.message,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async submitReview(
    id: string,
    dto: {
      items: {
        claimItemId: string;
        approvedQty: number;
        reviewNotes?: string;
      }[];
      reviewNotes?: string;
    },
    reviewedBy?: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const claim = await this.prisma.posClaim.findUnique({
        where: { id },
        include: {
          items: true,
          salesOrder: {
            include: {
              items: true,
            },
          },
        },
      });
      if (!claim) throw new NotFoundException('Claim not found');
      if (!['SUBMITTED', 'UNDER_REVIEW'].includes(claim.status)) {
        throw new BadRequestException(
          `Claim cannot be reviewed in status: ${claim.status}`,
        );
      }

      let totalApproved = new Decimal(0);
      let allApproved = true;
      let anyApproved = false;
      let anyPending = false;
      const newlyApprovedItems: {
        itemId: string;
        approvedQty: number;
        sku: string;
      }[] = [];
      let newApprovedAmount = new Decimal(0);

      await this.prisma.$transaction(
        async (tx) => {
          for (const itemDecision of dto.items) {
            const claimItem = claim.items.find(
              (i) => i.id === itemDecision.claimItemId,
            );
            if (!claimItem) continue;

            const wasAlreadyDecided = [
              'APPROVED',
              'PARTIALLY_APPROVED',
              'REJECTED',
            ].includes(claimItem.itemStatus);

            let approvedQty = claimItem.approvedQty;
            let itemStatus = claimItem.itemStatus;
            let approvedAmount = new Decimal(claimItem.approvedAmount);

            if (wasAlreadyDecided) {
              if (
                itemStatus === 'APPROVED' ||
                itemStatus === 'PARTIALLY_APPROVED'
              ) {
                anyApproved = true;
              }
              totalApproved = totalApproved.add(approvedAmount);
              if (itemStatus !== 'APPROVED') {
                allApproved = false;
              }
              continue;
            }

            // Process decision for pending items
            itemStatus = (itemDecision as any).status || 'REJECTED';

            if (itemStatus === 'PENDING') {
              anyPending = true;
              allApproved = false;
              approvedQty = 0;
            } else if (itemStatus === 'REJECTED' || itemStatus === 'MENDED') {
              approvedQty = 0;
            } else {
              // APPROVED or PARTIALLY_APPROVED
              approvedQty = Math.min(
                Math.max(0, itemDecision.approvedQty),
                claimItem.claimedQty,
              );
              if (approvedQty === 0) {
                itemStatus = 'REJECTED';
              } else if (approvedQty === claimItem.claimedQty) {
                itemStatus = 'APPROVED';
              } else {
                itemStatus = 'PARTIALLY_APPROVED';
              }
            }

            approvedAmount = new Decimal(claimItem.unitPaidPrice).mul(
              approvedQty,
            );

            if (approvedQty > 0) {
              anyApproved = true;

              // Get item details for transfer request
              const itemDetails = await tx.item.findUnique({
                where: { id: claimItem.itemId },
                select: { sku: true, description: true },
              });

              newlyApprovedItems.push({
                itemId: claimItem.itemId,
                approvedQty,
                sku: itemDetails?.sku || 'UNKNOWN',
              });

              newApprovedAmount = newApprovedAmount.add(approvedAmount);
            }
            if (itemStatus !== 'APPROVED') {
              allApproved = false;
            }

            totalApproved = totalApproved.add(approvedAmount);

            if (itemStatus === 'PARTIALLY_APPROVED') {
              const remainingQty = claimItem.claimedQty - approvedQty;
              const remainingClaimedAmt = new Decimal(
                claimItem.unitPaidPrice,
              ).mul(remainingQty);
              const remainingStatus =
                (itemDecision as any).remainingStatus === 'PENDING'
                  ? 'PENDING'
                  : 'REJECTED';

              if (remainingStatus === 'PENDING') {
                anyPending = true;
              }

              await tx.posClaimItem.update({
                where: { id: itemDecision.claimItemId },
                data: {
                  claimedQty: approvedQty,
                  approvedQty,
                  claimedAmount: approvedAmount,
                  approvedAmount,
                  itemStatus: 'APPROVED',
                  reviewNotes: itemDecision.reviewNotes || null,
                },
              });

              await tx.posClaimItem.create({
                data: {
                  claimId: claim.id,
                  salesOrderItemId: claimItem.salesOrderItemId,
                  itemId: claimItem.itemId,
                  claimedQty: remainingQty,
                  approvedQty: 0,
                  unitPaidPrice: claimItem.unitPaidPrice,
                  claimedAmount: remainingClaimedAmt,
                  approvedAmount: 0,
                  itemStatus: remainingStatus,
                  reviewNotes: itemDecision.reviewNotes || null,
                },
              });
            } else {
              await tx.posClaimItem.update({
                where: { id: itemDecision.claimItemId },
                data: {
                  approvedQty,
                  approvedAmount,
                  itemStatus,
                  reviewNotes: itemDecision.reviewNotes || null,
                },
              });
            }
          }

          const allMended = dto.items.every(
            (i: any) => (i.status || i.itemStatus) === 'MENDED',
          );

          const claimStatus = anyPending
            ? 'UNDER_REVIEW'
            : !anyApproved
              ? allMended
                ? 'MENDED'
                : 'REJECTED'
              : allApproved
                ? 'APPROVED'
                : 'PARTIALLY_APPROVED';

          await tx.posClaim.update({
            where: { id },
            data: {
              status: claimStatus,
              approvedAmount: totalApproved,
              reviewNotes: dto.reviewNotes || null,
              reviewedAt: new Date(),
              reviewedBy: reviewedBy || null,
            },
          });
        },
        {
          maxWait: 10000,
          timeout: 15000,
        },
      );

      const updated = await this.findOne(id);

      runInBackground(
        'Submit POS Claim Review',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'pos-claims',
          entity: 'PosClaim',
          entityId: id,
          description: `Submitted review for POS claim ${claim.claimNumber}. Result: ${updated.data.status}.`,
          newValues: JSON.stringify(dto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      // 🔔 Notify POS location about claim decision
      if (anyApproved) {
        if (claim.salesOrder.locationId) {
          runInBackground(
            'Notify POS - Claim Approved',
            this.notifyLocationUsers(claim.salesOrder.locationId, {
              title: '✅ Claim Approved',
              message: `Claim ${claim.claimNumber} has been approved. Amount: Rs. ${totalApproved.toLocaleString()}. Awaiting PLM physical acknowledgment.`,
              category: 'claims',
              priority: 'high',
              actionType: 'view_claim',
              actionPayload: {
                claimId: claim.id,
                claimNumber: claim.claimNumber,
              },
              entityType: 'PosClaim',
              entityId: claim.id,
            }),
          );
        }
      } else {
        if (claim.salesOrder.locationId) {
          runInBackground(
            'Notify POS - Claim Rejected',
            this.notifyLocationUsers(claim.salesOrder.locationId, {
              title: '❌ Claim Rejected',
              message: `Claim ${claim.claimNumber} has been rejected. No amount approved.`,
              category: 'claims',
              priority: 'high',
              actionType: 'view_claim',
              actionPayload: {
                claimId: claim.id,
                claimNumber: claim.claimNumber,
              },
              entityType: 'PosClaim',
              entityId: claim.id,
            }),
          );
        }
      }

      return {
        status: true,
        data: updated.data,
        message: `Claim decision submitted successfully.${anyApproved ? ' Awaiting PLM physical acknowledgment.' : ''}`,
      };
    } catch (error: any) {
      runInBackground(
        'Submit POS Claim Review (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'pos-claims',
          entity: 'PosClaim',
          entityId: id,
          description: `Failed to submit review for POS claim`,
          errorMessage: error?.message,
          newValues: JSON.stringify(dto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async cancel(
    id: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const claim = await this.prisma.posClaim.findUnique({ where: { id } });
      if (!claim) throw new NotFoundException('Claim not found');
      if (['APPROVED', 'REJECTED', 'CANCELLED'].includes(claim.status)) {
        throw new BadRequestException(`Cannot cancel a ${claim.status} claim`);
      }
      const updated = await this.prisma.posClaim.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });

      runInBackground(
        'Cancel POS Claim',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'pos-claims',
          entity: 'PosClaim',
          entityId: updated.id,
          description: `Cancelled POS claim ${updated.claimNumber}`,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return { status: true, data: updated, message: 'Claim cancelled' };
    } catch (error: any) {
      runInBackground(
        'Cancel POS Claim (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'pos-claims',
          entity: 'PosClaim',
          entityId: id,
          description: `Failed to cancel POS claim`,
          errorMessage: error?.message,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async rejectClaim(
    id: string,
    dto: { rejectionReason: string; notes?: string },
    rejectedBy?: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const claim = await this.prisma.posClaim.findUnique({
        where: { id },
        include: { items: true, salesOrder: true },
      });

      if (!claim) throw new NotFoundException('Claim not found');

      if (!['SUBMITTED', 'UNDER_REVIEW'].includes(claim.status)) {
        throw new BadRequestException(
          `Cannot reject claim in status: ${claim.status}`,
        );
      }

      // Update claim and all items to REJECTED
      await this.prisma.$transaction(async (tx) => {
        // Update all claim items to REJECTED
        await tx.posClaimItem.updateMany({
          where: { claimId: id },
          data: {
            itemStatus: 'REJECTED',
            approvedQty: 0,
            approvedAmount: 0,
            reviewNotes: dto.rejectionReason,
          },
        });

        // Update claim to REJECTED
        await tx.posClaim.update({
          where: { id },
          data: {
            status: 'REJECTED',
            approvedAmount: 0,
            reviewNotes: dto.notes || dto.rejectionReason,
            reviewedAt: new Date(),
            reviewedBy: rejectedBy || null,
          },
        });
      });

      const updated = await this.findOne(id);

      runInBackground(
        'Reject POS Claim',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'pos-claims',
          entity: 'PosClaim',
          entityId: id,
          description: `Rejected POS claim ${claim.claimNumber}. Reason: ${dto.rejectionReason}`,
          newValues: JSON.stringify(dto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      // 🔔 Notify POS location about rejection
      if (claim.salesOrder.locationId) {
        runInBackground(
          'Notify POS - Claim Rejected',
          this.notifyLocationUsers(claim.salesOrder.locationId, {
            title: '❌ Claim Rejected',
            message: `Claim ${claim.claimNumber} has been rejected. Reason: ${dto.rejectionReason}. Product ready for pickup.`,
            category: 'claims',
            priority: 'high',
            actionType: 'view_claim',
            actionPayload: {
              claimId: claim.id,
              claimNumber: claim.claimNumber,
            },
            entityType: 'PosClaim',
            entityId: claim.id,
          }),
        );
      }

      return {
        status: true,
        data: updated.data,
        message: 'Claim rejected successfully. No inventory changes made.',
      };
    } catch (error: any) {
      runInBackground(
        'Reject POS Claim (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'pos-claims',
          entity: 'PosClaim',
          entityId: id,
          description: `Failed to reject POS claim`,
          errorMessage: error?.message,
          newValues: JSON.stringify(dto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  // 🔔 Helper: Notify all PLM users (ERP users with claims permission)
  private async notifyPLMUsers(notificationData: {
    title: string;
    message: string;
    category: string;
    priority: 'low' | 'normal' | 'high' | 'urgent';
    actionType?: string;
    actionPayload?: any;
    entityType?: string;
    entityId?: string;
  }) {
    try {
      // Get all users with ERP claims permission
      const plmUsers = await this.prismaMaster.user.findMany({
        where: {
          role: {
            permissions: {
              some: {
                permission: {
                  name: 'erp.claims.read',
                },
              },
            },
          },
        },
        select: { id: true },
      });

      // Send notification to each PLM user
      for (const user of plmUsers) {
        await this.notifications.create({
          userId: user.id,
          ...notificationData,
        });
      }
    } catch (error) {
      console.error('Failed to notify PLM users:', error);
    }
  }

  // 🔔 Helper: Notify users at specific location (POS users)
  private async notifyLocationUsers(
    locationId: string,
    notificationData: {
      title: string;
      message: string;
      category: string;
      priority: 'low' | 'normal' | 'high' | 'urgent';
      actionType?: string;
      actionPayload?: any;
      entityType?: string;
      entityId?: string;
    },
  ) {
    try {
      // Get all users assigned to this location
      const locationUsers = await this.prismaMaster.user.findMany({
        // @ts-ignore
        where: { terminal: { locationId: locationId } },
        select: { id: true },
      });

      // Send notification to each location user
      for (const user of locationUsers) {
        await this.notifications.create({
          userId: user.id,
          ...notificationData,
        });
      }
    } catch (error) {
      console.error('Failed to notify location users:', error);
    }
  }

  private async generateReturnNumber(
    locationId: string,
    tx: any,
  ): Promise<string> {
    let cleanCode = 'LOC';
    if (locationId) {
      const loc = await tx.location.findUnique({
        where: { id: locationId },
        select: { shortCode: true, code: true, name: true },
      });
      if (loc) {
        const rawCode =
          loc.shortCode?.trim() || loc.code?.trim() || loc.name;
        cleanCode =
          rawCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'LOC';
      }
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const fiscalYearStartYear = month >= 6 ? year : year - 1;
    const fiscalYearEndYear = fiscalYearStartYear + 1;
    const fiscalYearStr = fiscalYearEndYear.toString().slice(-2);

    const matchPrefix = `CLM-${cleanCode}${fiscalYearStr}-`;

    const allPosReturns = await tx.posReturn.findMany({
      where: {
        returnNumber: { startsWith: matchPrefix },
      },
      select: { returnNumber: true },
    });

    let seq = 1;
    for (const pr of allPosReturns) {
      if (pr.returnNumber) {
        const parts = pr.returnNumber.split('-');
        const lastPart = parts[parts.length - 1];
        if (/^\d+$/.test(lastPart)) {
          const parsed = parseInt(lastPart, 10);
          if (parsed >= seq) seq = parsed + 1;
        }
      }
    }

    let nextNumber = `${matchPrefix}${String(seq).padStart(5, '0')}`;
    let exists = await tx.posReturn.findUnique({
      where: { returnNumber: nextNumber },
      select: { id: true },
    });

    while (exists) {
      seq++;
      nextNumber = `${matchPrefix}${String(seq).padStart(5, '0')}`;
      exists = await tx.posReturn.findUnique({
        where: { returnNumber: nextNumber },
        select: { id: true },
      });
    }

    return nextNumber;
  }

  private async generateTransferRequestNumber(tx: any): Promise<string> {
    const today = new Date();
    const currentMonth = today.getMonth();
    const startYear =
      currentMonth >= 6 ? today.getFullYear() : today.getFullYear() - 1;
    const endYear = startYear + 1;
    const startYearShort = startYear.toString().slice(-2);
    const endYearShort = endYear.toString().slice(-2);
    const fiscalYearStr = `${startYearShort}-${endYearShort}`;
    const prefix = `STN-${fiscalYearStr}`;

    const lastTR = await tx.transferRequest.findFirst({
      where: { requestNo: { startsWith: prefix } },
      orderBy: { createdAt: 'desc' },
      select: { requestNo: true },
    });
    const seq = lastTR
      ? parseInt(lastTR.requestNo.split('-').pop() || '0', 10) + 1
      : 1;
    return `${prefix}-${String(seq).padStart(4, '0')}`;
  }

  async acknowledgeClaim(
    id: string,
    userId?: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const claim = await this.prisma.posClaim.findUnique({
        where: { id },
        include: {
          items: {
            include: {
              item: {
                select: {
                  id: true,
                  sku: true,
                  description: true,
                  unitCost: true,
                },
              },
            },
          },
          salesOrder: {
            include: {
              customer: true,
              items: true,
            },
          },
        },
      });

      if (!claim) {
        throw new NotFoundException(`Claim ${id} not found`);
      }

      if (claim.status === 'COMPLETED' || claim.status === 'ACKNOWLEDGED') {
        throw new BadRequestException('Claim has already been acknowledged');
      }

      if (
        claim.status !== 'APPROVED' &&
        claim.status !== 'PARTIALLY_APPROVED'
      ) {
        throw new BadRequestException(
          `Claim cannot be acknowledged in status: ${claim.status}. It must be APPROVED first.`,
        );
      }

      const approvedItems = claim.items.filter(
        (i) =>
          ['APPROVED', 'PARTIALLY_APPROVED'].includes(i.itemStatus) &&
          i.approvedQty > 0,
      );

      if (approvedItems.length === 0) {
        throw new BadRequestException(
          'No approved items found to acknowledge in this claim',
        );
      }

      const outletLocationId = claim.salesOrder?.locationId;
      if (!outletLocationId) {
        throw new BadRequestException(
          'Outlet location not found on the original sales order',
        );
      }

      const result = await this.prisma.$transaction(
        async (tx) => {
          // 1. Resolve Locations
          const outletLocation = await tx.location.findUnique({
            where: { id: outletLocationId },
            select: {
              id: true,
              name: true,
              code: true,
              shortCode: true,
              warehouseId: true,
            },
          });

          if (!outletLocation) {
            throw new BadRequestException('Outlet location not found');
          }

          // ⚡ CLAIM SPECIFIC: Find PLM Location (C20001 or name containing PLM)
          let plmLocation = await tx.location.findFirst({
            where: { code: 'C20001', isDeleted: false },
            select: { id: true, name: true, code: true, warehouseId: true },
          });

          if (!plmLocation) {
            plmLocation = await tx.location.findFirst({
              where: {
                isDeleted: false,
                OR: [
                  { code: { contains: 'PLM', mode: 'insensitive' } },
                  { name: { contains: 'PLM', mode: 'insensitive' } },
                ],
              },
              select: { id: true, name: true, code: true, warehouseId: true },
            });
          }

          if (!plmLocation) {
            throw new BadRequestException(
              'PLM Location (C20001) not found for claim return. Please contact admin.',
            );
          }

          // Resolve Warehouses (for schema integrity)
          let outletWarehouseId = outletLocation.warehouseId;
          let plmWarehouseId = plmLocation.warehouseId;

          if (!outletWarehouseId || !plmWarehouseId) {
            const defaultWarehouse = await tx.warehouse.findFirst({
              where: { isActive: true },
              select: { id: true },
            });
            if (!outletWarehouseId) outletWarehouseId = defaultWarehouse?.id;
            if (!plmWarehouseId) plmWarehouseId = defaultWarehouse?.id;
          }

          // 2. Generate POS Return Number & Totals
          const returnNumber = await this.generateReturnNumber(
            outletLocation.id,
            tx,
          );

          let totalSubtotalWost = 0;
          let totalTaxAmount = 0;
          let totalRefundAmount = 0;

          const returnItemsData = approvedItems.map((item) => {
            const soi = claim.salesOrder?.items?.find(
              (s: any) => s.id === item.salesOrderItemId,
            );
            const refundPerUnit = Number(item.unitPaidPrice);
            const taxPercent = Number(soi?.taxPercent || 0);
            const unitPriceWost =
              taxPercent > 0
                ? refundPerUnit / (1 + taxPercent / 100)
                : refundPerUnit;
            const lineTotal = refundPerUnit * item.approvedQty;
            const lineTotalWost = unitPriceWost * item.approvedQty;
            const taxAmt = lineTotal - lineTotalWost;

            totalSubtotalWost += lineTotalWost;
            totalTaxAmount += taxAmt;
            totalRefundAmount += lineTotal;

            return {
              salesOrderItemId: item.salesOrderItemId,
              itemId: item.itemId,
              quantity: item.approvedQty,
              originalUnitPrice: new Decimal(refundPerUnit),
              originalPaidPerUnit: new Decimal(refundPerUnit),
              refundPerUnit: new Decimal(refundPerUnit),
              unitPriceWost: new Decimal(
                Math.round(unitPriceWost * 10000) / 10000,
              ),
              lineTotalWost: new Decimal(Math.round(lineTotalWost * 100) / 100),
              taxPercent: new Decimal(taxPercent),
              taxAmount: new Decimal(Math.round(taxAmt * 100) / 100),
              lineTotal: new Decimal(lineTotal),
              reason: claim.reasonNotes || claim.reasonCode || 'CLAIM_RETURN',
            };
          });

          // 3. Create pos_returns and pos_return_items entry
          const savedPosReturn = await tx.posReturn.create({
            data: {
              returnNumber,
              salesOrderId: claim.salesOrderId,
              originalCustomerId: claim.salesOrder.customerId || null,
              customerId: claim.salesOrder.customerId || null,
              returnType: 'CLAIM',
              refundMode: 'VOUCHER',
              locationId: outletLocation.id,
              createdById: userId || null,
              cashierUserId: userId || null,
              subtotalWost: new Decimal(
                Math.round(totalSubtotalWost * 100) / 100,
              ),
              discountWost: new Decimal(0),
              taxAmount: new Decimal(Math.round(totalTaxAmount * 100) / 100),
              totalRefundAmount: new Decimal(
                Math.round(totalRefundAmount * 100) / 100,
              ),
              reason: claim.reasonNotes || claim.reasonCode || 'CLAIM_RETURN',
              isCrossLocation: false,
              items: {
                create: returnItemsData,
              },
            },
          });

          // 4. Generate or link CLAIM Voucher (Code: CLM-XXXXXX, Type: CLAIM)
          let claimVoucher: any;
          let voucherCode: string = '';

          if (claim.voucherId) {
            claimVoucher = await tx.voucher.findUnique({
              where: { id: claim.voucherId },
            });
            if (claimVoucher) {
              voucherCode = claimVoucher.code;
            }
          }

          if (!claimVoucher) {
            voucherCode = `CLM-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
            const voucherExpiresAt = new Date();
            voucherExpiresAt.setDate(voucherExpiresAt.getDate() + 30); // 30 days expiry

            claimVoucher = await tx.voucher.create({
              data: {
                code: voucherCode,
                voucherType: 'CLAIM',
                faceValue: new Decimal(Math.round(totalRefundAmount * 100) / 100),
                description: `Claim voucher for acknowledged claim ${claim.claimNumber} (Return: ${returnNumber})`,
                customerId: claim.salesOrder.customerId || null,
                requireCustomerMatch: false,
                issuedByLocationId: outletLocation.id,
                issuedByUserId: userId || null,
                sourceOrderId: claim.salesOrderId,
                expiresAt: voucherExpiresAt,
                isActive: true,
                isRedeemed: false,
                locations: {
                  create: {
                    locationId: outletLocation.id,
                  },
                },
                transactions: {
                  create: {
                    action: 'ISSUED',
                    amountUsed: 0,
                    locationId: outletLocation.id,
                    notes: `Issued for acknowledged claim ${claim.claimNumber} (Return: ${returnNumber})`,
                  },
                },
              },
            });
          }

          // Link voucher to posReturn
          await tx.posReturn.update({
            where: { id: savedPosReturn.id },
            data: { voucherId: claimVoucher.id },
          });

          // 5. Create or Update Transfer Request (STN) in COMPLETED status (Location to Location: Outlet Location → PLM Location)
          const now = new Date();
          const transferNotes = claim.reviewNotes?.trim()
            ? `Review Remarks: ${claim.reviewNotes.trim()} | Claim: ${claim.claimNumber} (Return: ${returnNumber}, Voucher: ${voucherCode})`
            : `Auto-generated transfer for claim ${claim.claimNumber} (Return: ${returnNumber}, Voucher: ${voucherCode})`;

          let transferRequest: any;
          if (claim.transferRequestId) {
            transferRequest = await tx.transferRequest.findUnique({
              where: { id: claim.transferRequestId },
            });
          }

          if (transferRequest) {
            transferRequest = await tx.transferRequest.update({
              where: { id: transferRequest.id },
              data: {
                status: 'COMPLETED',
                notes: transferNotes,
                fromLocationId: outletLocation.id,
                fromWarehouseId: null,
                toLocationId: plmLocation.id,
                toWarehouseId: null,
                approvedById: userId || null,
                checkedById: userId || null,
                authorizedById: userId || null,
                sourceApprovedById: userId || null,
                checkedAt: now,
                authorizedAt: now,
                sourceApprovedAt: now,
              },
            });
          } else {
            const transferRequestNo = await this.generateTransferRequestNumber(tx);
            transferRequest = await tx.transferRequest.create({
              data: {
                requestNo: transferRequestNo,
                fromLocationId: outletLocation.id,
                fromWarehouseId: null,
                toLocationId: plmLocation.id,
                toWarehouseId: null,
                transferType: 'CLAIM_TO_PLM',
                status: 'COMPLETED',
                notes: transferNotes,
                createdById: userId || null,
                approvedById: userId || null,
                checkedById: userId || null,
                authorizedById: userId || null,
                sourceApprovedById: userId || null,
                checkedAt: now,
                authorizedAt: now,
                sourceApprovedAt: now,
                items: {
                  create: approvedItems.map((item) => ({
                    itemId: item.itemId,
                    quantity: new Decimal(item.approvedQty),
                  })),
                },
              },
            });
          }

          // Link STN to posReturn
          await tx.posReturn.update({
            where: { id: savedPosReturn.id },
            data: { transferRequestId: transferRequest.id },
          });

          // 6. Stock Movements (Pure Location-to-Location)
          for (const item of approvedItems) {
            const itemRate = await this.getCurrentItemRate(tx, item.itemId);
            const qty = item.approvedQty;

            // 6a. POS Return (Inbound to POS Outlet Location)
            await this.stockLedgerService.createEntry(
              {
                itemId: item.itemId,
                warehouseId: outletWarehouseId,
                locationId: outletLocation.id,
                qty: qty,
                movementType: 'INBOUND',
                referenceType: 'POS_RETURN',
                referenceId: savedPosReturn.id,
                rate: itemRate,
              },
              tx,
            );

            // Increment POS Outlet inventory
            const posStock = await tx.inventoryItem.findFirst({
              where: {
                itemId: item.itemId,
                locationId: outletLocation.id,
                status: 'AVAILABLE',
              },
            });

            if (posStock) {
              await tx.inventoryItem.update({
                where: { id: posStock.id },
                data: { quantity: { increment: qty } },
              });
            } else {
              await tx.inventoryItem.create({
                data: {
                  itemId: item.itemId,
                  warehouseId: outletWarehouseId,
                  locationId: outletLocation.id,
                  quantity: qty,
                  status: 'AVAILABLE',
                },
              });
            }

            // 6b. Outlet Transfer Out (Outbound from POS Outlet Location)
            await this.stockLedgerService.createEntry(
              {
                itemId: item.itemId,
                warehouseId: outletWarehouseId,
                locationId: outletLocation.id,
                qty: -qty,
                movementType: 'OUTBOUND',
                referenceType: 'OUTLET_TRANSFER_OUT',
                referenceId: transferRequest.id,
                rate: itemRate,
              },
              tx,
            );

            // Decrement POS Outlet inventory
            const posStockUpdated = await tx.inventoryItem.findFirst({
              where: {
                itemId: item.itemId,
                locationId: outletLocation.id,
                status: 'AVAILABLE',
              },
            });

            if (posStockUpdated) {
              await tx.inventoryItem.update({
                where: { id: posStockUpdated.id },
                data: { quantity: { decrement: qty } },
              });
            }

            // 6c. PLM Inbound (Inbound to PLM Location)
            await this.stockLedgerService.createEntry(
              {
                itemId: item.itemId,
                warehouseId: plmWarehouseId,
                locationId: plmLocation.id,
                qty: qty,
                movementType: 'INBOUND' as any,
                referenceType: 'CLAIM_ACKNOWLEDGED',
                referenceId: transferRequest.id,
                rate: itemRate,
              },
              tx,
            );

            // Increment PLM Location inventory
            const plmStock = await tx.inventoryItem.findFirst({
              where: {
                itemId: item.itemId,
                warehouseId: plmWarehouseId,
                locationId: plmLocation.id,
                status: 'AVAILABLE',
              },
            });

            if (plmStock) {
              await tx.inventoryItem.update({
                where: { id: plmStock.id },
                data: { quantity: { increment: qty } },
              });
            } else {
              await tx.inventoryItem.create({
                data: {
                  itemId: item.itemId,
                  warehouseId: plmWarehouseId,
                  locationId: plmLocation.id,
                  quantity: qty,
                  status: 'AVAILABLE',
                },
              });
            }
          }

          // 7. Update Claim status and links
          const updatedClaim = await tx.posClaim.update({
            where: { id: claim.id },
            data: {
              status: 'COMPLETED',
              transferRequestId: transferRequest.id,
              voucherId: claimVoucher.id,
            },
          });

          return {
            claim: updatedClaim,
            posReturn: savedPosReturn,
            voucher: claimVoucher,
            transferRequest,
          };
        },
        {
          maxWait: 10000,
          timeout: 20000,
        },
      );

      runInBackground(
        'Acknowledge Claim',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'pos-claims',
          entity: 'PosClaim',
          entityId: claim.id,
          description: `PLM acknowledged claim ${claim.claimNumber}. Sales return ${result.posReturn.returnNumber} and voucher ${result.voucher.code} created.`,
          newValues: JSON.stringify({
            returnNumber: result.posReturn.returnNumber,
            voucherCode: result.voucher.code,
            transferRequestNo: result.transferRequest.requestNo,
            status: 'COMPLETED',
          }),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      // 🔔 Notify POS Location
      if (outletLocationId) {
        runInBackground(
          'Notify POS - Claim Acknowledged',
          this.notifyLocationUsers(outletLocationId, {
            title: '📦 Claim Acknowledged',
            message: `Claim ${claim.claimNumber} acknowledged by PLM. Voucher ${result.voucher.code} has been issued.`,
            category: 'claims',
            priority: 'normal',
            actionType: 'view_claim',
            actionPayload: {
              claimId: claim.id,
              claimNumber: claim.claimNumber,
            },
            entityType: 'PosClaim',
            entityId: claim.id,
          }),
        );
      }

      return {
        status: true,
        data: result,
        message: `Claim acknowledged successfully. Return ${result.posReturn.returnNumber} and Claim Voucher ${result.voucher.code} created.`,
      };
    } catch (error: any) {
      runInBackground(
        'Acknowledge Claim (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'pos-claims',
          entity: 'PosClaim',
          entityId: id,
          description: `Failed to acknowledge claim ${id}`,
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

