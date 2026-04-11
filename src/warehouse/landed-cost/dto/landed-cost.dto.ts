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
  sku?: string;

  @IsString()
  @IsOptional()
  description?: string;

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
  exciseChargesAmount?: number;

  @IsNumber()
  @IsOptional()
  misFreightUSD?: number;

  @IsNumber()
  @IsOptional()
  misFreightPKR?: number;

  @IsNumber()
  @IsOptional()
  misDoThcPKR?: number;

  @IsNumber()
  @IsOptional()
  misBankPKR?: number;

  @IsNumber()
  @IsOptional()
  misInsurancePKR?: number;

  @IsNumber()
  @IsOptional()
  misClgFwdPKR?: number;

  @IsString()
  @IsOptional()
  misFreightInvNo?: string;

  @IsString()
  @IsOptional()
  misFreightDate?: string;

  @IsString()
  @IsOptional()
  misDoThcPoNo?: string;

  @IsString()
  @IsOptional()
  misDoThcDate?: string;

  @IsString()
  @IsOptional()
  misInsurancePolicyNo?: string;

  @IsString()
  @IsOptional()
  misClgFwdBillNo?: string;

  @IsNumber()
  @IsOptional()
  unitPrice?: number;

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

  @IsNumber()
  @IsOptional()
  freightUSD?: number;

  @IsNumber()
  @IsOptional()
  freightExRate?: number;

  @IsNumber()
  @IsOptional()
  freightPKR?: number;

  @IsString()
  @IsOptional()
  freightInvNo?: string;

  @IsString()
  @IsOptional()
  freightDate?: string;

  @IsNumber()
  @IsOptional()
  doThcCharges?: number;

  @IsString()
  @IsOptional()
  doThcPoNo?: string;

  @IsString()
  @IsOptional()
  doThcDate?: string;

  @IsNumber()
  @IsOptional()
  bankCharges?: number;

  @IsNumber()
  @IsOptional()
  insuranceChargesH?: number;

  @IsString()
  @IsOptional()
  insurancePolicyNo?: string;

  @IsNumber()
  @IsOptional()
  clgFwdCharges?: number;

  @IsString()
  @IsOptional()
  clgFwdBillNo?: string;

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
