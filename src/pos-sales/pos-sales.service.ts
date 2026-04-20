import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { StockLedgerService } from '../warehouse/stock-ledger/stock-ledger.service';
import { MovementType, Prisma } from '@prisma/client';


@Injectable()
export class PosSalesService implements OnModuleInit {
    constructor(
        private prisma: PrismaService,
        private prismaMaster: PrismaMasterService,
        private stockLedgerService: StockLedgerService,
    ) { }

      // ─── Schedule midnight hold-clear ─────────────────────────────────
    onModuleInit() {
        this.scheduleMidnightClear();
    }

    private scheduleMidnightClear() {
        const now = new Date();
        const midnight = new Date(now);
        midnight.setHours(23, 59, 59, 999);
        const msUntilMidnight = midnight.getTime() - now.getTime();

        setTimeout(async () => {
            await this.clearExpiredHolds();
            // Re-schedule for next midnight
            setInterval(() => this.clearExpiredHolds(), 24 * 60 * 60 * 1000);
        }, msUntilMidnight);
    }

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
    async lookupItem(query: string, locationId: string) {
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
        const enriched = await this.enrichForPos(items, locationId);
        return { status: true, data: enriched };
    }

    // ─── Quick barcode scan (exact match only, returns single item) ───
    async scanBarcode(barcode: string, locationId: string) {
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

        const enriched = await this.enrichForPos([item], locationId);
        return { status: true, data: enriched[0] };
    }

    // ─── Create sales order ───────────────────────────────────────────
    async createOrder(dto: CreateSalesOrderDto, cashierUserId?: string) {
        try {
            return await this.prisma.$transaction(async (tx) => {
                const orderNumber = await this.generateOrderNumber();
                const locationId = dto.locationId;

                // ── Resolve default warehouse ───────────────────────────
                const warehouse = await tx.warehouse.findFirst({
                    where: { isActive: true },
                });
                if (!warehouse) throw new Error('No active warehouse found');

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

                let globalDiscAmt = 0;
                if (dto.globalDiscountPercent) {
                    globalDiscAmt = Math.round(lineItemTotal * (dto.globalDiscountPercent / 100) * 100) / 100;
                } else if (dto.globalDiscountAmount) {
                    globalDiscAmt = Math.min(dto.globalDiscountAmount, lineItemTotal);
                }

                // ── Auto-calculate Coupon / Voucher Discount ───────────
                if (dto.couponId && globalDiscAmt === 0) {
                    const coupon = await tx.couponCode.findUnique({ where: { id: dto.couponId } });
                    if (coupon) {
                        if (coupon.discountType === 'percent') {
                            const disc = Math.round(lineItemTotal * (Number(coupon.discountValue) / 100) * 100) / 100;
                            globalDiscAmt = coupon.maxDiscount ? Math.min(disc, Number(coupon.maxDiscount)) : disc;
                        } else {
                            globalDiscAmt = Math.min(Number(coupon.discountValue), lineItemTotal);
                        }
                    }
                }

                const totalDiscount = lineItemDiscount + globalDiscAmt;
                const grandTotal = Math.max(0, Math.round((lineItemTotal - globalDiscAmt) * 100) / 100);
                const changeAmount = Math.max(0, totalPaid - grandTotal);

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

                const order = await tx.salesOrder.create({
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
                        globalDiscountPercent: dto.globalDiscountPercent,
                        globalDiscountAmount: globalDiscAmt || undefined,
                        promoId: dto.promoId,
                        couponId: dto.couponId,
                        allianceId: dto.allianceId,
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

                // ── Update Stock (Deduct) ───────────────────────────────
                // Skip if this is a resumed hold order — stock was already deducted at hold time
                const isResumedHold = !!(dto as any).holdOrderId;

                if (!isResumedHold) {
                for (const item of itemsData) {
                    await this.stockLedgerService.createEntry({
                        itemId: item.itemId,
                        warehouseId: warehouse.id,
                        locationId: locationId,
                        qty: -item.quantity, // Negative for OUTBOUND
                        movementType: MovementType.OUTBOUND,
                        referenceType: 'POS_SALE',
                        // unitCost: item.,
                        referenceId: order.id,
                    }, tx);

                    // ── Sync InventoryItem (for ERP visibility) ─────────
                    // Find existing inventory item first
                    const existingInventory = await tx.inventoryItem.findFirst({
                        where: {
                            itemId: item.itemId,
                            locationId: locationId,
                            status: 'AVAILABLE',
                        },
                    });

                    if (existingInventory) {
                        // Update existing inventory item
                        await tx.inventoryItem.update({
                            where: { id: existingInventory.id },
                            data: { quantity: { decrement: item.quantity } },
                        });
                    } else {
                        // If no record exists at this outlet, create one to reflect the sale
                        // This ensures that ERP views (which read InventoryItem) see the deduction
                        await tx.inventoryItem.create({
                            data: {
                                itemId: item.itemId,
                                locationId: locationId,
                                warehouseId: warehouse.id,
                                quantity: -item.quantity,
                                status: 'AVAILABLE',
                            }
                        });
                    }
                }
                } // end if (!isResumedHold)

                // If resumed from hold, mark the hold order as completed
                if (isResumedHold) {
                    await tx.salesOrder.update({
                        where: { id: (dto as any).holdOrderId },
                        data: { status: 'completed' },
                    });
                }

                if (dto.couponId) {
                    await tx.couponCode.update({
                        where: { id: dto.couponId },
                        data: { usedCount: { increment: 1 } },
                    });
                }

                return {
                    status: true,
                    data: {
                        ...order,
                        tenders,
                        changeAmount,
                    },
                    message: `Order ${orderNumber} created successfully`,
                };
            });
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

        console.log("=================")
        console.log(locationId)
        console.log("=================")
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

        const [rawOrders, total] = await Promise.all([
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

        // Reconstruct tenders from stored columns since they aren't persisted separately
        // Also attach already-returned qty per item for partially_returned orders
        // Attach already-returned qty per item for any order that may have returns
        const returnLedgerEntries = rawOrders.length > 0
            ? await this.prisma.stockLedger.findMany({
                where: { referenceId: { in: rawOrders.map(o => o.id) }, referenceType: 'POS_RETURN', movementType: 'INBOUND' },
                select: { referenceId: true, itemId: true, qty: true },
            })
            : [];

        // Map: orderId → itemId → totalReturnedQty
        const returnedQtyMap = new Map<string, Map<string, number>>();
        for (const entry of returnLedgerEntries) {
            if (!returnedQtyMap.has(entry.referenceId)) returnedQtyMap.set(entry.referenceId, new Map());
            const itemMap = returnedQtyMap.get(entry.referenceId)!;
            itemMap.set(entry.itemId, (itemMap.get(entry.itemId) ?? 0) + Math.abs(Number(entry.qty)));
        }

        const orders = rawOrders.map(order => {
            const tenders: { method: string; amount: number }[] = [];
            if (order.tenderType === 'split') {
                if (Number(order.cashAmount) > 0) tenders.push({ method: 'cash', amount: Number(order.cashAmount) });
                if (Number(order.cardAmount) > 0) tenders.push({ method: 'card', amount: Number(order.cardAmount) });
            } else if (order.paymentMethod) {
                const amount = Number(order.cashAmount) || Number(order.cardAmount) || Number(order.grandTotal);
                tenders.push({ method: order.paymentMethod, amount });
            }

            const itemReturnedMap = returnedQtyMap.get(order.id);
            const itemsWithReturned = order.items.map(item => ({
                ...item,
                returnedQty: itemReturnedMap?.get(item.itemId) ?? 0,
            }));

            return { ...order, items: itemsWithReturned, tenders };
        });

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
            include: {
                items: { include: { item: true } },
                promo: { select: { name: true, code: true } },
                coupon: { select: { code: true, description: true } },
                alliance: { select: { partnerName: true, code: true, discountPercent: true } },
            },
        });
        if (!order) return { status: false, message: 'Order not found' };

        const tenders: { method: string; amount: number }[] = [];
        if (order.tenderType === 'split') {
            if (Number(order.cashAmount) > 0) tenders.push({ method: 'cash', amount: Number(order.cashAmount) });
            if (Number(order.cardAmount) > 0) tenders.push({ method: 'card', amount: Number(order.cardAmount) });
        } else if (order.paymentMethod) {
            const amount = Number(order.cashAmount) || Number(order.cardAmount) || Number(order.grandTotal);
            tenders.push({ method: order.paymentMethod, amount });
        }

        return { status: true, data: { ...order, tenders } };
    }

    // ─── Return details (price-adjusted refund preview) ───────────────
    async getReturnDetails(id: string) {
        try {
            const order = await this.prisma.salesOrder.findUnique({
                where: { id },
                include: { items: { include: { item: true } }, coupon: true, promo: true, alliance: true },
            });
            if (!order) return { status: false, message: 'Order not found' };

            // Fetch already-returned quantities from stock ledger
            const returnedEntries = await this.prisma.stockLedger.findMany({
                where: { referenceId: order.id, referenceType: 'POS_RETURN', movementType: 'INBOUND' },
                select: { itemId: true, qty: true },
            });
            const returnedQtyMap = new Map<string, number>();
            for (const entry of returnedEntries) {
                const prev = returnedQtyMap.get(entry.itemId) ?? 0;
                returnedQtyMap.set(entry.itemId, prev + Math.abs(Number(entry.qty)));
            }

            let totalRefundAmount = 0;
            const lineTotalsSum = order.items.reduce((s, i) => s + Number(i.lineTotal), 0);
            const orderLevelDiscount = lineTotalsSum - Number(order.grandTotal);

            const itemRefundDetails = await Promise.all(
                order.items.map(async (orderItem) => {
                    const orderedQty = Number(orderItem.quantity);
                    const alreadyReturned = returnedQtyMap.get(orderItem.itemId) ?? 0;
                    // Remaining qty that can still be returned
                    const returnableQty = Math.max(0, orderedQty - alreadyReturned);

                    const unitPrice = Number(orderItem.unitPrice);
                    const lineTotal = Number(orderItem.lineTotal); // total for full ordered qty

                    // Scale lineTotal to returnableQty only
                    const scaleFactor = orderedQty > 0 ? returnableQty / orderedQty : 0;
                    const scaledLineTotal = lineTotal * scaleFactor;

                    // Item-level discount and tax — scale to returnable qty
                    const discountAmount = Number(orderItem.discountAmount ?? 0) * scaleFactor;
                    const taxAmount = Number(orderItem.taxAmount ?? 0) * scaleFactor;

                    // Proportional coupon deduction for this item's returnable share
                    const itemCouponDeduction = lineTotalsSum > 0
                        ? (scaledLineTotal / lineTotalsSum) * orderLevelDiscount
                        : 0;

                    const itemShare = scaledLineTotal - itemCouponDeduction;
                    const originalPaidPerUnit = returnableQty > 0 ? itemShare / returnableQty : 0;

                    const currentItem = await this.prisma.item.findUnique({
                        where: { id: orderItem.itemId },
                        select: { unitPrice: true, unitCost: true },
                    });
                    const baseCurrentPrice = currentItem
                        ? (Number(currentItem.unitCost) > 0 ? Number(currentItem.unitCost) : Number(currentItem.unitPrice))
                        : originalPaidPerUnit;

                    const taxPercent = Number(orderItem.taxPercent) || 0;
                    const currentPriceWithTax = baseCurrentPrice * (1 + taxPercent / 100);
                    const refundPerUnit = Math.min(originalPaidPerUnit, currentPriceWithTax);
                    const lineRefund = Math.round(refundPerUnit * returnableQty * 100) / 100;
                    totalRefundAmount += lineRefund;

                    return {
                        orderItemId: orderItem.id,
                        itemId: orderItem.itemId,
                        quantity: returnableQty,           // ← only returnable qty
                        orderedQty,
                        alreadyReturnedQty: alreadyReturned,
                        unitPrice: Math.round(unitPrice * 100) / 100,
                        discountAmount: Math.round(discountAmount * 100) / 100,
                        discountPercent: Number(orderItem.discountPercent ?? 0),
                        taxAmount: Math.round(taxAmount * 100) / 100,
                        taxPercent,
                        couponDeduction: Math.round(itemCouponDeduction * 100) / 100,
                        originalPaidPerUnit: Math.round(originalPaidPerUnit * 100) / 100,
                        refundPerUnit: Math.round(refundPerUnit * 100) / 100,
                        priceAdjusted: currentPriceWithTax < originalPaidPerUnit,
                    };
                }),
            );

            return {
                status: true,
                data: {
                    orderId: id,
                    orderNumber: order.orderNumber,
                    grandTotal: Number(order.grandTotal),
                    orderLevelDiscount: Math.round(orderLevelDiscount * 100) / 100,
                    couponCode: order.coupon?.code ?? null,
                    promoCode: order.promo?.code ?? null,
                    refundTotal: Math.round(totalRefundAmount * 100) / 100,
                    itemRefundDetails,
                },
            };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    // ─── Partial return ───────────────────────────────────────────────
    async returnItems(id: string, items: { orderItemId: string; itemId: string; quantity: number }[], reason?: string, returnLocationId?: string) {
        try {
            return await this.prisma.$transaction(async (tx) => {
                const order = await tx.salesOrder.findUnique({
                    where: { id },
                    include: { items: true, coupon: true },
                });
                if (!order) return { status: false, message: 'Order not found' };
                if (order.status === 'voided') return { status: false, message: 'Order is already voided' };

                const warehouse = await tx.warehouse.findFirst({ where: { isActive: true } });
                if (!warehouse) throw new Error('No active warehouse found');

                // Determine effective location for return (where stock goes back)
                const effectiveLocationId = returnLocationId || order.locationId;

                let totalRefundAmount = 0;
                const itemRefundDetails: {
                    orderItemId: string;
                    itemId: string;
                    quantity: number;
                    unitPrice: number;
                    discountAmount: number;
                    discountPercent: number;
                    taxAmount: number;
                    taxPercent: number;
                    couponDeduction: number;
                    originalPaidPerUnit: number;
                    refundPerUnit: number;
                    priceAdjusted: boolean;
                }[] = [];

                // Pre-compute for proportional coupon distribution
                const lineTotalsSum = order.items.reduce((s, i) => s + Number(i.lineTotal), 0);
                const orderLevelDiscount = lineTotalsSum - Number(order.grandTotal);

                // Pre-fetch already returned quantities per orderItem from stock ledger
                // Use orderItemId-level tracking via a separate table isn't available,
                // so we track by itemId but scope to this order only
                const alreadyReturnedEntries = await tx.stockLedger.findMany({
                    where: { referenceId: order.id, referenceType: 'POS_RETURN', movementType: 'INBOUND' },
                    select: { itemId: true, qty: true },
                });
                const alreadyReturnedMap = new Map<string, number>();
                for (const entry of alreadyReturnedEntries) {
                    const prev = alreadyReturnedMap.get(entry.itemId) ?? 0;
                    alreadyReturnedMap.set(entry.itemId, prev + Math.abs(Number(entry.qty)));
                }

                for (const returnItem of items) {
                    const orderItem = order.items.find(i => i.id === returnItem.orderItemId);
                    if (!orderItem) continue;

                    const alreadyReturned = alreadyReturnedMap.get(returnItem.itemId) ?? 0;
                    const remainingReturnable = Number(orderItem.quantity) - alreadyReturned;
                    if (returnItem.quantity > remainingReturnable) {
                        throw new Error(`Return qty (${returnItem.quantity}) exceeds remaining returnable qty (${remainingReturnable}) for item ${returnItem.itemId}`);
                    }

                    const qty = Number(orderItem.quantity);
                    const lineTotal = Number(orderItem.lineTotal);

                    // ── Refund price rule ─────────────────────────────────
                    // Proportionally distribute grandTotal across items so order-level
                    // coupon/voucher discounts are correctly reflected in the refund.
                    const itemCouponDeduction = lineTotalsSum > 0
                        ? (lineTotal / lineTotalsSum) * orderLevelDiscount
                        : 0;
                    const itemShare = lineTotal - itemCouponDeduction;
                    const originalPaidPerUnit = itemShare / qty;

                    // Current item price — POS uses unitCost when set, otherwise unitPrice
                    const currentItem = await tx.item.findUnique({
                        where: { id: returnItem.itemId },
                        select: { unitPrice: true, unitCost: true },
                    });
                    const baseCurrentPrice = currentItem
                        ? (Number(currentItem.unitCost) > 0 ? Number(currentItem.unitCost) : Number(currentItem.unitPrice))
                        : originalPaidPerUnit;

                    // Apply the same tax rate that was charged at sale time
                    const taxPercent = Number(orderItem.taxPercent) || 0;
                    const currentPriceWithTax = baseCurrentPrice * (1 + taxPercent / 100);

                    // Rule: refund = min(originalPaid, currentPriceWithTax)
                    // i.e. if price dropped/discounted → refund current (lower) price
                    //      if price rose               → refund original (lower) price
                    const refundPerUnit = Math.min(originalPaidPerUnit, currentPriceWithTax);
                    totalRefundAmount += refundPerUnit * returnItem.quantity;

                    itemRefundDetails.push({
                        orderItemId: returnItem.orderItemId,
                        itemId: returnItem.itemId,
                        quantity: returnItem.quantity,
                        unitPrice: Math.round(Number(orderItem.unitPrice) * 100) / 100,
                        discountAmount: Math.round(Number(orderItem.discountAmount ?? 0) * (returnItem.quantity / qty) * 100) / 100,
                        discountPercent: Number(orderItem.discountPercent ?? 0),
                        taxAmount: Math.round(Number(orderItem.taxAmount ?? 0) * (returnItem.quantity / qty) * 100) / 100,
                        taxPercent: Number(orderItem.taxPercent ?? 0),
                        couponDeduction: Math.round(itemCouponDeduction * (returnItem.quantity / qty) * 100) / 100,
                        originalPaidPerUnit: Math.round(originalPaidPerUnit * 100) / 100,
                        refundPerUnit: Math.round(refundPerUnit * 100) / 100,
                        priceAdjusted: currentPriceWithTax < originalPaidPerUnit,
                    });

                    await this.stockLedgerService.createEntry({
                        itemId: returnItem.itemId,
                        warehouseId: warehouse.id,
                        locationId: effectiveLocationId,
                        qty: returnItem.quantity,
                        movementType: MovementType.INBOUND,
                        referenceType: 'POS_RETURN',
                        referenceId: order.id,
                    }, tx);

                    const existing = await tx.inventoryItem.findFirst({
                        where: { itemId: returnItem.itemId, locationId: effectiveLocationId, status: 'AVAILABLE' },
                    });
                    if (existing) {
                        await tx.inventoryItem.update({
                            where: { id: existing.id },
                            data: { quantity: { increment: returnItem.quantity } },
                        });
                    } else {
                        await tx.inventoryItem.create({
                            data: {
                                itemId: returnItem.itemId,
                                locationId: effectiveLocationId,
                                warehouseId: warehouse.id,
                                quantity: returnItem.quantity,
                                status: 'AVAILABLE',
                            },
                        });
                    }
                }

                // Determine if this is a full return
                // Use alreadyReturnedMap (fetched BEFORE stock ledger entries were created)
                // + current return quantities to avoid counting current entries twice
                const allItemsReturned = order.items.every(oi => {
                    const prevQty = alreadyReturnedMap.get(oi.itemId) ?? 0;
                    const currentReturnItem = items.find(ri => ri.orderItemId === oi.id);
                    const currentQty = currentReturnItem?.quantity ?? 0;
                    return (prevQty + currentQty) >= Number(oi.quantity);
                });

                const newStatus = allItemsReturned ? 'returned' : 'partially_returned';
                const updatedOrder = await tx.salesOrder.update({
                    where: { id },
                    data: { status: newStatus, notes: reason ? `Return (${newStatus}): ${reason}` : order.notes },
                });

                // ── Restore Voucher / Coupon ────────────────────────────
                // Ensure voucher is only restored once per order
                if (order.couponId && !order.isVoucherRestored) {
                    const coupon = await tx.couponCode.findUnique({ where: { id: order.couponId } });
                    if (coupon && (coupon.discountType === 'voucher' || coupon.discountType === 'fixed')) {
                        // 1. Decrement used count (restore validity)
                        if (coupon.usedCount > 0) {
                            await tx.couponCode.update({
                                where: { id: order.couponId },
                                data: { usedCount: { decrement: 1 } },
                            });

                            // Create Audit Log
                            await tx.voucherAuditLog.create({
                                data: {
                                    couponId: order.couponId,
                                    orderId: id,
                                    locationId: effectiveLocationId,
                                    action: 'RESTORED_VIA_RETURN',
                                    previousValue: coupon.usedCount,
                                    newValue: coupon.usedCount - 1,
                                    details: `Voucher restored during return of order ${order.orderNumber}`,
                                },
                            });

                            // Update order flag
                            await tx.salesOrder.update({
                                where: { id },
                                data: { isVoucherRestored: true },
                            });
                        }

                        // 2. Restrict to the return location as requested
                        if (effectiveLocationId) {
                            await tx.couponCodeLocation.deleteMany({ where: { couponId: order.couponId } });
                            await tx.couponCodeLocation.create({
                                data: {
                                    couponId: order.couponId,
                                    locationId: effectiveLocationId,
                                },
                            });
                        }
                    }
                }

                return { status: true, data: updatedOrder, refundAmount: Math.round(totalRefundAmount * 100) / 100, itemRefundDetails, message: `Return processed (${newStatus}) and inventory restored` };
            });
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    // ─── Void order ───────────────────────────────────────────────────
    async voidOrder(id: string) {
        try {
            return await this.prisma.$transaction(async (tx) => {
                // Get the order with items first
                const order = await tx.salesOrder.findUnique({
                    where: { id },
                    include: { items: true, coupon: true },
                });

                if (!order) {
                    return { status: false, message: 'Order not found' };
                }

                if (order.status === 'voided') {
                    return { status: false, message: 'Order is already voided' };
                }

                // Update order status to voided
                const voidedOrder = await tx.salesOrder.update({
                    where: { id },
                    data: { status: 'voided' },
                });

                // Resolve default warehouse
                const warehouse = await tx.warehouse.findFirst({
                    where: { isActive: true },
                });
                if (!warehouse) throw new Error('No active warehouse found');

                // Restore inventory for each item
                for (const item of order.items) {
                    // Create stock ledger entry to restore stock
                    await this.stockLedgerService.createEntry({
                        itemId: item.itemId,
                        warehouseId: warehouse.id,
                        locationId: order.locationId,
                        qty: item.quantity, // Positive to restore stock
                        movementType: MovementType.INBOUND,
                        referenceType: 'POS_VOID',
                        referenceId: order.id,
                    }, tx);

                    // Restore InventoryItem quantity
                    const existingInventory = await tx.inventoryItem.findFirst({
                        where: {
                            itemId: item.itemId,
                            locationId: order.locationId,
                            status: 'AVAILABLE',
                        },
                    });

                    if (existingInventory) {
                        // Update existing inventory item
                        await tx.inventoryItem.update({
                            where: { id: existingInventory.id },
                            data: { quantity: { increment: item.quantity } },
                        });
                    } else {
                        // Create new inventory item if none exists
                        await tx.inventoryItem.create({
                            data: {
                                itemId: item.itemId,
                                locationId: order.locationId,
                                warehouseId: warehouse.id,
                                quantity: item.quantity,
                                status: 'AVAILABLE',
                            }
                        });
                    }
                }

                // ── Restore Voucher / Coupon (for voided orders) ─────────
                if (order.couponId && !order.isVoucherRestored) {
                    const coupon = await tx.couponCode.findUnique({ where: { id: order.couponId } });
                    if (coupon && (coupon.discountType === 'voucher' || coupon.discountType === 'fixed')) {
                        if (coupon.usedCount > 0) {
                            await tx.couponCode.update({
                                where: { id: order.couponId },
                                data: { usedCount: { decrement: 1 } },
                            });

                            // Create Audit Log
                            await tx.voucherAuditLog.create({
                                data: {
                                    couponId: order.couponId,
                                    orderId: id,
                                    locationId: order.locationId,
                                    action: 'RESTORED_VIA_VOID',
                                    previousValue: coupon.usedCount,
                                    newValue: coupon.usedCount - 1,
                                    details: `Voucher restored due to voiding order ${order.orderNumber}`,
                                },
                            });

                            // Update order flag
                            await tx.salesOrder.update({
                                where: { id },
                                data: { isVoucherRestored: true },
                            });
                        }
                    }
                }

                return { status: true, data: voidedOrder, message: 'Order voided and inventory restored' };
            });
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }
    // ─── Exchange items ───────────────────────────────────────────────
    async exchangeItems(
        id: string,
        returnedItems: { orderItemId: string; itemId: string; quantity: number }[],
        newItems: { itemId: string; quantity: number; unitPrice: number }[],
        reason?: string,
    ) {
        try {
            return await this.prisma.$transaction(async (tx) => {
                const order = await tx.salesOrder.findUnique({ where: { id }, include: { items: true, coupon: true } });
                if (!order) return { status: false, message: 'Order not found' };
                if (order.status === 'voided') return { status: false, message: 'Order is already voided' };

                const warehouse = await tx.warehouse.findFirst({ where: { isActive: true } });
                if (!warehouse) throw new Error('No active warehouse found');

                // ── Restore returned items ──────────────────────────────
                for (const ri of returnedItems) {
                    const orderItem = order.items.find(i => i.id === ri.orderItemId);
                    if (!orderItem || ri.quantity > orderItem.quantity) continue;

                    await this.stockLedgerService.createEntry({
                        itemId: ri.itemId, warehouseId: warehouse.id, locationId: order.locationId,
                        qty: ri.quantity, movementType: MovementType.INBOUND,
                        referenceType: 'POS_EXCHANGE_IN', referenceId: order.id,
                    }, tx);

                    const existing = await tx.inventoryItem.findFirst({
                        where: { itemId: ri.itemId, locationId: order.locationId, status: 'AVAILABLE' },
                    });
                    if (existing) {
                        await tx.inventoryItem.update({ where: { id: existing.id }, data: { quantity: { increment: ri.quantity } } });
                    } else {
                        await tx.inventoryItem.create({ data: { itemId: ri.itemId, locationId: order.locationId, warehouseId: warehouse.id, quantity: ri.quantity, status: 'AVAILABLE' } });
                    }
                }

                // ── Deduct new items ────────────────────────────────────
                for (const ni of newItems) {
                    await this.stockLedgerService.createEntry({
                        itemId: ni.itemId, warehouseId: warehouse.id, locationId: order.locationId,
                        qty: -ni.quantity, movementType: MovementType.OUTBOUND,
                        referenceType: 'POS_EXCHANGE_OUT', referenceId: order.id,
                    }, tx);

                    const existing = await tx.inventoryItem.findFirst({
                        where: { itemId: ni.itemId, locationId: order.locationId, status: 'AVAILABLE' },
                    });
                    if (existing) {
                        await tx.inventoryItem.update({ where: { id: existing.id }, data: { quantity: { decrement: ni.quantity } } });
                    } else {
                        await tx.inventoryItem.create({ data: { itemId: ni.itemId, locationId: order.locationId, warehouseId: warehouse.id, quantity: -ni.quantity, status: 'AVAILABLE' } });
                    }
                }

                const returnedValue = returnedItems.reduce((s, ri) => {
                    const oi = order.items.find(i => i.id === ri.orderItemId);
                    // Use lineTotal/quantity so discounts & tax are correctly reflected
                    return s + (oi ? (Number(oi.lineTotal) / Number(oi.quantity)) * ri.quantity : 0);
                }, 0);
                const newValue = newItems.reduce((s, ni) => s + ni.unitPrice * ni.quantity, 0);
                const difference = newValue - returnedValue; // positive = customer pays more, negative = refund

                const updatedOrder = await tx.salesOrder.update({
                    where: { id },
                    data: { status: 'exchanged', notes: reason ? `Exchange: ${reason}` : order.notes },
                });

                // ── Restore Voucher / Coupon (for exchanges) ──────────────
                if (order.couponId && !order.isVoucherRestored) {
                    const coupon = await tx.couponCode.findUnique({ where: { id: order.couponId } });
                    if (coupon && (coupon.discountType === 'voucher' || coupon.discountType === 'fixed')) {
                        if (coupon.usedCount > 0) {
                            await tx.couponCode.update({
                                where: { id: order.couponId },
                                data: { usedCount: { decrement: 1 } },
                            });

                            // Create Audit Log
                            await tx.voucherAuditLog.create({
                                data: {
                                    couponId: order.couponId,
                                    orderId: id,
                                    locationId: order.locationId,
                                    action: 'RESTORED_VIA_EXCHANGE',
                                    previousValue: coupon.usedCount,
                                    newValue: coupon.usedCount - 1,
                                    details: `Voucher restored during exchange in order ${order.orderNumber}`,
                                },
                            });

                            // Update order flag
                            await tx.salesOrder.update({
                                where: { id },
                                data: { isVoucherRestored: true },
                            });
                        }

                        // Restrict to exchange location
                        if (order.locationId) {
                            await tx.couponCodeLocation.deleteMany({ where: { couponId: order.couponId } });
                            await tx.couponCodeLocation.create({
                                data: {
                                    couponId: order.couponId,
                                    locationId: order.locationId,
                                },
                            });
                        }
                    }
                }

                return { status: true, data: { ...updatedOrder, difference }, message: 'Exchange processed successfully' };
            });
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    // ─── Refund only (no stock movement) ─────────────────────────────
    async refundOnly(id: string, refundAmount: number, reason?: string) {
        try {
            const order = await this.prisma.salesOrder.findUnique({ where: { id } });
            if (!order) return { status: false, message: 'Order not found' };
            if (order.status === 'voided') return { status: false, message: 'Order is already voided' };
            if (refundAmount <= 0) return { status: false, message: 'Refund amount must be greater than 0' };
            if (refundAmount > Number(order.grandTotal)) return { status: false, message: 'Refund amount exceeds order total' };

            const updatedOrder = await this.prisma.salesOrder.update({
                where: { id },
                data: { status: 'refunded', notes: reason ? `Refund Rs.${refundAmount}: ${reason}` : `Refund Rs.${refundAmount}` },
            });

            return { status: true, data: updatedOrder, message: `Refund of Rs.${refundAmount} processed` };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    // ─── Hold order (max 1 hour, auto-cleared at midnight) ───────────
    async holdOrder(dto: CreateSalesOrderDto, cashierUserId?: string) {
        try {
            const orderNumber = await this.generateOrderNumber();

            const now = new Date();
            const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
            const midnight = new Date(now);
            midnight.setHours(23, 59, 59, 999);
            const holdExpiresAt = oneHourLater < midnight ? oneHourLater : midnight;

            const itemsData = dto.items.map((lineItem) => {
                const subtotal = lineItem.unitPrice * lineItem.quantity;
                const discPct = lineItem.discountPercent || 0;
                const discAmt = Math.round(subtotal * (discPct / 100) * 100) / 100;
                const afterDisc = subtotal - discAmt;
                const taxPct = lineItem.taxPercent || 0;
                const taxAmt = Math.round(afterDisc * (taxPct / 100) * 100) / 100;
                const lineTotal = Math.round((afterDisc + taxAmt) * 100) / 100;
                return {
                    itemId: lineItem.itemId,
                    quantity: lineItem.quantity,
                    unitPrice: lineItem.unitPrice,
                    discountPercent: discPct,
                    discountAmount: discAmt,
                    taxPercent: taxPct,
                    taxAmount: taxAmt,
                    lineTotal: Math.max(0, lineTotal),
                    isStockInTransit: (lineItem as any).isStockInTransit || false,
                };
            });

            const subtotal = itemsData.reduce((acc, i) => acc + i.unitPrice * i.quantity, 0);
            const totalDiscount = itemsData.reduce((acc, i) => acc + i.discountAmount, 0);
            const totalTax = itemsData.reduce((acc, i) => acc + i.taxAmount, 0);
            const grandTotal = Math.max(0, Math.round((subtotal - totalDiscount + totalTax) * 100) / 100);

            return await this.prisma.$transaction(async (tx) => {
                const order = await tx.salesOrder.create({
                    data: {
                        orderNumber,
                        posId: dto.posId,
                        terminalId: dto.terminalId,
                        locationId: dto.locationId,
                        customerId: dto.customerId,
                        cashierUserId,
                        paymentMethod: null,
                        notes: dto.notes,
                        subtotal,
                        discountAmount: totalDiscount,
                        taxAmount: totalTax,
                        grandTotal,
                        status: 'hold',
                        paymentStatus: 'unpaid',
                        holdExpiresAt,
                        items: { create: itemsData },
                    },
                    include: {
                        items: { include: { item: { select: { description: true, sku: true, barCode: true } } } },
                    },
                });

                // ── Deduct stock immediately on hold ────────────────────
                const warehouse = await tx.warehouse.findFirst({ where: { isActive: true } });
                if (warehouse) {
                    for (const item of itemsData) {
                        await this.stockLedgerService.createEntry({
                            itemId: item.itemId,
                            warehouseId: warehouse.id,
                            locationId: dto.locationId,
                            qty: -item.quantity,
                            movementType: MovementType.OUTBOUND,
                            referenceType: 'POS_HOLD',
                            referenceId: order.id,
                        }, tx);

                        const existing = await tx.inventoryItem.findFirst({
                            where: { itemId: item.itemId, locationId: dto.locationId, status: 'AVAILABLE' },
                        });
                        if (existing) {
                            await tx.inventoryItem.update({
                                where: { id: existing.id },
                                data: { quantity: { decrement: item.quantity } },
                            });
                        } else {
                            await tx.inventoryItem.create({
                                data: {
                                    itemId: item.itemId,
                                    locationId: dto.locationId,
                                    warehouseId: warehouse.id,
                                    quantity: -item.quantity,
                                    status: 'AVAILABLE',
                                },
                            });
                        }
                    }
                }

                return {
                    status: true,
                    data: order,
                    message: `Order ${orderNumber} placed on hold until ${holdExpiresAt.toLocaleTimeString()}`,
                };
            });
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    // ─── Resume a held order (returns cart items to frontend) ─────────
    async resumeHoldOrder(id: string) {
        const order = await this.prisma.salesOrder.findUnique({
            where: { id },
            include: { items: { include: { item: true } } },
        });
        if (!order) return { status: false, message: 'Hold order not found' };
        if (order.status !== 'hold') return { status: false, message: 'Order is not on hold' };

        const now = new Date();
        if (order.holdExpiresAt && order.holdExpiresAt < now) {
            // Auto-clear expired hold
            await this.prisma.salesOrder.update({ where: { id }, data: { status: 'hold_expired' } });
            return { status: false, message: 'Hold order has expired' };
        }

        return { status: true, data: order };
    }

    // ─── List active hold orders for a POS/location ───────────────────
    async listHoldOrders(posId?: string, locationId?: string) {
        const now = new Date();
        const where: any = {
            status: 'hold',
            holdExpiresAt: { gt: now },
        };
        if (posId) where.posId = posId;
        if (locationId) where.locationId = locationId;

        const orders = await this.prisma.salesOrder.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: {
                items: { include: { item: { select: { description: true, sku: true, barCode: true } } } },
            },
        });
        return { status: true, data: orders };
    }

    // ─── Clear all expired / end-of-day holds (called by scheduler) ──
    async clearExpiredHolds() {
        const now = new Date();

        // Fetch expired holds with items before marking them expired
        const expiredOrders = await this.prisma.salesOrder.findMany({
            where: { status: 'hold', holdExpiresAt: { lte: now } },
            include: { items: true },
        });

        if (expiredOrders.length === 0) return { status: true, cleared: 0 };

        const warehouse = await this.prisma.warehouse.findFirst({ where: { isActive: true } });

        for (const order of expiredOrders) {
            await this.prisma.$transaction(async (tx) => {
                // Restore stock for each item
                if (warehouse) {
                    for (const item of order.items) {
                        await this.stockLedgerService.createEntry({
                            itemId: item.itemId,
                            warehouseId: warehouse.id,
                            locationId: order.locationId,
                            qty: item.quantity,
                            movementType: MovementType.INBOUND,
                            referenceType: 'POS_HOLD_EXPIRED',
                            referenceId: order.id,
                        }, tx);

                        const existing = await tx.inventoryItem.findFirst({
                            where: { itemId: item.itemId, locationId: order.locationId, status: 'AVAILABLE' },
                        });
                        if (existing) {
                            await tx.inventoryItem.update({
                                where: { id: existing.id },
                                data: { quantity: { increment: item.quantity } },
                            });
                        }
                    }
                }

                await tx.salesOrder.update({
                    where: { id: order.id },
                    data: { status: 'hold_expired' },
                });
            });
        }

        return { status: true, cleared: expiredOrders.length };
    }

    // ─── Enrich items with master data + stock for POS display ────────
    private async enrichForPos(items: any[], locationId: string) {
        if (!items.length) return [];

        const itemIds = items.map((i) => i.id);

        const stockEntries = await this.prisma.stockLedger.groupBy({
            by: ['itemId'],
            where: {
                itemId: { in: itemIds },
                locationId: locationId,
            },
            _sum: { qty: true },
        });

        const stockMap = new Map<string, number>();
        for (const entry of stockEntries) {
            stockMap.set(entry.itemId, Number(entry._sum.qty || 0));
        }

        return items.map((item) => {
            const stockQty = stockMap.get(item.id) || 0;
            const latestPrice = Number(item.unitCost || 0) > 0
                ? Number(item.unitCost)
                : Number(item.unitPrice || 0);
            return {
                id: item.id,
                itemId: item.itemId,
                sku: item.sku,
                barCode: item.barCode,
                description: item.description,
                unitPrice: latestPrice,
                unitCost: Number(item.unitCost || 0),
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
