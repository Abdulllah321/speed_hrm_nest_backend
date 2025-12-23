import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  ValidateNested,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateBonusItemDto {
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @IsOptional()
  @IsNumber()
  percentage?: number;
}

export class CreateBonusDto {
  @IsNotEmpty()
  @IsString()
  bonusTypeId: string;

  @IsNotEmpty()
  @IsString()
  bonusMonthYear: string; // Format: "YYYY-MM"

  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBonusItemDto)
  bonuses: CreateBonusItemDto[];

  @IsOptional()
  @IsString()
  @IsIn(['with_salary', 'separately'], {
    message: 'paymentMethod must be either "with_salary" or "separately"',
  })
  paymentMethod?: string; // "with_salary" | "separately"

  @IsOptional()
  @IsString()
  @IsIn(['distributed-remaining-months', 'deduct-current-month'], {
    message:
      'adjustmentMethod must be either "distributed-remaining-months" or "deduct-current-month"',
  })
  adjustmentMethod?: string; // "distributed-remaining-months" | "deduct-current-month"

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateBonusDto {
  @IsOptional()
  @IsString()
  bonusTypeId?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsNumber()
  percentage?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  @IsIn(['with_salary', 'separately'], {
    message: 'paymentMethod must be either "with_salary" or "separately"',
  })
  paymentMethod?: string; // "with_salary" | "separately"

  @IsOptional()
  @IsString()
  @IsIn(['distributed-remaining-months', 'deduct-current-month'], {
    message:
      'adjustmentMethod must be either "distributed-remaining-months" or "deduct-current-month"',
  })
  adjustmentMethod?: string; // "distributed-remaining-months" | "deduct-current-month"
}

export class BulkCreateBonusDto {
  @IsNotEmpty()
  @IsString()
  bonusTypeId: string;

  @IsNotEmpty()
  @IsString()
  bonusMonthYear: string; // Format: "YYYY-MM"

  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBonusItemDto)
  bonuses: CreateBonusItemDto[];

  @IsOptional()
  @IsString()
  @IsIn(['with_salary', 'separately'], {
    message: 'paymentMethod must be either "with_salary" or "separately"',
  })
  paymentMethod?: string; // "with_salary" | "separately"

  @IsOptional()
  @IsString()
  @IsIn(['distributed-remaining-months', 'deduct-current-month'], {
    message:
      'adjustmentMethod must be either "distributed-remaining-months" or "deduct-current-month"',
  })
  adjustmentMethod?: string; // "distributed-remaining-months" | "deduct-current-month"

  @IsOptional()
  @IsString()
  notes?: string;
}
