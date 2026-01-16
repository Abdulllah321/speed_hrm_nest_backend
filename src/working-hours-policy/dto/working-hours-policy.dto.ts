import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWorkingHoursPolicyDto {
  @ApiProperty({ example: 'Standard Policy' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: '09:00' })
  @IsNotEmpty()
  @IsString()
  startWorkingHours: string;

  @ApiProperty({ example: '18:00' })
  @IsNotEmpty()
  @IsString()
  endWorkingHours: string;

  @ApiPropertyOptional({ example: 240 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  shortDayMins?: number;

  @ApiPropertyOptional({ example: '13:00' })
  @IsOptional()
  @IsString()
  startBreakTime?: string;

  @ApiPropertyOptional({ example: '14:00' })
  @IsOptional()
  @IsString()
  endBreakTime?: string;

  @ApiPropertyOptional({ example: '13:30' })
  @IsOptional()
  @IsString()
  halfDayStartTime?: string;

  @ApiPropertyOptional({ example: '09:15' })
  @IsOptional()
  @IsString()
  lateStartTime?: string;

  @ApiPropertyOptional({ example: 'Unit' })
  @IsOptional()
  @IsString()
  lateDeductionType?: string;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  applyDeductionAfterLates?: number;

  @ApiPropertyOptional({ example: 25 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lateDeductionPercent?: number;

  @ApiPropertyOptional({ example: 'Amount' })
  @IsOptional()
  @IsString()
  halfDayDeductionType?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  applyDeductionAfterHalfDays?: number;

  @ApiPropertyOptional({ example: 500 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  halfDayDeductionAmount?: number;

  @ApiPropertyOptional({ example: 'Amount' })
  @IsOptional()
  @IsString()
  shortDayDeductionType?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  applyDeductionAfterShortDays?: number;

  @ApiPropertyOptional({ example: 200 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  shortDayDeductionAmount?: number;

  @ApiPropertyOptional({ example: 1.5 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  overtimeRate?: number;

  @ApiPropertyOptional({ example: 2.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  gazzetedOvertimeRate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  dayOverrides?: any;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateWorkingHoursPolicyDto {
  @ApiProperty({ example: 'policy-uuid' })
  @IsNotEmpty()
  @IsString()
  id: string;

  @ApiProperty({ example: 'Updated Policy' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: '09:00' })
  @IsNotEmpty()
  @IsString()
  startWorkingHours: string;

  @ApiProperty({ example: '18:00' })
  @IsNotEmpty()
  @IsString()
  endWorkingHours: string;

  @ApiPropertyOptional({ example: 240 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  shortDayMins?: number;

  @ApiPropertyOptional({ example: '13:00' })
  @IsOptional()
  @IsString()
  startBreakTime?: string;

  @ApiPropertyOptional({ example: '14:00' })
  @IsOptional()
  @IsString()
  endBreakTime?: string;

  @ApiPropertyOptional({ example: '13:30' })
  @IsOptional()
  @IsString()
  halfDayStartTime?: string;

  @ApiPropertyOptional({ example: '09:15' })
  @IsOptional()
  @IsString()
  lateStartTime?: string;

  @ApiPropertyOptional({ example: 'Unit' })
  @IsOptional()
  @IsString()
  lateDeductionType?: string;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  applyDeductionAfterLates?: number;

  @ApiPropertyOptional({ example: 25 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lateDeductionPercent?: number;

  @ApiPropertyOptional({ example: 'Amount' })
  @IsOptional()
  @IsString()
  halfDayDeductionType?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  applyDeductionAfterHalfDays?: number;

  @ApiPropertyOptional({ example: 500 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  halfDayDeductionAmount?: number;

  @ApiPropertyOptional({ example: 'Amount' })
  @IsOptional()
  @IsString()
  shortDayDeductionType?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  applyDeductionAfterShortDays?: number;

  @ApiPropertyOptional({ example: 200 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  shortDayDeductionAmount?: number;

  @ApiPropertyOptional({ example: 1.5 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  overtimeRate?: number;

  @ApiPropertyOptional({ example: 2.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  gazzetedOvertimeRate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  dayOverrides?: any;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
