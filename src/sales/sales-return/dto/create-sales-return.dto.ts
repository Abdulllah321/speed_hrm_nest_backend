import { IsString, IsNotEmpty, IsOptional, IsEnum, IsArray, ValidateNested, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum SalesReturnSourceType {
  DELIVERY_CHALLAN = 'DELIVERY_CHALLAN',
  INVOICE = 'INVOICE',
}

export enum SalesReturnType {
  DEFECTIVE = 'DEFECTIVE',
  EXCESS = 'EXCESS',
  WRONG_ITEM = 'WRONG_ITEM',
  DAMAGED = 'DAMAGED',
  SHORTAGE = 'SHORTAGE',
}

export class CreateSalesReturnItemDto {
  @IsString()
  @IsNotEmpty()
  sourceItemType: string; // DELIVERY_CHALLAN_ITEM, INVOICE_ITEM

  @IsOptional()
  @IsString()
  deliveryChallanItemId?: string;

  @IsOptional()
  @IsString()
  salesInvoiceItemId?: string;

  @IsString()
  @IsNotEmpty()
  itemId: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0.0001)
  returnQty: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;

  @IsNumber()
  @Min(0)
  lineTotal: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class CreateSalesReturnDto {
  @IsEnum(SalesReturnSourceType)
  sourceType: SalesReturnSourceType;

  @IsOptional()
  @IsString()
  deliveryChallanId?: string;

  @IsOptional()
  @IsString()
  salesInvoiceId?: string;

  @IsString()
  @IsNotEmpty()
  customerId: string;

  @IsString()
  @IsNotEmpty()
  warehouseId: string;

  @IsEnum(SalesReturnType)
  @IsOptional()
  returnType?: SalesReturnType;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  staxEInvoiceNumber?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSalesReturnItemDto)
  items: CreateSalesReturnItemDto[];
}
