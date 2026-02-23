import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreatePaymentVoucherDetailDto {
  @IsString()
  @IsNotEmpty()
  accountId: string;

  @IsNumber()
  @Min(0)
  debit: number;
}

export class CreatePaymentVoucherDto {
  @IsString()
  @IsNotEmpty()
  type: string; // bank or cash

  @IsString()
  @IsNotEmpty()
  pvNo: string;

  @IsDate()
  @Type(() => Date)
  pvDate: Date;

  @IsString()
  @IsOptional()
  refBillNo?: string;

  @IsDate()
  @IsOptional()
  @Type(() => Date)
  billDate?: Date;

  @IsString()
  @IsOptional()
  chequeNo?: string;

  @IsDate()
  @IsOptional()
  @Type(() => Date)
  chequeDate?: Date;

  @IsString()
  @IsNotEmpty()
  creditAccountId: string;

  @IsNumber()
  @Min(0)
  creditAmount: number;

  @IsBoolean()
  @IsOptional()
  isAdvance?: boolean;

  @IsBoolean()
  @IsOptional()
  isTaxApplicable?: boolean;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePaymentVoucherDetailDto)
  details: CreatePaymentVoucherDetailDto[];
}
