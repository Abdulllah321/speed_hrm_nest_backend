import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsArray,
  ValidateNested,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePurchaseOrderItemDto {
  @IsString()
  @IsNotEmpty()
  itemId: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  quantity: number;

  @IsNumber()
  unitPrice: number;
}

export class CreatePurchaseOrderDto {
  @IsString()
  @IsOptional()
  vendorQuotationId?: string;

  @IsString()
  @IsOptional()
  vendorId?: string;

  @IsString()
  @IsOptional()
  purchaseRequisitionId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderItemDto)
  @IsOptional()
  items?: CreatePurchaseOrderItemDto[];

  @IsString()
  @IsOptional()
  notes?: string;

  @IsDateString()
  @IsOptional()
  expectedDeliveryDate?: string;

  @IsString()
  @IsOptional()
  orderType?: string; // IMPORT, LOCAL

  @IsString()
  @IsOptional()
  goodsType?: string; // CONSUMABLE, FRESH
}

export class PurchaseOrderResponseDto {
  id: string;
  poNumber: string;
  status: string;
  totalAmount: string;
  vendor: {
    name: string;
  };
  createdAt: Date;
}

export class AwardItemDto {
  @IsString()
  @IsNotEmpty()
  itemId: string;

  @IsNumber()
  quantity: number;
}

export class AwardGroupDto {
  @IsString()
  @IsNotEmpty()
  vendorQuotationId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AwardItemDto)
  items: AwardItemDto[];

  @IsString()
  @IsOptional()
  notes?: string;

  @IsDateString()
  @IsOptional()
  expectedDeliveryDate?: string;

  @IsString()
  @IsOptional()
  orderType?: string; // IMPORT, LOCAL

  @IsString()
  @IsOptional()
  goodsType?: string; // CONSUMABLE, FRESH
}

export class AwardFromRfqDto {
  @IsString()
  @IsNotEmpty()
  rfqId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AwardGroupDto)
  awards: AwardGroupDto[];
}

export class MultiDirectItemDto {
  @IsString()
  @IsNotEmpty()
  itemId: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  quantity: number;

  @IsNumber()
  unitPrice: number;
}

export class MultiDirectGroupDto {
  @IsString()
  @IsNotEmpty()
  vendorId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MultiDirectItemDto)
  items: MultiDirectItemDto[];

  @IsString()
  @IsOptional()
  notes?: string;

  @IsDateString()
  @IsOptional()
  expectedDeliveryDate?: string;

  @IsString()
  @IsOptional()
  orderType?: string; // IMPORT, LOCAL

  @IsString()
  @IsOptional()
  goodsType?: string; // CONSUMABLE, FRESH
}

export class CreateMultiDirectPurchaseOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MultiDirectGroupDto)
  awards: MultiDirectGroupDto[];
}
