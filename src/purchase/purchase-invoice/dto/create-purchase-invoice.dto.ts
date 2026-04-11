import { IsString, IsDateString, IsOptional, IsArray, ValidateNested, IsNumber, IsUUID, IsIn } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class CreatePurchaseInvoiceItemDto {
  @IsString()
  itemId: string;

  @IsOptional()
  @IsUUID()
  @Transform(({ value }) => value === '' ? undefined : value)
  grnItemId?: string;

  @IsOptional()
  @IsUUID()
  @Transform(({ value }) => value === '' ? undefined : value)
  landedCostItemId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Transform(({ value }) => parseFloat(value))
  quantity: number;

  @IsNumber()
  @Transform(({ value }) => parseFloat(value))
  unitPrice: number;

  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => parseFloat(value))
  taxRate?: number;

  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => parseFloat(value))
  discountRate?: number;
}

export class CreatePurchaseInvoiceDto {
  @IsString()
  invoiceNumber: string;

  @IsDateString()
  invoiceDate: string;

  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => value === '' ? undefined : value)
  dueDate?: string;

  @IsUUID()
  supplierId: string;

  @IsOptional()
  @IsUUID()
  @Transform(({ value }) => value === '' ? undefined : value)
  grnId?: string;

  @IsOptional()
  @IsUUID()
  @Transform(({ value }) => value === '' ? undefined : value)
  landedCostId?: string;

  @IsOptional()
  @IsUUID()
  @Transform(({ value }) => value === '' ? undefined : value)
  warehouseId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['GRN_BASED', 'LANDED_COST_BASED', 'DIRECT'])
  invoiceType?: 'GRN_BASED' | 'LANDED_COST_BASED' | 'DIRECT';

  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => parseFloat(value))
  discountAmount?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  @IsIn(['DRAFT', 'SUBMITTED', 'APPROVED', 'CANCELLED'])
  status?: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'CANCELLED';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseInvoiceItemDto)
  items: CreatePurchaseInvoiceItemDto[];
}