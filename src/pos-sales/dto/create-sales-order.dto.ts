import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsString,
    IsOptional,
    IsArray,
    ValidateNested,
    IsNumber,
    Min,
    Max,
    IsInt,
    IsIn,
    IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SalesOrderItemDto {
    @ApiProperty({ description: 'Item UUID' })
    @IsString()
    itemId: string;

    @ApiProperty({ description: 'Quantity', default: 1 })
    @IsInt()
    @Min(1)
    quantity: number;

    @ApiProperty({ description: 'Unit price' })
    @IsNumber()
    @Min(0)
    unitPrice: number;

    @ApiPropertyOptional({ description: 'Discount percentage (0-100)', default: 0 })
    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    discountPercent?: number;

    @ApiPropertyOptional({ description: 'Tax percentage', default: 0 })
    @IsOptional()
    @IsNumber()
    @Min(0)
    taxPercent?: number;

    @ApiPropertyOptional({ description: 'Additional promo discount applied to this item' })
    @IsOptional()
    @IsNumber()
    @Min(0)
    promoDiscountAmount?: number;

    @ApiPropertyOptional({ description: 'Mark item as stock in transit (customer ordered but stock not yet at location)' })
    @IsOptional()
    isStockInTransit?: boolean;
}

// ── Multi-tender item ────────────────────────────────────────────────────
export class TenderItemDto {
    @ApiProperty({ description: 'Tender method: cash | card | bank_transfer | voucher' })
    @IsString()
    @IsIn(['cash', 'card', 'bank_transfer', 'voucher'])
    method: string;

    @ApiProperty({ description: 'Amount tendered' })
    @IsNumber()
    @Min(0)
    amount: number;

    @ApiPropertyOptional({ description: 'Last 4 digits of card (for card tenders)' })
    @IsOptional()
    @IsString()
    cardLast4?: string;

    @ApiPropertyOptional({ description: 'Merchant / bank slip reference number' })
    @IsOptional()
    @IsString()
    slipNo?: string;
}

// ── Alliance / bank card meta ─────────────────────────────────────────────
export class AllianceMetaDto {
    @ApiPropertyOptional({ description: 'Cardholder name' })
    @IsOptional()
    @IsString()
    cardholderName?: string;

    @ApiPropertyOptional({ description: 'Last 4 digits of bank card' })
    @IsOptional()
    @IsString()
    cardLast4?: string;

    @ApiPropertyOptional({ description: 'Merchant bank slip reference' })
    @IsOptional()
    @IsString()
    merchantSlip?: string;
}

// ── Voucher redemption item ───────────────────────────────────────────────
export class VoucherRedemptionDto {
    @ApiProperty({ description: 'Voucher UUID' })
    @IsString()
    voucherId: string;

    @ApiProperty({ description: 'Voucher code' })
    @IsString()
    code: string;

    @ApiProperty({ description: 'Amount redeemed from this voucher' })
    @IsNumber()
    @Min(0)
    amount: number;
}

// ── Promo scope (order-wide or per specific items) ─────────────────────────
export class PromoScopeDto {
    @ApiProperty({ description: 'Scope type: order | items' })
    @IsString()
    @IsIn(['order', 'items'])
    type: 'order' | 'items';

    @ApiPropertyOptional({ description: 'Item IDs promo applies to (when type=items)' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    itemIds?: string[];
}

export class CreateSalesOrderDto {
    @ApiPropertyOptional({ description: 'POS terminal UUID' })
    @IsOptional()
    @IsString()
    posId?: string; // Terminal Code

    @ApiPropertyOptional({ description: 'POS terminal record UUID' })
    @IsOptional()
    @IsString()
    terminalId?: string;

    @ApiPropertyOptional({ description: 'Location UUID' })
    @IsOptional()
    @IsString()
    locationId?: string;

    @ApiPropertyOptional({ description: 'Customer UUID' })
    @IsOptional()
    @IsString()
    customerId?: string;

    @ApiPropertyOptional({ description: 'Notes / memo' })
    @IsOptional()
    @IsString()
    notes?: string;

    // ── Discount fields ──────────────────────────────────────────────────
    @ApiPropertyOptional({ description: 'Global discount percentage (0-100)' })
    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    globalDiscountPercent?: number;

    @ApiPropertyOptional({ description: 'Global discount flat amount' })
    @IsOptional()
    @IsNumber()
    @Min(0)
    globalDiscountAmount?: number;

    @ApiPropertyOptional({ description: 'Promo campaign UUID' })
    @IsOptional()
    @IsString()
    promoId?: string;

    @ApiPropertyOptional({ description: 'Promo scope — order or specific items' })
    @IsOptional()
    @ValidateNested()
    @Type(() => PromoScopeDto)
    promoScope?: PromoScopeDto;

    @ApiPropertyOptional({ description: 'Coupon code UUID' })
    @IsOptional()
    @IsString()
    couponId?: string;

    @ApiPropertyOptional({ description: 'Alliance discount UUID' })
    @IsOptional()
    @IsString()
    allianceId?: string;

    @ApiPropertyOptional({ description: 'Alliance / bank card metadata' })
    @IsOptional()
    @ValidateNested()
    @Type(() => AllianceMetaDto)
    allianceMeta?: AllianceMetaDto;

    // ── Multi-tender payments ──────────────────────────────────────────────
    @ApiPropertyOptional({ description: 'Split payment tenders (supports multiple methods)' })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => TenderItemDto)
    tenders?: TenderItemDto[];

    // ── Legacy single-tender fields (kept for back-compat) ────────────────
    @ApiPropertyOptional({ description: 'Payment method (legacy)' })
    @IsOptional()
    @IsString()
    paymentMethod?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    @Min(0)
    cashAmount?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    @Min(0)
    cardAmount?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    @Min(0)
    changeAmount?: number;

    @ApiPropertyOptional({ description: 'If resuming from a hold order, pass the hold order ID to skip stock deduction (already done at hold time)' })
    @IsOptional()
    @IsString()
    holdOrderId?: string;

    @ApiPropertyOptional({ description: 'Flag to indicate this is a credit sale (customer will pay later)' })
    @IsOptional()
    isCreditSale?: boolean;

    @ApiPropertyOptional({ description: 'Credit amount (unpaid balance) for credit sales' })
    @IsOptional()
    @IsNumber()
    @Min(0)
    creditAmount?: number;

    @ApiPropertyOptional({ description: 'Gift receipt - print without prices' })
    @IsOptional()
    isGiftReceipt?: boolean;

    @ApiPropertyOptional({ description: 'Vouchers to redeem against this order', type: [VoucherRedemptionDto] })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => VoucherRedemptionDto)
    voucherRedemptions?: VoucherRedemptionDto[];

    @ApiProperty({ type: [SalesOrderItemDto] })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SalesOrderItemDto)
    items: SalesOrderItemDto[];
}
