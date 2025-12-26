import { IsNotEmpty, IsString, IsNumber, IsOptional, IsBoolean, IsDateString, IsArray, ValidateNested, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAllowanceItemDto {
  @ApiProperty({ example: 'emp-uuid' })
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @ApiProperty({ example: 'ah-uuid' })
  @IsNotEmpty()
  @IsString()
  allowanceHeadId: string;

  @ApiProperty({ example: 5000 })
  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @ApiPropertyOptional({ example: 'specific', enum: ['recurring', 'specific'], description: 'Type of allowance: recurring or specific' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isTaxable?: boolean;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  taxPercentage?: number;

  @ApiPropertyOptional({ example: 'Performance based' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: 'distributed-remaining-months', enum: ['distributed-remaining-months', 'deduct-current-month'], description: 'Adjustment method for allowance' })
  @IsOptional()
  @IsString()
  @IsIn(['distributed-remaining-months', 'deduct-current-month'], {
    message: 'adjustmentMethod must be either "distributed-remaining-months" or "deduct-current-month"',
  })
  adjustmentMethod?: string; // "distributed-remaining-months" | "deduct-current-month"
}

export class CreateAllowanceDto {
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

  @ApiProperty({ type: [CreateAllowanceItemDto] })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAllowanceItemDto)
  allowances: CreateAllowanceItemDto[];
}

export class UpdateAllowanceDto {
  @ApiPropertyOptional({ example: 'ah-uuid' })
  @IsOptional()
  @IsString()
  allowanceHeadId?: string;

  @ApiPropertyOptional({ example: 6000 })
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiPropertyOptional({ example: 'specific', enum: ['recurring', 'specific'], description: 'Type of allowance: recurring or specific' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isTaxable?: boolean;

  @ApiPropertyOptional({ example: 5 })
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

  @ApiPropertyOptional({ example: 'distributed-remaining-months', enum: ['distributed-remaining-months', 'deduct-current-month'] })
  @IsOptional()
  @IsString()
  @IsIn(['distributed-remaining-months', 'deduct-current-month'], {
    message: 'adjustmentMethod must be either "distributed-remaining-months" or "deduct-current-month"',
  })
  adjustmentMethod?: string; // "distributed-remaining-months" | "deduct-current-month"
}

export class BulkCreateAllowanceDto {
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

  @ApiProperty({ type: [CreateAllowanceItemDto] })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAllowanceItemDto)
  allowances: CreateAllowanceItemDto[];
}
