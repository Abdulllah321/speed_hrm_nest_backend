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
  @Min(0)
  physicalQty: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  rate?: number;
}

export class CreateStockAdjustmentDto {
  @IsString()
  @IsNotEmpty()
  warehouseId: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateStockAdjustmentItemDto)
  items: CreateStockAdjustmentItemDto[];
}
