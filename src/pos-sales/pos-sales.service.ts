import {
  Injectable,
  OnModuleInit,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { StockLedgerService } from '../warehouse/stock-ledger/stock-ledger.service';
import { MovementType, Prisma } from '@prisma/client';
import { FbrService } from './fbr.service';
import { VoucherService } from '../pos-config/voucher.service';

import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { runInBackground } from '../common/utils/run-in-background.util';
import { NotificationsService } from '../notifications/notifications.service';
import { StockMovementService } from '../warehouse/stock-movement.service';

@Injectable()
export class PosSalesService implements OnModuleInit {
  private readonly logger = new Logger(PosSalesService.name);

  constructor(
    private prisma: PrismaService,
    private prismaMaster: PrismaMasterService,
    private stockLedgerService: StockLedgerService,
    private fbrService: FbrService,
    private activityLogs: ActivityLogsService,
    private voucherService: VoucherService,
    private notificationsService: NotificationsService,
        private stockMovementService: StockMovementService,
  ) {}

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

  // ─── Generate sequential numbers per location and Pakistan fiscal year ───
  private async generateSequentialNumber(
    prefix: string,
    fieldName: 'orderNumber' | 'returnNumber' | 'refundNumber',
    locationId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const prismaClient = tx || this.prisma;

    // Find the location name and configured shortCode
    const location = await prismaClient.location.findUnique({
      where: { id: locationId },
      select: { name: true, shortCode: true },
    });

    if (!location) {
      throw new Error(`Location not found for ID: ${locationId}`);
    }

    // Determine shortCode: use custom configured shortCode or generate dynamically
    let shortCode = location.shortCode?.trim();
    if (!shortCode) {
      shortCode = location.name
        .split(/[\s\-_]+/)
        .map((word) => word.replace(/[^a-zA-Z0-9]/g, ''))
        .filter((word) => word.length > 0)
        .map((word) => word[0].toUpperCase())
        .join('');
    }
    if (!shortCode) {
      shortCode = 'LOC';
    }

    // Fiscal Year Start (Pakistan: July 1st)
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed, July is 6
    const fiscalYearStartYear = month >= 6 ? year : year - 1;
    const fiscalYearStartDate = new Date(
      Date.UTC(fiscalYearStartYear, 6, 1, 0, 0, 0, 0),
    );

    // Find the latest order/return/refund for this location/fiscal year, ordering by the field itself descending to get the highest suffix directly!
    const lastOrder = await prismaClient.salesOrder.findFirst({
      where: {
        locationId,
        createdAt: { gte: fiscalYearStartDate },
        [fieldName]: { startsWith: `${prefix}-${shortCode}-` },
      },
      orderBy: { [fieldName]: 'desc' },
      select: { [fieldName]: true },
    });

    let seq = 1;
    const lastVal = lastOrder
      ? ((lastOrder as any)[fieldName] as string | null)
      : null;
    if (lastVal) {
      const parts = lastVal.split('-');
      const lastPart = parts[parts.length - 1];
      if (/^\d+$/.test(lastPart)) {
        seq = parseInt(lastPart, 10) + 1;
      }
    }

    let nextNumber = `${prefix}-${shortCode}-${String(seq).padStart(5, '0')}`;
    let exists = await prismaClient.salesOrder.findUnique({
      where: { [fieldName]: nextNumber } as any,
      select: { id: true },
    });

    while (exists) {
      seq++;
      nextNumber = `${prefix}-${shortCode}-${String(seq).padStart(5, '0')}`;
      exists = await prismaClient.salesOrder.findUnique({
        where: { [fieldName]: nextNumber } as any,
        select: { id: true },
      });
    }

    return nextNumber;
  }

  private async generateOrderNumber(
    locationId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    return this.generateSequentialNumber('SI', 'orderNumber', locationId, tx);
  }

  private async generateReturnNumber(
    locationId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    return this.generateSequentialNumber('SR', 'returnNumber', locationId, tx);
  }

  private async generateRefundNumber(
    locationId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    return this.generateSequentialNumber('RF', 'refundNumber', locationId, tx);
  }

  // ─── Lookup items by barcode / SKU (for POS scanner) ──────────────
  async lookupItem(query: string, locationId: string) {
    const searchTerm = query.trim();
    if (!searchTerm)
      return { status: false, message: 'Search query is required' };

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
      },
    });

    if (!item)
      return { status: false, message: 'Item not found for this barcode/SKU' };

    const enriched = await this.enrichForPos([item], locationId);
    return { status: true, data: enriched[0] };
  }

  private async resolveWarehouseId(
    tx: any,
    locationId: string | null | undefined,
    itemId?: string,
  ): Promise<string> {
    if (locationId) {
      const loc = await tx.location.findUnique({
        where: { id: locationId },
        select: { warehouseId: true },
      });
      if (loc?.warehouseId) {
        return loc.warehouseId;
      }

      if (itemId) {
        const stock = await tx.inventoryItem.findFirst({
          where: { locationId, itemId, status: 'AVAILABLE' },
          select: { warehouseId: true },
        });
        if (stock?.warehouseId) {
          return stock.warehouseId;
        }
      }

      const anyStock = await tx.inventoryItem.findFirst({
        where: { locationId, status: 'AVAILABLE' },
        select: { warehouseId: true },
      });
      if (anyStock?.warehouseId) {
        return anyStock.warehouseId;
      }
    }

    const activeWarehouse = await tx.warehouse.findFirst({
      where: { isActive: true, isDeleted: false },
      select: { id: true },
    });
    if (!activeWarehouse) {
      throw new Error('No active warehouse found');
    }
    return activeWarehouse.id;
  }

  // ─── Create sales order ───────────────────────────────────────────
  async createOrder(
    dto: CreateSalesOrderDto,
    cashierUserId?: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
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
        const locationId = dto.locationId;
        if (!locationId) {
          throw new Error('Location ID is required to create a sales order.');
        }
        const orderNumber = await this.generateOrderNumber(locationId, tx);
        const warehouseId = await this.resolveWarehouseId(
          tx,
          locationId,
          dto.items?.[0]?.itemId,
        );

        // If resuming from hold, reverse the stock deduction and delete old items first
        const isResumedHold = !!dto.holdOrderId;
        if (isResumedHold) {
          const oldOrder = await tx.salesOrder.findUnique({
            where: { id: dto.holdOrderId },
            include: { items: true },
          });
          if (!oldOrder) {
            throw new Error('Resumed hold order not found');
          }

          // Reverse stock deduction done at hold time

          if (warehouseId) {
            for (const item of oldOrder.items) {
              await this.stockLedgerService.createEntry(
                {
                  itemId: item.itemId,
                  warehouseId: warehouseId,
                  locationId: oldOrder.locationId || locationId,
                  qty: item.quantity, // Positive to reverse OUTBOUND
                  movementType: MovementType.INBOUND,
                  referenceType: 'POS_HOLD_CANCELLED',
                  referenceId: oldOrder.id,
                },
                tx,
              );

              const existing = await tx.inventoryItem.findFirst({
                where: {
                  itemId: item.itemId,
                  locationId: oldOrder.locationId || locationId,
                  status: 'AVAILABLE',
                },
              });
              if (existing) {
                await tx.inventoryItem.update({
                  where: { id: existing.id },
                  data: { quantity: { increment: item.quantity } },
                });
              } else {
                await tx.inventoryItem.create({
                  data: {
                    itemId: item.itemId,
                    locationId: oldOrder.locationId || locationId,
                    warehouseId: warehouseId,
                    quantity: item.quantity,
                    status: 'AVAILABLE',
                  },
                });
              }
            }
          }

          // Delete old items associated with the hold order
          await tx.salesOrderItem.deleteMany({
            where: { salesOrderId: dto.holdOrderId },
          });
        }

        // ── Check if this is a credit sale ─────────────────────
        const isCreditSale = dto.isCreditSale || false;
        const creditAmount = dto.creditAmount || 0;

        // ── Resolve tenders ─────────────────────────────────────
        const tenders =
          dto.tenders && dto.tenders.length > 0
            ? dto.tenders
            : dto.paymentMethod
              ? [
                  {
                    method: dto.paymentMethod,
                    amount: dto.cashAmount || dto.cardAmount || 0,
                  },
                ]
              : [{ method: 'cash', amount: 0 }];

        const totalPaid = tenders.reduce((acc, t) => acc + Number(t.amount), 0);
        const tenderMethods = [...new Set(tenders.map((t) => t.method))];
        const paymentMethod =
          tenderMethods.length === 1 ? tenderMethods[0] : 'split';
        const cashAmount = tenders
          .filter((t) => t.method === 'cash')
          .reduce((a, t) => a + Number(t.amount), 0);
        const voucherAmount = tenders
          .filter((t) => t.method === 'voucher')
          .reduce((a, t) => a + Number(t.amount), 0);

        const cardAmount = tenders
          .filter(
            (t) =>
              t.method !== 'cash' &&
              t.method !== 'voucher' &&
              t.method !== 'credit_account',
          )
          .reduce((a, t) => a + Number(t.amount), 0);

        // General card/bank payment slip format validation (must be 6 digits numeric if present)
        for (const t of tenders) {
          if (t.method === 'card' || t.method === 'bank_transfer') {
            if (t.slipNo) {
              const trimmedSlip = t.slipNo.trim();
              if (trimmedSlip.length !== 6 || !/^\d+$/.test(trimmedSlip)) {
                throw new Error(
                  'Auth ID / Approval Code must be exactly a 6-digit numeric code.',
                );
              }
            }
          }
        }

        if (dto.allianceId) {
          const alliance = await tx.allianceDiscount.findFirst({
            where: { id: dto.allianceId, isDeleted: false },
          });
          if (!alliance) {
            throw new Error(
              'Selected Alliance discount is invalid or expired.',
            );
          }

          const hasCashTender = tenders.some((t) => t.method === 'cash');
          if (hasCashTender) {
            throw new Error(
              'Alliance discount cannot be applied when cash payment is selected.',
            );
          }
          const hasCardTender = tenders.some(
            (t) => t.method === 'card' || t.method === 'bank_transfer',
          );
          const hasVoucherTender = tenders.some((t) => t.method === 'voucher');

          if (!hasCardTender && !hasVoucherTender) {
            throw new Error(
              'A card, bank transfer, or voucher payment is required when Alliance is selected.',
            );
          }

          if (alliance.binNumbers && alliance.binNumbers.length > 0) {
            if (!dto.allianceMeta || !dto.allianceMeta.binNumber) {
              throw new Error(
                'BIN number selection is mandatory for this Alliance.',
              );
            }
            if (!alliance.binNumbers.includes(dto.allianceMeta.binNumber)) {
              throw new Error(
                `Invalid BIN number: ${dto.allianceMeta.binNumber} is not allowed for this Alliance.`,
              );
            }
          }

          if (hasCardTender) {
            if (
              !dto.allianceMeta ||
              !dto.allianceMeta.cardLast4 ||
              dto.allianceMeta.cardLast4.trim().length !== 4
            ) {
              throw new Error(
                'Card number (last 4 digits) is mandatory when Alliance is selected.',
              );
            }
            if (
              !dto.allianceMeta.merchantSlip ||
              !dto.allianceMeta.merchantSlip.trim()
            ) {
              throw new Error(
                'Auth ID / Approval Code is mandatory when Alliance is selected.',
              );
            }
            const trimmedMerchantSlip = dto.allianceMeta.merchantSlip.trim();
            if (
              trimmedMerchantSlip.length !== 6 ||
              !/^\d+$/.test(trimmedMerchantSlip)
            ) {
              throw new Error(
                'Auth ID / Approval Code must be exactly a 6-digit numeric code.',
              );
            }
            for (const t of tenders) {
              if (t.method === 'card' || t.method === 'bank_transfer') {
                if (!t.cardLast4 || t.cardLast4.trim().length !== 4) {
                  throw new Error(
                    'Card number (last 4 digits) is mandatory for card/bank payments when Alliance is selected.',
                  );
                }
                if (!t.slipNo || !t.slipNo.trim()) {
                  throw new Error(
                    'Auth ID / Approval Code is mandatory for card/bank payments when Alliance is selected.',
                  );
                }
                const trimmedTenderSlip = t.slipNo.trim();
                if (
                  trimmedTenderSlip.length !== 6 ||
                  !/^\d+$/.test(trimmedTenderSlip)
                ) {
                  throw new Error(
                    'Auth ID / Approval Code must be exactly a 6-digit numeric code.',
                  );
                }
              }
            }
          }
        }

        // ── Resolve promo scope ──────────────────────────────────
        const promoItemIds =
          dto.promoScope?.type === 'items' && dto.promoScope.itemIds?.length
            ? new Set(dto.promoScope.itemIds)
            : null; // null = apply to all

        // ── Calculate line items ─────────────────────────────────
        itemsData = dto.items.map((lineItem) => {
          const retailPrice = lineItem.unitPrice;
          const taxPct = lineItem.taxPercent || 0;
          const taxDivisor = 1 + taxPct / 100;

          // Calculate WOST (Value excluding tax) from Retail Price
          // WOST = Retail / (1 + tax%)
          const wostPerUnit = retailPrice / taxDivisor;
          const totalWost =
            Math.round(wostPerUnit * lineItem.quantity * 100) / 100;

          // Apply discount on WOST (not on Retail Price)
          // Use overrideDiscountPercent if available, otherwise use discountPercent
          const discPct =
            lineItem.overrideDiscountPercent ?? lineItem.discountPercent ?? 0;
          const discAmt = Math.round(totalWost * (discPct / 100) * 100) / 100;
          const afterDisc = totalWost - discAmt;

          // Calculate tax on amount after discount
          const taxAmt = Math.round(afterDisc * (taxPct / 100) * 100) / 100;

          const promoDisc =
            promoItemIds === null || promoItemIds.has(lineItem.itemId)
              ? lineItem.promoDiscountAmount || 0
              : 0;

          const lineTotal =
            Math.round((afterDisc + taxAmt - promoDisc) * 100) / 100;

          return {
            itemId: lineItem.itemId,
            quantity: lineItem.quantity,
            unitPrice: lineItem.unitPrice,
            discountPercent: discPct,
            discountAmount: discAmt + promoDisc,
            overrideDiscountPercent:
              lineItem.overrideDiscountPercent || undefined,
            overrideDiscountNote: lineItem.overrideDiscountNote || undefined,
            taxPercent: taxPct,
            taxAmount: taxAmt,
            lineTotal: Math.max(0, lineTotal),
          };
        });

        // Calculate subtotal as sum of WOST (not retail price)
        const subtotal = itemsData.reduce((acc, i) => {
          const taxDivisor = 1 + i.taxPercent / 100;
          const wostPerUnit = i.unitPrice / taxDivisor;
          return acc + wostPerUnit * i.quantity;
        }, 0);
        const lineItemDiscount = itemsData.reduce(
          (acc, i) => acc + i.discountAmount,
          0,
        );
        const recalculatedTotalTax = itemsData.reduce(
          (acc, i) => acc + i.taxAmount,
          0,
        );
        const subtotalAfterItemDiscount = subtotal - lineItemDiscount;

        // ── Calculate global discount with priority logic ──
        let globalDiscAmt = 0;
        let finalLineItemDiscount = lineItemDiscount; // May be zeroed if alliance is better
        let appliedDiscountType = 'none'; // Track which discount was applied

        // Calculate all possible discounts
        let manualDiscount = 0;
        let allianceDiscount = 0;
        let couponDiscount = 0;

        // 1. Manual discount (from UI) — calculated on full subtotal (replaces item discounts)
        //    Max 50% allowed; flat amount capped at 50% of Grand Total before manual discount
        const grandTotalBeforeManual =
          Math.round(
            (subtotal - lineItemDiscount + recalculatedTotalTax + 1) * 100,
          ) / 100;
        if (dto.globalDiscountPercent) {
          const cappedPercent = Math.min(dto.globalDiscountPercent, 50);
          manualDiscount =
            Math.round(subtotal * (cappedPercent / 100) * 100) / 100;
        } else if (dto.globalDiscountAmount) {
          const maxFlatDiscount =
            Math.round(grandTotalBeforeManual * 0.5 * 100) / 100;
          const cappedWstDiscount = Math.min(
            dto.globalDiscountAmount,
            maxFlatDiscount,
          );
          const totalWstPrice = itemsData.reduce(
            (acc, i) => acc + i.unitPrice * i.quantity,
            0,
          );
          if (totalWstPrice > 0) {
            manualDiscount =
              Math.round(cappedWstDiscount * (subtotal / totalWstPrice) * 100) /
              100;
          } else {
            manualDiscount = 0;
          }
        }
        // 2. Alliance discount (calculated on subtotal AFTER item discounts)
        if (
          dto.allianceId &&
          !dto.globalDiscountAmount &&
          !dto.globalDiscountPercent
        ) {
          const alliance = await tx.allianceDiscount.findFirst({
            where: { id: dto.allianceId, isDeleted: false },
          });
          if (alliance) {
            const calculatedDiscount =
              Math.round(
                subtotal * (Number(alliance.discountPercent) / 100) * 100,
              ) / 100;
            if (alliance.maxDiscount) {
              allianceDiscount = Math.min(
                calculatedDiscount,
                Number(alliance.maxDiscount),
              );
            } else {
              allianceDiscount = calculatedDiscount;
            }
            allianceDiscount = Math.round(allianceDiscount * 100) / 100;
          }
        }

        // 3. Coupon discount
        if (dto.couponId) {
          const coupon = await tx.couponCode.findFirst({
            where: { id: dto.couponId, isDeleted: false },
          });
          if (coupon) {
            if (coupon.discountType === 'percent') {
              const disc =
                Math.round(
                  subtotalAfterItemDiscount *
                    (Number(coupon.discountValue) / 100) *
                    100,
                ) / 100;
              couponDiscount = coupon.maxDiscount
                ? Math.min(disc, Number(coupon.maxDiscount))
                : disc;
            } else {
              couponDiscount = Math.min(
                Number(coupon.discountValue),
                subtotalAfterItemDiscount,
              );
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
          // Manual discount — replaces item-level discounts
          globalDiscAmt = manualDiscount;
          finalLineItemDiscount = 0; // Remove item discounts when manual discount is applied
          appliedDiscountType = 'manual';
          if (dto.allianceId) {
            dto.manualDiscountNote =
              `[Manual Alliance] ${dto.manualDiscountNote || ''}`.trim();
          }
        }

        // If any global/order-level discount (Alliance, Coupon, Manual) is applied,
        // distribute it across itemsData proportionally to WOST (Value excluding tax)
        if (globalDiscAmt > 0) {
          const baseSubtotal = subtotal > 0 ? subtotal : 1;
          let distributedDisc = 0;
          const rawShares = itemsData.map((item) => {
            const taxDivisor = 1 + item.taxPercent / 100;
            const wostPerUnit = item.unitPrice / taxDivisor;
            const itemWost = wostPerUnit * item.quantity;
            const share = Math.floor((globalDiscAmt * itemWost) / baseSubtotal);
            distributedDisc += share;
            return share;
          });

          let remainder = Math.round(globalDiscAmt - distributedDisc);
          const sortedIdx = itemsData
            .map((item, i) => {
              const taxDivisor = 1 + item.taxPercent / 100;
              const wostPerUnit = item.unitPrice / taxDivisor;
              return { i, v: wostPerUnit * item.quantity };
            })
            .sort((a, b) => b.v - a.v)
            .map((x) => x.i);

          for (let k = 0; k < remainder; k++) {
            rawShares[sortedIdx[k % sortedIdx.length]]++;
          }

          itemsData = itemsData.map((item, idx) => {
            const disc = rawShares[idx];

            // Recalculate tax based on WOST after discount
            const taxDivisor = 1 + item.taxPercent / 100;
            const wostPerUnit = item.unitPrice / taxDivisor;
            const totalWost = wostPerUnit * item.quantity;
            const afterDisc = totalWost - disc;
            const recalculatedTax =
              Math.round(afterDisc * (item.taxPercent / 100) * 100) / 100;

            return {
              ...item,
              discountPercent: Math.round((disc / totalWost) * 100 * 100) / 100,
              discountAmount: disc,
              taxAmount: recalculatedTax,
              lineTotal: Math.round((afterDisc + recalculatedTax) * 100) / 100,
            };
          });
        }

        // Recalculate totalTax after alliance discount distribution (if applied)
        const finalTotalTax = itemsData.reduce(
          (acc, i) => acc + i.taxAmount,
          0,
        );

        // Recalculate total with the chosen discount
        const totalDiscount = finalLineItemDiscount + globalDiscAmt;
        const location = await tx.location.findUnique({
          where: { id: locationId },
          select: { fbrEnabled: true, fbrNtn: true },
        });
        const fbrPosFee = location?.fbrEnabled && location?.fbrNtn ? 1 : 0;
        const grandTotal = Math.max(
          0,
          Math.round(subtotal - totalDiscount + finalTotalTax + fbrPosFee),
        );
        const changeAmount = Math.max(0, totalPaid - grandTotal);

        // Debug logging
        console.log('=== GRAND TOTAL CALCULATION ===');
        console.log('Subtotal (WOST):', subtotal);
        console.log('Total Discount:', totalDiscount);
        console.log('Total Tax (Final):', finalTotalTax);
        console.log('FBR POS Fee:', fbrPosFee);
        console.log('Grand Total:', grandTotal);
        console.log(
          'Formula: subtotal - totalDiscount + finalTotalTax + fbrPosFee =',
          subtotal,
          '-',
          totalDiscount,
          '+',
          finalTotalTax,
          '+',
          fbrPosFee,
          '=',
          grandTotal,
        );
        console.log('===============================');

        const notesParts: string[] = [];
        if (dto.notes) notesParts.push(dto.notes);
        if (isCreditSale)
          notesParts.push(`[Credit Sale] Balance: ${creditAmount}`);
        if (appliedDiscountType === 'alliance' && dto.allianceMeta) {
          const m = dto.allianceMeta;
          const parts: string[] = [];
          if (m.cardholderName) parts.push(`Cardholder: ${m.cardholderName}`);
          if (m.cardLast4) parts.push(`Card: ****${m.cardLast4}`);
          if (m.merchantSlip) parts.push(`Slip: ${m.merchantSlip}`);
          if (m.binNumber) parts.push(`BIN: ${m.binNumber}`);
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
          comparison:
            totalPaidRounded >= grandTotalRounded
              ? 'PAID'
              : totalPaidRounded > 0
                ? 'PARTIAL'
                : 'UNPAID',
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

        let order;
        if (isResumedHold) {
          order = await tx.salesOrder.update({
            where: { id: dto.holdOrderId },
            data: {
              orderNumber,
              posId: dto.posId,
              terminalId: dto.terminalId,
              locationId: dto.locationId,
              customerId: dto.customerId,
              cashierUserId,
              createdById: ctx?.userId || cashierUserId || null,
              paymentMethod:
                isCreditSale && totalPaid === 0
                  ? 'credit_account'
                  : paymentMethod,
              notes: notesParts.join(' | ') || undefined,
              manualDiscountNote: dto.manualDiscountNote || undefined,
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
              tenderType:
                isCreditSale && totalPaid === 0
                  ? 'credit_account'
                  : paymentMethod,
              cashAmount: cashAmount || undefined,
              cardAmount: cardAmount || undefined,
              voucherAmount: voucherAmount || undefined,
              changeAmount: changeAmount || undefined,
              isGiftReceipt: dto.isGiftReceipt || false,
              items: {
                create: itemsData,
              },
            },
            include: {
              items: {
                include: {
                  item: {
                    select: {
                      description: true,
                      sku: true,
                      barCode: true,
                      size: { select: { name: true } },
                      color: { select: { name: true } },
                    },
                  },
                },
              },
              promo: { select: { name: true, code: true } },
              coupon: { select: { code: true, description: true } },
              alliance: {
                select: {
                  partnerName: true,
                  code: true,
                  discountPercent: true,
                  maxDiscount: true,
                },
              },
              merchant: {
                select: {
                  id: true,
                  bankName: true,
                  description: true,
                  commissionRate: true,
                  bankGlCode: true,
                },
              },
            },
          });
        } else {
          order = await tx.salesOrder.create({
            data: {
              orderNumber,
              posId: dto.posId,
              terminalId: dto.terminalId,
              locationId: dto.locationId,
              customerId: dto.customerId,
              cashierUserId,
              createdById: ctx?.userId || cashierUserId || null,
              paymentMethod:
                isCreditSale && totalPaid === 0
                  ? 'credit_account'
                  : paymentMethod,
              notes: notesParts.join(' | ') || undefined,
              manualDiscountNote: dto.manualDiscountNote || undefined,
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
              tenderType:
                isCreditSale && totalPaid === 0
                  ? 'credit_account'
                  : paymentMethod,
              cashAmount: cashAmount || undefined,
              cardAmount: cardAmount || undefined,
              voucherAmount: voucherAmount || undefined,
              changeAmount: changeAmount || undefined,
              isGiftReceipt: dto.isGiftReceipt || false,
              items: {
                create: itemsData,
              },
            },
            include: {
              items: {
                include: {
                  item: {
                    select: {
                      description: true,
                      sku: true,
                      barCode: true,
                      size: { select: { name: true } },
                      color: { select: { name: true } },
                    },
                  },
                },
              },
              promo: { select: { name: true, code: true } },
              coupon: { select: { code: true, description: true } },
              alliance: {
                select: {
                  partnerName: true,
                  code: true,
                  discountPercent: true,
                  maxDiscount: true,
                },
              },
              merchant: {
                select: {
                  id: true,
                  bankName: true,
                  description: true,
                  commissionRate: true,
                  bankGlCode: true,
                },
              },
            },
          });
        }

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
        for (const item of itemsData) {
          await this.stockLedgerService.createEntry(
            {
              itemId: item.itemId,
              warehouseId: warehouseId,
              locationId: locationId,
              qty: -item.quantity, // Negative for OUTBOUND
              movementType: MovementType.OUTBOUND,
              referenceType: 'POS_SALE',
              // unitCost: item.,
              referenceId: order.id,
            },
            tx,
          );

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
                warehouseId: warehouseId,
                quantity: -item.quantity,
                status: 'AVAILABLE',
              },
            });
          }
        }

        if (dto.couponId) {
          await tx.couponCode.update({
            where: { id: dto.couponId },
            data: { usedCount: { increment: 1 } },
          });
        }

        // ── Redeem vouchers ────────────────────────────────────────
        const voucherRedemptions = dto.voucherRedemptions;
        let creditVouchers: {
          code: string;
          faceValue: number;
          expiresAt: Date | null;
        }[] = [];
        if (voucherRedemptions?.length) {
          creditVouchers = await this.voucherService.redeemVouchers(
            voucherRedemptions.map((r) => ({
              voucherId: r.voucherId,
              amountUsed: r.amount,
            })),
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
            creditVouchers:
              creditVouchers.length > 0 ? creditVouchers : undefined,
          },
          message:
            creditVouchers.length > 0
              ? `Order ${orderNumber} created successfully. Credit voucher(s) issued: ${creditVouchers.map((v) => v.code).join(', ')}`
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
      discountAmount: number;
      taxPercent: number;
      taxAmount: number;
      lineTotal: number;
    }>,
  ): Promise<{
    success: boolean;
    fbrInvoiceNumber?: string;
    fbrQrCode?: string;
    fbrStatus: 'SYNCED' | 'PENDING' | 'SKIPPED';
    error?: string;
    responsePayload?: any;
  }> {
    this.logger.log(
      `[FBR Sync] 🚀 Starting FBR sync for order: ${order.orderNumber || order.id}`,
    );
    try {
      // ── Load location FBR config ───────────────────────────────
      if (!order.locationId) {
        this.logger.warn(
          `[FBR Sync] [WARN] Order ${order.orderNumber} has no locationId — skipping FBR sync`,
        );
        return {
          success: false,
          fbrStatus: 'SKIPPED',
          error: 'Order has no locationId',
        };
      }

      const location = await this.prisma.location.findUnique({
        where: { id: order.locationId },
        select: {
          fbrEnabled: true,
          fbrBposId: true,
          fbrNtn: true,
          fbrSellerName: true,
          address: true,
        },
      });

      this.logger.log(
        `[FBR Sync] [CONFIG] Location ID: ${order.locationId}, FBR Enabled: ${location?.fbrEnabled}`,
      );

      if (!location?.fbrEnabled) {
        this.logger.log(
          `[FBR Sync] [INFO] FBR not configured or enabled for location ${order.locationId} — skipping`,
        );
        return {
          success: false,
          fbrStatus: 'SKIPPED',
          error: 'FBR disabled or not configured',
        };
      }

      if (!location.fbrBposId) {
        this.logger.warn(
          `[FBR Sync] [WARN] Location ${order.locationId} is FBR-enabled but missing bposId or token — setting status to PENDING`,
        );
        await this.prisma.salesOrder.update({
          where: { id: order.id },
          data: { fbrStatus: 'PENDING' },
        });
        order.fbrStatus = 'PENDING';
        return {
          success: false,
          fbrStatus: 'PENDING',
          error: 'Missing FBR BPOS ID or Bearer Token',
        };
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
          taxPercent: line.taxPercent,
          discountAmount: line.discountAmount,
          taxAmount: line.taxAmount,
          lineTotal: line.lineTotal,
        };
      });

      const payload = this.fbrService.buildPayload({
        bposId: location.fbrBposId,
        usin: order.orderNumber || order.id,
        orderDate: new Date(order.createdAt),
        buyerNtn,
        buyerName,
        buyerAddress,
        sellerNtn: location.fbrNtn || '6386420',
        sellerName: location.fbrSellerName || 'Hydra Foods',
        items: fbrItems,
      });

      this.logger.debug(
        `[FBR Sync] [PAYLOAD] Generated FBR payload for order ${order.orderNumber}:\n${JSON.stringify(payload, null, 2)}`,
      );

      // Override the bearer token with the per-location token
      this.logger.log(`[FBR Sync] [HTTP] Sending request to FBR gateway...`);
      const fbrResponse = await this.fbrService.postInvoice(payload);
      this.logger.log(
        `[FBR Sync] [RESPONSE] Received response from FBR gateway. Code: ${fbrResponse.Code}`,
      );

      if (fbrResponse.Code === 100) {
        this.logger.log(
          `[FBR Sync] [SUCCESS] Order ${order.orderNumber} successfully synced with FBR. Invoice Number: ${fbrResponse.InvoiceNumber}`,
        );
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

        return {
          success: true,
          fbrInvoiceNumber: fbrResponse.InvoiceNumber,
          fbrQrCode: fbrResponse.QRCode,
          fbrStatus: 'SYNCED',
          responsePayload: fbrResponse,
        };
      } else {
        const errMsg = `FBR non-success code ${fbrResponse.Code}: ${fbrResponse.Errors ?? ''}`;
        this.logger.error(
          `[FBR Sync] [FAIL] Order ${order.orderNumber} sync failed. ${errMsg}`,
        );
        await this.prisma.salesOrder.update({
          where: { id: order.id },
          data: { fbrStatus: 'PENDING' },
        });
        order.fbrStatus = 'PENDING';
        return {
          success: false,
          fbrStatus: 'PENDING',
          error: errMsg,
          responsePayload: fbrResponse,
        };
      }
    } catch (err: any) {
      this.logger.error(
        `[FBR Sync] [EXCEPTION] FBR Sync failed for order ${order?.orderNumber}: ${err.message}`,
        err.stack,
      );
      await this.prisma.salesOrder.update({
        where: { id: order.id },
        data: { fbrStatus: 'PENDING' },
      });
      order.fbrStatus = 'PENDING';
      return {
        success: false,
        fbrStatus: 'PENDING',
        error: err.message || 'Unknown integration error',
      };
    }
  }


    // ─── Search order for return (unrestricted by location / POS) ─────
    async searchOrderForReturn(orderNumber: string) {
        if (!orderNumber || !orderNumber.trim()) {
            return { status: false, message: 'Order number is required' };
        }

        const cleanSearch = orderNumber.trim();
        const rawOrders = await this.prisma.salesOrder.findMany({
            where: {
                orderNumber: { equals: cleanSearch, mode: 'insensitive' },
                status: { notIn: ['hold', 'hold_expired', 'hold_cancelled'] },
            },
            take: 10,
            orderBy: { createdAt: 'desc' },
            include: {
                items: {
                    include: {
                        item: {
                            select: {
                                description: true,
                                sku: true,
                                barCode: true,
                                size: { select: { name: true } },
                                color: { select: { name: true } },
                                brand: { select: { name: true } },
                            },
                        },
                    },
                },
                promo: { select: { name: true, code: true } },
                coupon: { select: { code: true, description: true } },
                alliance: { select: { partnerName: true, code: true, discountPercent: true, maxDiscount: true } },
                merchant: { select: { id: true, bankName: true, description: true, commissionRate: true, bankGlCode: true } },
                voucherRedemptions: { select: { amountUsed: true, voucher: { select: { code: true, faceValue: true } } } },
            },
        });

        if (rawOrders.length === 0) {
            return { status: false, message: `Order matching "${cleanSearch}" not found` };
        }

        const orderIds = rawOrders.map(o => o.id);
        const returnEntries = await this.prisma.stockLedger.findMany({
            where: {
                referenceType: { in: ['POS_RETURN', 'POS_REFUND'] },
                referenceId: { in: orderIds },
            },
            select: { referenceId: true, itemId: true, qty: true, referenceType: true },
        });

        const returnedQtyMap = new Map<string, Map<string, number>>();
        const orderReturnFlags = new Map<string, { hasReturn: boolean; hasRefund: boolean }>();
        for (const entry of returnEntries) {
            if (!returnedQtyMap.has(entry.referenceId)) {
                returnedQtyMap.set(entry.referenceId, new Map());
            }
            const itemMap = returnedQtyMap.get(entry.referenceId)!;
            const current = itemMap.get(entry.itemId) || 0;
            itemMap.set(entry.itemId, current + Math.abs(Number(entry.qty)));

            if (!orderReturnFlags.has(entry.referenceId)) {
                orderReturnFlags.set(entry.referenceId, { hasReturn: false, hasRefund: false });
            }
            const flags = orderReturnFlags.get(entry.referenceId)!;
            if (entry.referenceType === 'POS_RETURN') flags.hasReturn = true;
            if (entry.referenceType === 'POS_REFUND') flags.hasRefund = true;
        }

        const claims = await this.prisma.posClaim.findMany({
            where: { salesOrderId: { in: orderIds } },
            select: {
                id: true,
                claimNumber: true,
                salesOrderId: true,
                status: true,
                items: {
                    select: { itemId: true, claimedQty: true, approvedQty: true, itemStatus: true },
                },
            },
        });

        const claimsMap = new Map<string, any[]>();
        for (const claim of claims) {
            if (!claimsMap.has(claim.salesOrderId)) {
                claimsMap.set(claim.salesOrderId, []);
            }
            claimsMap.get(claim.salesOrderId)!.push(claim);
        }

        const locIds = [...new Set(rawOrders.map(o => o.locationId).filter(Boolean))] as string[];
        const locations = locIds.length > 0
            ? await this.prisma.location.findMany({ where: { id: { in: locIds } }, select: { id: true, name: true, code: true, shortCode: true } })
            : [];
        const locationMap = new Map(locations.map(l => [l.id, l]));

        const orders = rawOrders.map(order => {
            const itemMap = returnedQtyMap.get(order.id);
            const orderClaims = claimsMap.get(order.id) || [];
            const claimedQtyMap = new Map<string, { claimed: number; approved: number }>();
            for (const claim of orderClaims) {
                for (const claimItem of claim.items) {
                    const current = claimedQtyMap.get(claimItem.itemId) || { claimed: 0, approved: 0 };
                    const isRejected = claim.status === 'REJECTED' || claim.status === 'CANCELLED' || claimItem.itemStatus === 'REJECTED';
                    let claimedToAdd = 0;
                    if (isRejected) {
                        claimedToAdd = 0;
                    } else if (claimItem.itemStatus === 'APPROVED' || claimItem.itemStatus === 'PARTIALLY_APPROVED') {
                        claimedToAdd = Number(claimItem.approvedQty);
                    } else {
                        claimedToAdd = Number(claimItem.claimedQty);
                    }
                    claimedQtyMap.set(claimItem.itemId, {
                        claimed: current.claimed + claimedToAdd,
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

            const returnFlags = orderReturnFlags.get(order.id) || { hasReturn: false, hasRefund: false };
            return {
                ...order,
                location: order.locationId ? locationMap.get(order.locationId) || null : null,
                items: enrichedItems,
                claims: orderClaims,
                hasReturn: returnFlags.hasReturn,
                hasRefund: returnFlags.hasRefund,
            };
        });

        return { status: true, data: orders };
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
      // Always exclude hold, hold_expired, and hold_cancelled orders from history listing/search
      where.status = { notIn: ['hold', 'hold_expired', 'hold_cancelled'] };
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

    // const userPerms = role?.permissions.map(p => p.permission.name) || [];
    // const canViewAll = userPerms.includes('*') || userPerms.includes('pos.sales.history.view_all') ||
    //     ['super_admin', 'admin'].includes(role?.name.toLowerCase() || '');

    // if (!canViewAll) {
    //     // Only see their own orders
    //     where.cashierUserId = user.id;
    // }

    const [rawOrders, total] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          items: {
            include: {
              item: {
                select: {
                  description: true,
                  sku: true,
                  barCode: true,
                  size: true,
                  color: true,
                },
              },
            },
          },
          promo: { select: { name: true, code: true } },
          coupon: { select: { code: true, description: true } },
          alliance: {
            select: {
              partnerName: true,
              code: true,
              discountPercent: true,
              maxDiscount: true,
            },
          },
          merchant: {
            select: {
              id: true,
              bankName: true,
              description: true,
              commissionRate: true,
              bankGlCode: true,
            },
          },
          voucherRedemptions: {
            select: {
              amountUsed: true,
              voucher: { select: { code: true, faceValue: true } },
            },
          },
        },
      }),
      this.prisma.salesOrder.count({ where }),
    ]);

    // ── Fetch returned quantities for ALL orders ──
    const orderIds = rawOrders.map((o) => o.id);
    const returnEntries = await this.prisma.stockLedger.findMany({
      where: {
        referenceType: { in: ['POS_RETURN', 'POS_REFUND'] },
        referenceId: { in: orderIds },
      },
      select: {
        referenceId: true,
        itemId: true,
        qty: true,
        referenceType: true,
      },
    });

    // Build map: orderId -> itemId -> returnedQty
    const returnedQtyMap = new Map<string, Map<string, number>>();
    const orderReturnFlags = new Map<
      string,
      { hasReturn: boolean; hasRefund: boolean }
    >();
    for (const entry of returnEntries) {
      if (!returnedQtyMap.has(entry.referenceId)) {
        returnedQtyMap.set(entry.referenceId, new Map());
      }
      const itemMap = returnedQtyMap.get(entry.referenceId)!;
      const current = itemMap.get(entry.itemId) || 0;
      itemMap.set(entry.itemId, current + Math.abs(Number(entry.qty)));

      if (!orderReturnFlags.has(entry.referenceId)) {
        orderReturnFlags.set(entry.referenceId, {
          hasReturn: false,
          hasRefund: false,
        });
      }
      const flags = orderReturnFlags.get(entry.referenceId)!;
      if (entry.referenceType === 'POS_RETURN') flags.hasReturn = true;
      if (entry.referenceType === 'POS_REFUND') flags.hasRefund = true;
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

    // ── Fetch active issued vouchers for ALL orders ──
    const issuedVouchersList = await this.prisma.voucher.findMany({
      where: {
        sourceOrderId: { in: orderIds },
        isDeleted: false,
      },
      select: {
        sourceOrderId: true,
      },
    });
    const issuedVouchersSet = new Set(
      issuedVouchersList.map((v) => v.sourceOrderId).filter(Boolean),
    );

    console.log('🔍 [POS Sales] Fetching claims for orders:', {
      totalOrders: orderIds.length,
      orderIds: orderIds.slice(0, 3), // First 3 for brevity
      claimsFound: claims.length,
      claimNumbers: claims.map((c) => c.claimNumber),
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
    const orders = rawOrders.map((order) => {
      const tenders: {
        method: string;
        amount: number;
        slipNo?: string;
        voucherFaceValue?: number;
      }[] = [];

      // Extract voucher redemptions first
      const voucherTotalFromRedemptions = (
        order.voucherRedemptions || []
      ).reduce((sum: number, r: any) => sum + Number(r.amountUsed), 0);
      for (const r of (order.voucherRedemptions || []) as any[]) {
        tenders.push({
          method: 'voucher',
          amount: Number(r.amountUsed),
          slipNo: r.voucher?.code || undefined,
          voucherFaceValue: r.voucher?.faceValue
            ? Number(r.voucher.faceValue)
            : undefined,
        });
      }

      const rawCash = Number(order.cashAmount ?? 0);
      const rawCard = Number(order.cardAmount ?? 0);
      const change = Number(order.changeAmount ?? 0);
      const grandTotal = Number(order.grandTotal ?? 0);

      // Determine if voucher redemption is double-counted within card/cash amounts
      const excess = Math.max(
        0,
        rawCash + rawCard + voucherTotalFromRedemptions - (grandTotal + change),
      );

      let cash = rawCash;
      let card = rawCard;
      if (excess > 0) {
        if (card > 0) {
          card = Math.max(0, card - excess);
        } else {
          cash = Math.max(0, cash - excess);
        }
      }

      if (order.tenderType === 'split') {
        if (cash > 0) tenders.push({ method: 'cash', amount: cash });
        if (card > 0) tenders.push({ method: 'card', amount: card });
      } else if (order.paymentMethod) {
        if (order.paymentMethod === 'cash') {
          const finalCash =
            cash > 0
              ? cash
              : Math.max(0, grandTotal - voucherTotalFromRedemptions);
          if (finalCash > 0)
            tenders.push({ method: 'cash', amount: finalCash });
        } else if (
          order.paymentMethod === 'card' ||
          order.paymentMethod === 'bank_transfer'
        ) {
          const finalCard =
            card > 0
              ? card
              : Math.max(0, grandTotal - voucherTotalFromRedemptions);
          if (finalCard > 0)
            tenders.push({ method: order.paymentMethod, amount: finalCard });
        } else if (order.paymentMethod !== 'voucher') {
          const finalAmt = Math.max(
            0,
            grandTotal - voucherTotalFromRedemptions,
          );
          if (finalAmt > 0)
            tenders.push({ method: order.paymentMethod, amount: finalAmt });
        }
      }

      // Attach returnedQty to each item
      const itemMap = returnedQtyMap.get(order.id);

      // Get claims for this order
      const orderClaims = claimsMap.get(order.id) || [];

      // Build map of itemId -> total claimed/approved quantities across all claims
      const claimedQtyMap = new Map<
        string,
        { claimed: number; approved: number }
      >();
      for (const claim of orderClaims) {
        for (const claimItem of claim.items) {
          const current = claimedQtyMap.get(claimItem.itemId) || {
            claimed: 0,
            approved: 0,
          };
          const isRejected =
            claim.status === 'REJECTED' ||
            claim.status === 'CANCELLED' ||
            claimItem.itemStatus === 'REJECTED';
          let claimedToAdd = 0;
          if (isRejected) {
            claimedToAdd = 0;
          } else if (
            claimItem.itemStatus === 'APPROVED' ||
            claimItem.itemStatus === 'PARTIALLY_APPROVED'
          ) {
            claimedToAdd = Number(claimItem.approvedQty);
          } else {
            claimedToAdd = Number(claimItem.claimedQty);
          }
          claimedQtyMap.set(claimItem.itemId, {
            claimed: current.claimed + claimedToAdd,
            approved: current.approved + Number(claimItem.approvedQty),
          });
        }
      }
      const enrichedItems = order.items.map((oi) => ({
        ...oi,
        returnedQty: itemMap?.get(oi.itemId) || 0,
        claimedQty: claimedQtyMap.get(oi.itemId)?.claimed || 0,
        approvedClaimQty: claimedQtyMap.get(oi.itemId)?.approved || 0,
      }));

      const returnFlags = orderReturnFlags.get(order.id) || {
        hasReturn: false,
        hasRefund: false,
      };
      return {
        ...order,
        tenders,
        items: enrichedItems,
        claims: orderClaims,
        hasReturn: returnFlags.hasReturn,
        hasRefund: returnFlags.hasRefund,
        hasIssuedVoucher: issuedVouchersSet.has(order.id),
      };
    });

    console.log('✅ [POS Sales] Orders enriched with claims:', {
      totalOrders: orders.length,
      ordersWithClaims: orders.filter((o) => o.claims && o.claims.length > 0)
        .length,
      sampleOrder: orders[0]
        ? {
            orderNumber: orders[0].orderNumber,
            claimsCount: orders[0].claims?.length || 0,
            claimNumbers: orders[0].claims?.map((c) => c.claimNumber) || [],
          }
        : null,
    });

    return {
      status: true,
      data: orders,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─── List sales activities (for Activity Log) ────────────────────
  async listSalesActivities(
    user: any,
    page = 1,
    limit = 20,
    posId?: string,
    activityType?: string,
    filters?: { startDate?: string; endDate?: string; search?: string },
    locationId?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (posId) {
      if (posId.length > 20) {
        where.terminalId = posId;
      } else {
        where.posId = posId;
      }
    }
    if (locationId) where.locationId = locationId;

    // Always exclude hold, hold_expired, and hold_cancelled orders from activity listing
    where.status = { notIn: ['hold', 'hold_expired', 'hold_cancelled'] };

    // ── Permission filtering ──
    const role = await this.prismaMaster.role.findUnique({
      where: { id: user.roleId },
      include: { permissions: { include: { permission: true } } },
    });

    // const userPerms = role?.permissions.map(p => p.permission.name) || [];
    // const canViewAll = userPerms.includes('*') || userPerms.includes('pos.sales.history.view_all') ||
    //     ['super_admin', 'admin'].includes(role?.name.toLowerCase() || '');

    // if (!canViewAll) {
    //     where.cashierUserId = user.id;
    // }

    // ── Determine Date Range ──
    let start: Date | undefined = undefined;
    let end: Date | undefined = undefined;

    if (filters?.startDate) {
      start = new Date(filters.startDate);
    } else if (!filters?.search) {
      // Default to last 30 days if no start date and no search query is specified
      start = new Date();
      start.setDate(start.getDate() - 30);
      start.setHours(0, 0, 0, 0);
    }

    if (filters?.endDate) {
      end = new Date(filters.endDate);
      end.setHours(23, 59, 59, 999);
    } else if (!filters?.search) {
      end = new Date();
      end.setHours(23, 59, 59, 999);
    }

    // ── Gather all matching Order IDs by Activity Date ──
    const targetOrderIds = new Set<string>();
    const filterByDate = start || end;

    if (filterByDate) {
      // 1. Sale Activity in range
      const saleRangeQuery: any = {};
      if (start) saleRangeQuery.gte = start;
      if (end) saleRangeQuery.lte = end;

      const salesInRange = await this.prisma.salesOrder.findMany({
        where: {
          ...where,
          createdAt: saleRangeQuery,
        },
        select: { id: true },
      });
      salesInRange.forEach((o) => targetOrderIds.add(o.id));

      // 2. Return/Refund Activity in range (from stock ledgers)
      const ledgerRangeQuery: any = {};
      if (start) ledgerRangeQuery.gte = start;
      if (end) ledgerRangeQuery.lte = end;

      const ledgersInRange = await this.prisma.stockLedger.findMany({
        where: {
          referenceType: { in: ['POS_RETURN', 'POS_REFUND'] },
          createdAt: ledgerRangeQuery,
        },
        select: { referenceId: true },
      });
      ledgersInRange.forEach((l) => targetOrderIds.add(l.referenceId));

      // 3. Claim Activity in range (from claims)
      const claimRangeQuery: any = {};
      if (start) claimRangeQuery.gte = start;
      if (end) claimRangeQuery.lte = end;

      const claimsInRange = await this.prisma.posClaim.findMany({
        where: { submittedAt: claimRangeQuery },
        select: { salesOrderId: true },
      });
      claimsInRange.forEach((c) => targetOrderIds.add(c.salesOrderId));
    }

    // ── Search Filters ──
    if (filters?.search) {
      const searchTerm = filters.search.trim();

      const searchWhere: any = {
        OR: [
          { orderNumber: { contains: searchTerm, mode: 'insensitive' } },
          { returnNumber: { contains: searchTerm, mode: 'insensitive' } },
          { refundNumber: { contains: searchTerm, mode: 'insensitive' } },
        ],
      };

      const matchedOrders = await this.prisma.salesOrder.findMany({
        where: {
          ...where,
          ...searchWhere,
        },
        select: { id: true },
      });
      const searchOrderIds = new Set(matchedOrders.map((o) => o.id));

      // Search by Claim Number
      const matchedClaims = await this.prisma.posClaim.findMany({
        where: { claimNumber: { contains: searchTerm, mode: 'insensitive' } },
        select: { salesOrderId: true },
      });
      matchedClaims.forEach((c) => searchOrderIds.add(c.salesOrderId));

      // Search by Voucher Code (Issued or Redeemed)
      const matchedIssuedVouchers = await this.prisma.voucher.findMany({
        where: {
          code: { contains: searchTerm, mode: 'insensitive' },
          sourceOrderId: { not: null },
        },
        select: { sourceOrderId: true },
      });
      matchedIssuedVouchers.forEach((v) =>
        searchOrderIds.add(v.sourceOrderId as string),
      );

      const matchedRedemptions = await this.prisma.voucherRedemption.findMany({
        where: {
          voucher: { code: { contains: searchTerm, mode: 'insensitive' } },
        },
        select: { orderId: true },
      });
      matchedRedemptions.forEach((r) => searchOrderIds.add(r.orderId));

      // If we have date filters, intersect search results with target IDs. Else, use search results directly.
      if (filterByDate) {
        const intersectIds = Array.from(targetOrderIds).filter((id) =>
          searchOrderIds.has(id),
        );
        targetOrderIds.clear();
        intersectIds.forEach((id) => targetOrderIds.add(id));
      } else {
        searchOrderIds.forEach((id) => targetOrderIds.add(id));
      }
    }

    // Apply final resolved order IDs filter
    where.id = { in: Array.from(targetOrderIds) };

    // ── Fetch orders with matching IDs ──
    const rawOrders = await this.prisma.salesOrder.findMany({
      where,
      include: {
        items: {
          include: {
            item: {
              select: {
                description: true,
                sku: true,
                barCode: true,
                size: { select: { name: true } },
                color: { select: { name: true } },
                brand: { select: { name: true } },
              },
            },
          },
        },
        customer: { select: { id: true, name: true, contactNo: true } },
        promo: { select: { name: true, code: true } },
        coupon: { select: { code: true, description: true } },
        alliance: {
          select: {
            partnerName: true,
            code: true,
            discountPercent: true,
            maxDiscount: true,
          },
        },
        merchant: {
          select: {
            id: true,
            bankName: true,
            description: true,
            commissionRate: true,
            bankGlCode: true,
          },
        },
        voucherRedemptions: {
          select: {
            amountUsed: true,
            voucher: { select: { code: true, faceValue: true } },
          },
        },
        claims: {
          include: {
            items: {
              include: {
                item: {
                  select: { description: true, sku: true, barCode: true },
                },
              },
            },
            voucher: { select: { code: true, faceValue: true } },
          },
          orderBy: { submittedAt: 'desc' },
        },
      },
    });

    const orderIds = rawOrders.map((o) => o.id);

    // Fetch stock ledgers for returns/refunds
    const returnEntries = await this.prisma.stockLedger.findMany({
      where: {
        referenceType: { in: ['POS_RETURN', 'POS_REFUND'] },
        referenceId: { in: orderIds },
      },
      select: {
        referenceId: true,
        itemId: true,
        qty: true,
        referenceType: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const returnEntriesMap = new Map<string, typeof returnEntries>();
    for (const entry of returnEntries) {
      if (!returnEntriesMap.has(entry.referenceId)) {
        returnEntriesMap.set(entry.referenceId, []);
      }
      returnEntriesMap.get(entry.referenceId)!.push(entry);
    }

    // Fetch issued vouchers
    const issuedVouchers = await this.prisma.voucher.findMany({
      where: {
        sourceOrderId: { in: orderIds },
        isDeleted: false,
      },
      select: {
        id: true,
        code: true,
        voucherType: true,
        faceValue: true,
        expiresAt: true,
        sourceOrderId: true,
      },
    });

    const issuedVouchersMap = new Map<string, typeof issuedVouchers>();
    for (const v of issuedVouchers) {
      if (v.sourceOrderId) {
        if (!issuedVouchersMap.has(v.sourceOrderId)) {
          issuedVouchersMap.set(v.sourceOrderId, []);
        }
        issuedVouchersMap.get(v.sourceOrderId)!.push(v);
      }
    }

    // ── Flatten activities ──
    let allActivities: any[] = [];

    (rawOrders as any[]).forEach((order) => {
      const orderVouchers = issuedVouchersMap.get(order.id) || [];
      const orderLedgers = returnEntriesMap.get(order.id) || [];

      // 1. Sale Activity
      const saleIssuedVouchers = orderVouchers.filter((v) =>
        ['GIFT', 'CREDIT'].includes(v.voucherType),
      );
      const tenders: { method: string; amount: number; slipNo?: string }[] = [];
      const voucherTotalFromRedemptions = (
        order.voucherRedemptions || []
      ).reduce((sum: number, r: any) => sum + Number(r.amountUsed), 0);
      for (const r of (order.voucherRedemptions || []) as any[]) {
        tenders.push({
          method: 'voucher',
          amount: Number(r.amountUsed),
          slipNo: r.voucher?.code || undefined,
        });
      }

      if (order.tenderType === 'split') {
        if (Number(order.cashAmount) > 0)
          tenders.push({ method: 'cash', amount: Number(order.cashAmount) });
        const isLegacy =
          order.voucherAmount === null || order.voucherAmount === undefined;
        const realCardAmount = isLegacy
          ? Math.max(
              0,
              Number(order.cardAmount) -
                voucherTotalFromRedemptions -
                Number(order.changeAmount ?? 0),
            )
          : Number(order.cardAmount);
        if (realCardAmount > 0)
          tenders.push({ method: 'card', amount: realCardAmount });
      } else if (order.paymentMethod) {
        if (voucherTotalFromRedemptions > 0) {
          const totalOrder = Number(order.grandTotal);
          const remaining = totalOrder - voucherTotalFromRedemptions;
          if (remaining > 0)
            tenders.push({ method: order.paymentMethod, amount: remaining });
        } else {
          const amount =
            Number(order.cashAmount) ||
            Number(order.cardAmount) ||
            Number(order.grandTotal);
          tenders.push({ method: order.paymentMethod, amount });
        }
      }

      allActivities.push({
        id: `${order.id}-sale`,
        type: 'sale',
        number: order.orderNumber,
        date: order.createdAt,
        amount: Number(order.grandTotal),
        orderId: order.id,
        orderNumber: order.orderNumber,
        locationId: order.locationId,
        posId: order.posId || order.terminalId,
        customer: order.customer,
        tenders,
        issuedVouchers: saleIssuedVouchers.map((v) => ({
          code: v.code,
          faceValue: Number(v.faceValue),
          voucherType: v.voucherType,
          expiresAt: v.expiresAt,
        })),
        items: order.items.map((oi: any) => ({
          itemId: oi.itemId,
          sku: oi.item?.sku || oi.item?.barCode || 'N/A',
          description: oi.item?.description || 'Item',
          quantity: oi.quantity,
          price: Number(oi.unitPrice),
          lineTotal: Number(oi.lineTotal),
          size: oi.item?.size?.name,
          color: oi.item?.color?.name,
        })),
      });

      // 2. Return Activity
      const returnLedgers = orderLedgers.filter(
        (l) => l.referenceType === 'POS_RETURN',
      );
      if (order.returnNumber || returnLedgers.length > 0) {
        const exchangeVoucher = orderVouchers.find(
          (v) => v.voucherType === 'EXCHANGE',
        );
        const returnDate =
          returnLedgers.length > 0
            ? returnLedgers[returnLedgers.length - 1].createdAt
            : order.updatedAt;

        const returnedItems = returnLedgers.map((l) => {
          const orderItem = order.items.find(
            (oi: any) => oi.itemId === l.itemId,
          );
          return {
            itemId: l.itemId,
            sku: orderItem?.item?.sku || orderItem?.item?.barCode || 'N/A',
            description: orderItem?.item?.description || 'Item',
            quantity: Math.abs(Number(l.qty)),
            price: orderItem ? Number(orderItem.unitPrice) : 0,
            lineTotal: orderItem
              ? Math.abs(Number(l.qty)) * Number(orderItem.unitPrice)
              : 0,
            size: orderItem?.item?.size?.name,
            color: orderItem?.item?.color?.name,
          };
        });

        allActivities.push({
          id: `${order.id}-return`,
          type: 'return',
          number: order.returnNumber || 'Return',
          date: returnDate,
          amount: exchangeVoucher
            ? Number(exchangeVoucher.faceValue)
            : returnedItems.reduce((s, i) => s + i.lineTotal, 0),
          orderId: order.id,
          orderNumber: order.orderNumber,
          locationId: order.locationId,
          posId: order.posId || order.terminalId,
          customer: order.customer,
          items: returnedItems,
          issuedVouchers: exchangeVoucher
            ? [
                {
                  code: exchangeVoucher.code,
                  faceValue: Number(exchangeVoucher.faceValue),
                  voucherType: 'EXCHANGE',
                  expiresAt: exchangeVoucher.expiresAt,
                },
              ]
            : [],
        });
      }

      // 3. Refund Activity
      const refundLedgers = orderLedgers.filter(
        (l) => l.referenceType === 'POS_REFUND',
      );
      if (order.refundNumber || refundLedgers.length > 0) {
        const refundVouchers = orderVouchers.filter(
          (v) =>
            ['REFUND', 'CREDIT'].includes(v.voucherType) &&
            !saleIssuedVouchers.some((sv) => sv.id === v.id),
        );
        const refundDate =
          refundLedgers.length > 0
            ? refundLedgers[refundLedgers.length - 1].createdAt
            : order.updatedAt;

        const refundedItems = refundLedgers.map((l) => {
          const orderItem = order.items.find(
            (oi: any) => oi.itemId === l.itemId,
          );
          return {
            itemId: l.itemId,
            sku: orderItem?.item?.sku || orderItem?.item?.barCode || 'N/A',
            description: orderItem?.item?.description || 'Item',
            quantity: Math.abs(Number(l.qty)),
            price: orderItem ? Number(orderItem.unitPrice) : 0,
            lineTotal: orderItem
              ? Math.abs(Number(l.qty)) * Number(orderItem.unitPrice)
              : 0,
            size: orderItem?.item?.size?.name,
            color: orderItem?.item?.color?.name,
          };
        });

        allActivities.push({
          id: `${order.id}-refund`,
          type: 'refund',
          number: order.refundNumber || 'Refund',
          date: refundDate,
          amount:
            refundVouchers.length > 0
              ? refundVouchers.reduce((sum, v) => sum + Number(v.faceValue), 0)
              : refundedItems.reduce((s, i) => s + i.lineTotal, 0),
          orderId: order.id,
          orderNumber: order.orderNumber,
          locationId: order.locationId,
          posId: order.posId || order.terminalId,
          customer: order.customer,
          items: refundedItems,
          issuedVouchers: refundVouchers.map((v) => ({
            code: v.code,
            faceValue: Number(v.faceValue),
            voucherType: v.voucherType,
            expiresAt: v.expiresAt,
          })),
        });
      }

      // 4. Claim Activities
      for (const claim of order.claims || []) {
        allActivities.push({
          id: claim.id,
          type: 'claim',
          number: claim.claimNumber,
          date: claim.submittedAt,
          status: claim.status,
          amount: Number(claim.claimedAmount),
          approvedAmount: Number(claim.approvedAmount),
          reasonNotes: claim.reasonNotes,
          reviewNotes: claim.reviewNotes,
          orderId: order.id,
          orderNumber: order.orderNumber,
          locationId: order.locationId,
          posId: order.posId || order.terminalId,
          customer: order.customer,
          issuedVouchers: claim.voucher
            ? [
                {
                  code: claim.voucher.code,
                  faceValue: Number(claim.voucher.faceValue),
                  voucherType: 'EXCHANGE',
                  expiresAt: (claim.voucher as any).expiresAt,
                },
              ]
            : [],
          items: claim.items.map((ci: any) => ({
            itemId: ci.itemId,
            sku: ci.item?.sku || ci.item?.barCode || 'N/A',
            description: ci.item?.description || 'Item',
            quantity: ci.claimedQty,
            approvedQty: ci.approvedQty,
            price: Number(ci.unitPaidPrice),
            lineTotal: Number(ci.claimedAmount),
            approvedAmount: Number(ci.approvedAmount),
            status: ci.itemStatus,
          })),
        });
      }
    });

    // ── Secondary filter based on date & activityType & search in memory ──
    let filteredActivities = allActivities;

    // Apply strict date range filtering on actual activity date
    if (start || end) {
      filteredActivities = filteredActivities.filter((act) => {
        const actTime = new Date(act.date).getTime();
        if (start && actTime < start.getTime()) return false;
        if (end && actTime > end.getTime()) return false;
        return true;
      });
    }

    // Apply activityType filter
    if (activityType && activityType !== 'all') {
      if (activityType === 'exchange') {
        filteredActivities = filteredActivities.filter(
          (act) =>
            act.type === 'return' ||
            (act.type === 'claim' && act.claimType === 'EXCHANGE'),
        );
      } else {
        filteredActivities = filteredActivities.filter(
          (act) => act.type === activityType,
        );
      }
    }

    // Sort chronologically by date DESC (newest activities first)
    filteredActivities.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    // Paginate in memory
    const total = filteredActivities.length;
    const paginatedActivities = filteredActivities.slice(skip, skip + limit);

    return {
      status: true,
      data: paginatedActivities,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─── Get single order ─────────────────────────────────────────────
  async getOrder(id: string) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: {
        customer: true,
        items: { include: { item: { include: { size: true, color: true } } } },
        promo: { select: { name: true, code: true } },
        coupon: { select: { code: true, description: true } },
        alliance: {
          select: {
            partnerName: true,
            code: true,
            discountPercent: true,
            maxDiscount: true,
          },
        },
        merchant: {
          select: {
            id: true,
            bankName: true,
            description: true,
            commissionRate: true,
            bankGlCode: true,
          },
        },
        voucherRedemptions: {
          select: {
            amountUsed: true,
            voucher: { select: { code: true, faceValue: true } },
          },
        },
      },
    });
    if (!order) return { status: false, message: 'Order not found' };

    let cashier: {
      name: string;
      empCode: string | null;
      email: string | null;
    } | null = null;
    if (order.cashierUserId) {
      try {
        const emp = await this.prisma.employee.findFirst({
          where: {
            OR: [{ userId: order.cashierUserId }, { id: order.cashierUserId }],
          },
          select: { id: true, employeeName: true, employeeId: true },
        });

        const user = await this.prismaMaster.user.findUnique({
          where: { id: order.cashierUserId },
          select: { id: true, firstName: true, lastName: true, email: true },
        });

        if (emp || user) {
          cashier = {
            name:
              emp?.employeeName ||
              (user ? `${user.firstName} ${user.lastName}`.trim() : 'Unknown'),
            empCode: emp?.employeeId || null,
            email: user?.email || null,
          };
        }
      } catch (err) {
        this.logger.error(`Failed to fetch cashier details: ${err.message}`);
      }
    }

    // Fetch returned quantities for this order
    const returnEntries = await this.prisma.stockLedger.findMany({
      where: {
        referenceType: { in: ['POS_RETURN', 'POS_REFUND'] },
        referenceId: id,
      },
      select: { itemId: true, qty: true, referenceType: true },
    });

    let hasReturn = false;
    let hasRefund = false;
    const returnedQtyMap = new Map<string, number>();
    for (const entry of returnEntries) {
      const current = returnedQtyMap.get(entry.itemId) || 0;
      returnedQtyMap.set(entry.itemId, current + Math.abs(Number(entry.qty)));
      if (entry.referenceType === 'POS_RETURN') hasReturn = true;
      if (entry.referenceType === 'POS_REFUND') hasRefund = true;
    }

    // Fetch claims for this order to compute claimedQty correctly
    const orderClaims = await this.prisma.posClaim.findMany({
      where: { salesOrderId: id },
      select: {
        status: true,
        items: {
          select: {
            itemId: true,
            claimedQty: true,
            approvedQty: true,
            itemStatus: true,
          },
        },
      },
    });

    // Build map of itemId -> total claimed/approved quantities across all claims
    const claimedQtyMap = new Map<
      string,
      { claimed: number; approved: number }
    >();
    for (const claim of orderClaims) {
      for (const claimItem of claim.items) {
        const current = claimedQtyMap.get(claimItem.itemId) || {
          claimed: 0,
          approved: 0,
        };
        const isRejected =
          claim.status === 'REJECTED' ||
          claim.status === 'CANCELLED' ||
          claimItem.itemStatus === 'REJECTED';
        let claimedToAdd = 0;
        if (isRejected) {
          claimedToAdd = 0;
        } else if (
          claimItem.itemStatus === 'APPROVED' ||
          claimItem.itemStatus === 'PARTIALLY_APPROVED'
        ) {
          claimedToAdd = Number(claimItem.approvedQty);
        } else {
          claimedToAdd = Number(claimItem.claimedQty);
        }
        claimedQtyMap.set(claimItem.itemId, {
          claimed: current.claimed + claimedToAdd,
          approved: current.approved + Number(claimItem.approvedQty),
        });
      }
    }

    // Attach returnedQty, claimedQty, and approvedClaimQty to each item
    const enrichedItems = order.items.map((oi) => ({
      ...oi,
      returnedQty: returnedQtyMap.get(oi.itemId) || 0,
      claimedQty: claimedQtyMap.get(oi.itemId)?.claimed || 0,
      approvedClaimQty: claimedQtyMap.get(oi.itemId)?.approved || 0,
    }));

    const tenders: {
      method: string;
      amount: number;
      slipNo?: string;
      voucherFaceValue?: number;
    }[] = [];

    // Extract voucher redemptions first
    const voucherTotalFromRedemptions = (order.voucherRedemptions || []).reduce(
      (sum: number, r: any) => sum + Number(r.amountUsed),
      0,
    );
    for (const r of (order.voucherRedemptions || []) as any[]) {
      tenders.push({
        method: 'voucher',
        amount: Number(r.amountUsed),
        slipNo: r.voucher?.code || undefined,
        voucherFaceValue: r.voucher?.faceValue
          ? Number(r.voucher.faceValue)
          : undefined,
      });
    }

    const rawCash = Number(order.cashAmount ?? 0);
    const rawCard = Number(order.cardAmount ?? 0);
    const change = Number(order.changeAmount ?? 0);
    const grandTotal = Number(order.grandTotal ?? 0);

    // Determine if voucher redemption is double-counted within card/cash amounts
    const excess = Math.max(
      0,
      rawCash + rawCard + voucherTotalFromRedemptions - (grandTotal + change),
    );

    let cash = rawCash;
    let card = rawCard;
    if (excess > 0) {
      if (card > 0) {
        card = Math.max(0, card - excess);
      } else {
        cash = Math.max(0, cash - excess);
      }
    }

    if (order.tenderType === 'split') {
      if (cash > 0) tenders.push({ method: 'cash', amount: cash });
      if (card > 0) tenders.push({ method: 'card', amount: card });
    } else if (order.paymentMethod) {
      if (order.paymentMethod === 'cash') {
        const finalCash =
          cash > 0
            ? cash
            : Math.max(0, grandTotal - voucherTotalFromRedemptions);
        if (finalCash > 0) tenders.push({ method: 'cash', amount: finalCash });
      } else if (
        order.paymentMethod === 'card' ||
        order.paymentMethod === 'bank_transfer'
      ) {
        const finalCard =
          card > 0
            ? card
            : Math.max(0, grandTotal - voucherTotalFromRedemptions);
        if (finalCard > 0)
          tenders.push({ method: order.paymentMethod, amount: finalCard });
      } else if (order.paymentMethod !== 'voucher') {
        const finalAmt = Math.max(0, grandTotal - voucherTotalFromRedemptions);
        if (finalAmt > 0)
          tenders.push({ method: order.paymentMethod, amount: finalAmt });
      }
    }

    // Fetch any vouchers issued from this order
    const creditVouchers = await this.prisma.voucher.findMany({
      where: { sourceOrderId: id, isDeleted: false },
      select: {
        code: true,
        faceValue: true,
        expiresAt: true,
        voucherType: true,
      },
    });

    return {
      status: true,
      data: {
        ...order,
        items: enrichedItems,
        tenders,
        creditVouchers,
        issuedVouchers: creditVouchers,
        hasReturn,
        hasRefund,
        cashier,
      },
    };
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

                // Generate sequential return number if not set
                let returnNumber = (order as any).returnNumber;
                if (!returnNumber) {
                    returnNumber = await this.generateReturnNumber(effectiveLocationId || '', tx);
                }

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

                    const isAllianceOrNoGlobalDisc = Math.abs(lineTotalsSum - Number(order.grandTotal)) <= 5;
                    const itemCouponDeduction = (isAllianceOrNoGlobalDisc || lineTotalsSum <= 0)
                        ? 0
                        : (lineTotal / lineTotalsSum) * orderLevelDiscount;
                    const itemShare = lineTotal - itemCouponDeduction;
                    
                    let originalPaidPerUnit = 0;
                    if (isAllianceOrNoGlobalDisc) {
                        originalPaidPerUnit = lineTotal / qty;
                    } else {
                        originalPaidPerUnit = itemShare / qty;
                    }

                    // Current item price — POS uses unitPrice from item setup
                    const currentItem = await tx.item.findUnique({
                        where: { id: returnItem.itemId },
                        select: {
                            unitPrice: true,
                            discountRate: true,
                            discountAmount: true,
                            discountStartDate: true,
                            discountEndDate: true,
                        },
                    });
                    const latestPrice = currentItem
                        ? Number(currentItem.unitPrice)
                        : originalPaidPerUnit;

                    const now = new Date();
                    const startDate = currentItem?.discountStartDate ? new Date(currentItem.discountStartDate) : null;
                    const endDate = currentItem?.discountEndDate ? new Date(currentItem.discountEndDate) : null;
                    const discountActive = currentItem && (
                        (!startDate || startDate <= now) &&
                        (!endDate || endDate >= now)
                    );

                    const discountRate = discountActive ? Number(currentItem.discountRate || 0) : 0;
                    const discountAmount = discountActive ? Number(currentItem.discountAmount || 0) : 0;

                    let effectiveDiscountPercent = 0;
                    if (discountRate > 0) {
                        effectiveDiscountPercent = discountRate;
                    } else if (discountAmount > 0 && latestPrice > 0) {
                        effectiveDiscountPercent = Math.min(100, (discountAmount / latestPrice) * 100);
                    }

                    // Current price is already tax-inclusive (retail price)
                    const currentPriceWithTax = latestPrice - (latestPrice * (effectiveDiscountPercent / 100));

                    const priceAdjusted = currentPriceWithTax < originalPaidPerUnit;
                    const refundPerUnit = Math.min(originalPaidPerUnit, currentPriceWithTax);
                    totalRefundAmount += refundPerUnit * returnItem.quantity;
                    
                    const taxPct = Number(orderItem.taxPercent || 0);
                    const taxDivisor = 1 + (taxPct / 100);
                    const wostRefund = (Number(orderItem.unitPrice) * returnItem.quantity) / taxDivisor;

                    const finalDiscountPercent = priceAdjusted ? effectiveDiscountPercent : Number(orderItem.discountPercent ?? 0);
                    const finalDiscountAmount = priceAdjusted ? wostRefund * (effectiveDiscountPercent / 100) : Number(orderItem.discountAmount ?? 0) * (returnItem.quantity / qty);
                    const finalTaxAmount = priceAdjusted ? (wostRefund - finalDiscountAmount) * (taxPct / 100) : Number(orderItem.taxAmount ?? 0) * (returnItem.quantity / qty);

                    itemRefundDetails.push({
                        orderItemId: returnItem.orderItemId,
                        itemId: returnItem.itemId,
                        quantity: returnItem.quantity,
                        unitPrice: Math.round(Number(orderItem.unitPrice) * 100) / 100,
                        discountAmount: Math.round(finalDiscountAmount * 100) / 100,
                        discountPercent: finalDiscountPercent,
                        taxAmount: Math.round(finalTaxAmount * 100) / 100,
                        taxPercent: taxPct,
                        couponDeduction: Math.round(itemCouponDeduction * (returnItem.quantity / qty) * 100) / 100,
                        originalPaidPerUnit: Math.round(originalPaidPerUnit * 100) / 100,
                        refundPerUnit: Math.round(refundPerUnit * 100) / 100,
                        priceAdjusted,
                    });

                    // Process stock movement, stock ledger, and inventory update via StockMovementService for all returns
                    if (order.locationId && order.locationId !== effectiveLocationId) {
                        const origLoc = await tx.location.findUnique({ where: { id: order.locationId }, select: { name: true } });
                        const retLoc = effectiveLocationId ? await tx.location.findUnique({ where: { id: effectiveLocationId }, select: { name: true } }) : null;
                        const origName = origLoc?.name || 'Original Branch';
                        const retName = retLoc?.name || 'Return Outlet';

                        await this.stockMovementService.executeMovement({
                            itemId: returnItem.itemId,
                            fromLocationId: order.locationId,
                            toLocationId: effectiveLocationId || undefined,
                            quantity: returnItem.quantity,
                            type: 'CROSS_LOCATION_RETURN_TRANSFER',
                            referenceType: 'POS_RETURN',
                            referenceId: order.id,
                            notes: `Automated Stock Transfer against Sales Return #${returnNumber} (Original Order #${order.orderNumber} sold at ${origName}). Physical item received at ${retName}.`,
                            userId: ctx?.userId,
                            transaction: tx,
                        }, ctx);
                    } else {
                        await this.stockMovementService.executeMovement({
                            itemId: returnItem.itemId,
                            toLocationId: effectiveLocationId || undefined,
                            quantity: returnItem.quantity,
                            type: 'POS_RETURN',
                            referenceType: 'POS_RETURN',
                            referenceId: order.id,
                            notes: `POS Return against Order #${order.orderNumber} (Return #${returnNumber})`,
                            userId: ctx?.userId,
                            transaction: tx,
                        }, ctx);
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
                const isCrossLocation = !!(order.locationId && order.locationId !== effectiveLocationId);
                let locationNarration = '';
                if (isCrossLocation && effectiveLocationId) {
                    const retLoc = await tx.location.findUnique({ where: { id: effectiveLocationId }, select: { name: true } });
                    locationNarration = ` [Cross-Location Return: Physical stock received at ${retLoc?.name || 'Return Branch'}; Stock transfer created against Order ${order.orderNumber} / SR ${returnNumber}]`;
                }

                const updatedOrder = await tx.salesOrder.update({
                    where: { id },
                    data: {
                        status: newStatus,
                        returnNumber,
                        notes: `${reason ? `Return (${newStatus}): ${reason}` : order.notes || ''}${locationNarration}`.trim(),
                    },
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

                let returnLocationName = '';
                if (effectiveLocationId && effectiveLocationId !== order.locationId) {
                    const retLoc = await tx.location.findUnique({ where: { id: effectiveLocationId }, select: { name: true } });
                    if (retLoc) returnLocationName = retLoc.name;
                }

                return { 
                    status: true, 
                    data: updatedOrder, 
                    returnRef: returnNumber,
                    refundAmount: Math.round(totalRefundAmount * 100) / 100, 
                    itemRefundDetails, 
                    exchangeVoucher: exchangeVoucher ? {
                        code: exchangeVoucher.code,
                        faceValue: exchangeVoucher.faceValue,
                        expiresAt: exchangeVoucher.expiresAt,
                    } : null,
                    isCrossLocation: !!(order.locationId && order.locationId !== effectiveLocationId),
                    originalLocationId: order.locationId,
                    returnLocationId: effectiveLocationId,
                    returnLocationName,
                    orderNumber: order.orderNumber,
                    message: exchangeVoucher 
                        ? `Return processed (${newStatus}), inventory restored, and exchange voucher ${exchangeVoucher.code} issued for Rs.${Math.round(totalRefundAmount * 100) / 100}`
                        : `Return processed (${newStatus}) and inventory restored`
                };
            });

            if (result.status) {
                this.logger.log(`[returnItems] Return processed successfully for Order #${result.orderNumber}. isCrossLocation: ${result.isCrossLocation}`);
                
                // 1. Notify original location if cross-location
                if (result.isCrossLocation && result.originalLocationId) {
                    this.notificationsService.sendPosLocationNotification({
                        locationId: result.originalLocationId,
                        title: 'Cross-Location Return Received',
                        message: `Invoice #${result.orderNumber} (originally sold at your branch) had a return processed at ${result.returnLocationName || 'another store branch'}.`,
                        category: 'pos_return',
                        priority: 'high',
                        entityType: 'SalesOrder',
                        entityId: id,
                        actionType: 'view_order',
                        actionPayload: { orderId: id, orderNumber: result.orderNumber, returnLocationId: result.returnLocationId },
                    }).catch(err => this.logger.error(`[returnItems] Failed to send original location notification: ${err.message}`));
                }

                // 2. Notify processing location
                if (result.returnLocationId) {
                    this.notificationsService.sendPosLocationNotification({
                        locationId: result.returnLocationId,
                        title: 'POS Sale Return Processed',
                        message: `Return processed for Invoice #${result.orderNumber}. Refund Amount: Rs.${result.refundAmount}.`,
                        category: 'pos_return',
                        priority: 'high',
                        entityType: 'SalesOrder',
                        entityId: id,
                        actionType: 'view_order',
                        actionPayload: { orderId: id, orderNumber: result.orderNumber },
                    }).catch(err => this.logger.error(`[returnItems] Failed to send return location notification: ${err.message}`));
                }
            }

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
  async getReturnDetails(orderId: string, type?: 'return' | 'refund') {
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
                  unitPrice: true,
                  discountRate: true,
                  discountAmount: true,
                  discountStartDate: true,
                  discountEndDate: true,
                  brand: { select: { name: true } },
                  size: { select: { name: true } },
                  color: { select: { name: true } },
                },
              },
            },
          },
          coupon: true,
          alliance: { select: { partnerName: true, code: true } },
        },
      });

      if (!order) return { status: false, message: 'Order not found' };

      // Fetch ALREADY-RETURNED quantities from stock ledger
      const returnEntries = await this.prisma.stockLedger.findMany({
        where: {
          referenceType:
            type === 'return'
              ? 'POS_RETURN'
              : type === 'refund'
                ? 'POS_REFUND'
                : { in: ['POS_RETURN', 'POS_REFUND'] },
          referenceId: orderId,
        },
        select: { itemId: true, qty: true, referenceType: true },
      });

      const returnedQtyMap = new Map<string, number>();
      const isRefundMap = new Map<string, boolean>();
      for (const entry of returnEntries) {
        const current = returnedQtyMap.get(entry.itemId) || 0;
        returnedQtyMap.set(entry.itemId, current + Math.abs(Number(entry.qty)));
        if (entry.referenceType === 'POS_REFUND') {
          isRefundMap.set(entry.itemId, true);
        }
      }

      // If no returns found, return empty
      if (returnedQtyMap.size === 0) {
        return {
          status: true,
          data: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            returnNumber: (order as any).returnNumber,
            refundNumber: (order as any).refundNumber,
            items: [],
            reason: order.notes,
            discountNotes: [],
            returnedAt: new Date().toISOString(),
          },
        };
      }

      // Calculate order-level discount per unit (coupon/voucher)
      const lineTotalsSum = order.items.reduce(
        (s, oi) => s + Number(oi.lineTotal),
        0,
      );
      const globalDiscAmt = Number(order.globalDiscountAmount || 0);
      const grandTotal = Number(order.grandTotal);

      // Build details for RETURNED items only
      const enrichedItems = order.items
        .filter((oi) => returnedQtyMap.has(oi.itemId)) // Only items that were returned
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
          const isAllianceOrNoGlobalDisc =
            Math.abs(lineTotalsSum - grandTotal) <= 5;
          const couponDeduction =
            isAllianceOrNoGlobalDisc || lineTotalsSum <= 0
              ? 0
              : (lineTotal / lineTotalsSum) * globalDiscAmt;

          // Original paid per unit (after all discounts including coupon)
          let originalPaidPerUnit = 0;
          if (isAllianceOrNoGlobalDisc) {
            originalPaidPerUnit = lineTotal / returnedQty;
          } else {
            originalPaidPerUnit =
              lineTotalsSum > 0
                ? ((lineTotal / lineTotalsSum) * grandTotal) / returnedQty
                : lineTotal / returnedQty;
          }

          // Current price is already tax-inclusive (retail price)
          const currentItem = oi.item;
          const latestPrice = currentItem
            ? Number((currentItem as any).unitPrice || 0)
            : originalPaidPerUnit;

          const now = new Date();
          const startDate = (currentItem as any)?.discountStartDate
            ? new Date((currentItem as any).discountStartDate)
            : null;
          const endDate = (currentItem as any)?.discountEndDate
            ? new Date((currentItem as any).discountEndDate)
            : null;
          const discountActive =
            currentItem &&
            (!startDate || startDate <= now) &&
            (!endDate || endDate >= now);

          const discountRate = discountActive
            ? Number((currentItem as any).discountRate || 0)
            : 0;
          const activeDiscountAmount = discountActive
            ? Number((currentItem as any).discountAmount || 0)
            : 0;

          let effectiveDiscountPercent = 0;
          if (discountRate > 0) {
            effectiveDiscountPercent = discountRate;
          } else if (activeDiscountAmount > 0 && latestPrice > 0) {
            effectiveDiscountPercent = Math.min(
              100,
              (activeDiscountAmount / latestPrice) * 100,
            );
          }

          // Current price is already tax-inclusive (retail price)
          const currentPriceWithTax =
            latestPrice - latestPrice * (effectiveDiscountPercent / 100);

          const isRefund = isRefundMap.get(oi.itemId) === true;
          // Rule: Refund should be same as paid for POS_REFUND, otherwise minimum of original paid price and current price
          const refundPerUnit = isRefund
            ? originalPaidPerUnit
            : Math.min(originalPaidPerUnit, currentPriceWithTax);
          const priceAdjusted = isRefund
            ? false
            : currentPriceWithTax < originalPaidPerUnit;

          const wostRefund = (unitPrice * returnedQty) / (1 + taxPercent / 100);
          const finalDiscountPercent = priceAdjusted
            ? effectiveDiscountPercent
            : discountPercent;
          const finalDiscountAmount = priceAdjusted
            ? wostRefund * (effectiveDiscountPercent / 100)
            : discountAmount;
          const finalTaxAmount = priceAdjusted
            ? (wostRefund - finalDiscountAmount) * (taxPercent / 100)
            : taxAmount;

          return {
            orderItemId: oi.id,
            itemId: oi.itemId,
            item: oi.item,
            quantity: orderedQty,
            returnableQty: returnedQty, // This is the RETURNED qty for history
            unitPrice,
            discountAmount: finalDiscountAmount,
            discountPercent: finalDiscountPercent,
            taxAmount: finalTaxAmount,
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
      if (
        order.coupon &&
        (order.coupon.discountType === 'voucher' ||
          order.coupon.discountType === 'fixed')
      ) {
        discountNotes.push(
          `${order.coupon.code} - ${order.coupon.description || 'Voucher'}`,
        );
      }
      if ((order as any).alliance) {
        discountNotes.push(
          `Alliance: ${(order as any).alliance.partnerName || (order as any).alliance.code}`,
        );
      }

      const exchangeVoucher =
        type === 'refund'
          ? null
          : await this.prisma.voucher.findFirst({
              where: {
                sourceOrderId: order.id,
                voucherType: 'EXCHANGE',
                isDeleted: false,
              },
              select: { code: true, faceValue: true, expiresAt: true },
              orderBy: { createdAt: 'desc' },
            });

      return {
        status: true,
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          returnNumber: (order as any).returnNumber,
          refundNumber: (order as any).refundNumber,
          items: enrichedItems,
          reason: order.notes,
          discountNotes,
          exchangeVoucher: exchangeVoucher || undefined,
          returnedAt: new Date().toISOString(),
        },
      };
    } catch (error: any) {
      return { status: false, message: error.message };
    }
  }

  // ─── Void order ───────────────────────────────────────────────────
  async voidOrder(
    id: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
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
          await this.stockLedgerService.createEntry(
            {
              itemId: item.itemId,
              warehouseId: warehouse.id,
              locationId: order.locationId,
              qty: item.quantity, // Positive to restore stock
              movementType: MovementType.INBOUND,
              referenceType: 'POS_VOID',
              referenceId: order.id,
            },
            tx,
          );

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
              },
            });
          }
        }

        // ── Restore Voucher / Coupon (for voided orders) ─────────
        if (order.couponId && !order.isVoucherRestored) {
          const coupon = await tx.couponCode.findUnique({
            where: { id: order.couponId },
          });
          if (
            coupon &&
            (coupon.discountType === 'voucher' ||
              coupon.discountType === 'fixed')
          ) {
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

        return {
          status: true,
          data: voidedOrder,
          message: 'Order voided and inventory restored',
        };
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
        exchangeLocationId?: string,
        ctx?: { userId?: string; ipAddress?: string; userAgent?: string }
    ) {
        try {
            const result = await this.prisma.$transaction(async (tx) => {
                const order = await tx.salesOrder.findUnique({ where: { id }, include: { items: true, coupon: true } });
                if (!order) throw new Error('Order not found');
                if (order.status === 'voided') throw new Error('Order is already voided');

                const warehouse = await tx.warehouse.findFirst({ where: { isActive: true, isDeleted: false } });
                if (!warehouse) throw new Error('No active warehouse found');

                const effectiveLocationId = exchangeLocationId || order.locationId;
                const isCrossLocation = !!(order.locationId && order.locationId !== effectiveLocationId);

                // ── Restore returned items ──────────────────────────────
                for (const ri of returnedItems) {
                    const orderItem = order.items.find(i => i.id === ri.orderItemId);
                    if (!orderItem || ri.quantity > orderItem.quantity) continue;

                    await this.stockLedgerService.createEntry({
                        itemId: ri.itemId, warehouseId: warehouse.id, locationId: effectiveLocationId,
                        qty: ri.quantity, movementType: MovementType.INBOUND,
                        referenceType: 'POS_EXCHANGE_IN', referenceId: order.id,
                    }, tx);

                    const existing = await tx.inventoryItem.findFirst({
                        where: { itemId: ri.itemId, locationId: effectiveLocationId, status: 'AVAILABLE' },
                    });
                    if (existing) {
                        await tx.inventoryItem.update({ where: { id: existing.id }, data: { quantity: { increment: ri.quantity } } });
                    } else {
                        await tx.inventoryItem.create({ data: { itemId: ri.itemId, locationId: effectiveLocationId, warehouseId: warehouse.id, quantity: ri.quantity, status: 'AVAILABLE' } });
                    }

                    if (isCrossLocation) {
                        await tx.stockMovement.create({
                            data: {
                                movementNo: `MV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                                itemId: ri.itemId,
                                fromLocationId: order.locationId,
                                toLocationId: effectiveLocationId,
                                quantity: ri.quantity,
                                type: 'CROSS_LOCATION_EXCHANGE_TRANSFER',
                                referenceType: 'POS_EXCHANGE',
                                referenceId: order.id,
                                notes: `Automated stock transfer for cross-location exchange of Order ${order.orderNumber}`,
                                createdById: ctx?.userId || null,
                            },
                        });
                    }
                }

                // ── Deduct new items ────────────────────────────────────
                for (const ni of newItems) {
                    await this.stockLedgerService.createEntry({
                        itemId: ni.itemId, warehouseId: warehouse.id, locationId: effectiveLocationId,
                        qty: -ni.quantity, movementType: MovementType.OUTBOUND,
                        referenceType: 'POS_EXCHANGE_OUT', referenceId: order.id,
                    }, tx);

                    const existing = await tx.inventoryItem.findFirst({
                        where: { itemId: ni.itemId, locationId: effectiveLocationId, status: 'AVAILABLE' },
                    });
                    if (existing) {
                        await tx.inventoryItem.update({ where: { id: existing.id }, data: { quantity: { decrement: ni.quantity } } });
                    } else {
                        await tx.inventoryItem.create({ data: { itemId: ni.itemId, locationId: effectiveLocationId, warehouseId: warehouse.id, quantity: -ni.quantity, status: 'AVAILABLE' } });
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
                                    locationId: effectiveLocationId,
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

                let exchangeLocationName = '';
                if (isCrossLocation && effectiveLocationId) {
                    const exLoc = await tx.location.findUnique({ where: { id: effectiveLocationId }, select: { name: true } });
                    if (exLoc) exchangeLocationName = exLoc.name;
                }

                return { 
                    status: true, 
                    data: { ...updatedOrder, difference }, 
                    message: 'Exchange processed successfully',
                    isCrossLocation,
                    originalLocationId: order.locationId,
                    exchangeLocationId: effectiveLocationId,
                    exchangeLocationName,
                    orderNumber: order.orderNumber,
                };
            });

            if (result.status && result.isCrossLocation && result.originalLocationId) {
                runInBackground(
                    'Notify Original Location of Cross-Location Exchange',
                    this.notificationsService.sendPosLocationNotification({
                        locationId: result.originalLocationId,
                        title: 'Cross-Location Exchange Processed',
                        message: `Invoice #${result.orderNumber} (originally sold at your branch) had an exchange processed at ${result.exchangeLocationName || 'another store branch'}.`,
                        category: 'pos_exchange',
                        priority: 'high',
                        entityType: 'SalesOrder',
                        entityId: id,
                        actionType: 'view_order',
                        actionPayload: { orderId: id, orderNumber: result.orderNumber, exchangeLocationId: result.exchangeLocationId },
                    })
                );
            }

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
  async refundOnly(
    id: string,
    refundAmount: number,
    items?: { orderItemId: string; itemId: string; quantity: number }[],
    reason?: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const order = await this.prisma.salesOrder.findUnique({
        where: { id },
        include: {
          items: {
            include: {
              item: true,
            },
          },
        },
      });
      if (!order) throw new Error('Order not found');
      if (order.status === 'voided') throw new Error('Order is already voided');
      if (refundAmount <= 0)
        throw new Error('Refund amount must be greater than 0');
      if (refundAmount > Number(order.grandTotal))
        throw new Error('Refund amount exceeds order total');

      // Use transaction to ensure inventory is restored atomically
      const result = await this.prisma.$transaction(async (tx) => {
        // Find active warehouse
        const warehouse = await tx.warehouse.findFirst({
          where: { isActive: true, isDeleted: false },
        });
        if (!warehouse) throw new Error('No active warehouse found');

        const effectiveLocationId = order.locationId;

        // Generate sequential refund number if not set
        let refundNumber = (order as any).refundNumber;
        if (!refundNumber) {
          refundNumber = await this.generateRefundNumber(
            effectiveLocationId || '',
            tx,
          );
        }

        // Fetch ALREADY-RETURNED quantities from stock ledger (to determine status later)
        const previousReturns = await tx.stockLedger.findMany({
          where: {
            referenceType: { in: ['POS_RETURN', 'POS_REFUND'] },
            referenceId: id,
          },
          select: { itemId: true, qty: true },
        });
        const alreadyReturnedMap = new Map<string, number>();
        for (const pr of previousReturns) {
          const current = alreadyReturnedMap.get(pr.itemId) || 0;
          alreadyReturnedMap.set(pr.itemId, current + Math.abs(Number(pr.qty)));
        }

        // ── Restore Inventory for specified items (or all items) ──
        let processingItems = items;
        if (!processingItems || processingItems.length === 0) {
          // Fallback to all items (though not recommended)
          processingItems = order.items.map((oi) => ({
            orderItemId: oi.id,
            itemId: oi.itemId,
            quantity: oi.quantity,
          }));
        }

        for (const orderItem of processingItems) {
          if (!orderItem.itemId) continue;

          // Update returned qty map
          const current = alreadyReturnedMap.get(orderItem.itemId) || 0;
          alreadyReturnedMap.set(
            orderItem.itemId,
            current + orderItem.quantity,
          );

          // Create stock ledger entry for refund
          await this.stockLedgerService.createEntry(
            {
              itemId: orderItem.itemId,
              warehouseId: warehouse.id,
              locationId: effectiveLocationId,
              qty: orderItem.quantity,
              movementType: MovementType.INBOUND,
              referenceType: 'POS_REFUND',
              referenceId: id,
            },
            tx,
          );

          // Update or create inventory item
          const existing = await tx.inventoryItem.findFirst({
            where: {
              itemId: orderItem.itemId,
              locationId: effectiveLocationId,
              status: 'AVAILABLE',
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

        // ── Determine if ALL items are now fully returned/refunded ──
        const allItemsReturned = order.items.every((oi) => {
          const totalReturned = alreadyReturnedMap.get(oi.itemId) || 0;
          return totalReturned >= Number(oi.quantity);
        });
        const newStatus = allItemsReturned ? 'refunded' : 'partially_returned';

        // ── Generate REFUND Voucher (record-only, cash refunded to customer) ──
        let refundVoucher: any = null;
        if (refundAmount > 0) {
          const voucherResult = await this.voucherService.issueRefundVoucher(
            {
              faceValue: Math.round(refundAmount * 100) / 100,
              sourceOrderId: id,
              issuedByLocationId: order.locationId || '',
              issuedByUserId: ctx?.userId,
              customerId: order.customerId || undefined,
            },
            ctx,
          );

          if (voucherResult.status && voucherResult.data) {
            refundVoucher = voucherResult.data;
          }
        }

        const updatedOrder = await tx.salesOrder.update({
          where: { id },
          data: {
            status: newStatus,
            refundNumber,
            notes: refundVoucher
              ? `Cash refunded Rs.${refundAmount} (${newStatus}) - Refund voucher ${refundVoucher.code} (Record only) - Inventory restored${reason ? `: ${reason}` : ''}`
              : reason
                ? `Cash refund Rs.${refundAmount} (${newStatus}) - Inventory restored: ${reason}`
                : `Cash refund Rs.${refundAmount} (${newStatus}) - Inventory restored`,
          },
        });

        return { updatedOrder, refundVoucher, refundNumber };
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
          newValues: JSON.stringify({
            refundAmount,
            reason,
            voucherCode: result.refundVoucher?.code,
          }),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return {
        status: true,
        data: result.updatedOrder,
        refundRef: result.refundNumber,
        returnRef: result.refundNumber,
        refundVoucher: result.refundVoucher
          ? {
              code: result.refundVoucher.code,
              faceValue: result.refundVoucher.faceValue,
              voucherType: 'REFUND',
            }
          : null,
        message: result.refundVoucher
          ? `Cash refunded Rs.${refundAmount} - Refund voucher ${result.refundVoucher.code} issued for record - Inventory restored`
          : `Cash refund of Rs.${refundAmount} processed and inventory restored`,
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
  async holdOrder(
    dto: CreateSalesOrderDto,
    cashierUserId?: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const now = new Date();
      let holdExpiresAt: Date;

      if (dto.holdExpiresAt) {
        holdExpiresAt = new Date(dto.holdExpiresAt);
      } else {
        const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
        const midnight = new Date(now);
        midnight.setHours(23, 59, 59, 999);
        holdExpiresAt = oneHourLater < midnight ? oneHourLater : midnight;
      }

      const itemsData = dto.items.map((lineItem) => {
        const subtotal = lineItem.unitPrice * lineItem.quantity;
        const discPct =
          lineItem.overrideDiscountPercent ?? lineItem.discountPercent ?? 0;
        const discAmt = Math.round(subtotal * (discPct / 100));
        const afterDisc = subtotal - discAmt;
        const taxPct = lineItem.taxPercent || 0;
        const taxAmt = Math.round(afterDisc * (taxPct / 100));
        const lineTotal = Math.round(afterDisc + taxAmt);
        return {
          itemId: lineItem.itemId,
          quantity: lineItem.quantity,
          unitPrice: lineItem.unitPrice,
          discountPercent: discPct,
          discountAmount: discAmt,
          overrideDiscountPercent:
            lineItem.overrideDiscountPercent || undefined,
          overrideDiscountNote: lineItem.overrideDiscountNote || undefined,
          taxPercent: taxPct,
          taxAmount: taxAmt,
          lineTotal: Math.max(0, lineTotal),
        };
      });

      const subtotal = itemsData.reduce(
        (acc, i) => acc + i.unitPrice * i.quantity,
        0,
      );
      const totalDiscount = itemsData.reduce(
        (acc, i) => acc + i.discountAmount,
        0,
      );
      const totalTax = itemsData.reduce((acc, i) => acc + i.taxAmount, 0);
      const grandTotal = Math.max(
        0,
        Math.round(subtotal - totalDiscount + totalTax),
      );

      const result = await this.prisma.$transaction(async (tx) => {
        const locationId = dto.locationId;
        if (!locationId) {
          throw new Error('Location ID is required to hold an order.');
        }

        // Generate a temporary unique order number for hold that does not consume sequence numbers
        const location = await tx.location.findUnique({
          where: { id: locationId },
          select: { name: true, shortCode: true },
        });
        if (!location) {
          throw new Error(`Location not found for ID: ${locationId}`);
        }
        let shortCode = location.shortCode?.trim();
        if (!shortCode) {
          shortCode = location.name
            .split(/[\s\-_]+/)
            .map((word) => word.replace(/[^a-zA-Z0-9]/g, ''))
            .filter((word) => word.length > 0)
            .map((word) => word[0].toUpperCase())
            .join('');
        }
        if (!shortCode) {
          shortCode = 'LOC';
        }
        const orderNumber = `HOLD-${shortCode}-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

        const order = await tx.salesOrder.create({
          data: {
            orderNumber,
            posId: dto.posId,
            terminalId: dto.terminalId,
            locationId: dto.locationId,
            customerId: dto.customerId,
            cashierUserId,
            createdById: ctx?.userId || cashierUserId || null,
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
            items: {
              include: {
                item: {
                  select: {
                    description: true,
                    sku: true,
                    barCode: true,
                    size: { select: { name: true } },
                  },
                },
              },
            },
          },
        });

        // ── Deduct stock immediately on hold ────────────────────
        const warehouse = await tx.warehouse.findFirst({
          where: { isActive: true, isDeleted: false },
        });
        if (warehouse) {
          for (const item of itemsData) {
            await this.stockLedgerService.createEntry(
              {
                itemId: item.itemId,
                warehouseId: warehouse.id,
                locationId: dto.locationId,
                qty: -item.quantity,
                movementType: MovementType.OUTBOUND,
                referenceType: 'POS_HOLD',
                referenceId: order.id,
              },
              tx,
            );

            const existing = await tx.inventoryItem.findFirst({
              where: {
                itemId: item.itemId,
                locationId: dto.locationId,
                status: 'AVAILABLE',
              },
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
        message: `Order ${result.orderNumber} placed on hold until ${holdExpiresAt.toLocaleTimeString()}`,
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
    if (order.status !== 'hold')
      return { status: false, message: 'Order is not on hold' };

    const now = new Date();
    if (order.holdExpiresAt && order.holdExpiresAt < now) {
      // Auto-clear expired hold
      await this.prisma.salesOrder.update({
        where: { id },
        data: { status: 'hold_expired' },
      });
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
        items: {
          include: {
            item: {
              select: {
                description: true,
                sku: true,
                barCode: true,
                size: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    return { status: true, data: orders };
  }

  // ─── Cancel a hold order (restore stock) ─────────────────────────
  async cancelHoldOrder(
    id: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const order = await tx.salesOrder.findUnique({
          where: { id },
          include: { items: true },
        });

        if (!order) throw new Error('Hold order not found');
        if (order.status !== 'hold') throw new Error('Order is not on hold');

        // Restore stock for each item
        const warehouse = await tx.warehouse.findFirst({
          where: { isActive: true, isDeleted: false },
        });
        if (warehouse) {
          for (const item of order.items) {
            await this.stockLedgerService.createEntry(
              {
                itemId: item.itemId,
                warehouseId: warehouse.id,
                locationId: order.locationId,
                qty: item.quantity,
                movementType: MovementType.INBOUND,
                referenceType: 'POS_HOLD_CANCELLED',
                referenceId: order.id,
              },
              tx,
            );

            const existing = await tx.inventoryItem.findFirst({
              where: {
                itemId: item.itemId,
                locationId: order.locationId,
                status: 'AVAILABLE',
              },
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

    const warehouse = await this.prisma.warehouse.findFirst({
      where: { isActive: true, isDeleted: false },
    });

    for (const order of expiredOrders) {
      await this.prisma.$transaction(async (tx) => {
        // Restore stock for each item
        if (warehouse) {
          for (const item of order.items) {
            await this.stockLedgerService.createEntry(
              {
                itemId: item.itemId,
                warehouseId: warehouse.id,
                locationId: order.locationId,
                qty: item.quantity,
                movementType: MovementType.INBOUND,
                referenceType: 'POS_HOLD_EXPIRED',
                referenceId: order.id,
              },
              tx,
            );

            const existing = await tx.inventoryItem.findFirst({
              where: {
                itemId: item.itemId,
                locationId: order.locationId,
                status: 'AVAILABLE',
              },
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
      const startDate = item.discountStartDate
        ? new Date(item.discountStartDate)
        : null;
      const endDate = item.discountEndDate
        ? new Date(item.discountEndDate)
        : null;
      const discountActive =
        (!startDate || startDate <= now) && (!endDate || endDate >= now);

      const discountRate = discountActive ? Number(item.discountRate || 0) : 0;
      const discountAmount = discountActive
        ? Number(item.discountAmount || 0)
        : 0;

      // Effective discount percent for the cart:
      // If discountRate (%) is set, use it directly.
      // If only discountAmount (fixed PKR) is set, convert to percent of unit price.
      let effectiveDiscountPercent = 0;
      if (discountRate > 0) {
        effectiveDiscountPercent = discountRate;
      } else if (discountAmount > 0 && latestPrice > 0) {
        effectiveDiscountPercent = Math.min(
          100,
          (discountAmount / latestPrice) * 100,
        );
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
        effectiveDiscountPercent:
          Math.round(effectiveDiscountPercent * 100) / 100,
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
      groupBy?:
        | 'day'
        | 'week'
        | 'month'
        | 'cashier'
        | 'payment_method'
        | 'item';
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
    // const userPerms = role?.permissions.map((p: any) => p.permission.name) || [];
    // const canViewAll =
    //     userPerms.includes('*') ||
    //     userPerms.includes('pos.sales.history.view_all') ||
    //     ['super_admin', 'admin'].includes(role?.name?.toLowerCase() || '');

    // ── Build where clause ────────────────────────────────────────
    const where: any = {
      status: {
        in: [
          'completed',
          'partially_returned',
          'refunded',
          'exchanged',
          'voided',
        ],
      },
    };

    // if (!canViewAll) {
    //     where.cashierUserId = user.id;
    // }

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
    const trendMap = new Map<
      string,
      { label: string; sales: number; orders: number; returns: number }
    >();

    for (const o of trendOrders) {
      const d = new Date(o.createdAt);
      let key: string;
      let label: string;

      if (groupBy === 'month') {
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        label = d.toLocaleDateString('en-PK', {
          year: 'numeric',
          month: 'short',
        });
      } else if (groupBy === 'week') {
        // ISO week
        const startOfWeek = new Date(d);
        startOfWeek.setDate(d.getDate() - d.getDay());
        key = startOfWeek.toISOString().split('T')[0];
        label = `Wk ${startOfWeek.toLocaleDateString('en-PK', { month: 'short', day: 'numeric' })}`;
      } else {
        key = d.toISOString().split('T')[0];
        label = d.toLocaleDateString('en-PK', {
          month: 'short',
          day: 'numeric',
        });
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

    const cashierUserIds = cashierPerf
      .map((c) => c.cashierUserId)
      .filter(Boolean) as string[];
    const cashierUsers = cashierUserIds.length
      ? await this.prismaMaster.user.findMany({
          where: { id: { in: cashierUserIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];

    const cashierEmployees = cashierUserIds.length
      ? await this.prisma.employee.findMany({
          where: {
            OR: [
              { id: { in: cashierUserIds } },
              { userId: { in: cashierUserIds } },
            ],
          },
          select: {
            id: true,
            userId: true,
            employeeName: true,
            officialEmail: true,
            personalEmail: true,
          },
        })
      : [];

    const cashierNameMap = new Map<string, string>();
    const cashierEmailMap = new Map<string, string>();

    for (const u of cashierUsers) {
      cashierNameMap.set(u.id, `${u.firstName} ${u.lastName}`);
      if (u.email) cashierEmailMap.set(u.id, u.email);
    }
    for (const emp of cashierEmployees) {
      cashierNameMap.set(emp.id, emp.employeeName);
      const email = emp.officialEmail || emp.personalEmail;
      if (email) cashierEmailMap.set(emp.id, email);
      if (emp.userId) {
        cashierNameMap.set(emp.userId, emp.employeeName);
        if (email) cashierEmailMap.set(emp.userId, email);
      }
    }

    const cashierStats = cashierPerf.map((row) => {
      const name = cashierNameMap.get(row.cashierUserId || '') || 'Unknown';
      const email = cashierEmailMap.get(row.cashierUserId || '') || '-';
      return {
        cashierUserId: row.cashierUserId,
        name,
        email,
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
            item: {
              select: {
                description: true,
                sku: true,
                barCode: true,
                size: { select: { name: true } },
              },
            },
          },
        },
        promo: { select: { name: true, code: true } },
        coupon: { select: { code: true } },
        alliance: { select: { partnerName: true, code: true } },
      },
    });

    // Enrich orders with cashier names
    const orderCashierIds = [
      ...new Set(rawOrders.map((o) => o.cashierUserId).filter(Boolean)),
    ] as string[];
    const orderCashierUsers = orderCashierIds.length
      ? await this.prismaMaster.user.findMany({
          where: { id: { in: orderCashierIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];

    const orderEmployees = orderCashierIds.length
      ? await this.prisma.employee.findMany({
          where: {
            OR: [
              { id: { in: orderCashierIds } },
              { userId: { in: orderCashierIds } },
            ],
          },
          select: { id: true, userId: true, employeeName: true },
        })
      : [];

    const orderCashierMap = new Map<string, string>();
    for (const u of orderCashierUsers) {
      orderCashierMap.set(u.id, `${u.firstName} ${u.lastName}`);
    }
    for (const emp of orderEmployees) {
      orderCashierMap.set(emp.id, emp.employeeName);
      if (emp.userId) {
        orderCashierMap.set(emp.userId, emp.employeeName);
      }
    }

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
          totalDiscountGiven: Number(
            discountBreakdown._sum.discountAmount || 0,
          ),
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
    tenders: {
      method: string;
      amount: number;
      cardLast4?: string;
      slipNo?: string;
    }[],
    merchantId?: string,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const order = await tx.salesOrder.findUnique({
          where: { id },
          include: { voucherRedemptions: { include: { voucher: true } } },
        });
        if (!order) throw new Error('Order not found');
        if (
          order.status === 'voided' ||
          order.status === 'exchanged' ||
          order.status === 'refunded' ||
          order.status === 'returned' ||
          order.status === 'partially_returned'
        ) {
          throw new Error(
            'Cannot update tender on a voided, returned, refunded, or exchanged order',
          );
        }

        // ── Check if any claim exists for this order ──
        const existingClaims = await tx.posClaim.findMany({
          where: { salesOrderId: id },
        });
        if (existingClaims.length > 0) {
          throw new Error(
            'Cannot update tender because a claim has been created for this order',
          );
        }

        // ── Check if any stock ledger returns/refunds exist ──
        const returnEntries = await tx.stockLedger.findMany({
          where: {
            referenceId: id,
            referenceType: { in: ['POS_RETURN', 'POS_REFUND'] },
          },
        });
        if (returnEntries.length > 0) {
          throw new Error(
            'Cannot update tender because a return or refund has been created for this order',
          );
        }

        // ── Check if any voucher was used on this order ──
        const voucherAmountUsed = Number(order.voucherAmount ?? 0);
        const voucherRedemptionsCount = (order.voucherRedemptions || []).length;
        if (voucherAmountUsed > 0 || voucherRedemptionsCount > 0) {
          throw new Error(
            'Cannot update tender because a voucher was used for payment on this order',
          );
        }

        // ── Check if any voucher was issued from this order ──
        const issuedVouchers = await tx.voucher.findMany({
          where: { sourceOrderId: id, isDeleted: false },
        });
        if (issuedVouchers.length > 0) {
          throw new Error(
            'Cannot update tender because a voucher has been issued from this order',
          );
        }

        // ── Check alliance order tender constraints ──
        if (order.allianceId) {
          const originalCash = Number(order.cashAmount ?? 0);
          const originalCard = Number(order.cardAmount ?? 0);
          const originalVoucher = (order.voucherRedemptions || []).reduce(
            (s, r) => s + Number(r.amountUsed),
            0,
          );

          const newCash = tenders
            .filter((t) => t.method === 'cash')
            .reduce((s, t) => s + Number(t.amount), 0);
          const newCard = tenders
            .filter((t) => t.method === 'card' || t.method === 'bank_transfer')
            .reduce((s, t) => s + Number(t.amount), 0);
          const newVoucher = tenders
            .filter((t) => t.method === 'voucher')
            .reduce((s, t) => s + Number(t.amount), 0);

          if (
            originalCash !== newCash ||
            originalCard !== newCard ||
            originalVoucher !== newVoucher
          ) {
            throw new Error(
              'Tender amounts cannot be modified for Alliance orders. Only the merchant terminal can be updated.',
            );
          }
        }

        // ── Check voucher payment changes ──
        const originalVouchers = (order.voucherRedemptions || [])
          .map((vr) => ({
            code: vr.voucher?.code || '',
            amount: Number(vr.amountUsed),
          }))
          .sort((a, b) => a.code.localeCompare(b.code));

        const newVouchers = tenders
          .filter((t) => t.method === 'voucher')
          .map((t) => ({
            code: t.slipNo || '',
            amount: Number(t.amount),
          }))
          .sort((a, b) => a.code.localeCompare(b.code));

        const vouchersMatch =
          originalVouchers.length === newVouchers.length &&
          originalVouchers.every(
            (v, i) =>
              v.code === newVouchers[i].code &&
              v.amount === newVouchers[i].amount,
          );

        if (!vouchersMatch) {
          throw new Error('Modifying applied vouchers is not allowed');
        }

        // ── Update notes for card/bank transfer details ──
        let notes = order.notes || '';
        const cardTender = tenders.find(
          (t) =>
            (t.method === 'card' || t.method === 'bank_transfer') &&
            t.cardLast4,
        );
        if (cardTender) {
          if (order.allianceId) {
            const alliancePrefix = '[Alliance]';
            const parts: string[] = [];
            const cardholderMatch = notes.match(/Cardholder:\s*([^|\]]+)/i);
            if (cardholderMatch) {
              parts.push(`Cardholder: ${cardholderMatch[1].trim()}`);
            }
            parts.push(`Card: ****${cardTender.cardLast4}`);
            if (cardTender.slipNo) {
              parts.push(`Slip: ${cardTender.slipNo}`);
            }
            const allianceNote = `${alliancePrefix} ${parts.join(' | ')}`;

            notes = notes.replace(/\[Alliance\].*?($|\n)/, '').trim();
            notes = notes ? `${notes}\n${allianceNote}` : allianceNote;
          } else {
            const cardNote = `Card: ****${cardTender.cardLast4}${cardTender.slipNo ? ` | Slip: ${cardTender.slipNo}` : ''}`;
            notes = notes.replace(/Card:.*?($|\n)/, '').trim();
            notes = notes ? `${notes}\n${cardNote}` : cardNote;
          }
        }

        // ── Sync VoucherRedemption records ──
        const originalRedemptions = order.voucherRedemptions || [];
        const newVoucherTenders = tenders.filter((t) => t.method === 'voucher');

        // 1. Remove removed vouchers
        const redemptionsToRemove = originalRedemptions.filter(
          (or) =>
            !newVoucherTenders.some((nt) => nt.slipNo === or.voucher?.code),
        );
        for (const red of redemptionsToRemove) {
          await tx.voucher.update({
            where: { id: red.voucherId },
            data: { isRedeemed: false, isActive: true },
          });
          await tx.voucherRedemption.delete({
            where: { id: red.id },
          });
          await tx.voucherTransaction.deleteMany({
            where: {
              orderId: id,
              voucherId: red.voucherId,
              action: 'REDEEMED',
            },
          });
        }

        // 2. Redeem new vouchers
        const vouchersToAdd = newVoucherTenders.filter(
          (nt) =>
            !originalRedemptions.some((or) => or.voucher?.code === nt.slipNo),
        );
        if (vouchersToAdd.length > 0) {
          const voucherCodes = vouchersToAdd
            .map((v) => v.slipNo)
            .filter(Boolean) as string[];
          const dbVouchers = await tx.voucher.findMany({
            where: { code: { in: voucherCodes } },
          });

          const toRedeem = vouchersToAdd.map((v) => {
            const dbV = dbVouchers.find((x) => x.code === v.slipNo);
            if (!dbV) {
              throw new Error(`Voucher ${v.slipNo} not found in database`);
            }
            return { voucherId: dbV.id, amountUsed: v.amount };
          });

          await this.voucherService.redeemVouchers(
            toRedeem,
            order.id,
            order.locationId || '',
            tx,
            ctx,
          );
        }

        const totalPaid = tenders.reduce((acc, t) => acc + Number(t.amount), 0);
        const tenderMethods = [...new Set(tenders.map((t) => t.method))];
        const paymentMethod =
          tenderMethods.length === 1 ? tenderMethods[0] : 'split';
        const cashAmount = tenders
          .filter((t) => t.method === 'cash')
          .reduce((a, t) => a + Number(t.amount), 0);
        const voucherAmount = tenders
          .filter((t) => t.method === 'voucher')
          .reduce((a, t) => a + Number(t.amount), 0);
        const cardAmount = tenders
          .filter(
            (t) =>
              t.method !== 'cash' &&
              t.method !== 'voucher' &&
              t.method !== 'credit_account',
          )
          .reduce((a, t) => a + Number(t.amount), 0);
        const grandTotal = Number(order.grandTotal);

        const totalPaidRounded = Math.round(totalPaid * 100) / 100;
        const grandTotalRounded = Math.round(grandTotal * 100) / 100;

        if (totalPaidRounded > grandTotalRounded + 0.01) {
          throw new Error('Total tender amount cannot exceed the order bill total');
        }

        const changeAmount = Math.max(0, totalPaidRounded - grandTotalRounded);

        let paymentStatus: string;
        if (totalPaidRounded >= grandTotalRounded) {
          paymentStatus = 'paid';
        } else if (totalPaidRounded > 0) {
          paymentStatus = 'partial';
        } else {
          paymentStatus = 'unpaid';
        }

        return tx.salesOrder.update({
          where: { id },
          data: {
            paymentMethod,
            tenderType: paymentMethod,
            cashAmount: cashAmount || undefined,
            cardAmount: cardAmount || undefined,
            voucherAmount: voucherAmount || undefined,
            changeAmount: changeAmount || undefined,
            paymentStatus,
            merchantId: merchantId || undefined,
            notes: notes || undefined,
          },
        });
      });

      runInBackground(
        'Update Tender',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'pos-sales',
          entity: 'SalesOrder',
          entityId: id,
          description: `Updated tender for order ${updated.orderNumber}`,
          newValues: JSON.stringify({ tenders }),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return {
        status: true,
        data: updated,
        message: 'Tender updated successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message };
    }
  }

  // ─── List available cashiers for a location ─────────────────────
  async listCashiers(locationId: string) {
    // 1. Find all active employees at this location
    const employees = await this.prisma.employee.findMany({
      where: { locationId, status: 'active' },
      select: {
        id: true,
        employeeName: true,
        employeeId: true,
        userId: true,
        officialEmail: true,
        personalEmail: true,
      },
    });

    if (employees.length === 0) return { status: true, data: [] };

    const employeeIds = employees.map((e) => e.id);
    const userIdsFromEmployees = employees
      .map((e) => e.userId)
      .filter(Boolean) as string[];

    // 2. Find users linked to these employees (by both directions)
    const users = await this.prismaMaster.user.findMany({
      where: {
        OR: [
          { id: { in: userIdsFromEmployees } },
          { employeeId: { in: employeeIds } },
        ],
        status: 'active',
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        employeeId: true,
      },
    });

    // 3. Merge data starting from employees as primary source
    const cashierList = employees.map((emp) => {
      const user = users.find(
        (u) => u.employeeId === emp.id || u.id === emp.userId,
      );
      return {
        userId: user?.id || emp.userId || emp.id,
        employeeId: emp.id,
        name:
          emp.employeeName ||
          (user ? `${user.firstName} ${user.lastName}` : 'Unknown'),
        email: user?.email || emp.officialEmail || emp.personalEmail || null,
        empCode: emp.employeeId,
      };
    });

    // Deduplicate by userId
    const uniqueCashiers = Array.from(
      new Map(cashierList.map((c) => [c.userId, c])).values(),
    );

    return { status: true, data: uniqueCashiers };
  }

  // ─── Net Sales Summary Report ──────────────────────────────────
  async getNetSalesSummaryReport(options: {
    locationId: string;
    startDate?: string;
    endDate?: string;
    cashierUserId?: string;
    summaryOnly?: boolean;
    showSalesperson?: boolean;
    showYear?: boolean;
    showMonth?: boolean;
    showDay?: boolean;
    showDocument?: boolean;
    showBrand?: boolean;
    showDivision?: boolean;
    showSalesTax?: boolean;
    showCategory?: boolean;
    showGender?: boolean;
    showSilhouette?: boolean;
    showArticle?: boolean;
    showVariant?: boolean;
  }) {
    const {
      locationId,
      startDate: startStr,
      endDate: endStr,
      cashierUserId,
    } = options;
    if (!locationId) {
      throw new BadRequestException('locationId is required');
    }

    const sSalesperson = options.showSalesperson === true;
    const sYear = options.showYear === true;
    const sMonth = options.showMonth === true;
    const sDay = options.showDay === true;
    const sDocument = options.showDocument === true;

    const sBrand = options.showBrand !== false;
    const sDivision = options.showDivision !== false;
    const sSalesTax = options.showSalesTax === true;
    const sCategory = options.showCategory !== false;
    const sGender = options.showGender !== false;
    const sSilhouette = options.showSilhouette !== false;
    const sArticle = options.showArticle !== false;
    const sVariant =
      options.showVariant !== undefined
        ? options.showVariant
        : !options.summaryOnly;

    const levels: string[] = [];
    if (sSalesperson) levels.push('salesperson');
    if (sYear) levels.push('year');
    if (sMonth) levels.push('month');
    if (sDay) levels.push('day');
    if (sDocument) levels.push('document');
    if (sBrand) levels.push('brand');
    if (sDivision) levels.push('division');
    if (sSalesTax) levels.push('salesTax');
    if (sCategory) levels.push('category');
    if (sGender) levels.push('gender');
    if (sSilhouette) levels.push('silhouette');
    if (sArticle) levels.push('article');
    if (sVariant) levels.push('variant');

    if (levels.length === 0) {
      levels.push('salesperson');
    }

    const now = new Date();

    // Helper to parse dates robustly in local timezone if plain date strings are passed
    const parseLocalDate = (
      dateStr: string | undefined,
      isEndOfDay = false,
    ): Date => {
      if (!dateStr) {
        if (isEndOfDay) {
          const d = new Date(now);
          d.setHours(23, 59, 59, 999);
          return d;
        } else {
          return new Date(now.getFullYear(), now.getMonth(), 1);
        }
      }

      // If it has a time indicator, parse it as-is (e.g. ISO string)
      if (dateStr.includes('T') || dateStr.includes('Z')) {
        const d = new Date(dateStr);
        if (isEndOfDay && !dateStr.includes('T23:59:59')) {
          d.setHours(23, 59, 59, 999);
        }
        return d;
      }

      // Plain date string like YYYY-MM-DD
      const timePart = isEndOfDay ? 'T23:59:59.999' : 'T00:00:00.000';
      return new Date(`${dateStr}${timePart}`);
    };

    const startDate = parseLocalDate(startStr, false);
    const endDate = parseLocalDate(endStr, true);

    // Fetch sales order items
    const orderItems = await this.prisma.salesOrderItem.findMany({
      where: {
        salesOrder: {
          locationId,
          status: {
            in: ['completed', 'partially_returned', 'refunded', 'exchanged'],
          },
          createdAt: { gte: startDate, lte: endDate },
          ...(cashierUserId ? { cashierUserId } : {}),
        },
      },
      include: {
        salesOrder: true,
        item: {
          include: {
            brand: true,
            division: true,
            category: true,
            gender: true,
            silhouette: true,
            size: true,
            color: true,
          },
        },
      },
    });

    // Fetch approved claim items for location within the date range
    const approvedClaimItems = await this.prisma.posClaimItem.findMany({
      where: {
        itemStatus: 'APPROVED',
        approvedQty: { gt: 0 },
        claim: {
          status: { in: ['APPROVED', 'PARTIALLY_APPROVED'] },
          reviewedAt: { gte: startDate, lte: endDate },
          salesOrder: {
            locationId,
            ...(cashierUserId ? { cashierUserId } : {}),
          },
        },
      },
      include: {
        claim: {
          include: {
            salesOrder: true,
          },
        },
        item: {
          include: {
            brand: true,
            division: true,
            category: true,
            gender: true,
            silhouette: true,
            size: true,
            color: true,
          },
        },
      },
    });

    const salesOrderItemIds = approvedClaimItems
      .map((ci) => ci.salesOrderItemId)
      .filter(Boolean);
    const originalSalesOrderItems = salesOrderItemIds.length
      ? await this.prisma.salesOrderItem.findMany({
          where: { id: { in: salesOrderItemIds } },
        })
      : [];
    const originalSalesOrderItemMap = new Map<string, any>();
    for (const oi of originalSalesOrderItems) {
      originalSalesOrderItemMap.set(oi.id, oi);
    }

    // Fetch direct returns/refunds from StockLedger within the date range
    const returnLedgerEntries = await this.prisma.stockLedger.findMany({
      where: {
        referenceType: { in: ['POS_RETURN', 'POS_REFUND'] },
        createdAt: { gte: startDate, lte: endDate },
        locationId,
      },
      include: {
        item: {
          include: {
            brand: true,
            division: true,
            category: true,
            gender: true,
            silhouette: true,
            size: true,
            color: true,
          },
        },
      },
    });

    const referenceOrderIds = [
      ...new Set(returnLedgerEntries.map((e) => e.referenceId).filter(Boolean)),
    ];
    const referenceOrders = referenceOrderIds.length
      ? await this.prisma.salesOrder.findMany({
          where: {
            id: { in: referenceOrderIds },
            ...(cashierUserId ? { cashierUserId } : {}),
          },
          include: {
            items: true,
          },
        })
      : [];
    const referenceOrderMap = new Map<string, any>();
    for (const order of referenceOrders) {
      referenceOrderMap.set(order.id, order);
    }

    // Resolve cashier names if grouping by salesperson
    const cashierNameMap = new Map<string, string>();
    if (sSalesperson || levels.includes('salesperson')) {
      const claimCashierIds = approvedClaimItems
        .map((ci) => ci.claim.salesOrder?.cashierUserId)
        .filter(Boolean);
      const ledgerCashierIds = referenceOrders
        .map((o) => o.cashierUserId)
        .filter(Boolean);
      const cashierUserIds = [
        ...new Set([
          ...orderItems
            .map((oi) => oi.salesOrder?.cashierUserId)
            .filter(Boolean),
          ...claimCashierIds,
          ...ledgerCashierIds,
        ]),
      ] as string[];
      const cashierUsers = cashierUserIds.length
        ? await this.prismaMaster.user.findMany({
            where: { id: { in: cashierUserIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [];
      const cashierEmployees = cashierUserIds.length
        ? await this.prisma.employee.findMany({
            where: {
              OR: [
                { id: { in: cashierUserIds } },
                { userId: { in: cashierUserIds } },
              ],
            },
            select: { id: true, userId: true, employeeName: true },
          })
        : [];

      for (const u of cashierUsers) {
        cashierNameMap.set(u.id, `${u.firstName} ${u.lastName}`);
      }
      for (const emp of cashierEmployees) {
        if (emp.userId) cashierNameMap.set(emp.userId, emp.employeeName);
        cashierNameMap.set(emp.id, emp.employeeName);
      }
    }

    const root: any[] = [];

    const createEmptyTotals = () => ({
      qty: 0,
      totalRetailValue: 0,
      totalPriceWost: 0,
      discountAmount: 0,
      valueExclTax: 0,
      salesTaxAmount: 0,
      additionalSalesTaxAmount: 0,
      totalTax: 0,
      valueInclTax: 0,
    });

    const addTotals = (target: any, source: any) => {
      target.qty += source.qty;
      target.totalRetailValue += source.totalRetailValue;
      target.totalPriceWost += source.totalPriceWost;
      target.discountAmount += source.discountAmount;
      target.valueExclTax += source.valueExclTax;
      target.salesTaxAmount += source.salesTaxAmount;
      target.additionalSalesTaxAmount += source.additionalSalesTaxAmount;
      target.totalTax += source.totalTax;
      target.valueInclTax += source.valueInclTax;
    };

    for (const orderItem of orderItems) {
      if (!orderItem.item) continue;

      const qty = Number(orderItem.quantity || 0);
      const retailPrice = Number(orderItem.unitPrice || 0);
      const taxRate = Number(orderItem.taxPercent || 0);

      const taxDivisor = 1 + taxRate / 100;
      const wostPerUnit = retailPrice / taxDivisor;
      const totalPriceWost = qty * wostPerUnit;
      const discountAmount = Number(orderItem.discountAmount || 0);
      const valueExclTax = totalPriceWost - discountAmount;
      const salesTaxAmount = Number(orderItem.taxAmount || 0);
      const additionalSalesTaxAmount = 0; // Set to 0 for POS sales report
      const totalTax = salesTaxAmount + additionalSalesTaxAmount;
      const valueInclTax = valueExclTax + totalTax;

      const variantMetrics = {
        qty,
        totalRetailValue: qty * retailPrice,
        totalPriceWost,
        discountAmount,
        valueExclTax,
        salesTaxAmount,
        additionalSalesTaxAmount,
        totalTax,
        valueInclTax,
      };

      let currentLevelNodes = root;
      for (let i = 0; i < levels.length; i++) {
        const levelName = levels[i];
        let nodeVal = '';
        let extraFields: any = {};

        if (levelName === 'salesperson') {
          const cid = orderItem.salesOrder?.cashierUserId || '';
          nodeVal = cid
            ? cashierNameMap.get(cid) || 'Unknown Salesperson'
            : 'Unknown Salesperson';
        } else if (levelName === 'year') {
          nodeVal = orderItem.salesOrder
            ? String(orderItem.salesOrder.createdAt.getFullYear())
            : 'Unknown Year';
        } else if (levelName === 'month') {
          if (orderItem.salesOrder) {
            const date = orderItem.salesOrder.createdAt;
            nodeVal = date.toLocaleString('default', {
              month: 'long',
              year: 'numeric',
            });
          } else {
            nodeVal = 'Unknown Month';
          }
        } else if (levelName === 'day') {
          if (orderItem.salesOrder) {
            const date = orderItem.salesOrder.createdAt;
            nodeVal = date.toLocaleDateString('default', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            });
          } else {
            nodeVal = 'Unknown Day';
          }
        } else if (levelName === 'document') {
          nodeVal = orderItem.salesOrder
            ? `POS Sale - ${orderItem.salesOrder.orderNumber}`
            : 'Unknown Document';
        } else if (levelName === 'brand') {
          nodeVal = orderItem.item.brand?.name || 'No Brand';
        } else if (levelName === 'division') {
          nodeVal = orderItem.item.division?.name || 'No Division';
        } else if (levelName === 'salesTax') {
          const rate = Number(orderItem.taxPercent || 0);
          nodeVal = rate > 0 ? `${rate}% Tax` : 'No Tax';
        } else if (levelName === 'category') {
          nodeVal = orderItem.item.category?.name || 'No Category';
        } else if (levelName === 'gender') {
          nodeVal = orderItem.item.gender?.name || 'No Gender';
        } else if (levelName === 'silhouette') {
          nodeVal = orderItem.item.silhouette?.name || 'No Silhouette';
        } else if (levelName === 'article') {
          nodeVal = orderItem.item.sku;
          extraFields.sku = orderItem.item.sku;
          extraFields.articleName =
            orderItem.item.description || 'Unknown Article';
        } else if (levelName === 'variant') {
          nodeVal = `${orderItem.item.color?.name || 'Default'}-${orderItem.item.size?.name || 'Default'}`;
          extraFields.color = orderItem.item.color?.name || 'Default';
          extraFields.size = orderItem.item.size?.name || 'Default';
        }

        let existingNode = currentLevelNodes.find(
          (n) => n.level === levelName && n.value === nodeVal,
        );
        if (!existingNode) {
          existingNode = {
            level: levelName,
            value: nodeVal,
            totals: createEmptyTotals(),
            ...extraFields,
            children: [],
          };
          currentLevelNodes.push(existingNode);
        }

        addTotals(existingNode.totals, variantMetrics);

        if (i < levels.length - 1) {
          currentLevelNodes = existingNode.children;
        }
      }
    }

    for (const claimItem of approvedClaimItems) {
      if (!claimItem.item) continue;
      const originalOi = originalSalesOrderItemMap.get(
        claimItem.salesOrderItemId,
      );
      if (!originalOi) continue;

      const approvedQty = Number(claimItem.approvedQty || 0);
      const qty = -approvedQty;
      const retailPrice = Number(originalOi.unitPrice || 0);
      const taxRate = Number(originalOi.taxPercent || 0);

      const taxDivisor = 1 + taxRate / 100;
      const wostPerUnit = retailPrice / taxDivisor;
      const totalPriceWost = qty * wostPerUnit;

      const originalQty = Number(originalOi.quantity || 1);
      const discountAmount = -(
        (Number(originalOi.discountAmount || 0) / originalQty) *
        approvedQty
      );
      const salesTaxAmount = -(
        (Number(originalOi.taxAmount || 0) / originalQty) *
        approvedQty
      );
      const additionalSalesTaxAmount = 0;
      const totalTax = salesTaxAmount + additionalSalesTaxAmount;
      const valueExclTax = totalPriceWost - discountAmount;
      const valueInclTax = valueExclTax + totalTax;

      const variantMetrics = {
        qty,
        totalRetailValue: qty * retailPrice,
        totalPriceWost,
        discountAmount,
        valueExclTax,
        salesTaxAmount,
        additionalSalesTaxAmount,
        totalTax,
        valueInclTax,
      };

      let currentLevelNodes = root;
      for (let i = 0; i < levels.length; i++) {
        const levelName = levels[i];
        let nodeVal = '';
        let extraFields: any = {};

        if (levelName === 'salesperson') {
          const cid = claimItem.claim.salesOrder?.cashierUserId || '';
          nodeVal = cid
            ? cashierNameMap.get(cid) || 'Unknown Salesperson'
            : 'Unknown Salesperson';
        } else if (levelName === 'year') {
          nodeVal = claimItem.claim.reviewedAt
            ? String(claimItem.claim.reviewedAt.getFullYear())
            : claimItem.claim.createdAt
              ? String(claimItem.claim.createdAt.getFullYear())
              : 'Unknown Year';
        } else if (levelName === 'month') {
          const date = claimItem.claim.reviewedAt || claimItem.claim.createdAt;
          if (date) {
            nodeVal = date.toLocaleString('default', {
              month: 'long',
              year: 'numeric',
            });
          } else {
            nodeVal = 'Unknown Month';
          }
        } else if (levelName === 'day') {
          const date = claimItem.claim.reviewedAt || claimItem.claim.createdAt;
          if (date) {
            nodeVal = date.toLocaleDateString('default', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            });
          } else {
            nodeVal = 'Unknown Day';
          }
        } else if (levelName === 'document') {
          nodeVal = claimItem.claim
            ? `POS Claim - ${claimItem.claim.claimNumber}`
            : 'Unknown Document';
        } else if (levelName === 'brand') {
          nodeVal = claimItem.item.brand?.name || 'No Brand';
        } else if (levelName === 'division') {
          nodeVal = claimItem.item.division?.name || 'No Division';
        } else if (levelName === 'salesTax') {
          const rate = Number(originalOi.taxPercent || 0);
          nodeVal = rate > 0 ? `${rate}% Tax` : 'No Tax';
        } else if (levelName === 'category') {
          nodeVal = claimItem.item.category?.name || 'No Category';
        } else if (levelName === 'gender') {
          nodeVal = claimItem.item.gender?.name || 'No Gender';
        } else if (levelName === 'silhouette') {
          nodeVal = claimItem.item.silhouette?.name || 'No Silhouette';
        } else if (levelName === 'article') {
          nodeVal = claimItem.item.sku;
          extraFields.sku = claimItem.item.sku;
          extraFields.articleName =
            claimItem.item.description || 'Unknown Article';
        } else if (levelName === 'variant') {
          nodeVal = `${claimItem.item.color?.name || 'Default'}-${claimItem.item.size?.name || 'Default'}`;
          extraFields.color = claimItem.item.color?.name || 'Default';
          extraFields.size = claimItem.item.size?.name || 'Default';
        }

        let existingNode = currentLevelNodes.find(
          (n) => n.level === levelName && n.value === nodeVal,
        );
        if (!existingNode) {
          existingNode = {
            level: levelName,
            value: nodeVal,
            totals: createEmptyTotals(),
            ...extraFields,
            children: [],
          };
          currentLevelNodes.push(existingNode);
        }

        addTotals(existingNode.totals, variantMetrics);

        if (i < levels.length - 1) {
          currentLevelNodes = existingNode.children;
        }
      }
    }

    for (const ledgerEntry of returnLedgerEntries) {
      if (!ledgerEntry.item) continue;
      const originalOrder = referenceOrderMap.get(ledgerEntry.referenceId);
      if (!originalOrder) continue;

      const originalOi = originalOrder.items.find(
        (oi) => oi.itemId === ledgerEntry.itemId,
      );
      if (!originalOi) continue;

      const returnedQty = Math.abs(Number(ledgerEntry.qty));
      if (returnedQty <= 0) continue;

      const qty = -returnedQty;
      const retailPrice = Number(originalOi.unitPrice || 0);
      const taxRate = Number(originalOi.taxPercent || 0);

      const taxDivisor = 1 + taxRate / 100;
      const wostPerUnit = retailPrice / taxDivisor;
      const totalPriceWost = qty * wostPerUnit;

      const originalQty = Number(originalOi.quantity || 1);
      const discountAmount = -(
        (Number(originalOi.discountAmount || 0) / originalQty) *
        returnedQty
      );
      const salesTaxAmount = -(
        (Number(originalOi.taxAmount || 0) / originalQty) *
        returnedQty
      );
      const additionalSalesTaxAmount = 0;
      const totalTax = salesTaxAmount + additionalSalesTaxAmount;
      const valueExclTax = totalPriceWost - discountAmount;
      const valueInclTax = valueExclTax + totalTax;

      const variantMetrics = {
        qty,
        totalRetailValue: qty * retailPrice,
        totalPriceWost,
        discountAmount,
        valueExclTax,
        salesTaxAmount,
        additionalSalesTaxAmount,
        totalTax,
        valueInclTax,
      };

      let currentLevelNodes = root;
      for (let i = 0; i < levels.length; i++) {
        const levelName = levels[i];
        let nodeVal = '';
        let extraFields: any = {};

        if (levelName === 'salesperson') {
          const cid = originalOrder.cashierUserId || '';
          nodeVal = cid
            ? cashierNameMap.get(cid) || 'Unknown Salesperson'
            : 'Unknown Salesperson';
        } else if (levelName === 'year') {
          nodeVal = ledgerEntry.createdAt
            ? String(ledgerEntry.createdAt.getFullYear())
            : 'Unknown Year';
        } else if (levelName === 'month') {
          if (ledgerEntry.createdAt) {
            nodeVal = ledgerEntry.createdAt.toLocaleString('default', {
              month: 'long',
              year: 'numeric',
            });
          } else {
            nodeVal = 'Unknown Month';
          }
        } else if (levelName === 'day') {
          if (ledgerEntry.createdAt) {
            nodeVal = ledgerEntry.createdAt.toLocaleDateString('default', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            });
          } else {
            nodeVal = 'Unknown Day';
          }
        } else if (levelName === 'document') {
          const docNum =
            ledgerEntry.referenceType === 'POS_REFUND'
              ? originalOrder.refundNumber ||
                `Refund for ${originalOrder.orderNumber}`
              : originalOrder.returnNumber ||
                `Return for ${originalOrder.orderNumber}`;
          nodeVal = `POS Return - ${docNum}`;
        } else if (levelName === 'brand') {
          nodeVal = ledgerEntry.item.brand?.name || 'No Brand';
        } else if (levelName === 'division') {
          nodeVal = ledgerEntry.item.division?.name || 'No Division';
        } else if (levelName === 'salesTax') {
          const rate = Number(originalOi.taxPercent || 0);
          nodeVal = rate > 0 ? `${rate}% Tax` : 'No Tax';
        } else if (levelName === 'category') {
          nodeVal = ledgerEntry.item.category?.name || 'No Category';
        } else if (levelName === 'gender') {
          nodeVal = ledgerEntry.item.gender?.name || 'No Gender';
        } else if (levelName === 'silhouette') {
          nodeVal = ledgerEntry.item.silhouette?.name || 'No Silhouette';
        } else if (levelName === 'article') {
          nodeVal = ledgerEntry.item.sku;
          extraFields.sku = ledgerEntry.item.sku;
          extraFields.articleName =
            ledgerEntry.item.description || 'Unknown Article';
        } else if (levelName === 'variant') {
          nodeVal = `${ledgerEntry.item.color?.name || 'Default'}-${ledgerEntry.item.size?.name || 'Default'}`;
          extraFields.color = ledgerEntry.item.color?.name || 'Default';
          extraFields.size = ledgerEntry.item.size?.name || 'Default';
        }

        let existingNode = currentLevelNodes.find(
          (n) => n.level === levelName && n.value === nodeVal,
        );
        if (!existingNode) {
          existingNode = {
            level: levelName,
            value: nodeVal,
            totals: createEmptyTotals(),
            ...extraFields,
            children: [],
          };
          currentLevelNodes.push(existingNode);
        }

        addTotals(existingNode.totals, variantMetrics);

        if (i < levels.length - 1) {
          currentLevelNodes = existingNode.children;
        }
      }
    }

    return root;
  }

  async getSalesRegisterReport(options: {
    locationId: string;
    startDate?: string;
    endDate?: string;
    cashierUserId?: string;
    search?: string;
  }) {
    const {
      locationId,
      startDate: startStr,
      endDate: endStr,
      cashierUserId,
      search,
    } = options;
    if (!locationId) {
      throw new BadRequestException('locationId is required');
    }
    const now = new Date();
    const startDate = startStr
      ? new Date(startStr)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = endStr ? new Date(endStr) : new Date(now);
    endDate.setHours(23, 59, 59, 999);

    const orders = await this.prisma.salesOrder.findMany({
      where: {
        locationId,
        status: {
          in: ['completed', 'partially_returned', 'refunded', 'exchanged'],
        },
        createdAt: { gte: startDate, lte: endDate },
        ...(cashierUserId ? { cashierUserId } : {}),
        ...(search
          ? { orderNumber: { contains: search, mode: 'insensitive' } }
          : {}),
      },
      include: {
        alliance: true,
        voucherRedemptions: {
          include: {
            voucher: true,
          },
        },
        items: {
          include: {
            item: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const returnLedgerEntries = await this.prisma.stockLedger.findMany({
      where: {
        referenceType: { in: ['POS_RETURN', 'POS_REFUND'] },
        createdAt: { gte: startDate, lte: endDate },
        locationId,
      },
      include: {
        item: true,
      },
    });

    const referenceOrderIds = [
      ...new Set(returnLedgerEntries.map((e) => e.referenceId).filter(Boolean)),
    ];
    const referenceOrders = referenceOrderIds.length
      ? await this.prisma.salesOrder.findMany({
          where: {
            id: { in: referenceOrderIds },
            ...(cashierUserId ? { cashierUserId } : {}),
          },
          include: {
            items: { include: { item: true } },
            alliance: true,
            voucherRedemptions: { include: { voucher: true } },
          },
        })
      : [];

    const referenceOrderMap = new Map<string, any>();
    for (const o of referenceOrders) {
      referenceOrderMap.set(o.id, o);
    }

    const rows: any[] = [];

    for (const order of orders) {
      let grossSale = 0;
      let grossSaleWost = 0;

      for (const item of order.items) {
        const qty = Number(item.quantity || 0);
        const price = Number(item.unitPrice || 0);
        const taxRate = Number(item.taxPercent || 0);

        grossSale += qty * price;
        grossSaleWost += qty * (price / (1 + taxRate / 100));
      }

      let cash = Number(order.cashAmount || 0);
      let cardAmount = Number(order.cardAmount || 0);
      let postex = 0;
      let leopard = 0;

      const pm = order.paymentMethod?.toLowerCase();
      if (pm === 'postex') {
        postex = cardAmount || Number(order.grandTotal);
        cardAmount = 0;
      } else if (pm === 'leopard') {
        leopard = cardAmount || Number(order.grandTotal);
        cardAmount = 0;
      }

      let giftVoucherAmt = 0;
      let giftVoucherCodes: string[] = [];
      let creditAmt = 0;
      let creditCodes: string[] = [];
      let claimAmt = 0;
      let claimCodes: string[] = [];
      let corporateAmt = 0;
      let corporateCodes: string[] = [];
      let exchangeAmt = 0;
      let exchangeCodes: string[] = [];

      for (const red of order.voucherRedemptions) {
        const type = red.voucher?.voucherType;
        const code = red.voucher?.code || '';
        const amt = Number(red.amountUsed);

        if (type === 'GIFT' || type === 'OUTLET_GIFT') {
          giftVoucherAmt += amt;
          giftVoucherCodes.push(code);
        } else if (type === 'CREDIT') {
          creditAmt += amt;
          creditCodes.push(code);
        } else if (type === 'CLAIM') {
          claimAmt += amt;
          claimCodes.push(code);
        } else if (type === 'CORPORATE') {
          corporateAmt += amt;
          corporateCodes.push(code);
        } else if (type === 'EXCHANGE') {
          exchangeAmt += amt;
          exchangeCodes.push(code);
        }
      }

      let cardNo = '';
      const notesStr = order.notes || '';
      const cardMatch = notesStr.match(/Card:\s*\*\*\*\*(\d{4})/i);
      if (cardMatch) {
        cardNo = cardMatch[1];
      }

      let allianceDetails = '';
      if (order.alliance) {
        allianceDetails = `${order.alliance.partnerName} (${order.alliance.discountPercent}%)`;
      }

      const overrideDiscPct = order.items
        .map((i: any) =>
          i.overrideDiscountPercent ? `${i.overrideDiscountPercent}%` : null,
        )
        .filter(Boolean)
        .join(', ');

      const overrideDiscNote = order.items
        .map((i: any) => i.overrideDiscountNote)
        .filter(Boolean)
        .join('; ');

      rows.push({
        id: order.id,
        cmNo: order.orderNumber,
        date: order.createdAt,
        grossSale,
        grossSaleWost,
        disc: Number(order.discountAmount || 0),
        sTax: Number(order.taxAmount || 0),
        netSale: Number(order.grandTotal),
        cash,
        postex,
        leopard,
        cardNo,
        cardAmount,
        allianceDetails,
        giftVoucherAmt,
        giftVoucherCode: giftVoucherCodes.join(', '),
        creditAmt,
        creditCode: creditCodes.join(', '),
        claimAmt,
        claimCode: claimCodes.join(', '),
        corporateAmt,
        corporateCode: corporateCodes.join(', '),
        exchangeAmt,
        exchangeCode: exchangeCodes.join(', '),
        manualDiscPct: order.globalDiscountPercent
          ? `${order.globalDiscountPercent}%`
          : '',
        manualDiscAmt: Number(order.globalDiscountAmount || 0),
        manualDiscNote: order.manualDiscountNote || '',
        overrideDiscPct,
        overrideDiscNote,
      });
    }

    const groupedReturns = new Map<string, any[]>();
    for (const entry of returnLedgerEntries) {
      if (!entry.referenceId) continue;
      const list = groupedReturns.get(entry.referenceId) || [];
      list.push(entry);
      groupedReturns.set(entry.referenceId, list);
    }

    for (const [refId, entries] of groupedReturns.entries()) {
      const order = referenceOrderMap.get(refId);
      if (!order) continue;

      let grossSale = 0;
      let grossSaleWost = 0;
      let disc = 0;
      let sTax = 0;

      for (const entry of entries) {
        const qty = Math.abs(Number(entry.qty));
        const orderItem = order.items.find(
          (oi: any) => oi.itemId === entry.itemId,
        );
        if (!orderItem) continue;

        const price = Number(orderItem.unitPrice || 0);
        const taxRate = Number(orderItem.taxPercent || 0);
        const itemQty = Number(orderItem.quantity || 1);

        grossSale += qty * price;
        grossSaleWost += qty * (price / (1 + taxRate / 100));
        disc += (qty / itemQty) * Number(orderItem.discountAmount || 0);
        sTax += (qty / itemQty) * Number(orderItem.taxAmount || 0);
      }

      const netSale = grossSaleWost - disc + sTax;

      let cash = 0;
      let creditAmt = 0;
      let exchangeAmt = 0;

      const isRefund = entries[0].referenceType === 'POS_REFUND';
      if (isRefund) {
        cash = -netSale;
      } else {
        exchangeAmt = -netSale;
      }

      const docNum = isRefund
        ? order.refundNumber || `Refund for ${order.orderNumber}`
        : order.returnNumber || `Return for ${order.orderNumber}`;

      rows.push({
        id: `${refId}-return`,
        cmNo: docNum,
        date: entries[0].createdAt,
        grossSale: -grossSale,
        grossSaleWost: -grossSaleWost,
        disc: -disc,
        sTax: -sTax,
        netSale: -netSale,
        cash,
        postex: 0,
        leopard: 0,
        cardNo: '',
        cardAmount: 0,
        allianceDetails: '',
        giftVoucherAmt: 0,
        giftVoucherCode: '',
        creditAmt,
        creditCode: '',
        claimAmt: 0,
        claimCode: '',
        corporateAmt: 0,
        corporateCode: '',
        exchangeAmt,
        exchangeCode: '',
        manualDiscPct: '',
        manualDiscAmt: 0,
        manualDiscNote: '',
        overrideDiscPct: '',
        overrideDiscNote: '',
      });
    }

    rows.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    return { status: true, data: rows };
  }

  async getAllianceRegisterReport(options: {
    locationId?: string;
    startDate?: string;
    endDate?: string;
    cashierUserId?: string;
    search?: string;
  }) {
    const {
      locationId,
      startDate: startStr,
      endDate: endStr,
      cashierUserId,
      search,
    } = options;

    const now = new Date();
    const startDate = startStr
      ? new Date(startStr)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = endStr ? new Date(endStr) : new Date(now);
    endDate.setHours(23, 59, 59, 999);

    const locFilter =
      locationId && locationId !== 'all'
        ? locationId.includes(',')
          ? {
              locationId: {
                in: locationId
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              },
            }
          : { locationId }
        : {};

    const orders = await this.prisma.salesOrder.findMany({
      where: {
        ...locFilter,
        status: { in: ['completed', 'partially_returned'] },
        createdAt: { gte: startDate, lte: endDate },
        // Only alliance-related sales: pure alliance OR manual-with-alliance
        OR: [
          { allianceId: { not: null } },
          {
            manualDiscountNote: {
              contains: '[Manual Alliance]',
              mode: 'insensitive',
            },
          },
        ],
        ...(cashierUserId ? { cashierUserId } : {}),
        ...(search
          ? { orderNumber: { contains: search, mode: 'insensitive' } }
          : {}),
      },
      include: {
        alliance: true,
        items: true,
        voucherRedemptions: {
          include: {
            voucher: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const orderIds = orders.map((o) => o.id);
    const issuedVouchers =
      orderIds.length > 0
        ? await this.prisma.voucher.findMany({
            where: {
              sourceOrderId: { in: orderIds },
              voucherType: 'CREDIT',
              isDeleted: false,
            },
          })
        : [];

    const issuedVouchersMap = new Map<string, any[]>();
    for (const v of issuedVouchers) {
      if (v.sourceOrderId) {
        const list = issuedVouchersMap.get(v.sourceOrderId) || [];
        list.push(v);
        issuedVouchersMap.set(v.sourceOrderId, list);
      }
    }

    const rows = orders.map((order) => {
      // Retail Price = sum of (unitPrice × qty) — full retail with tax
      let retailPrice = 0;
      for (const item of order.items) {
        retailPrice += Number(item.unitPrice || 0) * Number(item.quantity || 1);
      }

      // Parse BIN / Auth ID / Card last 4 from notes field
      const notesStr = order.notes || '';
      const binMatch = notesStr.match(/BIN:\s*([\d\-]+)/i);
      const slipMatch = notesStr.match(/Slip:\s*(\d{6})/i);
      const cardMatch = notesStr.match(/Card:\s*\*{4}(\d{4})/i);
      const binNumber = binMatch ? binMatch[1] : '';
      const authId = slipMatch ? slipMatch[1] : '';
      const cardLast4 = cardMatch ? cardMatch[1] : '';

      // Build alliance option label
      let allianceOption = '';
      if (order.alliance) {
        const pct = Number(order.alliance.discountPercent);
        const cap = order.alliance.maxDiscount
          ? ` cap ${Number(order.alliance.maxDiscount).toLocaleString()}`
          : '';
        const bin = binNumber ? ` | BIN: ${binNumber}` : '';
        allianceOption = `${order.alliance.partnerName} ${pct}%${cap}${bin}`;
      } else if (order.manualDiscountNote) {
        allianceOption = (order.manualDiscountNote as string)
          .replace(/\[Manual Alliance\]/gi, '')
          .trim();
      }

      // Vouchers Used / Redeemed mapping
      let giftVoucherAmt = 0;
      let giftVoucherCode = '';
      let creditAmt = 0;
      let creditCode = '';
      let claimAmt = 0;
      let claimCode = '';
      let corporateAmt = 0;
      let corporateCode = '';
      let exchangeAmt = 0;
      let exchangeCode = '';

      const giftCodes: string[] = [];
      const creditCodes: string[] = [];
      const claimCodes: string[] = [];
      const corpCodes: string[] = [];
      const exchCodes: string[] = [];

      for (const red of order.voucherRedemptions) {
        const type = red.voucher?.voucherType;
        const code = red.voucher?.code || '';
        const amt = Number(red.amountUsed);

        if (type === 'GIFT' || type === 'OUTLET_GIFT') {
          giftVoucherAmt += amt;
          giftCodes.push(code);
        } else if (type === 'CREDIT') {
          creditAmt += amt;
          creditCodes.push(code);
        } else if (type === 'CLAIM') {
          claimAmt += amt;
          claimCodes.push(code);
        } else if (type === 'CORPORATE') {
          corporateAmt += amt;
          corpCodes.push(code);
        } else if (type === 'EXCHANGE') {
          exchangeAmt += amt;
          exchCodes.push(code);
        }
      }

      giftVoucherCode = giftCodes.join(', ');
      creditCode = creditCodes.join(', ');
      claimCode = claimCodes.join(', ');
      corporateCode = corpCodes.join(', ');
      exchangeCode = exchCodes.join(', ');

      // Credit Voucher Issued mapping
      const orderIssued = issuedVouchersMap.get(order.id) || [];
      const creditVoucherIssued = orderIssued.map((v) => v.code).join(', ');
      const creditVoucherIssuedAmt = orderIssued.reduce(
        (sum, v) => sum + Number(v.faceValue || 0),
        0,
      );

      const createdAt = new Date(order.createdAt);

      return {
        id: order.id,
        invoiceNo: order.orderNumber,
        date: createdAt.toLocaleDateString('en-PK', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }),
        time: createdAt.toLocaleTimeString('en-PK', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }),
        retailPrice,
        retailWost: Number(order.subtotal || 0),
        discount: Number(order.discountAmount || 0),
        sTax: Number(order.taxAmount || 0),
        netSale: Number(order.grandTotal || 0),
        cash: Number(order.cashAmount || 0),
        card: Number(order.cardAmount || 0),
        prefixCardNo: binNumber,
        authId,
        cardNo: cardLast4,
        allianceOption,
        remarks: order.manualDiscountNote || order.notes || '',
        giftVoucherCode,
        giftVoucherAmt,
        creditCode,
        creditAmt,
        claimCode,
        claimAmt,
        corporateCode,
        corporateAmt,
        exchangeCode,
        exchangeAmt,
        creditVoucherIssued,
        creditVoucherIssuedAmt,
        createdAt: order.createdAt,
      };
    });

    return { status: true, data: rows };
  }

  async getSalesListReport(options: {
    locationId: string;

    startDate?: string;
    endDate?: string;
    cashierUserId?: string;
    search?: string;
    paymentModeGroup?: string;
    minAmount?: number;
    maxAmount?: number;
    fbrOnly?: boolean;
  }) {
    const {
      locationId,
      startDate: startStr,
      endDate: endStr,
      cashierUserId,
      search,
      paymentModeGroup,
      minAmount,
      maxAmount,
      fbrOnly,
    } = options;
    if (!locationId) {
      throw new BadRequestException('locationId is required');
    }
    const now = new Date();
    const startDate = startStr
      ? new Date(startStr)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = endStr ? new Date(endStr) : new Date(now);
    endDate.setHours(23, 59, 59, 999);

    const orders = await this.prisma.salesOrder.findMany({
      where: {
        locationId,
        status: {
          in: ['completed', 'partially_returned', 'refunded', 'exchanged'],
        },
        createdAt: { gte: startDate, lte: endDate },
        ...(cashierUserId ? { cashierUserId } : {}),
        ...(search
          ? { orderNumber: { contains: search, mode: 'insensitive' } }
          : {}),
      },
      include: {
        alliance: true,
        voucherRedemptions: {
          include: {
            voucher: true,
          },
        },
        items: {
          include: {
            item: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const returnLedgerEntries = await this.prisma.stockLedger.findMany({
      where: {
        referenceType: { in: ['POS_RETURN', 'POS_REFUND'] },
        createdAt: { gte: startDate, lte: endDate },
        locationId,
      },
      include: {
        item: true,
      },
    });

    const referenceOrderIds = [
      ...new Set(returnLedgerEntries.map((e) => e.referenceId).filter(Boolean)),
    ];
    const referenceOrders = referenceOrderIds.length
      ? await this.prisma.salesOrder.findMany({
          where: {
            id: { in: referenceOrderIds },
            ...(cashierUserId ? { cashierUserId } : {}),
          },
          include: {
            items: { include: { item: true } },
            alliance: true,
            voucherRedemptions: { include: { voucher: true } },
          },
        })
      : [];

    const referenceOrderMap = new Map<string, any>();
    for (const o of referenceOrders) {
      referenceOrderMap.set(o.id, o);
    }

    // Fetch all issued vouchers in the period for these orders/returns
    const allOrderIds = [...orders.map((o) => o.id), ...referenceOrderIds];
    const issuedVouchers = allOrderIds.length
      ? await this.prisma.voucher.findMany({
          where: {
            sourceOrderId: { in: allOrderIds },
            isDeleted: false,
          },
        })
      : [];

    const issuedVoucherMap = new Map<string, any[]>();
    for (const v of issuedVouchers) {
      if (!v.sourceOrderId) continue;
      const list = issuedVoucherMap.get(v.sourceOrderId) || [];
      list.push(v);
      issuedVoucherMap.set(v.sourceOrderId, list);
    }

    const rows: any[] = [];

    // Helper to parse tender documents (Auth, Bin, last 4 digits)
    const parseTenderDocs = (notes: string | null, alliance: any): string => {
      if (!notes) return '';

      const cardMatch = notes.match(/Card:\s*\*\*\*\*(\d{4})/i);
      const cardLast4 = cardMatch ? cardMatch[1] : '';

      const slipMatch = notes.match(/Slip:\s*(\w+)/i);
      const authId = slipMatch ? slipMatch[1] : '';

      const binMatch = notes.match(/BIN:\s*(\d+)/i);
      const binNumber = binMatch ? binMatch[1] : '';

      if (authId && cardLast4) {
        if (binNumber) {
          const formattedBin =
            binNumber.length >= 6
              ? binNumber.slice(0, 4) + '-' + binNumber.slice(4)
              : binNumber;
          return `${authId},${formattedBin}**-****-${cardLast4}`;
        }
        return `${authId},****-****-${cardLast4}`;
      }
      return cardLast4 || authId || '';
    };

    // 1. Process Sales Orders
    for (const order of orders) {
      const notesStr = order.notes || '';

      // Parse FBR Fee
      const fbr = order.fbrInvoiceNumber ? 1 : 0;
      const netSale = Number(order.grandTotal) - fbr;

      // Balance outstanding for Credit Sale
      let balance = 0;
      const balanceMatch = notesStr.match(
        /\[Credit Sale\] Balance:\s*([\d.]+)/i,
      );
      if (balanceMatch) {
        balance = Number(balanceMatch[1]);
      } else if (
        order.paymentMethod === 'credit_account' ||
        order.tenderType === 'credit_account'
      ) {
        balance = Number(order.grandTotal);
      }

      // Tenders Breakdown
      let cash = Number(order.cashAmount || 0);
      let card = Number(order.cardAmount || 0);
      let onCredit = balance;
      let rewardVoucher = 0; // default 0

      let giftVoucher = 0;
      let creditVoucher = 0;
      let exchangeVoucher = 0;
      let claimVoucher = 0;
      let corporateVoucher = 0;

      for (const red of order.voucherRedemptions) {
        const type = red.voucher?.voucherType;
        const amt = Number(red.amountUsed);

        if (type === 'GIFT' || type === 'OUTLET_GIFT') {
          giftVoucher += amt;
        } else if (type === 'CREDIT' || type === 'REFUND') {
          creditVoucher += amt;
        } else if (type === 'CLAIM') {
          claimVoucher += amt;
        } else if (type === 'CORPORATE') {
          corporateVoucher += amt;
        } else if (type === 'EXCHANGE') {
          exchangeVoucher += amt;
        }
      }

      // Issued Vouchers in this sale order
      let issuedGift = 0;
      let issuedCredit = 0;

      const orderIssued = issuedVoucherMap.get(order.id) || [];
      for (const iv of orderIssued) {
        const type = iv.voucherType;
        const faceVal = Number(iv.faceValue || 0);

        if (type === 'GIFT' || type === 'CORPORATE' || type === 'OUTLET_GIFT') {
          issuedGift += faceVal;
        } else if (
          type === 'CREDIT' ||
          type === 'EXCHANGE' ||
          type === 'REFUND'
        ) {
          issuedCredit += faceVal;
        }
      }

      const tenderDocs = parseTenderDocs(notesStr, order.alliance);

      rows.push({
        id: order.id,
        invoiceNo: order.orderNumber,
        date: order.createdAt,
        netTotal: Number(order.grandTotal),
        balance,
        tenderCash: cash,
        tenderCard: card,
        tenderRewardVoucher: rewardVoucher,
        tenderOnCredit: onCredit,
        tenderGiftVoucher: giftVoucher,
        tenderCreditVoucher: creditVoucher,
        tenderExchangeVoucher: exchangeVoucher,
        tenderClaimVoucher: claimVoucher,
        tenderCorporateVoucher: corporateVoucher,
        issuedGiftVoucher: issuedGift,
        issuedCreditVoucher: issuedCredit,
        returnAmount: 0,
        fbr,
        netSale,
        tenderDocuments: tenderDocs,
      });
    }

    // 2. Process Returns from Stock Ledger
    const groupedReturns = new Map<string, any[]>();
    for (const entry of returnLedgerEntries) {
      if (!entry.referenceId) continue;
      const list = groupedReturns.get(entry.referenceId) || [];
      list.push(entry);
      groupedReturns.set(entry.referenceId, list);
    }

    for (const [refId, entries] of groupedReturns.entries()) {
      const order = referenceOrderMap.get(refId);
      if (!order) continue;

      let grossSale = 0;
      let grossSaleWost = 0;
      let disc = 0;
      let sTax = 0;

      for (const entry of entries) {
        const qty = Math.abs(Number(entry.qty));
        const orderItem = order.items.find(
          (oi: any) => oi.itemId === entry.itemId,
        );
        if (!orderItem) continue;

        const price = Number(orderItem.unitPrice || 0);
        const taxRate = Number(orderItem.taxPercent || 0);
        const itemQty = Number(orderItem.quantity || 1);

        grossSale += qty * price;
        grossSaleWost += qty * (price / (1 + taxRate / 100));
        disc += (qty / itemQty) * Number(orderItem.discountAmount || 0);
        sTax += (qty / itemQty) * Number(orderItem.taxAmount || 0);
      }

      const netSale = grossSaleWost - disc + sTax;

      let cash = 0;
      let exchangeVoucher = 0;

      const isRefund = entries[0].referenceType === 'POS_REFUND';
      if (isRefund) {
        cash = -netSale;
      } else {
        exchangeVoucher = -netSale;
      }

      const docNum = isRefund
        ? order.refundNumber || `Refund for ${order.orderNumber}`
        : order.returnNumber || `Return for ${order.orderNumber}`;

      // Issued vouchers on return/refund
      let issuedGift = 0;
      let issuedCredit = 0;

      const returnIssued = issuedVoucherMap.get(refId) || [];
      for (const iv of returnIssued) {
        const type = iv.voucherType;
        const faceVal = Number(iv.faceValue || 0);

        if (type === 'GIFT' || type === 'CORPORATE' || type === 'OUTLET_GIFT') {
          issuedGift += faceVal;
        } else if (
          type === 'CREDIT' ||
          type === 'EXCHANGE' ||
          type === 'REFUND'
        ) {
          issuedCredit += faceVal;
        }
      }

      rows.push({
        id: `${refId}-return`,
        invoiceNo: docNum,
        date: entries[0].createdAt,
        netTotal: -netSale,
        balance: 0,
        tenderCash: cash,
        tenderCard: 0,
        tenderRewardVoucher: 0,
        tenderOnCredit: 0,
        tenderGiftVoucher: 0,
        tenderCreditVoucher: 0,
        tenderExchangeVoucher: exchangeVoucher,
        tenderClaimVoucher: 0,
        tenderCorporateVoucher: 0,
        issuedGiftVoucher: issuedGift,
        issuedCreditVoucher: issuedCredit,
        returnAmount: -netSale,
        fbr: 0,
        netSale: -netSale,
        tenderDocuments: '',
      });
    }

    let filteredRows = rows;

    if (paymentModeGroup) {
      filteredRows = filteredRows.filter((r) => {
        if (paymentModeGroup === 'cash') return r.tenderCash !== 0;
        if (paymentModeGroup === 'card') return r.tenderCard !== 0;
        if (paymentModeGroup === 'credit')
          return r.tenderOnCredit !== 0 || r.balance !== 0;
        if (paymentModeGroup === 'voucher') {
          return (
            r.tenderGiftVoucher !== 0 ||
            r.tenderCreditVoucher !== 0 ||
            r.tenderExchangeVoucher !== 0 ||
            r.tenderClaimVoucher !== 0 ||
            r.tenderCorporateVoucher !== 0
          );
        }
        if (paymentModeGroup === 'return') return r.returnAmount !== 0;
        return true;
      });
    }

    if (minAmount !== undefined && minAmount !== null) {
      filteredRows = filteredRows.filter(
        (r) => Math.abs(r.netTotal) >= Number(minAmount),
      );
    }
    if (maxAmount !== undefined && maxAmount !== null) {
      filteredRows = filteredRows.filter(
        (r) => Math.abs(r.netTotal) <= Number(maxAmount),
      );
    }
    if (fbrOnly) {
      filteredRows = filteredRows.filter((r) => r.fbr === 1);
    }

    filteredRows.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    const uniqueCashiers = await this.prisma.salesOrder.findMany({
      where: {
        locationId,
        status: {
          in: ['completed', 'partially_returned', 'refunded', 'exchanged'],
        },
        createdAt: { gte: startDate, lte: endDate },
        cashierUserId: { not: null },
      },
      select: {
        cashierUserId: true,
      },
      distinct: ['cashierUserId'],
    });

    const cashierUserIds = uniqueCashiers.map((o) => o.cashierUserId as string);

    const cashierUsers = cashierUserIds.length
      ? await this.prismaMaster.user.findMany({
          where: { id: { in: cashierUserIds } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            employeeId: true,
          },
        })
      : [];

    return { status: true, data: filteredRows, cashiers: cashierUsers };
  }

  async getGrossSalesSummaryReport(options: {
    locationId: string;
    startDate?: string;
    endDate?: string;
    cashierUserId?: string;
    search?: string;
    paymentModeGroup?: string;
    minAmount?: number;
    maxAmount?: number;
    fbrOnly?: boolean;
    showBrand?: boolean;
    showDivision?: boolean;
    showCategory?: boolean;
    showGender?: boolean;
    showSilhouette?: boolean;
    showArticle?: boolean;
    showVariant?: boolean;
    showInvoices?: boolean;
  }) {
    const {
      locationId,
      startDate: startStr,
      endDate: endStr,
      cashierUserId,
      search,
      paymentModeGroup,
      minAmount,
      maxAmount,
      fbrOnly,
      showBrand,
      showDivision,
      showCategory,
      showGender,
      showSilhouette,
      showArticle,
      showVariant,
      showInvoices,
    } = options;
    if (!locationId) {
      throw new BadRequestException('locationId is required');
    }
    const now = new Date();
    const startDate = startStr
      ? new Date(startStr)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = endStr ? new Date(endStr) : new Date(now);
    endDate.setHours(23, 59, 59, 999);

    const sBrand = showBrand !== false;
    const sDivision = showDivision !== false;
    const sCategory = showCategory !== false;
    const sGender = showGender !== false;
    const sSilhouette = showSilhouette !== false;
    const sArticle = showArticle !== false;
    const sVariant = showVariant !== false;
    const sInvoices = showInvoices === true;

    const levels: string[] = [];
    if (sBrand) levels.push('brand');
    if (sDivision) levels.push('division');
    if (sCategory) levels.push('category');
    if (sGender) levels.push('gender');
    if (sSilhouette) levels.push('silhouette');
    if (sArticle) levels.push('product');
    if (sVariant) levels.push('variant');

    if (levels.length === 0) {
      levels.push('product');
    }

    const orders = await this.prisma.salesOrder.findMany({
      where: {
        locationId,
        status: {
          in: ['completed', 'partially_returned', 'refunded', 'exchanged'],
        },
        createdAt: { gte: startDate, lte: endDate },
        ...(cashierUserId ? { cashierUserId } : {}),
      },
      include: {
        items: {
          include: {
            item: {
              include: {
                brand: true,
                division: true,
                gender: true,
                silhouette: true,
                size: true,
                color: true,
                category: true,
              },
            },
          },
        },
      },
    });

    const cashierUserIds = [
      ...new Set(orders.map((o) => o.cashierUserId).filter(Boolean)),
    ] as string[];
    const cashierMap = new Map<string, string>();
    if (cashierUserIds.length) {
      const users = await this.prismaMaster.user.findMany({
        where: { id: { in: cashierUserIds } },
        select: { id: true, firstName: true, lastName: true },
      });
      for (const u of users) {
        cashierMap.set(u.id, `${u.firstName} ${u.lastName}`.trim());
      }
    }

    // Tree Construction
    const root = {
      type: 'root',
      label: 'ROOT',
      qty: 0,
      totalPriceWost: 0,
      discountAmount: 0,
      excludingSalesTax: 0,
      salesTaxPercent: 0,
      salesTaxAmount: 0,
      totalTax: 0,
      includingSalesTax: 0,
      salesPerson: '',
      children: new Map<string, any>(),
      leaves: [] as any[],
    };

    const getOrAddChild = (
      parent: any,
      key: string,
      type: string,
      label: string,
      size = '',
      color = '',
    ) => {
      if (!parent.children.has(key)) {
        parent.children.set(key, {
          type,
          label,
          size,
          color,
          qty: 0,
          totalPriceWost: 0,
          discountAmount: 0,
          excludingSalesTax: 0,
          salesTaxPercent: 0,
          salesTaxAmount: 0,
          totalTax: 0,
          includingSalesTax: 0,
          salesPerson: '',
          children: new Map<string, any>(),
          leaves: [] as any[],
        });
      }
      return parent.children.get(key);
    };

    for (const order of orders) {
      const fbr = order.fbrInvoiceNumber ? 1 : 0;
      if (fbrOnly && !fbr) continue;

      if (
        search &&
        !order.orderNumber.toLowerCase().includes(search.toLowerCase())
      ) {
        continue;
      }

      if (paymentModeGroup) {
        if (paymentModeGroup === 'cash' && Number(order.cashAmount) === 0)
          continue;
        if (paymentModeGroup === 'card' && Number(order.cardAmount) === 0)
          continue;
        if (
          paymentModeGroup === 'credit' &&
          order.paymentMethod !== 'credit_account' &&
          order.tenderType !== 'credit_account'
        )
          continue;
      }

      const salesPerson = order.cashierUserId
        ? cashierMap.get(order.cashierUserId) || 'Unknown'
        : 'Unknown';

      for (const item of order.items) {
        const qty = item.quantity;
        const retailPrice = Number(item.unitPrice);
        const taxPercent = Number(item.taxPercent);
        const discountAmount = Number(item.discountAmount);
        const taxAmount = Number(item.taxAmount);
        const lineTotal = Number(item.lineTotal);

        const totalPriceWost = (retailPrice * qty) / (1 + taxPercent / 100);
        const excludingSalesTax = totalPriceWost - discountAmount;
        const salesTaxAmount = taxAmount;
        const furtherTaxAmount = 0;
        const totalTax = taxAmount;
        const includingSalesTax = lineTotal;

        if (minAmount !== undefined && includingSalesTax < minAmount) continue;
        if (maxAmount !== undefined && includingSalesTax > maxAmount) continue;

        const it = item.item;
        const brandName = it.brand?.name || 'NO BRAND';
        const divisionName = it.division?.name || 'NO DIVISION';
        const categoryName = it.category?.name || 'NO CATEGORY';
        const genderName = it.gender?.name || 'NO GENDER';
        const silhouetteName = it.silhouette?.name || 'NO SILHOUETTE';
        const productName = `${it.sku} ${it.description || ''}`.trim();
        const sizeName = it.size?.name || '-';
        const colorName = it.color?.name || '-';

        // Traverse & Aggregate
        let currentNode = root;
        for (let i = 0; i < levels.length; i++) {
          const lvl = levels[i];
          let key = '';
          let type = '';
          let label = '';
          let size = '';
          let color = '';

          if (lvl === 'brand') {
            key = brandName;
            type = 'brand';
            label = brandName;
          } else if (lvl === 'division') {
            key = `${divisionName}|${taxPercent}`;
            type = 'division';
            label = `${divisionName} - Sales Tax: ${taxPercent.toFixed(2)}%`;
          } else if (lvl === 'category') {
            key = categoryName;
            type = 'category';
            label = categoryName;
          } else if (lvl === 'gender') {
            key = genderName;
            type = 'gender';
            label = genderName;
          } else if (lvl === 'silhouette') {
            key = silhouetteName;
            type = 'silhouette';
            label = silhouetteName;
          } else if (lvl === 'product') {
            key = productName;
            type = 'product';
            label = productName;
          } else if (lvl === 'variant') {
            key = `${sizeName}|${colorName}`;
            type = 'variant';
            label = `Size: ${sizeName} / Color: ${colorName}`;
            size = sizeName;
            color = colorName;
          }

          currentNode = getOrAddChild(
            currentNode,
            key,
            type,
            label,
            size,
            color,
          );
        }

        // Update counts along path
        let updateNode = root;
        updateNode.qty += qty;
        updateNode.totalPriceWost += totalPriceWost;
        updateNode.discountAmount += discountAmount;
        updateNode.excludingSalesTax += excludingSalesTax;
        updateNode.salesTaxAmount += salesTaxAmount;
        updateNode.totalTax += totalTax;
        updateNode.includingSalesTax += includingSalesTax;

        for (let i = 0; i < levels.length; i++) {
          const lvl = levels[i];
          let key = '';
          if (lvl === 'brand') key = brandName;
          else if (lvl === 'division') key = `${divisionName}|${taxPercent}`;
          else if (lvl === 'category') key = categoryName;
          else if (lvl === 'gender') key = genderName;
          else if (lvl === 'silhouette') key = silhouetteName;
          else if (lvl === 'product') key = productName;
          else if (lvl === 'variant') key = `${sizeName}|${colorName}`;

          updateNode = updateNode.children.get(key);
          if (updateNode) {
            updateNode.qty += qty;
            updateNode.totalPriceWost += totalPriceWost;
            updateNode.discountAmount += discountAmount;
            updateNode.excludingSalesTax += excludingSalesTax;
            updateNode.salesTaxAmount += salesTaxAmount;
            updateNode.totalTax += totalTax;
            updateNode.includingSalesTax += includingSalesTax;
            // Track salesTaxPercent and salesPerson on each node (variant has a fixed taxPercent; groups show last seen)
            updateNode.salesTaxPercent = taxPercent;
            updateNode.salesPerson = salesPerson;
          }
        }

        if (sInvoices) {
          currentNode.leaves.push({
            invoiceNo: order.orderNumber,
            date: order.createdAt,
            size: sizeName,
            color: colorName,
            qty,
            retailPrice,
            totalPriceWost,
            discountAmount,
            excludingSalesTax,
            salesTaxPercent: taxPercent,
            salesTaxAmount,
            furtherTaxAmount,
            totalTax,
            includingSalesTax,
            salesPerson,
          });
        }
      }
    }

    const flatRows: any[] = [];
    const flatten = (node: any, depth: number) => {
      if (node.type !== 'root') {
        flatRows.push({
          type: node.type,
          depth,
          label: node.label,
          size: node.size || '',
          color: node.color || '',
          qty: node.qty,
          retailPrice:
            node.type === 'variant'
              ? node.totalPriceWost / (node.qty || 1)
              : undefined,
          totalPriceWost: node.totalPriceWost,
          discountAmount: node.discountAmount,
          excludingSalesTax: node.excludingSalesTax,
          salesTaxPercent: node.salesTaxPercent,
          salesTaxAmount: node.salesTaxAmount,
          totalTax: node.totalTax,
          includingSalesTax: node.includingSalesTax,
          salesPerson: node.type === 'variant' ? node.salesPerson : undefined,
        });
      }

      if (node.children.size > 0) {
        const sortedKeys = Array.from(node.children.keys()).sort();
        for (const k of sortedKeys) {
          flatten(node.children.get(k), depth + 1);
        }
      }

      if (node.leaves.length > 0) {
        node.leaves.sort(
          (a: any, b: any) =>
            new Date(a.date).getTime() - new Date(b.date).getTime(),
        );
        for (const leaf of node.leaves) {
          flatRows.push({
            type: 'invoice',
            depth: depth + 1,
            label: `${leaf.invoiceNo} ${new Date(leaf.date).toLocaleDateString()}`,
            invoiceNo: leaf.invoiceNo,
            date: leaf.date,
            size: leaf.size,
            color: leaf.color,
            qty: leaf.qty,
            retailPrice: leaf.retailPrice,
            totalPriceWost: leaf.totalPriceWost,
            discountAmount: leaf.discountAmount,
            excludingSalesTax: leaf.excludingSalesTax,
            salesTaxPercent: leaf.salesTaxPercent,
            salesTaxAmount: leaf.salesTaxAmount,
            totalTax: leaf.totalTax,
            includingSalesTax: leaf.includingSalesTax,
            salesPerson: leaf.salesPerson,
          });
        }
      }
    };

    flatten(root, 0);

    const activeCashiers = cashierUserIds.length
      ? await this.prismaMaster.user.findMany({
          where: { id: { in: cashierUserIds } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            employeeId: true,
          },
        })
      : [];

    return { status: true, data: flatRows, cashiers: activeCashiers };
  }

  async getGrossSalesReturnReport(options: {
    locationId: string;
    startDate?: string;
    endDate?: string;
    cashierUserId?: string;
    search?: string;
    paymentModeGroup?: string;
    minAmount?: number;
    maxAmount?: number;
    fbrOnly?: boolean;
    showBrand?: boolean;
    showDivision?: boolean;
    showCategory?: boolean;
    showGender?: boolean;
    showSilhouette?: boolean;
    showArticle?: boolean;
    showVariant?: boolean;
    showInvoices?: boolean;
  }) {
    const {
      locationId,
      startDate: startStr,
      endDate: endStr,
      cashierUserId,
      search,
      paymentModeGroup,
      minAmount,
      maxAmount,
      fbrOnly,
      showBrand,
      showDivision,
      showCategory,
      showGender,
      showSilhouette,
      showArticle,
      showVariant,
      showInvoices,
    } = options;
    if (!locationId) {
      throw new BadRequestException('locationId is required');
    }
    const now = new Date();
    const startDate = startStr
      ? new Date(startStr)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = endStr ? new Date(endStr) : new Date(now);
    endDate.setHours(23, 59, 59, 999);

    const sBrand = showBrand !== false;
    const sDivision = showDivision !== false;
    const sCategory = showCategory !== false;
    const sGender = showGender !== false;
    const sSilhouette = showSilhouette !== false;
    const sArticle = showArticle !== false;
    const sVariant = showVariant !== false;
    const sInvoices = showInvoices === true;

    const levels: string[] = [];
    if (sBrand) levels.push('brand');
    if (sDivision) levels.push('division');
    if (sCategory) levels.push('category');
    if (sGender) levels.push('gender');
    if (sSilhouette) levels.push('silhouette');
    if (sArticle) levels.push('product');
    if (sVariant) levels.push('variant');

    if (levels.length === 0) {
      levels.push('product');
    }

    // 1. Fetch Returns/Refunds from StockLedger
    const returnLedgerEntries = await this.prisma.stockLedger.findMany({
      where: {
        referenceType: { in: ['POS_RETURN', 'POS_REFUND'] },
        createdAt: { gte: startDate, lte: endDate },
        locationId,
      },
      include: {
        item: {
          include: {
            brand: true,
            division: true,
            gender: true,
            silhouette: true,
            size: true,
            color: true,
            category: true,
          },
        },
      },
    });

    const referenceOrderIds = [
      ...new Set(returnLedgerEntries.map((e) => e.referenceId).filter(Boolean)),
    ];
    const referenceOrders = referenceOrderIds.length
      ? await this.prisma.salesOrder.findMany({
          where: {
            id: { in: referenceOrderIds },
            ...(cashierUserId ? { cashierUserId } : {}),
          },
          include: {
            items: true,
          },
        })
      : [];

    const refOrderMap = new Map<string, any>();
    for (const o of referenceOrders) {
      refOrderMap.set(o.id, o);
    }

    // 2. Fetch Approved Claims from PosClaim
    const claims = await this.prisma.posClaim.findMany({
      where: {
        status: { in: ['APPROVED', 'PARTIALLY_APPROVED'] },
        createdAt: { gte: startDate, lte: endDate },
        salesOrder: {
          locationId,
          ...(cashierUserId ? { cashierUserId } : {}),
        },
      },
      include: {
        salesOrder: {
          include: {
            items: true,
          },
        },
        items: {
          include: {
            item: {
              include: {
                brand: true,
                division: true,
                gender: true,
                silhouette: true,
                size: true,
                color: true,
                category: true,
              },
            },
          },
        },
      },
    });

    // Cashier Names mapping
    const orderCashierIds = [
      ...referenceOrders.map((o) => o.cashierUserId),
      ...claims.map((c) => c.salesOrder.cashierUserId),
    ].filter(Boolean);
    const cashierUserIds = [...new Set(orderCashierIds)] as string[];
    const cashierMap = new Map<string, string>();
    if (cashierUserIds.length) {
      const users = await this.prismaMaster.user.findMany({
        where: { id: { in: cashierUserIds } },
        select: { id: true, firstName: true, lastName: true },
      });
      for (const u of users) {
        cashierMap.set(u.id, `${u.firstName} ${u.lastName}`.trim());
      }
    }

    const root = {
      type: 'root',
      label: 'ROOT',
      qty: 0,
      totalPriceWost: 0,
      discountAmount: 0,
      excludingSalesTax: 0,
      salesTaxPercent: 0,
      salesTaxAmount: 0,
      totalTax: 0,
      includingSalesTax: 0,
      salesPerson: '',
      children: new Map<string, any>(),
      leaves: [] as any[],
    };

    const getOrAddChild = (
      parent: any,
      key: string,
      type: string,
      label: string,
      size = '',
      color = '',
    ) => {
      if (!parent.children.has(key)) {
        parent.children.set(key, {
          type,
          label,
          size,
          color,
          qty: 0,
          totalPriceWost: 0,
          discountAmount: 0,
          excludingSalesTax: 0,
          salesTaxPercent: 0,
          salesTaxAmount: 0,
          totalTax: 0,
          includingSalesTax: 0,
          salesPerson: '',
          children: new Map<string, any>(),
          leaves: [] as any[],
        });
      }
      return parent.children.get(key);
    };

    // Helper to process a leaf record and insert it into the tree
    const addLeafToTree = (leaf: any, it: any) => {
      if (fbrOnly && !leaf.fbr) return;
      if (
        search &&
        !leaf.invoiceNo.toLowerCase().includes(search.toLowerCase())
      )
        return;
      if (minAmount !== undefined && leaf.includingSalesTax < minAmount) return;
      if (maxAmount !== undefined && leaf.includingSalesTax > maxAmount) return;

      const brandName = it.brand?.name || 'NO BRAND';
      const divisionName = it.division?.name || 'NO DIVISION';
      const categoryName = it.category?.name || 'NO CATEGORY';
      const genderName = it.gender?.name || 'NO GENDER';
      const silhouetteName = it.silhouette?.name || 'NO SILHOUETTE';
      const productName = `${it.sku} ${it.description || ''}`.trim();
      const sizeName = it.size?.name || '-';
      const colorName = it.color?.name || '-';

      // Traverse & Aggregate
      let currentNode = root;
      for (let i = 0; i < levels.length; i++) {
        const lvl = levels[i];
        let key = '';
        let type = '';
        let label = '';
        let size = '';
        let color = '';

        if (lvl === 'brand') {
          key = brandName;
          type = 'brand';
          label = brandName;
        } else if (lvl === 'division') {
          key = `${divisionName}|${leaf.salesTaxPercent}`;
          type = 'division';
          label = `${divisionName} - Sales Tax: ${leaf.salesTaxPercent.toFixed(2)}%`;
        } else if (lvl === 'category') {
          key = categoryName;
          type = 'category';
          label = categoryName;
        } else if (lvl === 'gender') {
          key = genderName;
          type = 'gender';
          label = genderName;
        } else if (lvl === 'silhouette') {
          key = silhouetteName;
          type = 'silhouette';
          label = silhouetteName;
        } else if (lvl === 'product') {
          key = productName;
          type = 'product';
          label = productName;
        } else if (lvl === 'variant') {
          key = `${sizeName}|${colorName}`;
          type = 'variant';
          label = `Size: ${sizeName} / Color: ${colorName}`;
          size = sizeName;
          color = colorName;
        }

        currentNode = getOrAddChild(currentNode, key, type, label, size, color);
      }

      // Update counts along path
      let updateNode = root;
      updateNode.qty += leaf.qty;
      updateNode.totalPriceWost += leaf.totalPriceWost;
      updateNode.discountAmount += leaf.discountAmount;
      updateNode.excludingSalesTax += leaf.excludingSalesTax;
      updateNode.salesTaxAmount += leaf.salesTaxAmount;
      updateNode.totalTax += leaf.totalTax;
      updateNode.includingSalesTax += leaf.includingSalesTax;

      for (let i = 0; i < levels.length; i++) {
        const lvl = levels[i];
        let key = '';
        if (lvl === 'brand') key = brandName;
        else if (lvl === 'division')
          key = `${divisionName}|${leaf.salesTaxPercent}`;
        else if (lvl === 'category') key = categoryName;
        else if (lvl === 'gender') key = genderName;
        else if (lvl === 'silhouette') key = silhouetteName;
        else if (lvl === 'product') key = productName;
        else if (lvl === 'variant') key = `${sizeName}|${colorName}`;

        updateNode = updateNode.children.get(key);
        if (updateNode) {
          updateNode.qty += leaf.qty;
          updateNode.totalPriceWost += leaf.totalPriceWost;
          updateNode.discountAmount += leaf.discountAmount;
          updateNode.excludingSalesTax += leaf.excludingSalesTax;
          updateNode.salesTaxAmount += leaf.salesTaxAmount;
          updateNode.totalTax += leaf.totalTax;
          updateNode.includingSalesTax += leaf.includingSalesTax;
          // Track salesTaxPercent and salesPerson per node
          updateNode.salesTaxPercent = leaf.salesTaxPercent;
          updateNode.salesPerson = leaf.salesPerson;
        }
      }

      if (sInvoices) {
        currentNode.leaves.push(leaf);
      }
    };

    // Process StockLedger Returns
    for (const entry of returnLedgerEntries) {
      const order = refOrderMap.get(entry.referenceId);
      if (!order) continue;

      const originalItem = order.items.find((oi) => oi.itemId === entry.itemId);
      if (!originalItem) continue;

      const qty = Math.abs(Number(entry.qty));
      const originalQty = originalItem.quantity || 1;
      const ratio = qty / originalQty;

      const retailPrice = Number(originalItem.unitPrice);
      const taxPercent = Number(originalItem.taxPercent);
      const discountAmount = Number(originalItem.discountAmount) * ratio;
      const taxAmount = Number(originalItem.taxAmount) * ratio;
      const lineTotal = Number(originalItem.lineTotal) * ratio;

      const totalPriceWost = (retailPrice * qty) / (1 + taxPercent / 100);
      const excludingSalesTax = totalPriceWost - discountAmount;
      const salesTaxAmount = taxAmount;
      const furtherTaxAmount = 0;
      const totalTax = taxAmount;
      const includingSalesTax = lineTotal;

      const salesPerson = order.cashierUserId
        ? cashierMap.get(order.cashierUserId) || 'Unknown'
        : 'Unknown';
      const docNum =
        entry.referenceType === 'POS_REFUND'
          ? order.refundNumber || `Refund for ${order.orderNumber}`
          : order.returnNumber || `Return for ${order.orderNumber}`;

      const fbr = order.fbrInvoiceNumber ? 1 : 0;

      const leaf = {
        invoiceNo: docNum,
        date: entry.createdAt,
        size: entry.item?.size?.name || '-',
        color: entry.item?.color?.name || '-',
        qty,
        retailPrice,
        totalPriceWost,
        discountAmount,
        excludingSalesTax,
        salesTaxPercent: taxPercent,
        salesTaxAmount,
        furtherTaxAmount,
        totalTax,
        includingSalesTax,
        salesPerson,
        fbr,
      };

      addLeafToTree(leaf, entry.item);
    }

    // Process Approved Claims
    for (const claim of claims) {
      const order = claim.salesOrder;
      const fbr = order.fbrInvoiceNumber ? 1 : 0;

      for (const claimItem of claim.items) {
        if (claimItem.approvedQty <= 0) continue;

        const originalItem = order.items.find(
          (oi) =>
            oi.id === claimItem.salesOrderItemId ||
            oi.itemId === claimItem.itemId,
        );
        const taxPercent = originalItem ? Number(originalItem.taxPercent) : 18;

        const qty = claimItem.approvedQty;
        const retailPrice = originalItem
          ? Number(originalItem.unitPrice)
          : Number(claimItem.unitPaidPrice);

        const discountAmount = originalItem
          ? Number(originalItem.discountAmount) *
            (qty / (originalItem.quantity || 1))
          : (retailPrice * qty - Number(claimItem.approvedAmount)) /
            (1 + taxPercent / 100);

        const totalPriceWost = (retailPrice * qty) / (1 + taxPercent / 100);
        const excludingSalesTax = totalPriceWost - discountAmount;
        const salesTaxAmount = excludingSalesTax * (taxPercent / 100);
        const furtherTaxAmount = 0;
        const totalTax = salesTaxAmount;
        const includingSalesTax = excludingSalesTax + totalTax;

        const salesPerson = order.cashierUserId
          ? cashierMap.get(order.cashierUserId) || 'Unknown'
          : 'Unknown';

        const leaf = {
          invoiceNo: claim.claimNumber,
          date: claim.createdAt,
          size: claimItem.item?.size?.name || '-',
          color: claimItem.item?.color?.name || '-',
          qty,
          retailPrice,
          totalPriceWost,
          discountAmount,
          excludingSalesTax,
          salesTaxPercent: taxPercent,
          salesTaxAmount,
          furtherTaxAmount,
          totalTax,
          includingSalesTax,
          salesPerson,
          fbr,
        };

        addLeafToTree(leaf, claimItem.item);
      }
    }

    // Flatten Tree
    const flatRows: any[] = [];
    const flatten = (node: any, depth: number) => {
      if (node.type !== 'root') {
        flatRows.push({
          type: node.type,
          depth,
          label: node.label,
          size: node.size || '',
          color: node.color || '',
          qty: node.qty,
          retailPrice:
            node.type === 'variant'
              ? node.totalPriceWost / (node.qty || 1)
              : undefined,
          totalPriceWost: node.totalPriceWost,
          discountAmount: node.discountAmount,
          excludingSalesTax: node.excludingSalesTax,
          salesTaxPercent: node.salesTaxPercent,
          salesTaxAmount: node.salesTaxAmount,
          totalTax: node.totalTax,
          includingSalesTax: node.includingSalesTax,
          salesPerson: node.type === 'variant' ? node.salesPerson : undefined,
        });
      }

      if (node.children.size > 0) {
        const sortedKeys = Array.from(node.children.keys()).sort();
        for (const k of sortedKeys) {
          flatten(node.children.get(k), depth + 1);
        }
      }

      if (node.leaves.length > 0) {
        node.leaves.sort(
          (a: any, b: any) =>
            new Date(a.date).getTime() - new Date(b.date).getTime(),
        );
        for (const leaf of node.leaves) {
          flatRows.push({
            type: 'invoice',
            depth: depth + 1,
            label: `${leaf.invoiceNo} ${new Date(leaf.date).toLocaleDateString()}`,
            invoiceNo: leaf.invoiceNo,
            date: leaf.date,
            size: leaf.size,
            color: leaf.color,
            qty: leaf.qty,
            retailPrice: leaf.retailPrice,
            totalPriceWost: leaf.totalPriceWost,
            discountAmount: leaf.discountAmount,
            excludingSalesTax: leaf.excludingSalesTax,
            salesTaxPercent: leaf.salesTaxPercent,
            salesTaxAmount: leaf.salesTaxAmount,
            totalTax: leaf.totalTax,
            includingSalesTax: leaf.includingSalesTax,
            salesPerson: leaf.salesPerson,
          });
        }
      }
    };

    flatten(root, 0);

    const activeCashiers = cashierUserIds.length
      ? await this.prismaMaster.user.findMany({
          where: { id: { in: cashierUserIds } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            employeeId: true,
          },
        })
      : [];

    return { status: true, data: flatRows, cashiers: activeCashiers };
  }
}
