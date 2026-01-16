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

export class CreateLeaveEncashmentItemDto {
  @ApiProperty({ example: 'emp-uuid' })
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @ApiProperty({ example: '2023-01-15' })
  @IsNotEmpty()
  @IsDateString()
  encashmentDate: string; // Date when leave is encashed

  @ApiProperty({ example: 12 })
  @IsNotEmpty()
  @IsNumber()
  encashmentDays: number; // Number of leave days encashed

  @ApiProperty({ example: 5000 })
  @IsNotEmpty()
  @IsNumber()
  encashmentAmount: number; // Total amount to be paid

  @ApiProperty({ example: '02' })
  @IsNotEmpty()
  @IsString()
  paymentMonth: string; // Format: "01" to "12"

  @ApiProperty({ example: '2023' })
  @IsNotEmpty()
  @IsString()
  paymentYear: string; // Format: "YYYY"

  @ApiProperty({ example: '2023-02' })
  @IsNotEmpty()
  @IsString()
  paymentMonthYear: string; // Format: "YYYY-MM"

  @ApiPropertyOptional({ example: 100000 })
  @IsOptional()
  @IsNumber()
  grossSalary?: number; // Employee's gross salary at time of encashment

  @ApiPropertyOptional({ example: 1200000 })
  @IsOptional()
  @IsNumber()
  annualSalary?: number; // Annual salary for per day calculation

  @ApiPropertyOptional({ example: 3287.67 })
  @IsOptional()
  @IsNumber()
  perDayAmount?: number; // Per day amount calculated
}

export class CreateLeaveEncashmentDto {
  @ApiProperty({ type: [CreateLeaveEncashmentItemDto] })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateLeaveEncashmentItemDto)
  leaveEncashments: CreateLeaveEncashmentItemDto[];
}

export class UpdateLeaveEncashmentDto {
  @ApiPropertyOptional({ example: '2023-01-20' })
  @IsOptional()
  @IsDateString()
  encashmentDate?: string;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @IsNumber()
  encashmentDays?: number;

  @ApiPropertyOptional({ example: 6000 })
  @IsOptional()
  @IsNumber()
  encashmentAmount?: number;

  @ApiPropertyOptional({ example: '03' })
  @IsOptional()
  @IsString()
  paymentMonth?: string;

  @ApiPropertyOptional({ example: '2023' })
  @IsOptional()
  @IsString()
  paymentYear?: string;

  @ApiPropertyOptional({ example: '2023-03' })
  @IsOptional()
  @IsString()
  paymentMonthYear?: string;

  @ApiPropertyOptional({ example: 100000 })
  @IsOptional()
  @IsNumber()
  grossSalary?: number;

  @ApiPropertyOptional({ example: 1200000 })
  @IsOptional()
  @IsNumber()
  annualSalary?: number;

  @ApiPropertyOptional({ example: 3287.67 })
  @IsOptional()
  @IsNumber()
  perDayAmount?: number;

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

export class ApproveLeaveEncashmentDto {
  @ApiPropertyOptional({ example: 'Invalid request' })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
