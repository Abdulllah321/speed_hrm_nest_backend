import { IsNotEmpty, IsString, IsOptional, IsBoolean, IsDateString, IsNumber, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class LeavesPolicyLeaveTypeDto {
  @IsNotEmpty()
  @IsString()
  leaveTypeId: string;

  @IsNotEmpty()
  @IsNumber()
  numberOfLeaves: number;
}

export class CreateLeavesPolicyDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  details?: string;

  @IsOptional()
  @IsDateString()
  policyDateFrom?: string;

  @IsOptional()
  @IsDateString()
  policyDateTill?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  fullDayDeductionRate?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  halfDayDeductionRate?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  shortLeaveDeductionRate?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LeavesPolicyLeaveTypeDto)
  leaveTypes?: LeavesPolicyLeaveTypeDto[];
}

export class UpdateLeavesPolicyDto {
  @IsNotEmpty()
  @IsString()
  id: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  details?: string;

  @IsOptional()
  @IsDateString()
  policyDateFrom?: string;

  @IsOptional()
  @IsDateString()
  policyDateTill?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  fullDayDeductionRate?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  halfDayDeductionRate?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  shortLeaveDeductionRate?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LeavesPolicyLeaveTypeDto)
  leaveTypes?: LeavesPolicyLeaveTypeDto[];
}

