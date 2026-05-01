import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Decimal } from '@prisma/client/runtime/client';

import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { runInBackground } from '../common/utils/run-in-background.util';
@Injectable()
export class PosClaimsService {
    constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) { }

    private async generateClaimNumber(): Promise<string> {
        const today = new Date();
        const prefix = `CLM-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
        const last = await this.prisma.posClaim.findFirst({
            where: { claimNumber: { startsWith: prefix } },
            orderBy: { claimNumber: 'desc' },
            select: { claimNumber: true },
        });
        const seq = last ? parseInt(last.claimNumber.split('-').pop() || '0', 10) + 1 : 1;
        return `${prefix}-${String(seq).padStart(4, '0')}`;
    }

    async create(dto: any, createdBy?: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const { salesOrderId, claimType, reasonCode, reasonNotes, items } = dto;

            const order = await this.prisma.salesOrder.findUnique({ where: { id: salesOrderId } });
            if (!order) throw new NotFoundException('Sales order not found');
            if (order.status === 'voided') throw new BadRequestException('Cannot claim a voided order');

            const claimNumber = await this.generateClaimNumber();
            const claimedAmount = items.reduce((s: number, i: any) => s + Number(i.unitPaidPrice) * Number(i.claimedQty), 0);

            const claim = await this.prisma.posClaim.create({
                data: {
                    claimNumber,
                    salesOrderId,
                    claimType: claimType || 'RETURN',
                    reasonCode,
                    reasonNotes: reasonNotes || null,
                    status: 'SUBMITTED',
                    claimedAmount: new Decimal(claimedAmount),
                    createdBy: createdBy || null,
                    items: {
                        create: items.map((i: any) => ({
                            salesOrderItemId: i.salesOrderItemId,
                            itemId: i.itemId,
                            claimedQty: Number(i.claimedQty),
                            unitPaidPrice: new Decimal(i.unitPaidPrice),
                            claimedAmount: new Decimal(Number(i.unitPaidPrice) * Number(i.claimedQty)),
                            itemStatus: 'PENDING',
                        })),
                    },
                },
                include: {
                    items: { include: { item: { select: { description: true, sku: true } } } },
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

            return { status: true, data: claim, message: `Claim ${claimNumber} submitted successfully` };
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
                    items: { select: { id: true, claimedQty: true, approvedQty: true, claimedAmount: true, approvedAmount: true, itemStatus: true } },
                },
            }),
            this.prisma.posClaim.count({ where }),
        ]);

        return { status: true, data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
    }

    async findOne(id: string) {
        const claim = await this.prisma.posClaim.findUnique({
            where: { id },
            include: {
                salesOrder: { select: { orderNumber: true, grandTotal: true } },
                items: {
                    include: {
                        item: { select: { description: true, sku: true, barCode: true } },
                    },
                },
            },
        });
        if (!claim) throw new NotFoundException('Claim not found');
        return { status: true, data: claim };
    }

    async startReview(id: string, reviewedBy?: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const claim = await this.prisma.posClaim.findUnique({ where: { id } });
            if (!claim) throw new NotFoundException('Claim not found');
            if (claim.status !== 'SUBMITTED') throw new BadRequestException(`Claim is already ${claim.status}`);

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

            return { status: true, data: updated, message: 'Claim is now under review' };
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

    async submitReview(id: string, dto: { items: { claimItemId: string; approvedQty: number; reviewNotes?: string }[]; reviewNotes?: string }, reviewedBy?: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const claim = await this.prisma.posClaim.findUnique({
                where: { id },
                include: { items: true },
            });
            if (!claim) throw new NotFoundException('Claim not found');
            if (!['SUBMITTED', 'UNDER_REVIEW'].includes(claim.status)) {
                throw new BadRequestException(`Claim cannot be reviewed in status: ${claim.status}`);
            }

            let totalApproved = new Decimal(0);
            let allApproved = true;
            let anyApproved = false;

            await this.prisma.$transaction(async (tx) => {
                for (const itemDecision of dto.items) {
                    const claimItem = claim.items.find(i => i.id === itemDecision.claimItemId);
                    if (!claimItem) continue;

                    const approvedQty = Math.min(Math.max(0, itemDecision.approvedQty), claimItem.claimedQty);
                    const approvedAmount = new Decimal(claimItem.unitPaidPrice).mul(approvedQty);

                    let itemStatus = 'REJECTED';
                    if (approvedQty === claimItem.claimedQty) itemStatus = 'APPROVED';
                    else if (approvedQty > 0) itemStatus = 'PARTIALLY_APPROVED';

                    if (approvedQty > 0) anyApproved = true;
                    if (approvedQty < claimItem.claimedQty) allApproved = false;

                    totalApproved = totalApproved.add(approvedAmount);

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

                const claimStatus = !anyApproved ? 'REJECTED' : allApproved ? 'APPROVED' : 'PARTIALLY_APPROVED';

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
            });

            const updated = await this.findOne(id);

            runInBackground(
                'Submit POS Claim Review',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-claims',
                    entity: 'PosClaim',
                    entityId: id,
                    description: `Submitted review for POS claim ${claim.claimNumber}. Result: ${updated.data.status}`,
                    newValues: JSON.stringify(dto),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return { status: true, data: updated.data, message: `Claim decision submitted` };
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

    async cancel(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
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
}
