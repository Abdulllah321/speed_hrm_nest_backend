import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsDateString,
  IsArray,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum IncrementType {
  INCREMENT = 'Increment',
  DECREMENT = 'Decrement',
}

export enum IncrementMethod {
  AMOUNT = 'Amount',
  PERCENT = 'Percent',
}

export class CreateIncrementItemDto {
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @IsOptional()
  @IsString()
  employeeGradeId?: string;

  @IsOptional()
  @IsString()
  designationId?: string;

  @IsNotEmpty()
  @IsEnum(IncrementType)
  incrementType: IncrementType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  incrementAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  incrementPercentage?: number;

  @IsNotEmpty()
  @IsEnum(IncrementMethod)
  incrementMethod: IncrementMethod;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  salary: number;

  @IsNotEmpty()
  @IsDateString()
  promotionDate: string;

  @IsNotEmpty()
  @IsString()
  currentMonth: string; // Format: "01" to "12"

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  monthsOfIncrement: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class BulkCreateIncrementDto {
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateIncrementItemDto)
  increments: CreateIncrementItemDto[];
}

export class UpdateIncrementDto {
  @IsOptional()
  @IsString()
  employeeGradeId?: string;

  @IsOptional()
  @IsString()
  designationId?: string;

  @IsOptional()
  @IsEnum(IncrementType)
  incrementType?: IncrementType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  incrementAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  incrementPercentage?: number;

  @IsOptional()
  @IsEnum(IncrementMethod)
  incrementMethod?: IncrementMethod;

  @IsOptional()
  @IsNumber()
  @Min(0)
  salary?: number;

  @IsOptional()
  @IsDateString()
  promotionDate?: string;

  @IsOptional()
  @IsString()
  currentMonth?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  monthsOfIncrement?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

