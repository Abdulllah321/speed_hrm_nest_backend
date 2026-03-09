import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';


@Injectable()
export class PosSalesService {
    constructor(
        private prisma: PrismaService,
        private prismaMaster: PrismaMasterService,
    ) { }

    // ─── Generate next SO number ──────────────────────────────────────
    private async generateOrderNumber(): Promise<string> {
        const today = new Date();
        const prefix = `SO-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

        const last = await this.prisma.salesOrder.findFirst({
            where: { orderNumber: { startsWith: prefix } },
            orderBy: { orderNumber: 'desc' },
            select: { orderNumber: true },
        });

        const seq = last
            ? parseInt(last.orderNumber.split('-').pop() || '0', 10) + 1
            : 1;

        return `${prefix}-${String(seq).padStart(4, '0')}`;
    }

    // ─── Lookup items by barcode / SKU (for POS scanner) ──────────────
    async lookupItem(query: string) {
        const searchTerm = query.trim();
        if (!searchTerm) return { status: false, message: 'Search query is required' };

        const items = await this.prisma.item.findMany({
            where: {
                isActive: true,
                OR: [
                    { barCode: { equals: searchTerm, mode: 'insensitive' } },
                    { sku: { equals: searchTerm, mode: 'insensitive' } },
                    { itemId: { equals: searchTerm, mode: 'insensitive' } },
                    { barCode: { contains: searchTerm, mode: 'insensitive' } },
                    { sku: { contains: searchTerm, mode: 'insensitive' } },
                    { description: { contains: searchTerm, mode: 'insensitive' } },
                ],
            },
            take: 20,
            include: {
                brand: true,
                size: true,
                color: true,
            }
        });

        // Enrich with master data names + stock levels
        const enriched = await this.enrichForPos(items);
        return { status: true, data: enriched };
    }

    // ─── Quick barcode scan (exact match only, returns single item) ───
    async scanBarcode(barcode: string) {
        const item = await this.prisma.item.findFirst({
            where: {
                isActive: true,
                OR: [
                    { barCode: { equals: barcode.trim(), mode: 'insensitive' } },
                    { sku: { equals: barcode.trim(), mode: 'insensitive' } },
                ],
            },
            include: {
                brand: true,
                size: true,
                color: true,
            }
        });

        if (!item) return { status: false, message: 'Item not found for this barcode/SKU' };

        const enriched = await this.enrichForPos([item]);
        return { status: true, data: enriched[0] };
    }

    // ─── Create sales order ───────────────────────────────────────────
    async createOrder(dto: CreateSalesOrderDto, cashierUserId?: string) {
        try {
            const orderNumber = await this.generateOrderNumber();

            // ── Resolve tenders ─────────────────────────────────────
            const tenders = dto.tenders && dto.tenders.length > 0
                ? dto.tenders
                : dto.paymentMethod
                    ? [{ method: dto.paymentMethod, amount: dto.cashAmount || dto.cardAmount || 0 }]
                    : [{ method: 'cash', amount: 0 }];

            const totalPaid = tenders.reduce((acc, t) => acc + Number(t.amount), 0);
            const tenderMethods = [...new Set(tenders.map(t => t.method))];
            const paymentMethod = tenderMethods.length === 1 ? tenderMethods[0] : 'split';
            const cashAmount = tenders.filter(t => t.method === 'cash').reduce((a, t) => a + Number(t.amount), 0);
            const cardAmount = tenders.filter(t => t.method !== 'cash').reduce((a, t) => a + Number(t.amount), 0);

            // ── Resolve promo scope ──────────────────────────────────
            const promoItemIds = dto.promoScope?.type === 'items' && dto.promoScope.itemIds?.length
                ? new Set(dto.promoScope.itemIds)
                : null; // null = apply to all

            // ── Calculate line items ─────────────────────────────────
            const itemsData = dto.items.map((lineItem) => {
                const subtotal = lineItem.unitPrice * lineItem.quantity;
                const discPct = lineItem.discountPercent || 0;
                const discAmt = Math.round(subtotal * (discPct / 100) * 100) / 100;
                const afterDisc = subtotal - discAmt;
                const taxPct = lineItem.taxPercent || 0;
                const taxAmt = Math.round(afterDisc * (taxPct / 100) * 100) / 100;

                // Per-item promo discount (from frontend pre-calculated promoDiscountAmount)
                const promoDisc = (promoItemIds === null || promoItemIds.has(lineItem.itemId))
                    ? (lineItem.promoDiscountAmount || 0)
                    : 0;

                const lineTotal = Math.round((afterDisc + taxAmt - promoDisc) * 100) / 100;

                return {
                    itemId: lineItem.itemId,
                    quantity: lineItem.quantity,
                    unitPrice: lineItem.unitPrice,
                    discountPercent: discPct,
                    discountAmount: discAmt + promoDisc,
                    taxPercent: taxPct,
                    taxAmount: taxAmt,
                    lineTotal: Math.max(0, lineTotal),
                };
            });

            const subtotal = itemsData.reduce((acc, i) => acc + i.unitPrice * i.quantity, 0);
            const lineItemDiscount = itemsData.reduce((acc, i) => acc + i.discountAmount, 0);
            const totalTax = itemsData.reduce((acc, i) => acc + i.taxAmount, 0);
            const lineItemTotal = itemsData.reduce((acc, i) => acc + i.lineTotal, 0);

            // ── Apply global discount on top ─────────────────────────
            let globalDiscAmt = 0;
            if (dto.globalDiscountPercent) {
                globalDiscAmt = Math.round(lineItemTotal * (dto.globalDiscountPercent / 100) * 100) / 100;
            } else if (dto.globalDiscountAmount) {
                globalDiscAmt = Math.min(dto.globalDiscountAmount, lineItemTotal);
            }

            const totalDiscount = lineItemDiscount + globalDiscAmt;
            const grandTotal = Math.max(0, Math.round((lineItemTotal - globalDiscAmt) * 100) / 100);
            const changeAmount = Math.max(0, totalPaid - grandTotal);

            // ── Build notes — include alliance meta ──────────────────
            const notesParts: string[] = [];
            if (dto.notes) notesParts.push(dto.notes);
            if (dto.allianceMeta) {
                const m = dto.allianceMeta;
                const parts: string[] = [];
                if (m.cardholderName) parts.push(`Cardholder: ${m.cardholderName}`);
                if (m.cardLast4) parts.push(`Card: ****${m.cardLast4}`);
                if (m.merchantSlip) parts.push(`Slip: ${m.merchantSlip}`);
                if (parts.length) notesParts.push(`[Alliance] ${parts.join(' | ')}`);
            }

            const order = await this.prisma.salesOrder.create({
                data: {
                    orderNumber,
                    posId: dto.posId,
                    terminalId: dto.terminalId,
                    locationId: dto.locationId,
                    customerId: dto.customerId,
                    cashierUserId,
                    paymentMethod,
                    notes: notesParts.join(' | ') || undefined,
                    subtotal,
                    discountAmount: totalDiscount,
                    taxAmount: totalTax,
                    grandTotal,
                    status: 'completed',
                    paymentStatus: totalPaid >= grandTotal ? 'paid' : 'partial',
                    // Discount tracking
                    globalDiscountPercent: dto.globalDiscountPercent,
                    globalDiscountAmount: globalDiscAmt || undefined,
                    promoId: dto.promoId,
                    couponId: dto.couponId,
                    allianceId: dto.allianceId,
                    // Tender summary
                    tenderType: paymentMethod,
                    cashAmount: cashAmount || undefined,
                    cardAmount: cardAmount || undefined,
                    changeAmount: changeAmount || undefined,
                    items: {
                        create: itemsData,
                    },
                },
                include: {
                    items: { include: { item: { select: { description: true, sku: true, barCode: true } } } },
                    promo: { select: { name: true, code: true } },
                    coupon: { select: { code: true, description: true } },
                    alliance: { select: { partnerName: true, code: true, discountPercent: true } },
                },
            });

            // Increment coupon usage if used
            if (dto.couponId) {
                await this.prisma.couponCode.update({
                    where: { id: dto.couponId },
                    data: { usedCount: { increment: 1 } },
                });
            }

            return {
                status: true,
                data: {
                    ...order,
                    tenders, // include tenders in response for receipt
                    changeAmount,
                },
                message: `Order ${orderNumber} created successfully`,
            };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    // ─── List orders (for session/history) ────────────────────────────
    async listOrders(
        user: any,
        page = 1,
        limit = 20,
        posId?: string,
        status?: string,
        filters?: { startDate?: string; endDate?: string; search?: string },
        locationId?: string,
    ) {
        const skip = (page - 1) * limit;
        const where: any = {};
        if (posId) {
            // If posId is a UUID, search by terminalId, otherwise by posId (code)
            if (posId.length > 20) {
                where.terminalId = posId;
            } else {
                where.posId = posId;
            }
        }
        if (locationId) where.locationId = locationId;
        if (status) where.status = status;

        // ── Handle search (by order number) ──
        if (filters?.search) {
            where.orderNumber = { contains: filters.search, mode: 'insensitive' };
        }

        // ── Handle date range ──
        if (filters?.startDate || filters?.endDate) {
            where.createdAt = {};
            if (filters.startDate) where.createdAt.gte = new Date(filters.startDate);
            if (filters.endDate) {
                const end = new Date(filters.endDate);
                end.setHours(23, 59, 59, 999);
                where.createdAt.lte = end;
            }
        }

        // ── Permission filtering ──
        // Check if user has pos.sales.history.view_all
        const role = await this.prismaMaster.role.findUnique({
            where: { id: user.roleId },
            include: { permissions: { include: { permission: true } } },
        });

        const userPerms = role?.permissions.map(p => p.permission.name) || [];
        const canViewAll = userPerms.includes('*') || userPerms.includes('pos.sales.history.view_all') ||
            ['super_admin', 'admin'].includes(role?.name.toLowerCase() || '');

        if (!canViewAll) {
            // Only see their own orders
            where.cashierUserId = user.id;
        }

        const [orders, total] = await Promise.all([
            this.prisma.salesOrder.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    items: { include: { item: { select: { description: true, sku: true, barCode: true } } } },
                    promo: { select: { name: true, code: true } },
                    coupon: { select: { code: true, description: true } },
                    alliance: { select: { partnerName: true, code: true, discountPercent: true } },
                },
            }),
            this.prisma.salesOrder.count({ where }),
        ]);

        return {
            status: true,
            data: orders,
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
        };
    }

    // ─── Get single order ─────────────────────────────────────────────
    async getOrder(id: string) {
        const order = await this.prisma.salesOrder.findUnique({
            where: { id },
            include: { items: { include: { item: true } } },
        });
        if (!order) return { status: false, message: 'Order not found' };
        return { status: true, data: order };
    }

    // ─── Void order ───────────────────────────────────────────────────
    async voidOrder(id: string) {
        try {
            const order = await this.prisma.salesOrder.update({
                where: { id },
                data: { status: 'voided' },
            });
            return { status: true, data: order, message: 'Order voided' };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    // ─── Enrich items with master data + stock for POS display ────────
    private async enrichForPos(items: any[]) {
        if (!items.length) return [];

        const itemIds = items.map((i) => i.id);

        const stockEntries = await this.prisma.stockLedger.groupBy({
            by: ['itemId'],
            where: { itemId: { in: itemIds } },
            _sum: { qty: true },
        });

        const stockMap = new Map<string, number>();
        for (const entry of stockEntries) {
            stockMap.set(entry.itemId, Number(entry._sum.qty || 0));
        }

        return items.map((item) => {
            const stockQty = stockMap.get(item.id) || 0;
            return {
                id: item.id,
                itemId: item.itemId,
                sku: item.sku,
                barCode: item.barCode,
                description: item.description,
                unitPrice: Number(item.unitPrice),
                taxRate1: Number(item.taxRate1 || 0),
                taxRate2: Number(item.taxRate2 || 0),
                discountRate: Number(item.discountRate || 0),
                brand: item.brand?.name || null,
                size: item.size?.name || null,
                color: item.color?.name || null,
                stockQty,
                inStock: stockQty > 0,
            };
        });
    }
}
