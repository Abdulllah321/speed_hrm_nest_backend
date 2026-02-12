import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MovementType, Prisma } from '@prisma/client';

@Injectable()
export class StockLedgerService {
    constructor(private prisma: PrismaService) { }

    async findAll(options?: {
        warehouseId?: string;
        movementType?: MovementType;
        itemId?: string;
    }) {
        const { warehouseId, movementType, itemId } = options || {};

        return this.prisma.stockLedger.findMany({
            where: {
                warehouseId,
                movementType,
                itemId,
            },
            orderBy: {
                createdAt: 'desc',
            },
            include: {
                item: {
                    select: {
                        itemId: true,
                        sku: true,
                        description: true,
                    }
                },
                warehouse: {
                    select: {
                        name: true
                    }
                }
            }
        });
    }

    async createEntry(data: {
        itemId: string;
        warehouseId: string;
        qty: number | Prisma.Decimal;
        movementType: MovementType;
        referenceType: string;
        referenceId: string;
        locationId?: string;
    }, tx?: Prisma.TransactionClient) {
        const { itemId, warehouseId, qty, movementType, referenceType, referenceId, locationId } = data;
        const quantity = new Prisma.Decimal(qty);

        // Validate Quantity Direction
        if ((movementType === MovementType.INBOUND || movementType === MovementType.OPENING_BALANCE) && quantity.isNegative()) {
            throw new BadRequestException(`Quantity must be positive for ${movementType}`);
        }
        if (movementType === MovementType.OUTBOUND && quantity.isPositive()) {
            throw new BadRequestException(`Quantity must be negative for ${movementType}`);
        }

        const prisma = tx || this.prisma;

        const operation = async (transaction: Prisma.TransactionClient) => {
            // Concurrency Safe Negative Stock Check for OUTBOUND
            if (quantity.isNegative()) {
                const currentStock = await transaction.stockLedger.aggregate({
                    where: {
                        itemId,
                        warehouseId,
                    },
                    _sum: {
                        qty: true,
                    },
                });

                const totalStock = currentStock._sum.qty || new Prisma.Decimal(0);

                if (totalStock.plus(quantity).isNegative()) {
                    throw new BadRequestException(
                        `Insufficient stock for item ${itemId} in warehouse ${warehouseId}. Current: ${totalStock}, Requested: ${quantity.abs()}`
                    );
                }
            }

            // Create Immutable Ledger Entry
            return transaction.stockLedger.create({
                data: {
                    itemId,
                    warehouseId,
                    qty: quantity,
                    movementType,
                    referenceType,
                    referenceId,
                    locationId,
                },
            });
        };

        if (tx) {
            return operation(tx);
        } else {
            return this.prisma.$transaction(operation);
        }
    }
}
