import { IsString, IsOptional, IsArray, ValidateNested, IsNumber, IsEnum, IsNotEmpty, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export enum ReturnSourceType {
  GRN = 'GRN',
  LANDED_COST = 'LANDED_COST'
}

export enum ReturnType {
  DEFECTIVE = 'DEFECTIVE',
  EXCESS = 'EXCESS',
  WRONG_ITEM = 'WRONG_ITEM',
  DAMAGED = 'DAMAGED'
}

export class CreatePurchaseReturnItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  sourceItemType: string; // GRN_ITEM, LANDED_COST_ITEM

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  grnItemId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  landedCostItemId?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  itemId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty()
  @IsNumber({}, { message: 'Return quantity must be a valid number' })
  @IsPositive({ message: 'Return quantity must be positive' })
  @Type(() => Number)
  returnQty: number;

  @ApiProperty()
  @IsNumber({}, { message: 'Unit price must be a valid number' })
  @IsPositive({ message: 'Unit price must be positive' })
  @Type(() => Number)
  unitPrice: number;

  @ApiProperty()
  @IsNumber({}, { message: 'Line total must be a valid number' })
  @Type(() => Number)
  lineTotal: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class CreatePurchaseReturnDto {
  @ApiProperty({ enum: ReturnSourceType })
  @IsEnum(ReturnSourceType)
  sourceType: ReturnSourceType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  grnId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  landedCostId?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  supplierId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  warehouseId: string;

  @ApiProperty({ enum: ReturnType })
  @IsEnum(ReturnType)
  returnType: ReturnType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: [CreatePurchaseReturnItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseReturnItemDto)
  items: CreatePurchaseReturnItemDto[];
}