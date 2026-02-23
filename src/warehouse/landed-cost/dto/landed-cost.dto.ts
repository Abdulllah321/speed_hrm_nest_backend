import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class LandedCostChargeDto {
  @IsString()
  @IsNotEmpty()
  accountId: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsString()
  @IsOptional()
  description?: string;
}

export class PostLandedCostDto {
  @IsString()
  @IsNotEmpty()
  grnId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LandedCostChargeDto)
  @IsOptional()
  charges?: LandedCostChargeDto[];

  @IsString()
  @IsOptional()
  inventoryAccountId?: string;
}

export class LandedCostItemRateDto {
  @IsString()
  @IsNotEmpty()
  itemId: string;

  @IsNumber()
  @Min(0)
  rate: number;
}

export class PostLandedCostDtoWithRates extends PostLandedCostDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LandedCostItemRateDto)
  @IsOptional()
  itemRates?: LandedCostItemRateDto[];
}
