import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransferRequest, Prisma } from '@prisma/client';
import { StockMovementService } from './stock-movement.service';
import { StockLedgerService } from './stock-ledger/stock-ledger.service';

@Injectable()
export class TransferRequestService {
    constructor(
        private prisma: PrismaService,
        private stockMovementService: StockMovementService,
        private stockLedgerService: StockLedgerService
    ) { }

    async createRequest(data: {
        fromWarehouseId?: string; // Optional for outlet-to-warehouse
        fromLocationId?: string;  // Source outlet for returns and outlet-to-outlet
        toLocationId?: string;    // Destination outlet (null for warehouse)
        transferType?: 'WAREHOUSE_TO_OUTLET' | 'OUTLET_TO_WAREHOUSE' | 'OUTLET_TO_OUTLET';
        items: { itemId: string; quantity: number }[];
        createdById?: string;
        notes?: string;
    }) {
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

        return this.prisma.transferRequest.create({
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
                fromWarehouse: { select: { name: true } },
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
     * Helper to manually enrichment location data
     */
    private async enrichRequest(req: any) {
        if (req.toLocationId) {
            const masterLoc = await this.prisma.location.findUnique({
                where: { id: req.toLocationId }
            });
            if (masterLoc) req.toLocation = masterLoc;
        }

        return req;
    }

    async updateStatus(id: string, status: string, approvedById?: string) {
        const request = await this.prisma.transferRequest.findUnique({ where: { id } });
        if (!request) {
            throw new NotFoundException(`Transfer request ${id} not found`);
        }

        return this.prisma.transferRequest.update({
            where: { id },
            data: {
                status,
                ...(status === 'APPROVED' ? { approvedById } : {}),
            },
        });
    }

    async approveSource(id: string, userId?: string) {
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

                // Create outbound ledger entry
                await this.stockLedgerService.createEntry({
                    itemId: item.itemId,
                    warehouseId: actualWarehouseId,
                    locationId: request.fromLocationId!,
                    qty: -Number(item.quantity),
                    movementType: 'OUTBOUND' as any,
                    referenceType: 'OUTLET_TRANSFER_OUT',
                    referenceId: request.id,
                }, tx);
            }

            // 2. Update request status
            return tx.transferRequest.update({
                where: { id },
                data: {
                    status: 'SOURCE_APPROVED',
                    sourceApprovedById: userId,
                    sourceApprovedAt: new Date(),
                },
            });
        });
    }

    async acceptRequest(id: string, userId?: string) {
        const request = await this.prisma.transferRequest.findUnique({
            where: { id },
            include: { items: true }
        });

        if (!request) {
            throw new NotFoundException(`Transfer request ${id} not found`);
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
                    }, tx);
                }
            }

            // Update request status to completed
            return tx.transferRequest.update({
                where: { id },
                data: {
                    status: 'COMPLETED',
                    approvedById: userId,
                },
            });
        });
    }
}
