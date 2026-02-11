import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreatePurchaseOrderDto } from './dto/purchase-order.dto';
import { Decimal } from '@prisma/client/runtime/client';

@Injectable()
export class PurchaseOrderService {
    constructor(private prisma: PrismaService) { }

    async findAll() {
        return this.prisma.purchaseOrder.findMany({
            include: {
                vendor: true,
                vendorQuotation: true
            },
            orderBy: { createdAt: 'desc' }
        });
    }

    async findOne(id: string) {
        const po = await this.prisma.purchaseOrder.findUnique({
            where: { id },
            include: {
                items: true,
                vendor: true,
                vendorQuotation: {
                    include: {
                        rfq: {
                            include: {
                                purchaseRequisition: true
                            }
                        }
                    }
                }
            }
        });

        if (!po) {
            throw new NotFoundException('Purchase Order not found');
        }

        return po;
    }

    async createFromQuotation(createDto: CreatePurchaseOrderDto) {
        const quotation = await this.prisma.vendorQuotation.findUnique({
            where: { id: createDto.vendorQuotationId },
            include: {
                items: true,
                vendor: true,
                rfq: true
            }
        });

        if (!quotation) {
            throw new NotFoundException('Vendor Quotation not found');
        }

        if (quotation.status !== 'SELECTED') {
            throw new BadRequestException('Purchase Order can only be created from a SELECTED quotation');
        }

        // Check if PO already exists for this quotation
        const existingPo = await this.prisma.purchaseOrder.findFirst({
            where: { vendorQuotationId: quotation.id }
        });

        if (existingPo) {
            throw new BadRequestException('Purchase Order already exists for this quotation');
        }

        const poNumber = `PO-${Date.now()}`; // Simple PO number generation

        return this.prisma.$transaction(async (tx) => {
            const po = await tx.purchaseOrder.create({
                data: {
                    poNumber,
                    vendorQuotationId: quotation.id,
                    vendorId: quotation.vendorId,
                    rfqId: quotation.rfqId,
                    notes: createDto.notes,
                    expectedDeliveryDate: createDto.expectedDeliveryDate ? new Date(createDto.expectedDeliveryDate) : null,
                    status: 'OPEN',
                    subtotal: quotation.subtotal,
                    taxAmount: quotation.taxAmount,
                    discountAmount: quotation.discountAmount,
                    totalAmount: quotation.totalAmount,
                    items: {
                        create: quotation.items.map(item => ({
                            itemId: item.itemId,
                            description: item.description,
                            quantity: item.quotedQty,
                            unitPrice: item.unitPrice,
                            taxPercent: item.taxPercent,
                            discountPercent: item.discountPercent,
                            lineTotal: item.lineTotal
                        }))
                    }
                },
                include: {
                    items: true,
                    vendor: true
                }
            });

            return po;
        });
    }

    async updateStatus(id: string, status: string) {
        return this.prisma.purchaseOrder.update({
            where: { id },
            data: { status }
        });
    }
}
