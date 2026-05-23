import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransferRequest, Prisma } from '@prisma/client';
import { StockMovementService } from './stock-movement.service';
import { StockLedgerService } from './stock-ledger/stock-ledger.service';

import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { runInBackground } from '../common/utils/run-in-background.util';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaMasterService } from '../database/prisma-master.service';

@Injectable()
export class TransferRequestService {
    constructor(
    private prisma: PrismaService,
        private stockMovementService: StockMovementService,
        private stockLedgerService: StockLedgerService,
    private activityLogs: ActivityLogsService,
    private notifications: NotificationsService,
    private prismaMaster: PrismaMasterService,
  ) { }

    private async getCurrentItemRate(tx: Prisma.TransactionClient, itemId: string): Promise<number> {
        const item = await tx.item.findUnique({
            where: { id: itemId },
            select: { unitCost: true },
        });
        return Number(item?.unitCost || 0);
    }

    async createRequest(data: {
        fromWarehouseId?: string; // Optional for outlet-to-warehouse
        fromLocationId?: string;  // Source outlet for returns and outlet-to-outlet
        toLocationId?: string;    // Destination outlet (null for warehouse)
        transferType?: 'WAREHOUSE_TO_OUTLET' | 'OUTLET_TO_WAREHOUSE' | 'OUTLET_TO_OUTLET';
        items: { itemId: string; quantity: number }[];
        createdById?: string;
        notes?: string;
    }, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const requestNo = `TR-${Date.now()}`;
            const transferType = data.transferType || 'WAREHOUSE_TO_OUTLET';

            // Validation based on transfer type
            if (transferType === 'WAREHOUSE_TO_OUTLET') {
                if (!data.fromWarehouseId || !data.toLocationId) {
                    throw new BadRequestException('fromWarehouseId and toLocationId required for warehouse-to-outlet transfers');
                }
            } else if (transferType === 'OUTLET_TO_WAREHOUSE') {
                if (!data.fromLocationId || !data.fromWarehouseId) {
                    throw new BadRequestException('fromLocationId and fromWarehouseId required for outlet-to-warehouse transfers');
                }
            } else if (transferType === 'OUTLET_TO_OUTLET') {
                if (!data.fromLocationId || !data.toLocationId) {
                    throw new BadRequestException('fromLocationId and toLocationId required for outlet-to-outlet transfers');
                }
                if (data.fromLocationId === data.toLocationId) {
                    throw new BadRequestException('Source and destination outlets cannot be the same');
                }
            }

            // Validate that locations exist
            if (data.toLocationId) {
                const toLocation = await this.prisma.location.findUnique({
                    where: { id: data.toLocationId }
                });
                if (!toLocation) {
                    throw new BadRequestException(`Destination location ${data.toLocationId} not found`);
                }
            }

            if (data.fromLocationId) {
                const fromLocation = await this.prisma.location.findUnique({
                    where: { id: data.fromLocationId }
                });
                if (!fromLocation) {
                    throw new BadRequestException(`Source location ${data.fromLocationId} not found`);
                }
            }

            // Validate stock availability based on transfer type
            for (const item of data.items) {
                let availableQty = 0;
                if (transferType === 'WAREHOUSE_TO_OUTLET') {
                    const stock = await this.prisma.inventoryItem.findFirst({
                        where: {
                            warehouseId: data.fromWarehouseId,
                            locationId: null, // Ensure we check warehouse main stock
                            itemId: item.itemId,
                            status: 'AVAILABLE'
                        }
                    });
                    availableQty = stock ? Number(stock.quantity) : 0;
                } else {
                    const stock = await this.prisma.inventoryItem.findFirst({
                        where: {
                            locationId: data.fromLocationId,
                            itemId: item.itemId,
                            status: 'AVAILABLE'
                        }
                    });
                    availableQty = stock ? Number(stock.quantity) : 0;
                }

                if (availableQty < item.quantity) {
                    throw new BadRequestException(`Insufficient stock for item ID: ${item.itemId}. Available: ${availableQty}, Requested: ${item.quantity}`);
                }
            }

            const created = await this.prisma.transferRequest.create({
                data: {
                    requestNo,
                    fromWarehouseId: data.fromWarehouseId,
                    fromLocationId: data.fromLocationId,
                    toLocationId: data.toLocationId,
                    transferType,
                    status: 'PENDING',
                    requiresSourceApproval: transferType === 'OUTLET_TO_OUTLET',
                    createdById: data.createdById,
                    notes: data.notes,
                    items: {
                        create: data.items.map((item) => ({
                            itemId: item.itemId,
                            quantity: new Prisma.Decimal(item.quantity),
                        })),
                    },
                },
                include: {
                    items: true,
                },
            });

            runInBackground(
                'Create Transfer Request',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'create',
                    module: 'transfer-request',
                    entity: 'TransferRequest',
                    entityId: created.id,
                    description: `Created transfer request ${created.requestNo}`,
                    newValues: JSON.stringify(data),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return created;
        } catch (error: any) {
            runInBackground(
                'Create Transfer Request (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'create',
                    module: 'transfer-request',
                    entity: 'TransferRequest',
                    description: `Failed to create transfer request`,
                    errorMessage: error?.message,
                    newValues: JSON.stringify(data),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
            throw error;
        }
    }

    async getRequests(warehouseId?: string, status?: string) {
        const requests = await this.prisma.transferRequest.findMany({
            where: {
                ...(warehouseId ? { fromWarehouseId: warehouseId } : {}),
                ...(status ? { status } : {}),
            },
            include: {
                items: {
                    include: {
                        item: true
                    }
                },
                fromWarehouse: { select: { name: true, code: true } },
                toWarehouse: { select: { name: true, code: true } },
                fromLocation: { select: { name: true, code: true } },
                toLocation: { select: { name: true, code: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        return Promise.all(requests.map(req => this.enrichRequest(req)));
    }

    async getIncomingRequests(locationId: string) {
        const requests = await this.prisma.transferRequest.findMany({
            where: {
                toLocationId: locationId,
                transferType: 'WAREHOUSE_TO_OUTLET',
                status: 'PENDING',
            },
            include: {
                items: {
                    include: {
                        item: true
                    }
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        return Promise.all(requests.map(req => this.enrichRequest(req)));
    }

    async getReturnRequests(locationId: string) {
        const requests = await this.prisma.transferRequest.findMany({
            where: {
                fromLocationId: locationId,
                transferType: 'OUTLET_TO_WAREHOUSE',
                status: 'PENDING',
            },
            include: {
                items: {
                    include: {
                        item: true
                    }
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        return Promise.all(requests.map(req => this.enrichRequest(req)));
    }

    async getOutboundRequests(locationId: string) {
        // Get outlet-to-outlet requests where this location is the source
        const requests = await this.prisma.transferRequest.findMany({
            where: {
                fromLocationId: locationId,
                transferType: 'OUTLET_TO_OUTLET',
                status: 'PENDING',
                requiresSourceApproval: true,
                sourceApprovedById: null,
            },
            include: {
                items: {
                    include: {
                        item: true
                    }
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        return Promise.all(requests.map(req => this.enrichRequest(req)));
    }

    async getInboundRequests(locationId: string) {
        // Get outlet-to-outlet requests where this location is the destination
        const requests = await this.prisma.transferRequest.findMany({
            where: {
                toLocationId: locationId,
                transferType: 'OUTLET_TO_OUTLET',
                status: 'SOURCE_APPROVED', // Only show after source approval
            },
            include: {
                items: {
                    include: {
                        item: true
                    }
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        return Promise.all(requests.map(req => this.enrichRequest(req)));
    }

    /**
     * Helper to manually enrichment location data and claim data
     */
    private async enrichRequest(req: any) {
        if (req.toLocationId) {
            const masterLoc = await this.prisma.location.findUnique({
                where: { id: req.toLocationId }
            });
            if (masterLoc) req.toLocation = masterLoc;
        }

        // Fetch claim data if this is a claim transfer
        if (req.transferType === 'CLAIM_TO_PLM') {
            const claim = await this.prisma.posClaim.findFirst({
                where: { transferRequestId: req.id },
                select: { claimNumber: true, claimType: true }
            });
            if (claim) {
                req.claim = {
                    claimNo: claim.claimNumber,
                    claimType: claim.claimType
                };
            }
        }

        return req;
    }

    async updateStatus(id: string, status: string, approvedById?: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const request = await this.prisma.transferRequest.findUnique({ where: { id } });
            if (!request) {
                throw new NotFoundException(`Transfer request ${id} not found`);
            }

            const updated = await this.prisma.transferRequest.update({
                where: { id },
                data: {
                    status,
                    ...(status === 'APPROVED' ? { approvedById } : {}),
                },
            });
            runInBackground(
                'Update Transfer Request Status',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'transfer-request',
                    entity: 'TransferRequest',
                    entityId: updated.id,
                    description: `Updated transfer request ${updated.requestNo} status to ${status}`,
                    newValues: JSON.stringify({ status, approvedById }),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return updated;
        } catch (error: any) {
            runInBackground(
                'Update Transfer Request Status (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'transfer-request',
                    entity: 'TransferRequest',
                    entityId: id,
                    description: `Failed to update transfer request status`,
                    errorMessage: error?.message,
                    newValues: JSON.stringify({ status, approvedById }),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
            throw error;
        }
    }

    async approveSource(id: string, userId?: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const request = await this.prisma.transferRequest.findUnique({
                where: { id },
                include: { items: true }
            });

            if (!request) {
                throw new NotFoundException(`Transfer request ${id} not found`);
            }

            if (request.transferType !== 'OUTLET_TO_OUTLET') {
                throw new BadRequestException('Source approval only applies to outlet-to-outlet transfers');
            }

            if (request.status !== 'PENDING') {
                throw new BadRequestException(`Request is not in PENDING status (Current: ${request.status})`);
            }

            if (request.sourceApprovedById) {
                throw new BadRequestException('Request already approved by source outlet');
            }

            // Validate that locations exist
            if (request.fromLocationId) {
                const fromLocation = await this.prisma.location.findUnique({
                    where: { id: request.fromLocationId }
                });
                if (!fromLocation) {
                    throw new BadRequestException(`Source location ${request.fromLocationId} not found`);
                }
            }

            if (request.toLocationId) {
                const toLocation = await this.prisma.location.findUnique({
                    where: { id: request.toLocationId }
                });
                if (!toLocation) {
                    throw new BadRequestException(`Destination location ${request.toLocationId} not found`);
                }
            }

            return this.prisma.$transaction(async (tx) => {
                // 1. Check and reserve stock at source outlet
                for (const item of request.items) {
                    const sourceStock = await tx.inventoryItem.findFirst({
                        where: {
                            locationId: request.fromLocationId!,
                            itemId: item.itemId,
                            status: 'AVAILABLE',
                        },
                    });

                    if (!sourceStock || Number(sourceStock.quantity) < Number(item.quantity)) {
                        throw new BadRequestException(`Insufficient stock for item ${item.itemId} at source outlet. Current: ${sourceStock?.quantity || 0}, Requested: ${item.quantity}`);
                    }

                    // Decrease source outlet stock
                    await tx.inventoryItem.update({
                        where: { id: sourceStock.id },
                        data: { quantity: { decrement: Number(item.quantity) } },
                    });

                    // Use actual warehouseId from the inventoryItem record
                    const actualWarehouseId = sourceStock.warehouseId;
                    const transferRate = await this.getCurrentItemRate(tx, item.itemId);

                    // Create outbound ledger entry
                    await this.stockLedgerService.createEntry({
                        itemId: item.itemId,
                        warehouseId: actualWarehouseId,
                        locationId: request.fromLocationId!,
                        qty: -Number(item.quantity),
                        movementType: 'OUTBOUND' as any,
                        referenceType: 'OUTLET_TRANSFER_OUT',
                        referenceId: request.id,
                        rate: transferRate,
                    }, tx);
                }

                // 2. Update request status
                const updated = await tx.transferRequest.update({
                    where: { id },
                    data: {
                        status: 'SOURCE_APPROVED',
                        sourceApprovedById: userId,
                        sourceApprovedAt: new Date(),
                    },
                });

                runInBackground(
                    'Approve Transfer Request Source',
                    this.activityLogs.log({
                        userId: ctx?.userId,
                        action: 'update',
                        module: 'transfer-request',
                        entity: 'TransferRequest',
                        entityId: updated.id,
                        description: `Source approved transfer request ${updated.requestNo}`,
                        newValues: JSON.stringify({ status: 'SOURCE_APPROVED' }),
                        ipAddress: ctx?.ipAddress,
                        userAgent: ctx?.userAgent,
                        status: 'success',
                    }),
                );

                return updated;
            });
        } catch (error: any) {
            runInBackground(
                'Approve Transfer Request Source (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'transfer-request',
                    entity: 'TransferRequest',
                    entityId: id,
                    description: `Failed to source approve transfer request`,
                    errorMessage: error?.message,
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
            throw error;
        }
    }

    async acceptRequest(id: string, userId?: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const request = await this.prisma.transferRequest.findUnique({
                where: { id },
                include: { items: true }
            });

            if (!request) {
                throw new NotFoundException(`Transfer request ${id} not found`);
            }

            // Validate that locations exist before processing
            if (request.toLocationId) {
                const toLocation = await this.prisma.location.findUnique({
                    where: { id: request.toLocationId }
                });
                if (!toLocation) {
                    throw new BadRequestException(`Destination location ${request.toLocationId} not found`);
                }
            }

            if (request.fromLocationId) {
                const fromLocation = await this.prisma.location.findUnique({
                    where: { id: request.fromLocationId }
                });
                if (!fromLocation) {
                    throw new BadRequestException(`Source location ${request.fromLocationId} not found`);
                }
            }

            return this.prisma.$transaction(async (tx) => {
                if (request.transferType === 'WAREHOUSE_TO_OUTLET') {
                    // Normal transfer: Warehouse → Outlet
                    if (request.status !== 'PENDING') {
                        throw new BadRequestException(`Request is not in PENDING status (Current: ${request.status})`);
                    }

                    for (const item of request.items) {
                        await this.stockMovementService.executeMovement({
                            itemId: item.itemId,
                            fromWarehouseId: request.fromWarehouseId!,
                            toLocationId: request.toLocationId!,
                            quantity: Number(item.quantity),
                            type: 'TRANSFER',
                            referenceType: 'TRANSFER_REQUEST',
                            referenceId: request.id,
                            userId: userId,
                        });
                    }
                } else if (request.transferType === 'OUTLET_TO_WAREHOUSE') {
                    // Return transfer: Outlet → Warehouse
                    if (request.status !== 'PENDING') {
                        throw new BadRequestException(`Request is not in PENDING status (Current: ${request.status})`);
                    }

                    // Check if this is a claim-based transfer (items need to be added to POS first)
                    const isClaimBased = request.notes?.includes('approved claim');
                    
                    if (isClaimBased) {
                        // For claim-based transfers: First add items to POS inventory, then transfer to warehouse
                        for (const item of request.items) {
                            const posStock = await tx.inventoryItem.findFirst({
                                where: {
                                    itemId: item.itemId,
                                    locationId: request.fromLocationId!,
                                    status: 'AVAILABLE'
                                }
                            });

                            const actualWarehouseId = posStock?.warehouseId || request.fromWarehouseId!;
                            const itemRate = await this.getCurrentItemRate(tx, item.itemId);

                            // 1. Add items to POS inventory (claim approved items)
                            if (posStock) {
                                await tx.inventoryItem.update({
                                    where: { id: posStock.id },
                                    data: { quantity: { increment: Number(item.quantity) } }
                                });
                            } else {
                                await tx.inventoryItem.create({
                                    data: {
                                        itemId: item.itemId,
                                        warehouseId: actualWarehouseId,
                                        locationId: request.fromLocationId!,
                                        quantity: Number(item.quantity),
                                        status: 'AVAILABLE'
                                    }
                                });
                            }

                            // 2. Create inbound ledger entry for POS (claim approved)
                            await this.stockLedgerService.createEntry({
                                itemId: item.itemId,
                                warehouseId: actualWarehouseId,
                                locationId: request.fromLocationId!,
                                qty: Number(item.quantity),
                                movementType: 'INBOUND' as any,
                                referenceType: 'POS_CLAIM_APPROVED',
                                referenceId: request.id,
                                rate: itemRate,
                            }, tx);

                            // 3. Now execute the normal outlet-to-warehouse transfer
                            await this.stockMovementService.executeMovement({
                                itemId: item.itemId,
                                fromLocationId: request.fromLocationId!,
                                toWarehouseId: request.fromWarehouseId!,
                                quantity: Number(item.quantity),
                                type: 'RETURN_TRANSFER',
                                referenceType: 'CLAIM_RETURN_REQUEST',
                                referenceId: request.id,
                                userId: userId,
                            });
                        }
                    } else {
                        // Normal outlet-to-warehouse transfer (non-claim)
                        for (const item of request.items) {
                            await this.stockMovementService.executeMovement({
                                itemId: item.itemId,
                                fromLocationId: request.fromLocationId!,
                                toWarehouseId: request.fromWarehouseId!,
                                quantity: Number(item.quantity),
                                type: 'RETURN_TRANSFER',
                                referenceType: 'RETURN_REQUEST',
                                referenceId: request.id,
                                userId: userId,
                            });
                        }
                    }
                } else if (request.transferType === 'OUTLET_TO_OUTLET') {
                    // Outlet-to-outlet transfer: Only destination can accept after source approval
                    if (request.status !== 'SOURCE_APPROVED') {
                        throw new BadRequestException(`Request must be source-approved first (Current: ${request.status})`);
                    }

                    for (const item of request.items) {
                        // Only need to add stock to destination (source already decreased)
                        const destItem = await tx.inventoryItem.findFirst({
                            where: {
                                locationId: request.toLocationId!,
                                itemId: item.itemId,
                                status: 'AVAILABLE',
                            },
                        });

                        // Find source stock to get actual warehouseId
                        const sourceStock = await tx.inventoryItem.findFirst({
                            where: {
                                locationId: request.fromLocationId!,
                                itemId: item.itemId,
                            },
                        });
                        const actualWarehouseId = sourceStock?.warehouseId || request.fromWarehouseId!;
                        const transferRate = await this.getCurrentItemRate(tx, item.itemId);

                        if (destItem) {
                            // Update existing stock at destination
                            await tx.inventoryItem.update({
                                where: { id: destItem.id },
                                data: { quantity: { increment: Number(item.quantity) } },
                            });
                        } else {
                            // Create new stock entry at destination
                            await tx.inventoryItem.create({
                                data: {
                                    warehouseId: actualWarehouseId,
                                    locationId: request.toLocationId!,
                                    itemId: item.itemId,
                                    quantity: Number(item.quantity),
                                    status: 'AVAILABLE',
                                },
                            });
                        }

                        // Create inbound ledger entry for destination
                        await this.stockLedgerService.createEntry({
                            itemId: item.itemId,
                            warehouseId: actualWarehouseId,
                            locationId: request.toLocationId!,
                            qty: Number(item.quantity),
                            movementType: 'INBOUND' as any,
                            referenceType: 'OUTLET_TRANSFER_IN',
                            referenceId: request.id,
                            rate: transferRate,
                        }, tx);
                    }
                }

                // Update request status to completed
                const updated = await tx.transferRequest.update({
                    where: { id },
                    data: {
                        status: 'COMPLETED',
                        approvedById: userId,
                    },
                });
                
                runInBackground(
                    'Accept Transfer Request',
                    this.activityLogs.log({
                        userId: ctx?.userId,
                        action: 'update',
                        module: 'transfer-request',
                        entity: 'TransferRequest',
                        entityId: updated.id,
                        description: `Completed transfer request ${updated.requestNo}`,
                        newValues: JSON.stringify({ status: 'COMPLETED' }),
                        ipAddress: ctx?.ipAddress,
                        userAgent: ctx?.userAgent,
                        status: 'success',
                    }),
                );

                return updated;
            });
        } catch (error: any) {
            runInBackground(
                'Accept Transfer Request (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'transfer-request',
                    entity: 'TransferRequest',
                    entityId: id,
                    description: `Failed to accept transfer request`,
                    errorMessage: error?.message,
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
            throw error;
        }
    }

    /**
     * PLM Acknowledgment: Manually acknowledge receipt of claim items
     * This updates inventory only after PLM physically receives the product
     */
    async acknowledgeClaim(id: string, userId?: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const request = await this.prisma.transferRequest.findUnique({
                where: { id },
                include: { items: true }
            });

            if (!request) {
                throw new NotFoundException(`Transfer request ${id} not found`);
            }

            if (request.transferType !== 'CLAIM_TO_PLM') {
                throw new BadRequestException('This endpoint is only for claim-based transfers');
            }

            if (request.status !== 'PENDING') {
                throw new BadRequestException(`Request is not in PENDING status (Current: ${request.status})`);
            }

            console.log('🔄 [PLM Acknowledgment] Starting claim acknowledgment:', {
                transferRequestId: id,
                requestNo: request.requestNo,
                itemCount: request.items.length
            });

            return this.prisma.$transaction(async (tx) => {
                const plmWarehouseId = request.toWarehouseId!;

                // Process each item: Add to PLM warehouse inventory
                for (const item of request.items) {
                    console.log('📦 [PLM Acknowledgment] Processing item:', {
                        itemId: item.itemId,
                        quantity: item.quantity
                    });

                    const itemRate = await this.getCurrentItemRate(tx, item.itemId);

                    // 1. Create stock ledger entry: Customer → PLM (direct transfer)
                    await this.stockLedgerService.createEntry({
                        itemId: item.itemId,
                        warehouseId: plmWarehouseId,
                        locationId: null, // Warehouse-level
                        qty: Number(item.quantity),
                        movementType: 'INBOUND' as any,
                        referenceType: 'CLAIM_ACKNOWLEDGED',
                        referenceId: request.id,
                        rate: itemRate,
                    }, tx);

                    console.log('✅ [PLM Acknowledgment] Stock ledger entry created');

                    // 2. Add item to PLM warehouse inventory
                    const plmStock = await tx.inventoryItem.findFirst({
                        where: {
                            itemId: item.itemId,
                            warehouseId: plmWarehouseId,
                            locationId: null, // Warehouse-level
                            status: 'AVAILABLE'
                        }
                    });

                    if (plmStock) {
                        await tx.inventoryItem.update({
                            where: { id: plmStock.id },
                            data: { quantity: { increment: Number(item.quantity) } }
                        });
                        console.log('✅ [PLM Acknowledgment] PLM inventory updated (incremented)');
                    } else {
                        await tx.inventoryItem.create({
                            data: {
                                itemId: item.itemId,
                                warehouseId: plmWarehouseId,
                                locationId: null, // Warehouse-level
                                quantity: Number(item.quantity),
                                status: 'AVAILABLE'
                            }
                        });
                        console.log('✅ [PLM Acknowledgment] PLM inventory created (new entry)');
                    }
                }

                // 3. Update transfer request status to COMPLETED
                const updated = await tx.transferRequest.update({
                    where: { id },
                    data: {
                        status: 'COMPLETED',
                        approvedById: userId,
                        notes: `${request.notes || ''}\n\nPLM acknowledged receipt and inventory updated on ${new Date().toISOString()}`
                    },
                });

                console.log('✅ [PLM Acknowledgment] Transfer request completed');

                runInBackground(
                    'Acknowledge Claim Transfer',
                    this.activityLogs.log({
                        userId: ctx?.userId,
                        action: 'update',
                        module: 'transfer-request',
                        entity: 'TransferRequest',
                        entityId: updated.id,
                        description: `PLM acknowledged claim transfer ${updated.requestNo} and inventory updated`,
                        newValues: JSON.stringify({ status: 'COMPLETED', acknowledgedBy: userId }),
                        ipAddress: ctx?.ipAddress,
                        userAgent: ctx?.userAgent,
                        status: 'success',
                    }),
                );

                // 🔔 Notify POS location about PLM acknowledgment
                if (request.fromLocationId) {
                    runInBackground(
                        'Notify POS - Transfer Acknowledged',
                        this.notifyLocationUsers(request.fromLocationId, {
                            title: '📦 Transfer Acknowledged',
                            message: `PLM has acknowledged receipt of transfer ${updated.requestNo}. Inventory updated.`,
                            category: 'inventory',
                            priority: 'normal',
                            actionType: 'view_transfer',
                            actionPayload: { transferId: updated.id, requestNo: updated.requestNo },
                            entityType: 'TransferRequest',
                            entityId: updated.id,
                        })
                    );
                }

                return updated;
            });
        } catch (error: any) {
            runInBackground(
                'Acknowledge Claim Transfer (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'transfer-request',
                    entity: 'TransferRequest',
                    entityId: id,
                    description: `Failed to acknowledge claim transfer`,
                    errorMessage: error?.message,
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
            throw error;
        }
    }

    // 🔔 Helper: Notify users at specific location
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
            // For now, get all users and let notification system handle filtering
            // In future, can add location-based filtering when user-location relationship is clarified
            const allUsers = await this.prismaMaster.user.findMany({
                select: { id: true }
            });

            // Send notification to each user (notification system will handle user preferences)
            for (const user of allUsers) {
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
