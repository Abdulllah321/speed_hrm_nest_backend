import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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
  ) { }

    private async getCurrentItemRate(tx: any, itemId: string): Promise<number> {
        const item = await tx.item.findUnique({
            where: { id: itemId },
            select: { unitCost: true },
        });
        return Number(item?.unitCost || 0);
    }

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
                })
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
                voucher: {
                    select: {
                        id: true,
                        code: true,
                        voucherType: true,
                        faceValue: true,
                        expiresAt: true,
                        isActive: true,
                        isRedeemed: true,
                    }
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
                include: { 
                    items: true,
                    salesOrder: {
                        include: {
                            items: true,
                        }
                    }
                },
            });
            if (!claim) throw new NotFoundException('Claim not found');
            if (!['SUBMITTED', 'UNDER_REVIEW'].includes(claim.status)) {
                throw new BadRequestException(`Claim cannot be reviewed in status: ${claim.status}`);
            }

            let totalApproved = new Decimal(0);
            let allApproved = true;
            let anyApproved = false;
            const approvedItems: { itemId: string; approvedQty: number; sku: string }[] = [];

            await this.prisma.$transaction(async (tx) => {
                for (const itemDecision of dto.items) {
                    const claimItem = claim.items.find(i => i.id === itemDecision.claimItemId);
                    if (!claimItem) continue;

                    const approvedQty = Math.min(Math.max(0, itemDecision.approvedQty), claimItem.claimedQty);
                    const approvedAmount = new Decimal(claimItem.unitPaidPrice).mul(approvedQty);

                    let itemStatus = 'REJECTED';
                    if (approvedQty === claimItem.claimedQty) itemStatus = 'APPROVED';
                    else if (approvedQty > 0) itemStatus = 'PARTIALLY_APPROVED';

                    if (approvedQty > 0) {
                        anyApproved = true;
                        
                        // Get item details for transfer request
                        const itemDetails = await tx.item.findUnique({
                            where: { id: claimItem.itemId },
                            select: { sku: true, description: true }
                        });
                        
                        approvedItems.push({
                            itemId: claimItem.itemId,
                            approvedQty,
                            sku: itemDetails?.sku || 'UNKNOWN'
                        });
                    }
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

                // ── If approved, create transfer request (inventory will be updated when transfer is processed) ──
                console.log('🔍 Starting transfer creation check:', {
                    anyApproved,
                    approvedItemsLength: approvedItems.length,
                    claimNumber: claim.claimNumber
                });

                if (anyApproved && approvedItems.length > 0) {
                    const salesOrder = claim.salesOrder;
                    
                    console.log('🔍 Sales order info:', {
                        orderNumber: salesOrder.orderNumber,
                        locationId: salesOrder.locationId
                    });
                    
                    // Get POS location with warehouse info
                    const posLocation = await tx.location.findUnique({
                        where: { id: salesOrder.locationId || '' },
                        select: { 
                            id: true, 
                            name: true,
                            warehouseId: true 
                        }
                    });

                    console.log('🔍 POS Location found:', posLocation);

                    if (posLocation) {
                        console.log('✅ POS location found, proceeding with transfer...');
                        
                        // ⚡ CLAIM SPECIFIC: Always send to PLM Warehouse (WH-PLM-002)
                        console.log('🎯 Claim Return: Finding PLM Warehouse...');
                        const plmWarehouse = await tx.warehouse.findFirst({
                            where: { 
                                code: 'WH-PLM-002',
                                isActive: true 
                            },
                            select: { id: true, name: true, code: true }
                        });
                        
                        if (!plmWarehouse) {
                            console.log('❌ PLM Warehouse (WH-PLM-002) not found!');
                            throw new BadRequestException('PLM Warehouse not found for claim return. Please contact admin.');
                        }
                        
                        const plmWarehouseId = plmWarehouse.id;
                        console.log('✅ Using PLM Warehouse:', {
                            name: plmWarehouse.name,
                            code: plmWarehouse.code,
                            id: plmWarehouseId
                        });
                        
                        // Get POS location's original warehouse (for stock validation)
                        let posWarehouseId = posLocation.warehouseId;
                        if (!posWarehouseId) {
                            console.log('⚠️ POS location has no warehouse, using first active warehouse...');
                            const defaultWarehouse = await tx.warehouse.findFirst({
                                where: { isActive: true },
                                select: { id: true, name: true }
                            });
                            if (defaultWarehouse) {
                                posWarehouseId = defaultWarehouse.id;
                                console.log('✅ Using default warehouse:', defaultWarehouse.name);
                            } else {
                                throw new BadRequestException('No warehouse found for POS location');
                            }
                        }
                        
                        console.log('📍 Warehouse IDs:', {
                            posWarehouse: posWarehouseId,
                            plmWarehouse: plmWarehouseId
                        });
                        
                        // Create automatic transfer request from POS location to PLM Warehouse
                        const today = new Date();
                        const prefix = `TR-CLM-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
                        const lastTR = await tx.transferRequest.findFirst({
                            where: { requestNo: { startsWith: prefix } },
                            orderBy: { requestNo: 'desc' },
                            select: { requestNo: true },
                        });
                        const seq = lastTR ? parseInt(lastTR.requestNo.split('-').pop() || '0', 10) + 1 : 1;
                        const transferRequestNo = `${prefix}-${String(seq).padStart(4, '0')}`;

                        const transferRequest = await tx.transferRequest.create({
                            data: {
                                requestNo: transferRequestNo,
                                fromLocationId: posLocation.id,
                                fromWarehouseId: posWarehouseId, // POS location's warehouse
                                toWarehouseId: plmWarehouseId,   // PLM Warehouse
                                transferType: 'CLAIM_TO_PLM',    // Special type for claims
                                status: 'PENDING', // ⚡ Changed to PENDING (requires PLM acknowledgment)
                                notes: `Auto-generated from approved claim ${claim.claimNumber} for order ${salesOrder.orderNumber}. Awaiting PLM acknowledgment before inventory update.`,
                                createdById: reviewedBy || null,
                                items: {
                                    create: approvedItems.map(item => ({
                                        itemId: item.itemId,
                                        quantity: new Decimal(item.approvedQty),
                                    }))
                                }
                            }
                        });
                        
                        console.log('✅ Transfer request created:', {
                            id: transferRequest.id,
                            requestNo: transferRequest.requestNo,
                            status: 'PENDING - Awaiting PLM acknowledgment'
                        });

                        // ⚡ DO NOT update inventory yet - wait for PLM acknowledgment
                        console.log('⏳ Inventory update deferred until PLM acknowledges receipt');
                        
                        // Note: Inventory will be updated when PLM acknowledges the transfer
                        // via the acknowledgeClaim endpoint

                        // Link transfer request to claim
                        await tx.posClaim.update({
                            where: { id },
                            data: { transferRequestId: transferRequest.id }
                        });
                        
                        console.log('✅ Transfer request linked to claim');

                        // ── Generate EXCHANGE voucher for approved claim ──
                        console.log('🎫 Generating exchange voucher for approved claim...');
                        
                        // Calculate total approved amount
                        const totalApprovedAmount = approvedItems.reduce((sum, item) => {
                            return sum + (item.approvedQty * Number(claim.items.find(ci => ci.itemId === item.itemId)?.unitPaidPrice || 0));
                        }, 0);
                        
                        // Generate voucher code
                        const voucherCode = `EXC-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
                        const voucherExpiresAt = new Date();
                        voucherExpiresAt.setDate(voucherExpiresAt.getDate() + 30); // 30 days expiry
                        
                        const exchangeVoucher = await tx.voucher.create({
                            data: {
                                code: voucherCode,
                                voucherType: 'EXCHANGE',
                                faceValue: totalApprovedAmount,
                                description: `Exchange voucher for approved claim ${claim.claimNumber}`,
                                customerId: salesOrder.customerId || null,
                                requireCustomerMatch: false,
                                issuedByLocationId: salesOrder.locationId,
                                issuedByUserId: reviewedBy || null,
                                sourceOrderId: salesOrder.id,
                                expiresAt: voucherExpiresAt,
                                isActive: true,
                                isRedeemed: false,
                                locations: {
                                    create: {
                                        locationId: salesOrder.locationId || ''
                                    }
                                },
                                transactions: {
                                    create: {
                                        action: 'ISSUED',
                                        amountUsed: 0,
                                        locationId: salesOrder.locationId,
                                        notes: `Issued for approved claim ${claim.claimNumber}`,
                                    }
                                }
                            }
                        });
                        
                        console.log('✅ Exchange voucher created:', {
                            code: voucherCode,
                            amount: totalApprovedAmount,
                            expiresAt: voucherExpiresAt
                        });
                        
                        // Link voucher to claim
                        await tx.posClaim.update({
                            where: { id },
                            data: { 
                                transferRequestId: transferRequest.id,
                                voucherId: exchangeVoucher.id  // Link voucher
                            }
                        });
                        
                        console.log('✅ Voucher linked to claim');

                        // Log transfer request creation
                        runInBackground(
                            'Auto-Create Transfer Request from Claim',
                            this.activityLogs.log({
                                userId: ctx?.userId,
                                action: 'create',
                                module: 'transfer-request',
                                entity: 'TransferRequest',
                                entityId: transferRequest.id,
                                description: `Auto-created and completed transfer request ${transferRequestNo} from approved claim ${claim.claimNumber}. Inventory updated: POS → Warehouse`,
                                newValues: JSON.stringify({ claimId: claim.id, transferRequestId: transferRequest.id, autoCompleted: true }),
                                ipAddress: ctx?.ipAddress,
                                userAgent: ctx?.userAgent,
                                status: 'success',
                            }),
                        );
                    } else {
                        console.log('❌ POS location not found:', {
                            locationId: salesOrder.locationId
                        });
                    }
                } else {
                    console.log('⏭️ Skipping transfer creation:', {
                        anyApproved,
                        approvedItemsLength: approvedItems.length
                    });
                }
            }, {
                maxWait: 10000, // 10 seconds max wait
                timeout: 15000, // 15 seconds timeout
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
                    description: `Submitted review for POS claim ${claim.claimNumber}. Result: ${updated.data.status}. ${anyApproved ? `Transfer completed automatically - inventory updated.` : ''}`,
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
                            message: `Claim ${claim.claimNumber} has been approved. Amount: Rs. ${totalApproved.toLocaleString()}. Exchange voucher generated.`,
                            category: 'claims',
                            priority: 'high',
                            actionType: 'view_claim',
                            actionPayload: { claimId: claim.id, claimNumber: claim.claimNumber },
                            entityType: 'PosClaim',
                            entityId: claim.id,
                        })
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
                            actionPayload: { claimId: claim.id, claimNumber: claim.claimNumber },
                            entityType: 'PosClaim',
                            entityId: claim.id,
                        })
                    );
                }
            }

            return { status: true, data: updated.data, message: `Claim decision submitted${anyApproved ? '. Transfer completed automatically - inventory updated.' : ''}` };
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

    async rejectClaim(id: string, dto: { rejectionReason: string; notes?: string }, rejectedBy?: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const claim = await this.prisma.posClaim.findUnique({
                where: { id },
                include: { items: true, salesOrder: true }
            });
            
            if (!claim) throw new NotFoundException('Claim not found');
            
            if (!['SUBMITTED', 'UNDER_REVIEW'].includes(claim.status)) {
                throw new BadRequestException(`Cannot reject claim in status: ${claim.status}`);
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
                        reviewNotes: dto.rejectionReason
                    }
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
                    }
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
                        actionPayload: { claimId: claim.id, claimNumber: claim.claimNumber },
                        entityType: 'PosClaim',
                        entityId: claim.id,
                    })
                );
            }

            return { 
                status: true, 
                data: updated.data, 
                message: 'Claim rejected successfully. No inventory changes made.' 
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
                                    name: 'erp.claims.read'
                                }
                            }
                        }
                    }
                },
                select: { id: true }
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
    private async notifyLocationUsers(locationId: string, notificationData: {
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
            // Get all users assigned to this location
            const locationUsers = await this.prismaMaster.user.findMany({
                // @ts-ignore
                where: { terminal: { locationId: locationId } },
                select: { id: true }
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
}
