import { IsNotEmpty, IsString, IsOptional, IsBoolean, IsDateString, IsNumber, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LeavesPolicyLeaveTypeDto {
  @ApiProperty({ example: 'leave-type-uuid' })
  @IsNotEmpty()
  @IsString()
  leaveTypeId: string;

  @ApiProperty({ example: 10 })
  @IsNotEmpty()
  @IsNumber()
  numberOfLeaves: number;
}

export class CreateLeavesPolicyDto {
  @ApiProperty({ example: 'Standard Policy' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Details about policy' })
  @IsOptional()
  @IsString()
  details?: string;

  @ApiPropertyOptional({ example: '2023-01-01' })
  @IsOptional()
  @IsDateString()
  policyDateFrom?: string;

  @ApiPropertyOptional({ example: '2023-12-31' })
  @IsOptional()
  @IsDateString()
  policyDateTill?: string;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  fullDayDeductionRate?: number;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  halfDayDeductionRate?: number;

  @ApiPropertyOptional({ example: 25 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  shortLeaveDeductionRate?: number;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ type: [LeavesPolicyLeaveTypeDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LeavesPolicyLeaveTypeDto)
  leaveTypes?: LeavesPolicyLeaveTypeDto[];
}

export class UpdateLeavesPolicyDto {
  @ApiProperty({ example: 'policy-uuid' })
  @IsNotEmpty()
  @IsString()
  id: string;

  @ApiProperty({ example: 'Updated Policy' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Updated Details' })
  @IsOptional()
  @IsString()
  details?: string;

  @ApiPropertyOptional({ example: '2023-01-01' })
  @IsOptional()
  @IsDateString()
  policyDateFrom?: string;

  @ApiPropertyOptional({ example: '2023-12-31' })
  @IsOptional()
  @IsDateString()
  policyDateTill?: string;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  fullDayDeductionRate?: number;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  halfDayDeductionRate?: number;

  @ApiPropertyOptional({ example: 25 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  shortLeaveDeductionRate?: number;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ type: [LeavesPolicyLeaveTypeDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LeavesPolicyLeaveTypeDto)
  leaveTypes?: LeavesPolicyLeaveTypeDto[];
}

