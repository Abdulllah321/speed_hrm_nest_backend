import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsDate,
  IsUUID,
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
