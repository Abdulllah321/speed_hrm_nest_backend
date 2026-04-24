import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { StockLedgerService } from '../warehouse/stock-ledger/stock-ledger.service';
import { MovementType, Prisma } from '@prisma/client';
import { FbrService } from './fbr.service';


@Injectable()
export class PosSalesService implements OnModuleInit {
    constructor(
        private prisma: PrismaService,
        private prismaMaster: PrismaMasterService,
        private stockLedgerService: StockLedgerService,
        private fbrService: FbrService,
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
        let itemsData: Array<{
            itemId: string;
            quantity: number;
            unitPrice: number;
            discountPercent: number;
            discountAmount: number;
            taxPercent: number;
            taxAmount: number;
            lineTotal: number;
        }> = [];

        try {
            const result = await this.prisma.$transaction(async (tx) => {
                const orderNumber = await this.generateOrderNumber();
                const locationId = dto.locationId;

                // ── Resolve default warehouse ───────────────────────────
                const warehouse = await tx.warehouse.findFirst({
                    where: { isActive: true },
                });
                if (!warehouse) throw new Error('No active warehouse found');

                // ── Check if this is a credit sale ─────────────────────
                const isCreditSale = dto.isCreditSale || false;
                const creditAmount = dto.creditAmount || 0;

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
                itemsData = dto.items.map((lineItem) => {
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
                const subtotalAfterItemDiscount = subtotal - lineItemDiscount;

                // ── Calculate global discount with priority logic ──
                let globalDiscAmt = 0;
                let finalLineItemDiscount = lineItemDiscount; // May be zeroed if alliance is better
                let appliedDiscountType = 'none'; // Track which discount was applied
                
                // Calculate all possible discounts
                let manualDiscount = 0;
                let allianceDiscount = 0;
                let couponDiscount = 0;
                
                // 1. Manual discount (from UI)
                if (dto.globalDiscountPercent) {
                    manualDiscount = Math.round(subtotalAfterItemDiscount * (dto.globalDiscountPercent / 100) * 100) / 100;
                } else if (dto.globalDiscountAmount) {
                    manualDiscount = Math.min(dto.globalDiscountAmount, subtotalAfterItemDiscount);
                }
                
                // 2. Alliance discount (calculated on subtotal BEFORE item discounts)
                if (dto.allianceId) {
                    const alliance = await tx.allianceDiscount.findUnique({ where: { id: dto.allianceId } });
                    if (alliance) {
                        allianceDiscount = Math.round(subtotal * (Number(alliance.discountPercent) / 100) * 100) / 100;
                        if (alliance.maxDiscount) {
                            allianceDiscount = Math.min(allianceDiscount, Number(alliance.maxDiscount));
                        }
                    }
                }
                
                // 3. Coupon discount
                if (dto.couponId) {
                    const coupon = await tx.couponCode.findUnique({ where: { id: dto.couponId } });
                    if (coupon) {
                        if (coupon.discountType === 'percent') {
                            const disc = Math.round(subtotalAfterItemDiscount * (Number(coupon.discountValue) / 100) * 100) / 100;
                            couponDiscount = coupon.maxDiscount ? Math.min(disc, Number(coupon.maxDiscount)) : disc;
                        } else {
                            couponDiscount = Math.min(Number(coupon.discountValue), subtotalAfterItemDiscount);
                        }
                    }
                }
                
                // Apply discount priority logic:
                // - If item discount and alliance discount both exist, apply the greater one
                // - If equal, apply alliance discount
                // - The one not applied should be removed from calculation
                
                if (lineItemDiscount > 0 && allianceDiscount > 0) {
                    // Both item and alliance discounts exist - choose the greater one
                    if (allianceDiscount >= lineItemDiscount) {
                        // Alliance discount is greater or equal - use alliance, remove item discount
                        globalDiscAmt = allianceDiscount;
                        finalLineItemDiscount = 0; // Remove item discount
                        appliedDiscountType = 'alliance';
                    } else {
                        // Item discount is greater - keep item discount, no alliance
                        globalDiscAmt = 0;
                        finalLineItemDiscount = lineItemDiscount;
                        appliedDiscountType = 'item';
                    }
                } else if (allianceDiscount > 0) {
                    // Only alliance discount
                    globalDiscAmt = allianceDiscount;
                    appliedDiscountType = 'alliance';
                } else if (couponDiscount > 0) {
                    // Coupon discount
                    globalDiscAmt = couponDiscount;
                    appliedDiscountType = 'coupon';
                } else if (manualDiscount > 0) {
                    // Manual discount
                    globalDiscAmt = manualDiscount;
                    appliedDiscountType = 'manual';
                }

                // Recalculate total with the chosen discount
                const totalDiscount = finalLineItemDiscount + globalDiscAmt;
                const grandTotal = Math.max(0, Math.round((subtotal - totalDiscount + totalTax) * 100) / 100);
                const changeAmount = Math.max(0, totalPaid - grandTotal);

                const notesParts: string[] = [];
                if (dto.notes) notesParts.push(dto.notes);
                if (isCreditSale) notesParts.push(`[Credit Sale] Balance: ${creditAmount}`);
                if (appliedDiscountType === 'alliance' && dto.allianceMeta) {
                    const m = dto.allianceMeta;
                    const parts: string[] = [];
                    if (m.cardholderName) parts.push(`Cardholder: ${m.cardholderName}`);
                    if (m.cardLast4) parts.push(`Card: ****${m.cardLast4}`);
                    if (m.merchantSlip) parts.push(`Slip: ${m.merchantSlip}`);
                    if (parts.length) notesParts.push(`[Alliance] ${parts.join(' | ')}`);
                }

                // Determine payment status - round both values to 2 decimals for comparison
                const totalPaidRounded = Math.round(totalPaid * 100) / 100;
                const grandTotalRounded = Math.round(grandTotal * 100) / 100;
                
                let paymentStatus: string;
                
                // Debug logging
                console.log('Payment Status Calculation:', {
                    totalPaid,
                    totalPaidRounded,
                    grandTotal,
                    grandTotalRounded,
                    difference: totalPaidRounded - grandTotalRounded,
                    comparison: totalPaidRounded >= grandTotalRounded ? 'PAID' : totalPaidRounded > 0 ? 'PARTIAL' : 'UNPAID'
                });
                
                if (totalPaidRounded >= grandTotalRounded) {
                    // Full payment received
                    paymentStatus = 'paid';
                } else if (totalPaidRounded > 0) {
                    // Partial payment received
                    paymentStatus = 'partial';
                } else {
                    // No payment received (credit sale)
                    paymentStatus = 'unpaid';
                }

                const order = await tx.salesOrder.create({
                    data: {
                        orderNumber,
                        posId: dto.posId,
                        terminalId: dto.terminalId,
                        locationId: dto.locationId,
                        customerId: dto.customerId,
                        cashierUserId,
                        paymentMethod: isCreditSale && totalPaid === 0 ? 'credit_account' : paymentMethod,
                        notes: notesParts.join(' | ') || undefined,
                        subtotal,
                        discountAmount: totalDiscount,
                        taxAmount: totalTax,
                        grandTotal,
                        status: 'completed',
                        paymentStatus,
                        globalDiscountPercent: dto.globalDiscountPercent,
                        globalDiscountAmount: globalDiscAmt || undefined,
                        promoId: dto.promoId,
                        couponId: dto.couponId,
                        allianceId: dto.allianceId,
                        tenderType: isCreditSale && totalPaid === 0 ? 'credit_account' : paymentMethod,
                        cashAmount: cashAmount || undefined,
                        cardAmount: cardAmount || undefined,
                        changeAmount: changeAmount || undefined,
                        isGiftReceipt: dto.isGiftReceipt || false,
                        items: {
                            create: itemsData,
                        },
                    },
                    include: {
                        items: { include: { item: { select: { description: true, sku: true, barCode: true } } } },
                        promo: { select: { name: true, code: true } },
                        coupon: { select: { code: true, description: true } },
                        alliance: { select: { partnerName: true, code: true, discountPercent: true, maxDiscount: true } },
                    },
                });

                // ── Update Customer Balance for Credit Sale ────────────
                if (isCreditSale && dto.customerId && creditAmount > 0) {
                    await tx.customer.update({
                        where: { id: dto.customerId },
                        data: {
                            balance: {
                                increment: creditAmount,
                            },
                        },
                    });
                }

                // ── Update Stock (Deduct) ───────────────────────────────
                // Skip if this is a resumed hold order — stock was already deducted at hold time
                const isResumedHold = !!dto.holdOrderId;

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
                        where: { id: dto.holdOrderId },
                        data: { status: 'completed' },
                    });
                }

                if (dto.couponId) {
                    await tx.couponCode.update({
                        where: { id: dto.couponId },
                        data: { usedCount: { increment: 1 } },
                    });
                }

                // ── Redeem vouchers ────────────────────────────────────────
                const voucherRedemptions = dto.voucherRedemptions;
                if (voucherRedemptions?.length) {
                    for (const r of voucherRedemptions) {
                        await tx.voucher.update({
                            where: { id: r.voucherId },
                            data: { isRedeemed: true, isActive: false },
                        });
                        await tx.voucherTransaction.create({
                            data: {
                                voucherId: r.voucherId,
                                orderId: order.id,
                                locationId: locationId,
                                action: 'REDEEMED',
                                amountUsed: r.amount,
                            },
                        });
                        await tx.voucherRedemption.create({
                            data: { voucherId: r.voucherId, orderId: order.id, amountUsed: r.amount },
                        });
                    }
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

            // ── FBR Sync (outside transaction — never rolls back local DB) ──
            await this.syncWithFbr(result.data, itemsData);

            return result;
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    // ─── FBR sync helper ──────────────────────────────────────────────
    private async syncWithFbr(
        order: any,
        itemsData: Array<{
            itemId: string;
            quantity: number;
            unitPrice: number;
            taxAmount: number;
            lineTotal: number;
        }>,
    ) {
        try {
            // ── Load location FBR config ───────────────────────────────
            if (!order.locationId) {
                console.warn(`[FBR] Order ${order.orderNumber} has no locationId — skipping FBR sync`);
                return;
            }

            const location = await this.prisma.location.findUnique({
                where: { id: order.locationId },
                select: {
                    fbrEnabled: true,
                    fbrBposId: true,
                    fbrBearerToken: true,
                    fbrNtn: true,
                    fbrSellerName: true,
                    address: true,
                },
            });

            if (!location?.fbrEnabled) {
                // FBR not configured / enabled for this location — skip silently
                return;
            }

            if (!location.fbrBposId || !location.fbrBearerToken) {
                console.warn(`[FBR] Location ${order.locationId} is FBR-enabled but missing bposId or token — skipping`);
                await this.prisma.salesOrder.update({
                    where: { id: order.id },
                    data: { fbrStatus: 'PENDING' },
                });
                return;
            }

            // ── Fetch item details (sku, description, hsCode) ──────────
            const itemIds = itemsData.map((i) => i.itemId);
            const itemRecords = await this.prisma.item.findMany({
                where: { id: { in: itemIds } },
                select: { id: true, sku: true, description: true, hsCodeStr: true },
            });
            const itemMap = new Map(itemRecords.map((r) => [r.id, r]));

            // Walk-in buyer defaults when no customer is attached
            const buyerNtn = '9999999-9';
            const buyerName = 'Guest';
            const buyerAddress = location.address || '';

            const fbrItems = itemsData.map((line) => {
                const rec = itemMap.get(line.itemId);
                return {
                    itemId: line.itemId,
                    sku: rec?.sku ?? line.itemId,
                    description: rec?.description ?? null,
                    hsCode: rec?.hsCodeStr ?? null,
                    quantity: line.quantity,
                    unitPrice: line.unitPrice,
                    taxAmount: line.taxAmount,
                    lineTotal: line.lineTotal,
                };
            });

            const payload = this.fbrService.buildPayload({
                bposId: location.fbrBposId,
                orderDate: new Date(order.createdAt),
                buyerNtn,
                buyerName,
                buyerAddress,
                sellerNtn: location.fbrNtn || '',
                sellerName: location.fbrSellerName || '',
                items: fbrItems,
            });

            // Override the bearer token with the per-location token
            const fbrResponse = await this.fbrService.postInvoice(payload, location.fbrBearerToken);

            if (fbrResponse.Code === 100) {
                await this.prisma.salesOrder.update({
                    where: { id: order.id },
                    data: {
                        fbrInvoiceNumber: fbrResponse.InvoiceNumber,
                        fbrQrCode: fbrResponse.QRCode,
                        fbrStatus: 'SYNCED',
                    },
                });
                order.fbrInvoiceNumber = fbrResponse.InvoiceNumber;
                order.fbrQrCode = fbrResponse.QRCode;
                order.fbrStatus = 'SYNCED';
            } else {
                const errMsg = `FBR non-success code ${fbrResponse.Code}: ${fbrResponse.Errors ?? ''}`;
                console.error(`[FBR] Order ${order.orderNumber} — ${errMsg}`);
                await this.prisma.salesOrder.update({
                    where: { id: order.id },
                    data: { fbrStatus: 'PENDING' },
                });
            }
        } catch (err: any) {
            // Never throw — log and leave fbrStatus as PENDING
            console.error(`[FBR] Sync failed for order ${order?.orderNumber}: ${err.message}`);
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
                    alliance: { select: { partnerName: true, code: true, discountPercent: true, maxDiscount: true } },
                },
            }),
            this.prisma.salesOrder.count({ where }),
        ]);

        // ── Fetch returned quantities for ALL orders ──
        const orderIds = rawOrders.map(o => o.id);
        const returnEntries = await this.prisma.stockLedger.findMany({
            where: {
                referenceType: 'POS_RETURN',
                referenceId: { in: orderIds },
            },
            select: { referenceId: true, itemId: true, qty: true },
        });

        // Build map: orderId -> itemId -> returnedQty
        const returnedQtyMap = new Map<string, Map<string, number>>();
        for (const entry of returnEntries) {
            if (!returnedQtyMap.has(entry.referenceId)) {
                returnedQtyMap.set(entry.referenceId, new Map());
            }
            const itemMap = returnedQtyMap.get(entry.referenceId)!;
            const current = itemMap.get(entry.itemId) || 0;
            itemMap.set(entry.itemId, current + Math.abs(Number(entry.qty)));
        }

        // Reconstruct tenders and attach returnedQty to each order item
        const orders = rawOrders.map(order => {
            const tenders: { method: string; amount: number }[] = [];
            if (order.tenderType === 'split') {
                if (Number(order.cashAmount) > 0) tenders.push({ method: 'cash', amount: Number(order.cashAmount) });
                if (Number(order.cardAmount) > 0) tenders.push({ method: 'card', amount: Number(order.cardAmount) });
            } else if (order.paymentMethod) {
                const amount = Number(order.cashAmount) || Number(order.cardAmount) || Number(order.grandTotal);
                tenders.push({ method: order.paymentMethod, amount });
            }

            // Attach returnedQty to each item
            const itemMap = returnedQtyMap.get(order.id);
            const enrichedItems = order.items.map(oi => ({
                ...oi,
                returnedQty: itemMap?.get(oi.itemId) || 0,
            }));

            return { ...order, tenders, items: enrichedItems };
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
                alliance: { select: { partnerName: true, code: true, discountPercent: true, maxDiscount: true } },
            },
        });
        if (!order) return { status: false, message: 'Order not found' };

        // Fetch returned quantities for this order
        const returnEntries = await this.prisma.stockLedger.findMany({
            where: {
                referenceType: 'POS_RETURN',
                referenceId: id,
            },
            select: { itemId: true, qty: true },
        });

        const returnedQtyMap = new Map<string, number>();
        for (const entry of returnEntries) {
            const current = returnedQtyMap.get(entry.itemId) || 0;
            returnedQtyMap.set(entry.itemId, current + Math.abs(Number(entry.qty)));
        }

        // Attach returnedQty to each item
        const enrichedItems = order.items.map(oi => ({
            ...oi,
            returnedQty: returnedQtyMap.get(oi.itemId) || 0,
        }));

        const tenders: { method: string; amount: number }[] = [];
        if (order.tenderType === 'split') {
            if (Number(order.cashAmount) > 0) tenders.push({ method: 'cash', amount: Number(order.cashAmount) });
            if (Number(order.cardAmount) > 0) tenders.push({ method: 'card', amount: Number(order.cardAmount) });
        } else if (order.paymentMethod) {
            const amount = Number(order.cashAmount) || Number(order.cardAmount) || Number(order.grandTotal);
            tenders.push({ method: order.paymentMethod, amount });
        }

        return { status: true, data: { ...order, items: enrichedItems, tenders } };
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

                // ── Fetch already-returned quantities BEFORE creating new entries ──
                const existingReturnEntries = await tx.stockLedger.findMany({
                    where: {
                        referenceType: 'POS_RETURN',
                        referenceId: order.id,
                    },
                    select: { itemId: true, qty: true },
                });

                const alreadyReturnedMap = new Map<string, number>();
                for (const entry of existingReturnEntries) {
                    const current = alreadyReturnedMap.get(entry.itemId) || 0;
                    alreadyReturnedMap.set(entry.itemId, current + Math.abs(Number(entry.qty)));
                }

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

                // ── Validate and process return items ──
                for (const returnItem of items) {
                    const orderItem = order.items.find(i => i.id === returnItem.orderItemId);
                    if (!orderItem) continue;

                    const alreadyReturned = alreadyReturnedMap.get(returnItem.itemId) || 0;
                    const remainingReturnable = Number(orderItem.quantity) - alreadyReturned;

                    if (returnItem.quantity > remainingReturnable) {
                        throw new Error(`Cannot return ${returnItem.quantity} of item ${returnItem.itemId}. Only ${remainingReturnable} remaining (${alreadyReturned} already returned).`);
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

                    // Update the map with current return
                    alreadyReturnedMap.set(returnItem.itemId, (alreadyReturnedMap.get(returnItem.itemId) || 0) + returnItem.quantity);
                }

                // ── Determine if ALL items are now fully returned ──
                const allItemsReturned = order.items.every(oi => {
                    const totalReturned = alreadyReturnedMap.get(oi.itemId) || 0;
                    return totalReturned >= Number(oi.quantity);
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

    // ─── Get return details for printing return slip ──────────────────
    async getReturnDetails(orderId: string) {
        try {
            const order = await this.prisma.salesOrder.findUnique({
                where: { id: orderId },
                include: {
                    items: {
                        include: {
                            item: {
                                select: {
                                    description: true,
                                    sku: true,
                                    barCode: true,
                                    brand: { select: { name: true } },
                                },
                            },
                        },
                    },
                    coupon: true,
                },
            });

            if (!order) return { status: false, message: 'Order not found' };

            // Fetch ALREADY-RETURNED quantities from stock ledger
            const returnEntries = await this.prisma.stockLedger.findMany({
                where: {
                    referenceType: 'POS_RETURN',
                    referenceId: orderId,
                },
                select: { itemId: true, qty: true },
            });

            const returnedQtyMap = new Map<string, number>();
            for (const entry of returnEntries) {
                const current = returnedQtyMap.get(entry.itemId) || 0;
                returnedQtyMap.set(entry.itemId, current + Math.abs(Number(entry.qty)));
            }

            // If no returns found, return empty
            if (returnedQtyMap.size === 0) {
                return {
                    status: true,
                    data: {
                        orderId: order.id,
                        orderNumber: order.orderNumber,
                        items: [],
                        reason: order.notes,
                        discountNotes: [],
                        returnedAt: new Date().toISOString(),
                    },
                };
            }

            // Calculate order-level discount per unit (coupon/voucher)
            const lineTotalsSum = order.items.reduce((s, oi) => s + Number(oi.lineTotal), 0);
            const globalDiscAmt = Number(order.globalDiscountAmount || 0);
            const grandTotal = Number(order.grandTotal);

            // Build details for RETURNED items only
            const enrichedItems = order.items
                .filter(oi => returnedQtyMap.has(oi.itemId)) // Only items that were returned
                .map((oi) => {
                    const returnedQty = returnedQtyMap.get(oi.itemId) || 0;
                    const orderedQty = Number(oi.quantity);

                    // Proportional scaling factor based on returned quantity
                    const scaleFactor = returnedQty / orderedQty;

                    const unitPrice = Number(oi.unitPrice);
                    const discountAmount = Number(oi.discountAmount || 0) * scaleFactor;
                    const discountPercent = Number(oi.discountPercent || 0);
                    const taxAmount = Number(oi.taxAmount || 0) * scaleFactor;
                    const taxPercent = Number(oi.taxPercent || 0);
                    const lineTotal = Number(oi.lineTotal) * scaleFactor;

                    // Proportional coupon deduction
                    const couponDeduction = lineTotalsSum > 0
                        ? (lineTotal / lineTotalsSum) * globalDiscAmt
                        : 0;

                    // Original paid per unit (after all discounts including coupon)
                    const originalPaidPerUnit = lineTotalsSum > 0
                        ? (lineTotal / lineTotalsSum) * grandTotal / returnedQty
                        : lineTotal / returnedQty;

                    // Current price logic (use unitCost if available)
                    const currentItem = oi.item;
                    const baseCurrentPrice = Number((currentItem as any).unitCost || 0) > 0
                        ? Number((currentItem as any).unitCost)
                        : unitPrice;
                    const currentPriceWithTax = baseCurrentPrice * (1 + taxPercent / 100);

                    // Refund rule: min(original, current)
                    const refundPerUnit = Math.min(originalPaidPerUnit, currentPriceWithTax);
                    const priceAdjusted = currentPriceWithTax < originalPaidPerUnit;

                    return {
                        orderItemId: oi.id,
                        itemId: oi.itemId,
                        item: oi.item,
                        quantity: orderedQty,
                        returnableQty: returnedQty, // This is the RETURNED qty for history
                        unitPrice,
                        discountAmount,
                        discountPercent,
                        taxAmount,
                        taxPercent,
                        lineTotal,
                        couponDeduction,
                        originalPaidPerUnit,
                        refundPerUnit,
                        priceAdjusted,
                        refundAmount: refundPerUnit * returnedQty,
                    };
                });

            const discountNotes: string[] = [];
            if (order.coupon && (order.coupon.discountType === 'voucher' || order.coupon.discountType === 'fixed')) {
                discountNotes.push(`${order.coupon.code} - ${order.coupon.description || 'Voucher'}`);
            }

            return {
                status: true,
                data: {
                    orderId: order.id,
                    orderNumber: order.orderNumber,
                    items: enrichedItems,
                    reason: order.notes,
                    discountNotes,
                    returnedAt: new Date().toISOString(),
                },
            };
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

    // ─── Cancel a hold order (restore stock) ─────────────────────────
    async cancelHoldOrder(id: string) {
        try {
            return await this.prisma.$transaction(async (tx) => {
                const order = await tx.salesOrder.findUnique({
                    where: { id },
                    include: { items: true },
                });

                if (!order) return { status: false, message: 'Hold order not found' };
                if (order.status !== 'hold') return { status: false, message: 'Order is not on hold' };

                // Restore stock for each item
                const warehouse = await tx.warehouse.findFirst({ where: { isActive: true } });
                if (warehouse) {
                    for (const item of order.items) {
                        await this.stockLedgerService.createEntry({
                            itemId: item.itemId,
                            warehouseId: warehouse.id,
                            locationId: order.locationId,
                            qty: item.quantity,
                            movementType: MovementType.INBOUND,
                            referenceType: 'POS_HOLD_CANCELLED',
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

                // Mark order as cancelled
                await tx.salesOrder.update({
                    where: { id },
                    data: { status: 'hold_cancelled' },
                });

                return {
                    status: true,
                    message: `Hold order ${order.orderNumber} cancelled successfully`,
                };
            });
        } catch (error: any) {
            return { status: false, message: error.message };
        }
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
