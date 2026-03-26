import {
  IsDate,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePurchaseRequisitionItemDto {
  @IsString()
  @IsNotEmpty()
  itemId: string;

  @IsNotEmpty()
  requiredQty: number;
}

export class CreatePurchaseRequisitionDto {
  @IsString()
  @IsOptional()
  department?: string;

  @IsString()
  @IsOptional()
  type?: string;

  @IsString()
  @IsOptional()
  goodsType?: string; // CONSUMABLE, FRESH

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
