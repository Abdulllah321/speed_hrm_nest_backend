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
  @Min(0)
  amount: number;

  @IsString()
  @IsOptional()
  description?: string;
}

export class LandedCostItemDto {
  @IsString()
  @IsNotEmpty()
  itemId: string;

  @IsString()
  @IsOptional()
  hsCode?: string;

  @IsNumber()
  @Min(0)
  qty: number;

  @IsNumber()
  @Min(0)
  unitFob: number;

  @IsNumber()
  @Min(0)
  freightForeign: number;

  @IsNumber()
  @Min(0)
  insuranceCharges: number;

  @IsNumber()
  @Min(0)
  landingCharges: number;

  @IsNumber()
  @Min(0)
  assessableValue: number;

  @IsNumber()
  @Min(0)
  unitCostPKR: number;

  @IsNumber()
  @Min(0)
  totalCostPKR: number;

  @IsNumber()
  @IsOptional()
  customsDutyRate?: number;

  @IsNumber()
  @IsOptional()
  customsDutyAmount?: number;

  @IsNumber()
  @IsOptional()
  regulatoryDutyRate?: number;

  @IsNumber()
  @IsOptional()
  regulatoryDutyAmount?: number;

  @IsNumber()
  @IsOptional()
  additionalCustomsDutyRate?: number;

  @IsNumber()
  @IsOptional()
  additionalCustomsDutyAmount?: number;

  @IsNumber()
  @IsOptional()
  salesTaxRate?: number;

  @IsNumber()
  @IsOptional()
  salesTaxAmount?: number;

  @IsNumber()
  @IsOptional()
  additionalSalesTaxRate?: number;

  @IsNumber()
  @IsOptional()
  additionalSalesTaxAmount?: number;

  @IsNumber()
  @IsOptional()
  incomeTaxRate?: number;

  @IsNumber()
  @IsOptional()
  incomeTaxAmount?: number;

  @IsNumber()
  @IsOptional()
  otherChargesPKR?: number;
}

export class CreateLandedCostDto {
  @IsString()
  @IsNotEmpty()
  grnId: string;

  @IsString()
  @IsNotEmpty()
  supplierId: string;

  @IsString()
  @IsOptional()
  purchaseOrderId?: string;

  @IsString()
  @IsOptional()
  lcNo?: string;

  @IsString()
  @IsOptional()
  blNo?: string;

  @IsOptional()
  blDate?: Date;

  @IsString()
  @IsOptional()
  countryOfOrigin?: string;

  @IsString()
  @IsOptional()
  gdNo?: string;

  @IsOptional()
  gdDate?: Date;

  @IsString()
  @IsOptional()
  season?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  shippingInvoiceNo?: string;

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsNumber()
  @Min(0)
  exchangeRate: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LandedCostItemDto)
  @IsNotEmpty()
  items: LandedCostItemDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LandedCostChargeDto)
  @IsOptional()
  charges?: LandedCostChargeDto[];
}
