import { IsNotEmpty, IsString, IsNumber, IsOptional, IsBoolean, IsDateString, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateDeductionItemDto {
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @IsNotEmpty()
  @IsString()
  deductionHeadId: string;

  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @IsOptional()
  @IsBoolean()
  isTaxable?: boolean;

  @IsOptional()
  @IsNumber()
  taxPercentage?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateDeductionDto {
  @IsNotEmpty()
  @IsString()
  month: string; // Format: "01" to "12"

  @IsNotEmpty()
  @IsString()
  year: string; // Format: "YYYY"

  @IsNotEmpty()
  @IsDateString()
  date: string; // Full date for reference

  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDeductionItemDto)
  deductions: CreateDeductionItemDto[];
}

export class UpdateDeductionDto {
  @IsOptional()
  @IsString()
  deductionHeadId?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsBoolean()
  isTaxable?: boolean;

  @IsOptional()
  @IsNumber()
  taxPercentage?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class BulkCreateDeductionDto {
  @IsNotEmpty()
  @IsString()
  month: string;

  @IsNotEmpty()
  @IsString()
  year: string;

  @IsNotEmpty()
  @IsDateString()
  date: string;

  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDeductionItemDto)
  deductions: CreateDeductionItemDto[];
}
