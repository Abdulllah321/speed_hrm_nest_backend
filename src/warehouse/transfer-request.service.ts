import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransferRequest, Prisma } from '@prisma/client';

@Injectable()
export class TransferRequestService {
    constructor(private prisma: PrismaService) { }

    async createRequest(data: {
        fromWarehouseId: string;
        toWarehouseId: string;
        items: { itemId: string; quantity: number }[];
        createdById?: string;
    }) {
        // Basic implementation: creating request in DRAFT status
        const requestNo = `TR-${Date.now()}`;

        return this.prisma.transferRequest.create({
            data: {
                requestNo,
                fromWarehouseId: data.fromWarehouseId,
                toWarehouseId: data.toWarehouseId,
                status: 'PENDING',
                createdById: data.createdById,
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

    async getRequests(warehouseId: string) {
        return this.prisma.transferRequest.findMany({
            where: {
                OR: [{ fromWarehouseId: warehouseId }, { toWarehouseId: warehouseId }],
            },
            include: {
                items: true,
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
}
