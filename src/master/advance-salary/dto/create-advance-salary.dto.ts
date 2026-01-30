import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  IsDateString,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAdvanceSalaryItemDto {
  @ApiProperty({ example: 'emp-uuid' })
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @ApiProperty({ example: 5000 })
  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @ApiProperty({ example: '2023-01-15' })
  @IsNotEmpty()
  @IsDateString()
  neededOn: string; // When the advance salary is needed

  @ApiProperty({ example: '02' })
  @IsNotEmpty()
  @IsString()
  deductionMonth: string; // Format: "01" to "12"

  @ApiProperty({ example: '2023' })
  @IsNotEmpty()
  @IsString()
  deductionYear: string; // Format: "YYYY"

  @ApiProperty({ example: '2023-02' })
  @IsNotEmpty()
  @IsString()
  deductionMonthYear: string; // Format: "YYYY-MM"

  @ApiProperty({ example: 'Personal Loan' })
  @IsNotEmpty()
  @IsString()
  reason: string; // Detailed reason
}

export class CreateAdvanceSalaryDto {
  @ApiProperty({ type: [CreateAdvanceSalaryItemDto] })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAdvanceSalaryItemDto)
  advanceSalaries: CreateAdvanceSalaryItemDto[];
}

export class UpdateAdvanceSalaryDto {
  @ApiPropertyOptional({ example: 6000 })
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiPropertyOptional({ example: '2023-01-20' })
  @IsOptional()
  @IsDateString()
  neededOn?: string;

  @ApiPropertyOptional({ example: '03' })
  @IsOptional()
  @IsString()
  deductionMonth?: string;

  @ApiPropertyOptional({ example: '2023' })
  @IsOptional()
  @IsString()
  deductionYear?: string;

  @ApiPropertyOptional({ example: '2023-03' })
  @IsOptional()
  @IsString()
  deductionMonthYear?: string;

  @ApiPropertyOptional({ example: 'Emergency' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({
    example: 'pending',
    enum: ['pending', 'approved', 'rejected'],
  })
  @IsOptional()
  @IsString()
  approvalStatus?: string; // pending, approved, rejected

  @ApiPropertyOptional({ example: 'Policy violation' })
  @IsOptional()
  @IsString()
  rejectionReason?: string;

  @ApiPropertyOptional({
    example: 'active',
    enum: ['pending', 'active', 'completed', 'cancelled', 'rejected'],
  })
  @IsOptional()
  @IsString()
  status?: string; // pending, active, completed, cancelled, rejected
}

export class ApproveAdvanceSalaryDto {
  @ApiPropertyOptional({ example: 'Invalid request' })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
