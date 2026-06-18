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

export class CreateJournalVoucherDetailDto {
  @IsString()
  @IsNotEmpty()
  accountId: string;

  @IsString()
  @IsOptional()
  tagAccountId?: string;

  @IsNumber()
  @Min(0)
  debit: number;

  @IsNumber()
  @Min(0)
  credit: number;

  @IsString()
  @IsOptional()
  narration?: string;       // Per-line narration

  @IsString()
  @IsOptional()
  refBillNo?: string;       // Bill/ref number for this line

  @IsString()
  @IsOptional()
  refBillNo2?: string;

  @IsString()
  @IsOptional()
  taxType?: string;
}

export class CreateJournalVoucherDto {
  @IsString()
  @IsNotEmpty()
  jvNo: string;

  @IsDate()
  @Type(() => Date)
  jvDate: Date;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateJournalVoucherDetailDto)
  details: CreateJournalVoucherDetailDto[];
}
