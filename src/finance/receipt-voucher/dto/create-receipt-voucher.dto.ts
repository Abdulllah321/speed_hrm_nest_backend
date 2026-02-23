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

export class CreateReceiptVoucherDetailDto {
  @IsString()
  @IsNotEmpty()
  accountId: string;

  @IsNumber()
  @Min(0)
  credit: number;
}

export class CreateReceiptVoucherDto {
  @IsString()
  @IsNotEmpty()
  type: string; // bank or cash

  @IsString()
  @IsNotEmpty()
  rvNo: string;

  @IsDate()
  @Type(() => Date)
  rvDate: Date;

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
  debitAccountId: string;

  @IsNumber()
  @Min(0)
  debitAmount: number;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateReceiptVoucherDetailDto)
  details: CreateReceiptVoucherDetailDto[];
}
