import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  ValidateNested,
  IsIn,
  IsBoolean,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBonusItemDto {
  @ApiProperty({ example: 'emp-uuid' })
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @ApiProperty({ example: 5000 })
  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  percentage?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isTaxable?: boolean;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  taxPercentage?: number;
}

export class CreateBonusDto {
  @ApiProperty({ example: 'bt-uuid' })
  @IsNotEmpty()
  @IsString()
  bonusTypeId: string;

  @ApiProperty({ example: '2023-12' })
  @IsNotEmpty()
  @IsString()
  bonusMonthYear: string; // Format: "YYYY-MM"

  @ApiProperty({ type: [CreateBonusItemDto] })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBonusItemDto)
  bonuses: CreateBonusItemDto[];

  @ApiPropertyOptional({ example: 'with_salary', enum: ['with_salary', 'separately'] })
  @IsOptional()
  @IsString()
  @IsIn(['with_salary', 'separately'], {
    message: 'paymentMethod must be either "with_salary" or "separately"',
  })
  paymentMethod?: string; // "with_salary" | "separately"

  @ApiPropertyOptional({ example: 'deduct-current-month', enum: ['distributed-remaining-months', 'deduct-current-month'] })
  @IsOptional()
  @IsString()
  @IsIn(['distributed-remaining-months', 'deduct-current-month'], {
    message:
      'adjustmentMethod must be either "distributed-remaining-months" or "deduct-current-month"',
  })
  adjustmentMethod?: string; // "distributed-remaining-months" | "deduct-current-month"

  @ApiPropertyOptional({ example: 'Holiday Bonus' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value === 'true' || value === '1';
    }
    return Boolean(value);
  })
  isTaxable?: boolean;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  taxPercentage?: number;
}

export class UpdateBonusDto {
  @ApiPropertyOptional({ example: 'bt-uuid' })
  @IsOptional()
  @IsString()
  bonusTypeId?: string;

  @ApiPropertyOptional({ example: 6000 })
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsNumber()
  percentage?: number;

  @ApiPropertyOptional({ example: 'Updated Notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: 'approved' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'separately', enum: ['with_salary', 'separately'] })
  @IsOptional()
  @IsString()
  @IsIn(['with_salary', 'separately'], {
    message: 'paymentMethod must be either "with_salary" or "separately"',
  })
  paymentMethod?: string; // "with_salary" | "separately"

  @ApiPropertyOptional({ example: 'distributed-remaining-months', enum: ['distributed-remaining-months', 'deduct-current-month'] })
  @IsOptional()
  @IsString()
  @IsIn(['distributed-remaining-months', 'deduct-current-month'], {
    message:
      'adjustmentMethod must be either "distributed-remaining-months" or "deduct-current-month"',
  })
  adjustmentMethod?: string; // "distributed-remaining-months" | "deduct-current-month"

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isTaxable?: boolean;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  taxPercentage?: number;
}

export class BulkCreateBonusDto {
  @ApiProperty({ example: 'bt-uuid' })
  @IsNotEmpty()
  @IsString()
  bonusTypeId: string;

  @ApiProperty({ example: '2023-12' })
  @IsNotEmpty()
  @IsString()
  bonusMonthYear: string; // Format: "YYYY-MM"

  @ApiProperty({ type: [CreateBonusItemDto] })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBonusItemDto)
  bonuses: CreateBonusItemDto[];

  @ApiPropertyOptional({ example: 'with_salary', enum: ['with_salary', 'separately'] })
  @IsOptional()
  @IsString()
  @IsIn(['with_salary', 'separately'], {
    message: 'paymentMethod must be either "with_salary" or "separately"',
  })
  paymentMethod?: string; // "with_salary" | "separately"

  @ApiPropertyOptional({ example: 'deduct-current-month', enum: ['distributed-remaining-months', 'deduct-current-month'] })
  @IsOptional()
  @IsString()
  @IsIn(['distributed-remaining-months', 'deduct-current-month'], {
    message:
      'adjustmentMethod must be either "distributed-remaining-months" or "deduct-current-month"',
  })
  adjustmentMethod?: string; // "distributed-remaining-months" | "deduct-current-month"

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value === 'true' || value === '1';
    }
    return Boolean(value);
  })
  isTaxable?: boolean;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  taxPercentage?: number;

  @ApiPropertyOptional({ example: 'Bulk Bonus' })
  @IsOptional()
  @IsString()
  notes?: string;
}
