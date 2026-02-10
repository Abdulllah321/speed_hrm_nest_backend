
import { IsDate, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePurchaseRequisitionItemDto {
    @IsString()
    @IsNotEmpty()
    itemId: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsNotEmpty()
    requiredQty: number;

    @IsDate()
    @Type(() => Date)
    @IsOptional()
    neededByDate?: Date;
}

export class CreatePurchaseRequisitionDto {
    @IsString()
    @IsNotEmpty()
    requestedBy: string;

    @IsString()
    @IsOptional()
    department?: string;

    @IsDate()
    @Type(() => Date)
    @IsOptional()
    requestDate?: Date;

    @IsString()
    @IsOptional()
    notes?: string;

    @ValidateNested({ each: true })
    @Type(() => CreatePurchaseRequisitionItemDto)
    items: CreatePurchaseRequisitionItemDto[];
}
