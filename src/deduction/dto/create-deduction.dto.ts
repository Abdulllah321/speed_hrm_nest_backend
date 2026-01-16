import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsDateString,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDeductionItemDto {
  @ApiProperty({ example: 'emp-uuid' })
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @ApiProperty({ example: 'dh-uuid' })
  @IsNotEmpty()
  @IsString()
  deductionHeadId: string;

  @ApiProperty({ example: 1000 })
  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isTaxable?: boolean;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  taxPercentage?: number;

  @ApiPropertyOptional({ example: 'Penalty' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateDeductionDto {
  @ApiProperty({ example: '01' })
  @IsNotEmpty()
  @IsString()
  month: string; // Format: "01" to "12"

  @ApiProperty({ example: '2023' })
  @IsNotEmpty()
  @IsString()
  year: string; // Format: "YYYY"

  @ApiProperty({ example: '2023-01-31' })
  @IsNotEmpty()
  @IsDateString()
  date: string; // Full date for reference

  @ApiProperty({ type: [CreateDeductionItemDto] })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDeductionItemDto)
  deductions: CreateDeductionItemDto[];
}

export class UpdateDeductionDto {
  @ApiPropertyOptional({ example: 'dh-uuid' })
  @IsOptional()
  @IsString()
  deductionHeadId?: string;

  @ApiPropertyOptional({ example: 1200 })
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isTaxable?: boolean;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  taxPercentage?: number;

  @ApiPropertyOptional({ example: 'Updated notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: 'approved' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class BulkCreateDeductionDto {
  @ApiProperty({ example: '02' })
  @IsNotEmpty()
  @IsString()
  month: string;

  @ApiProperty({ example: '2023' })
  @IsNotEmpty()
  @IsString()
  year: string;

  @ApiProperty({ example: '2023-02-28' })
  @IsNotEmpty()
  @IsDateString()
  date: string;

  @ApiProperty({ type: [CreateDeductionItemDto] })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDeductionItemDto)
  deductions: CreateDeductionItemDto[];
}
