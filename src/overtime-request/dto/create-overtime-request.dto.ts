import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  IsDateString,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum OvertimeType {
  WEEKDAY = 'weekday',
  HOLIDAY = 'holiday',
}

export class CreateOvertimeRequestDto {
  @ApiProperty({ example: 'emp-uuid' })
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @ApiProperty({ enum: OvertimeType, example: OvertimeType.WEEKDAY })
  @IsNotEmpty()
  @IsEnum(OvertimeType)
  overtimeType: OvertimeType;

  @ApiProperty({ example: 'Extra work on project X' })
  @IsNotEmpty()
  @IsString()
  title: string;

  @ApiPropertyOptional({ example: 'Working late to meet deadline' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: '2023-01-25' })
  @IsNotEmpty()
  @IsDateString()
  date: string;

  @ApiProperty({ example: 2 })
  @IsNotEmpty()
  @IsNumber()
  weekdayOvertimeHours: number;

  @ApiProperty({ example: 0 })
  @IsNotEmpty()
  @IsNumber()
  holidayOvertimeHours: number;
}

export class UpdateOvertimeRequestDto {
  @ApiPropertyOptional({ example: 'emp-uuid' })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({ enum: OvertimeType, example: OvertimeType.HOLIDAY })
  @IsOptional()
  @IsEnum(OvertimeType)
  overtimeType?: OvertimeType;

  @ApiPropertyOptional({ example: 'Weekend Support' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ example: 'Urgent support needed' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: '2023-01-28' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  weekdayOvertimeHours?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  holidayOvertimeHours?: number;

  @ApiPropertyOptional({
    example: 'approved',
    enum: ['pending', 'approved', 'rejected'],
  })
  @IsOptional()
  @IsString()
  status?: string;
}
