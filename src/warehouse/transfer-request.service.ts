import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransferRequest, Prisma } from '@prisma/client';
import { StockMovementService } from './stock-movement.service';

@Injectable()
export class TransferRequestService {
    constructor(
        private prisma: PrismaService,
        private stockMovementService: StockMovementService
    ) { }

    async createRequest(data: {
        fromWarehouseId: string;
        toWarehouseId: string;
        fromLocationId?: string;
        toLocationId?: string;
        items: { itemId: string; quantity: number }[];
        createdById?: string;
        notes?: string;
    }) {
        const requestNo = `TR-${Date.now()}`;

        return this.prisma.transferRequest.create({
            data: {
                requestNo,
                fromWarehouseId: data.fromWarehouseId,
                toWarehouseId: data.toWarehouseId,
                fromLocationId: data.fromLocationId,
                toLocationId: data.toLocationId,
                status: 'PENDING',
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
        return this.prisma.transferRequest.findMany({
            where: {
                ...(warehouseId ? { OR: [{ fromWarehouseId: warehouseId }, { toWarehouseId: warehouseId }] } : {}),
                ...(status ? { status } : {}),
            },
            include: {
                items: {
                    include: {
                        item: true
                    }
                },
                fromLocation: true,
                toLocation: true,
                fromWarehouse: { select: { name: true } },
                toWarehouse: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
    }

    async getIncomingRequests(locationId: string) {
        return this.prisma.transferRequest.findMany({
            where: {
                toLocationId: locationId,
                status: 'PENDING',
            },
            include: {
                items: {
                    include: {
                        item: true
                    }
                },
                fromLocation: true,
            },
            orderBy: { createdAt: 'desc' },
        });
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

    async acceptRequest(id: string, userId?: string) {
        const request = await this.prisma.transferRequest.findUnique({
            where: { id },
            include: { items: true }
        });

        if (!request) {
            throw new NotFoundException(`Transfer request ${id} not found`);
        }

        if (request.status !== 'PENDING') {
            throw new BadRequestException(`Request is not in PENDING status (Current: ${request.status})`);
        }

        return this.prisma.$transaction(async (tx) => {
            // 1. Execute movements for each item
            for (const item of request.items) {
                await this.stockMovementService.executeMovement({
                    itemId: item.itemId,
                    fromLocationId: request.fromLocationId || undefined,
                    toLocationId: request.toLocationId || undefined,
                    quantity: Number(item.quantity),
                    type: 'TRANSFER',
                    referenceType: 'TRANSFER_REQUEST',
                    referenceId: request.id,
                    userId: userId,
                });
            }

            // 2. Update request status
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
