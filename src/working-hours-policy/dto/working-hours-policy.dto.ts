import { IsNotEmpty, IsString, IsOptional, IsBoolean, IsNumber, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateWorkingHoursPolicyDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  startWorkingHours: string;

  @IsNotEmpty()
  @IsString()
  endWorkingHours: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  shortDayMins?: number;

  @IsOptional()
  @IsString()
  startBreakTime?: string;

  @IsOptional()
  @IsString()
  endBreakTime?: string;

  @IsOptional()
  @IsString()
  halfDayStartTime?: string;

  @IsOptional()
  @IsString()
  lateStartTime?: string;

  @IsOptional()
  @IsString()
  lateDeductionType?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  applyDeductionAfterLates?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lateDeductionPercent?: number;

  @IsOptional()
  @IsString()
  halfDayDeductionType?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  applyDeductionAfterHalfDays?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  halfDayDeductionAmount?: number;

  @IsOptional()
  @IsString()
  shortDayDeductionType?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  applyDeductionAfterShortDays?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  shortDayDeductionAmount?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  overtimeRate?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  gazzetedOvertimeRate?: number;

  @IsOptional()
  dayOverrides?: any;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateWorkingHoursPolicyDto {
  @IsNotEmpty()
  @IsString()
  id: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  startWorkingHours: string;

  @IsNotEmpty()
  @IsString()
  endWorkingHours: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  shortDayMins?: number;

  @IsOptional()
  @IsString()
  startBreakTime?: string;

  @IsOptional()
  @IsString()
  endBreakTime?: string;

  @IsOptional()
  @IsString()
  halfDayStartTime?: string;

  @IsOptional()
  @IsString()
  lateStartTime?: string;

  @IsOptional()
  @IsString()
  lateDeductionType?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  applyDeductionAfterLates?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lateDeductionPercent?: number;

  @IsOptional()
  @IsString()
  halfDayDeductionType?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  applyDeductionAfterHalfDays?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  halfDayDeductionAmount?: number;

  @IsOptional()
  @IsString()
  shortDayDeductionType?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  applyDeductionAfterShortDays?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  shortDayDeductionAmount?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  overtimeRate?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  gazzetedOvertimeRate?: number;

  @IsOptional()
  dayOverrides?: any;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

