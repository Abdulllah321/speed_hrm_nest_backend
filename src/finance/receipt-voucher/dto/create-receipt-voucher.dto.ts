import { Type, Transform } from 'class-transformer';
import {
  IsArray,
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

export class CreateReceiptVoucherInvoiceDto {
  @IsString()
  @IsNotEmpty()
  salesInvoiceId: string;

  @IsNumber()
  @Min(0.01)
  receivedAmount: number;
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
  @Transform(({ value }) => value === '' ? undefined : value)
  refBillNo?: string;

  @IsDate()
  @IsOptional()
  @Type(() => Date)
  @Transform(({ value }) => value === '' ? undefined : value)
  billDate?: Date;

  @IsString()
  @IsOptional()
  @Transform(({ value }) => value === '' ? undefined : value)
  chequeNo?: string;

  @IsDate()
  @IsOptional()
  @Type(() => Date)
  @Transform(({ value }) => value === '' ? undefined : value)
  chequeDate?: Date;

  @IsString()
  @IsNotEmpty()
  debitAccountId: string;

  @IsNumber()
  @Min(0.01)
  debitAmount: number;

  @IsOptional()
  @Transform(({ value }) => value === '' ? undefined : value)
  @IsString()
  customerId?: string;

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

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateReceiptVoucherInvoiceDto)
  invoices?: CreateReceiptVoucherInvoiceDto[];
}
