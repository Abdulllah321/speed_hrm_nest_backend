import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { StockLedgerService } from '../warehouse/stock-ledger/stock-ledger.service';
import { MovementType, Prisma } from '@prisma/client';
import { FbrService } from './fbr.service';
import { VoucherService } from '../pos-config/voucher.service';

import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { runInBackground } from '../common/utils/run-in-background.util';
@Injectable()
export class PosSalesService implements OnModuleInit {
    constructor(
        private prisma: PrismaService,
        private prismaMaster: PrismaMasterService,
        private stockLedgerService: StockLedgerService,
        private fbrService: FbrService,
        private activityLogs: ActivityLogsService,
        private voucherService: VoucherService,
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

        // ── Step 1: text-match items first (selective, small result set) ──
        // Exact matches on barCode/sku/itemId are boosted by ordering them first.
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
            },
        });

        if (!items.length) return { status: true, data: [] };

        // ── Step 2: check stock only for the matched items (≤20 IDs) ──
        // Single enrichForPos call handles both ledger + inventoryItem fallback.
        const enriched = await this.enrichForPos(items, locationId);

        // Return only items that are actually in stock at this location
        return { status: true, data: enriched.filter((i) => i.stockQty > 0) };
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
    async createOrder(dto: CreateSalesOrderDto, cashierUserId?: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
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
                    where: { isActive: true, isDeleted: false },
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
                    const retailPrice = lineItem.unitPrice;
                    const taxPct = lineItem.taxPercent || 0;
                    const taxDivisor = 1 + (taxPct / 100);
                    
                    // Calculate WOST (Value excluding tax) from Retail Price
                    // WOST = Retail / (1 + tax%)
                    const wostPerUnit = retailPrice / taxDivisor;
                    const totalWost = Math.round(wostPerUnit * lineItem.quantity * 100) / 100;
                    
                    // Apply discount on WOST (not on Retail Price)
                    // Use overrideDiscountPercent if available, otherwise use discountPercent
                    const discPct = lineItem.overrideDiscountPercent ?? lineItem.discountPercent ?? 0;
                    const discAmt = Math.round(totalWost * (discPct / 100) * 100) / 100;
                    const afterDisc = totalWost - discAmt;
                    
                    // Calculate tax on amount after discount
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

                // Calculate subtotal as sum of WOST (not retail price)
                const subtotal = itemsData.reduce((acc, i) => {
                    const taxDivisor = 1 + (i.taxPercent / 100);
                    const wostPerUnit = i.unitPrice / taxDivisor;
                    return acc + (wostPerUnit * i.quantity);
                }, 0);
                const lineItemDiscount = itemsData.reduce((acc, i) => acc + i.discountAmount, 0);
                const recalculatedTotalTax = itemsData.reduce((acc, i) => acc + i.taxAmount, 0);
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
                    const alliance = await tx.allianceDiscount.findFirst({ where: { id: dto.allianceId, isDeleted: false } });
                    if (alliance) {
                        if (alliance.maxDiscount) {
                            allianceDiscount = Number(alliance.maxDiscount);
                        } else {
                            allianceDiscount = Math.round(subtotal * (Number(alliance.discountPercent) / 100) * 100) / 100;
                        }
                    }
                }
                
                // 3. Coupon discount
                if (dto.couponId) {
                    const coupon = await tx.couponCode.findFirst({ where: { id: dto.couponId, isDeleted: false } });
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

                        // IMPORTANT: Distribute alliance discount across itemsData
                        const count = itemsData.length;
                        const baseDisc = Math.floor(globalDiscAmt / count);
                        let remainder = Math.round((globalDiscAmt - (baseDisc * count)) * 100) / 100;

                        itemsData = itemsData.map((item, idx) => {
                            const lineSubtotal = item.unitPrice * item.quantity;
                            let disc = baseDisc;
                            if (remainder > 0) {
                                disc += 1;
                                remainder -= 1;
                            }
                            
                            // Recalculate tax based on WOST after discount
                            const taxDivisor = 1 + (item.taxPercent / 100);
                            const wostPerUnit = item.unitPrice / taxDivisor;
                            const totalWost = Math.round(wostPerUnit * item.quantity * 100) / 100;
                            const afterDisc = totalWost - disc;
                            const recalculatedTax = Math.round(afterDisc * (item.taxPercent / 100) * 100) / 100;
                            
                            return {
                                ...item,
                                discountPercent: Math.round((disc / lineSubtotal) * 100 * 100) / 100,
                                discountAmount: disc,
                                taxAmount: recalculatedTax,
                                lineTotal: Math.round((afterDisc + recalculatedTax) * 100) / 100
                            };
                        });
                        // Since it's distributed, we can set globalDiscAmt to 0 if we want it to ONLY show on items,
                        // but usually it's better to keep it and hide it in the UI if needed.
                        // The user said "Alliance: UBL-SIGNATURE -3000 isko items ke sath show karo", 
                        // so I will keep globalDiscAmt for the label but ensure receipt summary doesn't double count.
                    } else {
                        // Item discount is greater - keep item discount, no alliance
                        globalDiscAmt = 0;
                        finalLineItemDiscount = lineItemDiscount;
                        appliedDiscountType = 'item';
                    }
                } else if (allianceDiscount > 0) {
                    // Only alliance discount - distribute across items
                    globalDiscAmt = allianceDiscount;
                    appliedDiscountType = 'alliance';
                    
                    const count = itemsData.length;
                    const baseDisc = Math.floor(globalDiscAmt / count);
                    let remainder = Math.round((globalDiscAmt - (baseDisc * count)) * 100) / 100;

                    itemsData = itemsData.map((item, idx) => {
                        const lineSubtotal = item.unitPrice * item.quantity;
                        let disc = baseDisc;
                        if (remainder > 0) {
                            disc += 1;
                            remainder -= 1;
                        }
                        
                        // Recalculate tax based on WOST after discount
                        const taxDivisor = 1 + (item.taxPercent / 100);
                        const wostPerUnit = item.unitPrice / taxDivisor;
                        const totalWost = Math.round(wostPerUnit * item.quantity * 100) / 100;
                        const afterDisc = totalWost - disc;
                        const recalculatedTax = Math.round(afterDisc * (item.taxPercent / 100) * 100) / 100;
                        
                        return {
                            ...item,
                            discountPercent: Math.round((disc / lineSubtotal) * 100 * 100) / 100,
                            discountAmount: disc,
                            taxAmount: recalculatedTax,
                            lineTotal: Math.round((afterDisc + recalculatedTax) * 100) / 100
                        };
                    });
                } else if (couponDiscount > 0) {
                    // Coupon discount
                    globalDiscAmt = couponDiscount;
                    appliedDiscountType = 'coupon';
                } else if (manualDiscount > 0) {
                    // Manual discount
                    globalDiscAmt = manualDiscount;
                    appliedDiscountType = 'manual';
                }

                // Recalculate totalTax after alliance discount distribution (if applied)
                const finalTotalTax = itemsData.reduce((acc, i) => acc + i.taxAmount, 0);
                
                // Recalculate total with the chosen discount
                const totalDiscount = finalLineItemDiscount + globalDiscAmt;
                const fbrPosFee = 1; // FBR POS Fee
                const grandTotal = Math.max(0, Math.round((subtotal - totalDiscount + finalTotalTax + fbrPosFee) * 100) / 100);
                const changeAmount = Math.max(0, totalPaid - grandTotal);

                // Debug logging
                console.log('=== GRAND TOTAL CALCULATION ===');
                console.log('Subtotal (WOST):', subtotal);
                console.log('Total Discount:', totalDiscount);
                console.log('Total Tax (Final):', finalTotalTax);
                console.log('FBR POS Fee:', fbrPosFee);
                console.log('Grand Total:', grandTotal);
                console.log('Formula: subtotal - totalDiscount + finalTotalTax + fbrPosFee =', subtotal, '-', totalDiscount, '+', finalTotalTax, '+', fbrPosFee, '=', grandTotal);
                console.log('===============================');

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
                        taxAmount: finalTotalTax,
                        grandTotal,
                        status: 'completed',
                        paymentStatus,
                        globalDiscountPercent: dto.globalDiscountPercent,
                        globalDiscountAmount: globalDiscAmt || undefined,
                        promoId: dto.promoId,
                        couponId: dto.couponId,
                        allianceId: dto.allianceId,
                        merchantId: dto.merchantId || undefined,
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
                        merchant: { select: { id: true, bankName: true, description: true, commissionRate: true, bankGlCode: true } },
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
                let creditVouchers: { code: string; faceValue: number; expiresAt: Date | null }[] = [];
                if (voucherRedemptions?.length) {
                    creditVouchers = await this.voucherService.redeemVouchers(
                        voucherRedemptions.map(r => ({ voucherId: r.voucherId, amountUsed: r.amount })),
                        order.id,
                        locationId || '',
                        tx,
                        ctx,
                    );
                }

                return {
                    status: true,
                    data: {
                        ...order,
                        tenders,
                        changeAmount,
                        creditVouchers: creditVouchers.length > 0 ? creditVouchers : undefined,
                    },
                    message: creditVouchers.length > 0
                        ? `Order ${orderNumber} created successfully. Credit voucher(s) issued: ${creditVouchers.map(v => v.code).join(', ')}`
                        : `Order ${orderNumber} created successfully`,
                };
            });

            // ── FBR Sync (outside transaction — never rolls back local DB) ──
            await this.syncWithFbr(result.data, itemsData);

            runInBackground(
                'Create POS Order',
                this.activityLogs.log({
                    userId: ctx?.userId || cashierUserId,
                    action: 'create',
                    module: 'pos-sales',
                    entity: 'SalesOrder',
                    entityId: result.data.id,
                    description: `Created POS order ${result.data.orderNumber}`,
                    newValues: JSON.stringify(dto),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return result;
        } catch (error: any) {
            runInBackground(
                'Create POS Order (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId || cashierUserId,
                    action: 'create',
                    module: 'pos-sales',
                    entity: 'SalesOrder',
                    description: `Failed to create POS order`,
                    errorMessage: error?.message,
                    newValues: JSON.stringify(dto),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
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

        if (posId) {
            // If posId is a UUID, search by terminalId, otherwise by posId (code)
            if (posId.length > 20) {
                where.terminalId = posId;
            } else {
                where.posId = posId;
            }
        }
        if (locationId) where.locationId = locationId;
        if (status) {
            where.status = status;
        } else {
            // Always exclude hold_expired orders from history listing
            where.status = { not: 'hold_expired' };
        }

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
                    items: { include: { item: { select: { description: true, sku: true, barCode: true ,size: true } } } },
                    promo: { select: { name: true, code: true } },
                    coupon: { select: { code: true, description: true } },
                    alliance: { select: { partnerName: true, code: true, discountPercent: true, maxDiscount: true } },
                    merchant: { select: { id: true, bankName: true, description: true, commissionRate: true, bankGlCode: true } },
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

        // ── Fetch claims for ALL orders ──
        const claims = await this.prisma.posClaim.findMany({
            where: {
                salesOrderId: { in: orderIds },
            },
            select: {
                id: true,
                claimNumber: true,
                salesOrderId: true,
                claimType: true,
                status: true,
                claimedAmount: true,
                approvedAmount: true,
                submittedAt: true,
                reviewedAt: true,
                items: {
                    select: {
                        itemId: true,
                        claimedQty: true,
                        approvedQty: true,
                        itemStatus: true,
                    },
                },
            },
            orderBy: { submittedAt: 'desc' },
        });

        console.log('🔍 [POS Sales] Fetching claims for orders:', {
            totalOrders: orderIds.length,
            orderIds: orderIds.slice(0, 3), // First 3 for brevity
            claimsFound: claims.length,
            claimNumbers: claims.map(c => c.claimNumber),
        });

        // Build map: orderId -> claims[]
        const claimsMap = new Map<string, any[]>();
        for (const claim of claims) {
            if (!claimsMap.has(claim.salesOrderId)) {
                claimsMap.set(claim.salesOrderId, []);
            }
            claimsMap.get(claim.salesOrderId)!.push(claim);
        }

        // Reconstruct tenders and attach returnedQty and claimedQty to each order item
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
            
            // Get claims for this order
            const orderClaims = claimsMap.get(order.id) || [];
            
            // Build map of itemId -> total claimed/approved quantities across all claims
            const claimedQtyMap = new Map<string, { claimed: number; approved: number }>();
            for (const claim of orderClaims) {
                for (const claimItem of claim.items) {
                    const current = claimedQtyMap.get(claimItem.itemId) || { claimed: 0, approved: 0 };
                    claimedQtyMap.set(claimItem.itemId, {
                        claimed: current.claimed + Number(claimItem.claimedQty),
                        approved: current.approved + Number(claimItem.approvedQty),
                    });
                }
            }
            
            const enrichedItems = order.items.map(oi => ({
                ...oi,
                returnedQty: itemMap?.get(oi.itemId) || 0,
                claimedQty: claimedQtyMap.get(oi.itemId)?.claimed || 0,
                approvedClaimQty: claimedQtyMap.get(oi.itemId)?.approved || 0,
            }));

            return { 
                ...order, 
                tenders, 
                items: enrichedItems,
                claims: orderClaims,
            };
        });

        console.log('✅ [POS Sales] Orders enriched with claims:', {
            totalOrders: orders.length,
            ordersWithClaims: orders.filter(o => o.claims && o.claims.length > 0).length,
            sampleOrder: orders[0] ? {
                orderNumber: orders[0].orderNumber,
                claimsCount: orders[0].claims?.length || 0,
                claimNumbers: orders[0].claims?.map(c => c.claimNumber) || []
            } : null
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
                merchant: { select: { id: true, bankName: true, description: true, commissionRate: true, bankGlCode: true } },
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
    async returnItems(id: string, items: { orderItemId: string; itemId: string; quantity: number }[], reason?: string, returnLocationId?: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const result = await this.prisma.$transaction(async (tx) => {
                const order = await tx.salesOrder.findUnique({
                    where: { id },
                    include: { items: true, coupon: true },
                });
                if (!order) throw new Error('Order not found');
                if (order.status === 'voided') throw new Error('Order is already voided');

                const warehouse = await tx.warehouse.findFirst({ where: { isActive: true, isDeleted: false } });
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

                    // Current item price — POS uses unitPrice from item setup
                    const currentItem = await tx.item.findUnique({
                        where: { id: returnItem.itemId },
                        select: { unitPrice: true },
                    });
                    const baseCurrentPrice = currentItem
                        ? Number(currentItem.unitPrice)
                        : originalPaidPerUnit;

                    // Apply the same tax rate that was charged at sale time
                    const taxPercent = Number(orderItem.taxPercent) || 0;
                    const currentPriceWithTax = baseCurrentPrice * (1 + taxPercent / 100);

                    // Rule: ALWAYS refund the original paid price (what customer actually paid)
                    // Customer gets full cash refund regardless of current stock price
                    // Refund voucher is generated for record keeping only
                    const refundPerUnit = originalPaidPerUnit;
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

                // ── Generate Exchange Voucher for refund amount ──
                let exchangeVoucher: any = null;
                if (totalRefundAmount > 0) {
                    const voucherResult = await this.voucherService.issueExchangeVoucher({
                        faceValue: Math.round(totalRefundAmount * 100) / 100,
                        sourceOrderId: id,
                        issuedByLocationId: effectiveLocationId || order.locationId || '',
                        issuedByUserId: ctx?.userId,
                        customerId: order.customerId || undefined,
                        expiresInDays: 30,
                    }, ctx);

                    if (voucherResult.status && voucherResult.data) {
                        exchangeVoucher = voucherResult.data;
                    }
                }

                return { 
                    status: true, 
                    data: updatedOrder, 
                    refundAmount: Math.round(totalRefundAmount * 100) / 100, 
                    itemRefundDetails, 
                    exchangeVoucher: exchangeVoucher ? {
                        code: exchangeVoucher.code,
                        faceValue: exchangeVoucher.faceValue,
                        expiresAt: exchangeVoucher.expiresAt,
                    } : null,
                    message: exchangeVoucher 
                        ? `Return processed (${newStatus}), inventory restored, and exchange voucher ${exchangeVoucher.code} issued for Rs.${Math.round(totalRefundAmount * 100) / 100}`
                        : `Return processed (${newStatus}) and inventory restored`
                };
            });

            runInBackground(
                'Return POS Order Items',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-sales',
                    entity: 'SalesOrder',
                    entityId: id,
                    description: `Processed return for POS order items. New status: ${result.data.status}`,
                    newValues: JSON.stringify({ items, reason }),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return result;
        } catch (error: any) {
            runInBackground(
                'Return POS Order Items (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-sales',
                    entity: 'SalesOrder',
                    entityId: id,
                    description: `Failed to process return for POS order items`,
                    errorMessage: error?.message,
                    newValues: JSON.stringify({ items, reason }),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
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

                    // Current price logic (use unitPrice from item setup)
                    const currentItem = oi.item;
                    const baseCurrentPrice = Number((currentItem as any).unitPrice || 0);
                    const currentPriceWithTax = baseCurrentPrice * (1 + taxPercent / 100);

                    // Rule: ALWAYS refund the original paid price (what customer actually paid)
                    // Customer gets full cash refund regardless of current stock price
                    const refundPerUnit = originalPaidPerUnit;
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
    async voidOrder(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const result = await this.prisma.$transaction(async (tx) => {
                // Get the order with items first
                const order = await tx.salesOrder.findUnique({
                    where: { id },
                    include: { items: true, coupon: true },
                });

                if (!order) {
                    throw new Error('Order not found');
                }

                if (order.status === 'voided') {
                    throw new Error('Order is already voided');
                }

                // Update order status to voided
                const voidedOrder = await tx.salesOrder.update({
                    where: { id },
                    data: { status: 'voided' },
                });

                // Resolve default warehouse
                const warehouse = await tx.warehouse.findFirst({
                    where: { isActive: true, isDeleted: false },
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

            runInBackground(
                'Void POS Order',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-sales',
                    entity: 'SalesOrder',
                    entityId: id,
                    description: `Voided POS order ${id}`,
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return result;
        } catch (error: any) {
            runInBackground(
                'Void POS Order (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-sales',
                    entity: 'SalesOrder',
                    entityId: id,
                    description: `Failed to void POS order`,
                    errorMessage: error?.message,
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
            return { status: false, message: error.message };
        }
    }
    // ─── Exchange items ───────────────────────────────────────────────
    async exchangeItems(
        id: string,
        returnedItems: { orderItemId: string; itemId: string; quantity: number }[],
        newItems: { itemId: string; quantity: number; unitPrice: number }[],
        reason?: string,
        ctx?: { userId?: string; ipAddress?: string; userAgent?: string }
    ) {
        try {
            const result = await this.prisma.$transaction(async (tx) => {
                const order = await tx.salesOrder.findUnique({ where: { id }, include: { items: true, coupon: true } });
                if (!order) throw new Error('Order not found');
                if (order.status === 'voided') throw new Error('Order is already voided');

                const warehouse = await tx.warehouse.findFirst({ where: { isActive: true, isDeleted: false } });
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

            runInBackground(
                'Exchange POS Order Items',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-sales',
                    entity: 'SalesOrder',
                    entityId: id,
                    description: `Processed exchange for POS order items. Difference: ${result.data.difference}`,
                    newValues: JSON.stringify({ returnedItems, newItems, reason }),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return result;
        } catch (error: any) {
            runInBackground(
                'Exchange POS Order Items (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-sales',
                    entity: 'SalesOrder',
                    entityId: id,
                    description: `Failed to process exchange for POS order items`,
                    errorMessage: error?.message,
                    newValues: JSON.stringify({ returnedItems, newItems, reason }),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
            return { status: false, message: error.message };
        }
    }

    // ─── Refund only (no stock movement) ─────────────────────────────
    async refundOnly(id: string, refundAmount: number, reason?: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const order = await this.prisma.salesOrder.findUnique({ 
                where: { id },
                include: {
                    items: {
                        include: {
                            item: true
                        }
                    }
                }
            });
            if (!order) throw new Error('Order not found');
            if (order.status === 'voided') throw new Error('Order is already voided');
            if (refundAmount <= 0) throw new Error('Refund amount must be greater than 0');
            if (refundAmount > Number(order.grandTotal)) throw new Error('Refund amount exceeds order total');

            // Use transaction to ensure inventory is restored atomically
            const result = await this.prisma.$transaction(async (tx) => {
                // Find active warehouse
                const warehouse = await tx.warehouse.findFirst({ where: { isActive: true, isDeleted: false } });
                if (!warehouse) throw new Error('No active warehouse found');

                const effectiveLocationId = order.locationId;

                // ── Restore Inventory for ALL items ──
                for (const orderItem of order.items) {
                    if (!orderItem.itemId) continue;

                    // Create stock ledger entry for refund
                    await this.stockLedgerService.createEntry({
                        itemId: orderItem.itemId,
                        warehouseId: warehouse.id,
                        locationId: effectiveLocationId,
                        qty: orderItem.quantity,
                        movementType: MovementType.INBOUND,
                        referenceType: 'POS_REFUND',
                        referenceId: id,
                    }, tx);

                    // Update or create inventory item
                    const existing = await tx.inventoryItem.findFirst({
                        where: { 
                            itemId: orderItem.itemId, 
                            locationId: effectiveLocationId, 
                            status: 'AVAILABLE' 
                        },
                    });
                    
                    if (existing) {
                        await tx.inventoryItem.update({
                            where: { id: existing.id },
                            data: { quantity: { increment: orderItem.quantity } },
                        });
                    } else {
                        await tx.inventoryItem.create({
                            data: {
                                itemId: orderItem.itemId,
                                locationId: effectiveLocationId,
                                warehouseId: warehouse.id,
                                quantity: orderItem.quantity,
                                status: 'AVAILABLE',
                            },
                        });
                    }
                }

                // ── Generate REFUND Voucher (record-only, cash refunded to customer) ──
                let refundVoucher: any = null;
                if (refundAmount > 0) {
                    const voucherResult = await this.voucherService.issueRefundVoucher({
                        faceValue: Math.round(refundAmount * 100) / 100,
                        sourceOrderId: id,
                        issuedByLocationId: order.locationId || '',
                        issuedByUserId: ctx?.userId,
                        customerId: order.customerId || undefined,
                    }, ctx);

                    if (voucherResult.status && voucherResult.data) {
                        refundVoucher = voucherResult.data;
                    }
                }

                const updatedOrder = await tx.salesOrder.update({
                    where: { id },
                    data: { 
                        status: 'refunded', 
                        notes: refundVoucher 
                            ? `Cash refunded Rs.${refundAmount} - Refund voucher ${refundVoucher.code} (Record only) - Inventory restored${reason ? `: ${reason}` : ''}`
                            : (reason ? `Cash refund Rs.${refundAmount} - Inventory restored: ${reason}` : `Cash refund Rs.${refundAmount} - Inventory restored`)
                    },
                });

                return { updatedOrder, refundVoucher };
            });

            runInBackground(
                'Refund POS Order',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-sales',
                    entity: 'SalesOrder',
                    entityId: id,
                    description: result.refundVoucher 
                        ? `Cash refunded Rs.${refundAmount} - Refund voucher ${result.refundVoucher.code} issued for record - Inventory restored for POS order ${id}`
                        : `Processed cash refund of Rs.${refundAmount} and restored inventory for POS order ${id}`,
                    newValues: JSON.stringify({ refundAmount, reason, voucherCode: result.refundVoucher?.code }),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return { 
                status: true, 
                data: result.updatedOrder, 
                refundVoucher: result.refundVoucher ? {
                    code: result.refundVoucher.code,
                    faceValue: result.refundVoucher.faceValue,
                    voucherType: 'REFUND',
                } : null,
                message: result.refundVoucher 
                    ? `Cash refunded Rs.${refundAmount} - Refund voucher ${result.refundVoucher.code} issued for record - Inventory restored`
                    : `Cash refund of Rs.${refundAmount} processed and inventory restored`
            };
        } catch (error: any) {
            runInBackground(
                'Refund POS Order (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-sales',
                    entity: 'SalesOrder',
                    entityId: id,
                    description: `Failed to process refund for POS order`,
                    errorMessage: error?.message,
                    newValues: JSON.stringify({ refundAmount, reason }),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
            return { status: false, message: error.message };
        }
    }

    // ─── Hold order (max 1 hour, auto-cleared at midnight) ───────────
    async holdOrder(dto: CreateSalesOrderDto, cashierUserId?: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
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

            const result = await this.prisma.$transaction(async (tx) => {
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
                const warehouse = await tx.warehouse.findFirst({ where: { isActive: true, isDeleted: false } });
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

                return order;
            });

            runInBackground(
                'Hold POS Order',
                this.activityLogs.log({
                    userId: ctx?.userId || cashierUserId,
                    action: 'create',
                    module: 'pos-sales',
                    entity: 'SalesOrder',
                    entityId: result.id,
                    description: `Placed POS order ${result.orderNumber} on hold until ${holdExpiresAt.toLocaleTimeString()}`,
                    newValues: JSON.stringify(dto),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return {
                status: true,
                data: result,
                message: `Order ${orderNumber} placed on hold until ${holdExpiresAt.toLocaleTimeString()}`,
            };
        } catch (error: any) {
            runInBackground(
                'Hold POS Order (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId || cashierUserId,
                    action: 'create',
                    module: 'pos-sales',
                    entity: 'SalesOrder',
                    description: `Failed to place POS order on hold`,
                    errorMessage: error?.message,
                    newValues: JSON.stringify(dto),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
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
    async cancelHoldOrder(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
        try {
            const result = await this.prisma.$transaction(async (tx) => {
                const order = await tx.salesOrder.findUnique({
                    where: { id },
                    include: { items: true },
                });

                if (!order) throw new Error('Hold order not found');
                if (order.status !== 'hold') throw new Error('Order is not on hold');

                // Restore stock for each item
                const warehouse = await tx.warehouse.findFirst({ where: { isActive: true, isDeleted: false } });
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

            runInBackground(
                'Cancel POS Hold Order',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-sales',
                    entity: 'SalesOrder',
                    entityId: id,
                    description: `Cancelled POS hold order ${id}`,
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return result;
        } catch (error: any) {
            runInBackground(
                'Cancel POS Hold Order (Failure)',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-sales',
                    entity: 'SalesOrder',
                    entityId: id,
                    description: `Failed to cancel POS hold order`,
                    errorMessage: error?.message,
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'failure',
                }),
            );
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

        const warehouse = await this.prisma.warehouse.findFirst({ where: { isActive: true, isDeleted: false } });

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

        // Primary: sum ledger entries scoped to this outlet location
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

        // Fallback: for items with no ledger entry at this outlet, read inventoryItem directly.
        // This covers transfers completed before the outlet ledger entry was written.
        const missingIds = itemIds.filter((id) => !stockMap.has(id));
        if (missingIds.length > 0) {
            const inventoryItems = await this.prisma.inventoryItem.findMany({
                where: {
                    itemId: { in: missingIds },
                    locationId: locationId,
                    status: 'AVAILABLE',
                },
                select: { itemId: true, quantity: true },
            });
            for (const inv of inventoryItems) {
                const existing = stockMap.get(inv.itemId) || 0;
                stockMap.set(inv.itemId, existing + Number(inv.quantity));
            }
        }

        const now = new Date();

        return items.map((item) => {
            const stockQty = stockMap.get(item.id) || 0;
            // Use unitPrice from item setup, not unitCost
            const latestPrice = Number(item.unitPrice || 0);

            // ── Resolve effective discount respecting date validity ──────────
            // A discount is active if:
            //   - discountStartDate is null OR discountStartDate <= now
            //   - discountEndDate is null OR discountEndDate >= now
            const startDate = item.discountStartDate ? new Date(item.discountStartDate) : null;
            const endDate = item.discountEndDate ? new Date(item.discountEndDate) : null;
            const discountActive =
                (!startDate || startDate <= now) &&
                (!endDate || endDate >= now);

            const discountRate = discountActive ? Number(item.discountRate || 0) : 0;
            const discountAmount = discountActive ? Number(item.discountAmount || 0) : 0;

            // Effective discount percent for the cart:
            // If discountRate (%) is set, use it directly.
            // If only discountAmount (fixed PKR) is set, convert to percent of unit price.
            let effectiveDiscountPercent = 0;
            if (discountRate > 0) {
                effectiveDiscountPercent = discountRate;
            } else if (discountAmount > 0 && latestPrice > 0) {
                effectiveDiscountPercent = Math.min(100, (discountAmount / latestPrice) * 100);
            }

            return {
                id: item.id,
                itemId: item.itemId,
                sku: item.sku,
                barCode: item.barCode,
                description: item.description,
                unitPrice: latestPrice,
                taxRate1: Number(item.taxRate1 || 0),
                taxRate2: Number(item.taxRate2 || 0),
                // Raw discount fields
                discountRate,
                discountAmount,
                discountStartDate: item.discountStartDate ?? null,
                discountEndDate: item.discountEndDate ?? null,
                // Computed effective discount percent (ready for cart)
                effectiveDiscountPercent: Math.round(effectiveDiscountPercent * 100) / 100,
                brand: item.brand?.name || null,
                size: item.size?.name || null,
                color: item.color?.name || null,
                stockQty,
                inStock: stockQty > 0,
            };
        });
    }

    // ─── Sales Report ─────────────────────────────────────────────────
    async getSalesReport(
        user: any,
        filters: {
            startDate?: string;
            endDate?: string;
            locationId?: string;
            cashierUserId?: string;
            paymentMethod?: string;
            status?: string;
            groupBy?: 'day' | 'week' | 'month' | 'cashier' | 'payment_method' | 'item';
            page?: number;
            limit?: number;
            search?: string;
        },
    ) {
        const page = filters.page || 1;
        const limit = filters.limit || 50;
        const skip = (page - 1) * limit;

        // ── Permission check ──────────────────────────────────────────
        const role = await this.prismaMaster.role.findUnique({
            where: { id: user.roleId },
            include: { permissions: { include: { permission: true } } },
        });
        const userPerms = role?.permissions.map((p: any) => p.permission.name) || [];
        const canViewAll =
            userPerms.includes('*') ||
            userPerms.includes('pos.sales.history.view_all') ||
            ['super_admin', 'admin'].includes(role?.name?.toLowerCase() || '');

        // ── Build where clause ────────────────────────────────────────
        const where: any = {
            status: { in: ['completed', 'partially_returned', 'refunded', 'exchanged', 'voided'] },
        };

        if (!canViewAll) {
            where.cashierUserId = user.id;
        }

        if (filters.locationId) where.locationId = filters.locationId;
        if (filters.cashierUserId) where.cashierUserId = filters.cashierUserId;
        if (filters.paymentMethod) where.paymentMethod = filters.paymentMethod;
        if (filters.status) where.status = filters.status;
        if (filters.search) {
            where.orderNumber = { contains: filters.search, mode: 'insensitive' };
        }

        if (filters.startDate || filters.endDate) {
            where.createdAt = {};
            if (filters.startDate) where.createdAt.gte = new Date(filters.startDate);
            if (filters.endDate) {
                const end = new Date(filters.endDate);
                end.setHours(23, 59, 59, 999);
                where.createdAt.lte = end;
            }
        }

        // ── Aggregate summary ─────────────────────────────────────────
        const [summaryAgg, totalOrders] = await Promise.all([
            this.prisma.salesOrder.aggregate({
                where,
                _sum: {
                    grandTotal: true,
                    subtotal: true,
                    discountAmount: true,
                    taxAmount: true,
                    cashAmount: true,
                    cardAmount: true,
                    voucherAmount: true,
                },
                _count: { id: true },
                _avg: { grandTotal: true },
            }),
            this.prisma.salesOrder.count({ where }),
        ]);

        // ── Payment method breakdown ──────────────────────────────────
        const paymentBreakdown = await this.prisma.salesOrder.groupBy({
            by: ['paymentMethod'],
            where,
            _sum: { grandTotal: true },
            _count: { id: true },
        });

        // ── Status breakdown ──────────────────────────────────────────
        const statusBreakdown = await this.prisma.salesOrder.groupBy({
            by: ['status'],
            where,
            _sum: { grandTotal: true },
            _count: { id: true },
        });

        // ── Discount type breakdown ───────────────────────────────────
        const discountBreakdown = await this.prisma.salesOrder.aggregate({
            where: { ...where, discountAmount: { gt: 0 } },
            _sum: { discountAmount: true, globalDiscountAmount: true },
            _count: { id: true },
        });

        // ── Top selling items ─────────────────────────────────────────
        const topItemsRaw = await this.prisma.salesOrderItem.groupBy({
            by: ['itemId'],
            where: { salesOrder: where },
            _sum: { quantity: true, lineTotal: true, discountAmount: true },
            _count: { id: true },
            orderBy: { _sum: { lineTotal: 'desc' } },
            take: 10,
        });

        const topItemIds = topItemsRaw.map((i) => i.itemId);
        const topItemDetails = await this.prisma.item.findMany({
            where: { id: { in: topItemIds } },
            select: { id: true, description: true, sku: true, barCode: true },
        });
        const itemDetailMap = new Map(topItemDetails.map((i) => [i.id, i]));

        const topItems = topItemsRaw.map((row) => {
            const detail = itemDetailMap.get(row.itemId);
            return {
                itemId: row.itemId,
                description: detail?.description || 'Unknown',
                sku: detail?.sku || '-',
                barCode: detail?.barCode || '-',
                qtySold: Number(row._sum.quantity || 0),
                revenue: Number(row._sum.lineTotal || 0),
                discountGiven: Number(row._sum.discountAmount || 0),
                orderCount: row._count.id,
            };
        });

        // ── Daily / period trend ──────────────────────────────────────
        const trendOrders = await this.prisma.salesOrder.findMany({
            where,
            select: { createdAt: true, grandTotal: true, status: true },
            orderBy: { createdAt: 'asc' },
        });

        const groupBy = filters.groupBy || 'day';
        const trendMap = new Map<string, { label: string; sales: number; orders: number; returns: number }>();

        for (const o of trendOrders) {
            const d = new Date(o.createdAt);
            let key: string;
            let label: string;

            if (groupBy === 'month') {
                key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                label = d.toLocaleDateString('en-PK', { year: 'numeric', month: 'short' });
            } else if (groupBy === 'week') {
                // ISO week
                const startOfWeek = new Date(d);
                startOfWeek.setDate(d.getDate() - d.getDay());
                key = startOfWeek.toISOString().split('T')[0];
                label = `Wk ${startOfWeek.toLocaleDateString('en-PK', { month: 'short', day: 'numeric' })}`;
            } else {
                key = d.toISOString().split('T')[0];
                label = d.toLocaleDateString('en-PK', { month: 'short', day: 'numeric' });
            }

            if (!trendMap.has(key)) {
                trendMap.set(key, { label, sales: 0, orders: 0, returns: 0 });
            }
            const bucket = trendMap.get(key)!;
            const isReturn = ['refunded', 'partially_returned'].includes(o.status);
            bucket.sales += isReturn ? 0 : Number(o.grandTotal);
            bucket.orders += isReturn ? 0 : 1;
            bucket.returns += isReturn ? 1 : 0;
        }

        const trend = Array.from(trendMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, val]) => ({ key, ...val }));

        // ── Cashier performance ───────────────────────────────────────
        const cashierPerf = await this.prisma.salesOrder.groupBy({
            by: ['cashierUserId'],
            where,
            _sum: { grandTotal: true, discountAmount: true },
            _count: { id: true },
            _avg: { grandTotal: true },
            orderBy: { _sum: { grandTotal: 'desc' } },
            take: 10,
        });

        const cashierUserIds = cashierPerf.map((c) => c.cashierUserId).filter(Boolean) as string[];
        const cashierUsers = cashierUserIds.length
            ? await this.prismaMaster.user.findMany({
                where: { id: { in: cashierUserIds } },
                select: { id: true, firstName: true, lastName: true, email: true },
            })
            : [];
        const cashierUserMap = new Map(cashierUsers.map((u) => [u.id, u]));

        const cashierStats = cashierPerf.map((row) => {
            const u = cashierUserMap.get(row.cashierUserId || '');
            return {
                cashierUserId: row.cashierUserId,
                name: u ? `${u.firstName} ${u.lastName}` : 'Unknown',
                email: u?.email || '-',
                totalSales: Number(row._sum.grandTotal || 0),
                totalDiscount: Number(row._sum.discountAmount || 0),
                orderCount: row._count.id,
                avgOrderValue: Number(row._avg.grandTotal || 0),
            };
        });

        // ── Paginated order list ──────────────────────────────────────
        const rawOrders = await this.prisma.salesOrder.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: {
                items: {
                    include: {
                        item: { select: { description: true, sku: true, barCode: true } },
                    },
                },
                promo: { select: { name: true, code: true } },
                coupon: { select: { code: true } },
                alliance: { select: { partnerName: true, code: true } },
            },
        });

        // Enrich orders with cashier names
        const orderCashierIds = [...new Set(rawOrders.map((o) => o.cashierUserId).filter(Boolean))] as string[];
        const orderCashierUsers = orderCashierIds.length
            ? await this.prismaMaster.user.findMany({
                where: { id: { in: orderCashierIds } },
                select: { id: true, firstName: true, lastName: true },
            })
            : [];
        const orderCashierMap = new Map(orderCashierUsers.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));

        const orders = rawOrders.map((o) => ({
            ...o,
            cashierName: orderCashierMap.get(o.cashierUserId || '') || '-',
        }));

        return {
            status: true,
            data: {
                summary: {
                    totalOrders,
                    totalRevenue: Number(summaryAgg._sum.grandTotal || 0),
                    totalSubtotal: Number(summaryAgg._sum.subtotal || 0),
                    totalDiscount: Number(summaryAgg._sum.discountAmount || 0),
                    totalTax: Number(summaryAgg._sum.taxAmount || 0),
                    totalCash: Number(summaryAgg._sum.cashAmount || 0),
                    totalCard: Number(summaryAgg._sum.cardAmount || 0),
                    totalVoucher: Number(summaryAgg._sum.voucherAmount || 0),
                    avgOrderValue: Number(summaryAgg._avg.grandTotal || 0),
                    discountedOrders: discountBreakdown._count.id,
                    totalDiscountGiven: Number(discountBreakdown._sum.discountAmount || 0),
                },
                paymentBreakdown: paymentBreakdown.map((p) => ({
                    method: p.paymentMethod || 'unknown',
                    total: Number(p._sum.grandTotal || 0),
                    count: p._count.id,
                })),
                statusBreakdown: statusBreakdown.map((s) => ({
                    status: s.status,
                    total: Number(s._sum.grandTotal || 0),
                    count: s._count.id,
                })),
                trend,
                topItems,
                cashierStats,
                orders,
                meta: {
                    total: totalOrders,
                    page,
                    limit,
                    totalPages: Math.ceil(totalOrders / limit),
                },
            },
        };
    }

    // ─── Update tender on an existing order ──────────────────────────
    async updateTender(
        id: string,
        tenders: { method: string; amount: number; cardLast4?: string; slipNo?: string }[],
        ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
    ) {
        try {
            const order = await this.prisma.salesOrder.findUnique({ where: { id } });
            if (!order) return { status: false, message: 'Order not found' };
            if (order.status === 'voided') return { status: false, message: 'Cannot update tender on a voided order' };

            const totalPaid = tenders.reduce((acc, t) => acc + Number(t.amount), 0);
            const tenderMethods = [...new Set(tenders.map((t) => t.method))];
            const paymentMethod = tenderMethods.length === 1 ? tenderMethods[0] : 'split';
            const cashAmount = tenders.filter((t) => t.method === 'cash').reduce((a, t) => a + Number(t.amount), 0);
            const cardAmount = tenders.filter((t) => t.method !== 'cash').reduce((a, t) => a + Number(t.amount), 0);
            const grandTotal = Number(order.grandTotal);

            const totalPaidRounded = Math.round(totalPaid * 100) / 100;
            const grandTotalRounded = Math.round(grandTotal * 100) / 100;
            const changeAmount = Math.max(0, totalPaidRounded - grandTotalRounded);

            let paymentStatus: string;
            if (totalPaidRounded >= grandTotalRounded) {
                paymentStatus = 'paid';
            } else if (totalPaidRounded > 0) {
                paymentStatus = 'partial';
            } else {
                paymentStatus = 'unpaid';
            }

            const updated = await this.prisma.salesOrder.update({
                where: { id },
                data: {
                    paymentMethod,
                    tenderType: paymentMethod,
                    cashAmount: cashAmount || undefined,
                    cardAmount: cardAmount || undefined,
                    changeAmount: changeAmount || undefined,
                    paymentStatus,
                },
            });

            runInBackground(
                'Update Tender',
                this.activityLogs.log({
                    userId: ctx?.userId,
                    action: 'update',
                    module: 'pos-sales',
                    entity: 'SalesOrder',
                    entityId: id,
                    description: `Updated tender for order ${order.orderNumber}`,
                    newValues: JSON.stringify({ tenders }),
                    ipAddress: ctx?.ipAddress,
                    userAgent: ctx?.userAgent,
                    status: 'success',
                }),
            );

            return { status: true, data: updated, message: 'Tender updated successfully' };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    // ─── List available cashiers for a location ─────────────────────
    async listCashiers(locationId: string) {
        // 1. Find all employees at this location
        const employees = await this.prisma.employee.findMany({
            where: { locationId },
            select: { id: true, employeeName: true, employeeId: true, userId: true, status: true }
        });

        if (employees.length === 0) return { status: true, data: [] };

        const employeeIds = employees.map(e => e.id);
        const userIdsFromEmployees = employees.map(e => e.userId).filter(Boolean) as string[];

        // 2. Find users linked to these employees (by both directions)
        const users = await this.prismaMaster.user.findMany({
            where: {
                OR: [
                    { id: { in: userIdsFromEmployees } },
                    { employeeId: { in: employeeIds } }
                ],
                status: 'active'
            },
            select: { id: true, firstName: true, lastName: true, email: true, employeeId: true }
        });

        // 3. Merge data
        // We want to return a list where each entry has a valid userId for the SalesOrder
        const cashierList = users.map(user => {
            // Find the corresponding employee record
            const emp = employees.find(e => e.id === user.employeeId || e.userId === user.id);
            return {
                userId: user.id,
                employeeId: emp?.id || user.employeeId,
                name: emp ? emp.employeeName : `${user.firstName} ${user.lastName}`,
                email: user.email,
                empCode: emp ? emp.employeeId : null
            };
        });

        // Deduplicate by userId
        const uniqueCashiers = Array.from(new Map(cashierList.map(c => [c.userId, c])).values());

        return { status: true, data: uniqueCashiers };
    }
}
