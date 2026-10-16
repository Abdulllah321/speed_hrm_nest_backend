import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateStockAdjustmentItemDto {
  @IsString()
  @IsNotEmpty()
  itemId: string;

  @IsString()
  @IsOptional()
  locationId?: string;

  @IsNumber()
  physicalQty: number;

  @IsNumber()
  @IsOptional()
  currentQty?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  rate?: number;

  @IsString()
  @IsOptional()
  swapItemId?: string;
}

export class CreateStockAdjustmentDto {
  @IsString()
  @IsOptional()
  warehouseId?: string;

  @IsString()
  @IsOptional()
  locationId?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  adjustmentType?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateStockAdjustmentItemDto)
  items: CreateStockAdjustmentItemDto[];
}
