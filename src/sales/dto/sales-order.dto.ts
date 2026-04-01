import { IsString, IsNumber, IsArray, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class SalesOrderItemDto {
  @IsString()
  itemId: string;

  @IsNumber()
  quantity: number;

  @IsNumber()
  salePrice: number;

  @IsOptional()
  @IsNumber()
  discount?: number;
}

export class CreateSalesOrderDto {
  @IsString()
  customerId: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsNumber()
  taxRate?: number;

  @IsOptional()
  @IsNumber()
  discount?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalesOrderItemDto)
  items: SalesOrderItemDto[];
}

export class UpdateSalesOrderDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsNumber()
  taxRate?: number;

  @IsOptional()
  @IsNumber()
  discount?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalesOrderItemDto)
  items?: SalesOrderItemDto[];
}