import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsDate,
  IsUUID,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateItemDto {
  // itemId will be auto-generated (6-digit serial)

  @IsString()
  sku: string;

  @IsString()
  @IsOptional()
  barCode?: string;

  @IsUUID()
  @IsOptional()
  hsCodeId?: string;

  @IsString()
  @IsOptional()
  hsCodeStr?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  status?: string;

  // Pricing & Discounts
  @IsNumber()
  @IsOptional()
  unitPrice?: number;

  @IsNumber()
  @IsOptional()
  fob?: number;

  @IsNumber()
  @IsOptional()
  unitCost?: number;

  @IsNumber()
  @IsOptional()
  taxRate1?: number;

  @IsNumber()
  @IsOptional()
  taxRate2?: number;

  @IsNumber()
  @IsOptional()
  discountRate?: number;

  @IsNumber()
  @IsOptional()
  discountAmount?: number;

  @IsDate()
  @IsOptional()
  @Type(() => Date)
  discountStartDate?: Date;

  @IsDate()
  @IsOptional()
  @Type(() => Date)
  discountEndDate?: Date;

  // Attributes
  @IsString()
  @IsOptional()
  case?: string;

  @IsString()
  @IsOptional()
  band?: string;

  @IsString()
  @IsOptional()
  movementType?: string;

  @IsString()
  @IsOptional()
  heelHeight?: string;

  @IsString()
  @IsOptional()
  width?: string;

  // Master Relations (Id's)
  @IsUUID()
  @IsOptional()
  brandId?: string;

  @IsUUID()
  @IsOptional()
  divisionId?: string;

  @IsUUID()
  @IsOptional()
  genderId?: string;

  @IsUUID()
  @IsOptional()
  sizeId?: string;

  @IsUUID()
  @IsOptional()
  silhouetteId?: string;

  @IsUUID()
  @IsOptional()
  channelClassId?: string;

  @IsUUID()
  @IsOptional()
  colorId?: string;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsUUID()
  @IsOptional()
  subCategoryId?: string;

  @IsUUID()
  @IsOptional()
  itemClassId?: string;

  @IsUUID()
  @IsOptional()
  itemSubclassId?: string;

  @IsUUID()
  @IsOptional()
  seasonId?: string;

  @IsUUID()
  @IsOptional()
  segmentId?: string;
}

export class UpdateItemDto extends CreateItemDto { }

// ─── Bulk Discount ────────────────────────────────────────────────────────────

export class BulkDiscountItemOverrideDto {
  @IsUUID()
  id: string;

  @IsNumber()
  @IsOptional()
  discountRate?: number;

  @IsNumber()
  @IsOptional()
  discountAmount?: number;

  // Pre-apply snapshot for DB rollback (sent by frontend)
  @IsNumber()
  @IsOptional()
  prevDiscountRate?: number;

  @IsNumber()
  @IsOptional()
  prevDiscountAmount?: number;

  @IsDate()
  @IsOptional()
  @Type(() => Date)
  prevStartDate?: Date;

  @IsDate()
  @IsOptional()
  @Type(() => Date)
  prevEndDate?: Date;
}

export class BulkDiscountDto {
  /** Campaign name — stored in DiscountCampaign table */
  @IsString()
  campaignName: string;

  @IsUUID(undefined, { each: true })
  itemIds: string[];

  /** Percent discount applied to all items */
  @IsNumber()
  @IsOptional()
  discountRate?: number;

  /** Fixed amount discount applied to all items */
  @IsNumber()
  @IsOptional()
  discountAmount?: number;

  @IsDate()
  @IsOptional()
  @Type(() => Date)
  discountStartDate?: Date;

  @IsDate()
  @IsOptional()
  @Type(() => Date)
  discountEndDate?: Date;

  /** When true, clears all discount fields on the selected items */
  @IsBoolean()
  @IsOptional()
  clearDiscount?: boolean;

  /** Internal notes */
  @IsString()
  @IsOptional()
  notes?: string;

  /** WarehouseLocation IDs this campaign is scoped to (empty = global) */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locationIds?: string[];

  /** Display names for the locations (parallel array to locationIds, for history display) */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locationNames?: string[];

  /** Per-item overrides with pre-apply snapshots */
  @IsOptional()
  overrides?: BulkDiscountItemOverrideDto[];

  /** ID of the user applying the campaign */
  @IsString()
  @IsOptional()
  appliedById?: string;
}

// ─── Campaign Rollback ────────────────────────────────────────────────────────

export class RollbackCampaignDto {
  @IsUUID()
  campaignId: string;
}

// ─── Bulk Sale Price Update ───────────────────────────────────────────────────

export class BulkSalePriceItemOverrideDto {
  @IsUUID()
  id: string;

  @IsNumber()
  unitPrice: number;
}

export class BulkSalePriceDto {
  /** Human-readable label stored for audit trail */
  @IsString()
  campaignName: string;

  @IsUUID(undefined, { each: true })
  itemIds: string[];

  /**
   * New unit price applied to all selected items.
   * Ignored when overrides are provided for a specific item.
   */
  @IsNumber()
  @IsOptional()
  unitPrice?: number;

  /** Per-item price overrides — takes precedence over the shared unitPrice */
  @IsOptional()
  overrides?: BulkSalePriceItemOverrideDto[];

  /** Internal notes */
  @IsString()
  @IsOptional()
  notes?: string;

  /** ID of the user applying the update */
  @IsString()
  @IsOptional()
  appliedById?: string;
}
