import { IsString, IsNotEmpty, IsOptional, IsDateString, IsArray, ValidateNested, IsNumber } from 'class-validator';
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

    @IsNumber()
    @IsOptional()
    taxPercent?: number;

    @IsNumber()
    @IsOptional()
    discountPercent?: number;
}

export class CreatePurchaseOrderDto {
    @IsString()
    @IsOptional()
    vendorQuotationId?: string;

    @IsString()
    @IsOptional()
    vendorId?: string;

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
