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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum IncrementType {
  INCREMENT = 'Increment',
  DECREMENT = 'Decrement',
}

export enum IncrementMethod {
  AMOUNT = 'Amount',
  PERCENT = 'Percent',
}

export class CreateIncrementItemDto {
  @ApiProperty({ example: 'emp-uuid' })
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @ApiPropertyOptional({ example: 'grade-uuid' })
  @IsOptional()
  @IsString()
  employeeGradeId?: string;

  @ApiPropertyOptional({ example: 'designation-uuid' })
  @IsOptional()
  @IsString()
  designationId?: string;

  @ApiProperty({ enum: IncrementType, example: IncrementType.INCREMENT })
  @IsNotEmpty()
  @IsEnum(IncrementType)
  incrementType: IncrementType;

  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  incrementAmount?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  incrementPercentage?: number;

  @ApiProperty({ enum: IncrementMethod, example: IncrementMethod.AMOUNT })
  @IsNotEmpty()
  @IsEnum(IncrementMethod)
  incrementMethod: IncrementMethod;

  @ApiProperty({ example: 55000 })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  salary: number;

  @ApiProperty({ example: '2023-08-01' })
  @IsNotEmpty()
  @IsDateString()
  promotionDate: string;

  @ApiProperty({ example: '08' })
  @IsNotEmpty()
  @IsString()
  currentMonth: string; // Format: "01" to "12"

  @ApiProperty({ example: 12 })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  monthsOfIncrement: number;

  @ApiPropertyOptional({ example: 'Annual Increment' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class BulkCreateIncrementDto {
  @ApiProperty({ type: [CreateIncrementItemDto] })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateIncrementItemDto)
  increments: CreateIncrementItemDto[];
}

export class UpdateIncrementDto {
  @ApiPropertyOptional({ example: 'grade-uuid' })
  @IsOptional()
  @IsString()
  employeeGradeId?: string;

  @ApiPropertyOptional({ example: 'designation-uuid' })
  @IsOptional()
  @IsString()
  designationId?: string;

  @ApiPropertyOptional({ enum: IncrementType, example: IncrementType.INCREMENT })
  @IsOptional()
  @IsEnum(IncrementType)
  incrementType?: IncrementType;

  @ApiPropertyOptional({ example: 6000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  incrementAmount?: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  incrementPercentage?: number;

  @ApiPropertyOptional({ enum: IncrementMethod, example: IncrementMethod.PERCENT })
  @IsOptional()
  @IsEnum(IncrementMethod)
  incrementMethod?: IncrementMethod;

  @ApiPropertyOptional({ example: 66000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  salary?: number;

  @ApiPropertyOptional({ example: '2023-08-01' })
  @IsOptional()
  @IsDateString()
  promotionDate?: string;

  @ApiPropertyOptional({ example: '08' })
  @IsOptional()
  @IsString()
  currentMonth?: string;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthsOfIncrement?: number;

  @ApiPropertyOptional({ example: 'Adjusted Increment' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: 'approved', enum: ['pending', 'approved', 'rejected'] })
  @IsOptional()
  @IsString()
  status?: string;
}

