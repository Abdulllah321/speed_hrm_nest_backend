import { IsNotEmpty, IsString, IsNumber, IsOptional, IsBoolean, IsDateString, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAllowanceItemDto {
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @IsNotEmpty()
  @IsString()
  allowanceHeadId: string;

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

export class CreateAllowanceDto {
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
  @Type(() => CreateAllowanceItemDto)
  allowances: CreateAllowanceItemDto[];
}

export class UpdateAllowanceDto {
  @IsOptional()
  @IsString()
  allowanceHeadId?: string;

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

export class BulkCreateAllowanceDto {
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
  @Type(() => CreateAllowanceItemDto)
  allowances: CreateAllowanceItemDto[];
}
