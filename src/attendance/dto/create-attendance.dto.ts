import { IsNotEmpty, IsString, IsOptional, IsBoolean, IsDateString, IsNumber, IsDecimal } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAttendanceDto {
  @ApiProperty({ example: 'emp-uuid' })
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @ApiProperty({ example: '2023-10-01' })
  @IsNotEmpty()
  @IsDateString()
  date: string;

  @ApiPropertyOptional({ example: '2023-10-01T09:00:00Z' })
  @IsOptional()
  @IsDateString()
  checkIn?: string;

  @ApiPropertyOptional({ example: '2023-10-01T17:00:00Z' })
  @IsOptional()
  @IsDateString()
  checkOut?: string;

  @ApiPropertyOptional({ example: 'Present', enum: ['Present', 'Absent', 'Leave', 'Holiday'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isRemote?: boolean;

  @ApiPropertyOptional({ example: 'Office' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ example: 40.7128 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  latitude?: number;

  @ApiPropertyOptional({ example: -74.0060 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  longitude?: number;

  @ApiPropertyOptional({ example: 8 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  workingHours?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  overtimeHours?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lateMinutes?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  earlyLeaveMinutes?: number;

  @ApiPropertyOptional({ example: 60 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  breakDuration?: number;

  @ApiPropertyOptional({ example: 'Notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: 'approver-uuid' })
  @IsOptional()
  @IsString()
  approvedBy?: string;
}

export class UpdateAttendanceDto {
  @ApiProperty({ example: 'attendance-uuid' })
  @IsNotEmpty()
  @IsString()
  id: string;

  @ApiPropertyOptional({ example: '2023-10-01T09:00:00Z' })
  @IsOptional()
  @IsDateString()
  checkIn?: string;

  @ApiPropertyOptional({ example: '2023-10-01T17:00:00Z' })
  @IsOptional()
  @IsDateString()
  checkOut?: string;

  @ApiPropertyOptional({ example: 'Present' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isRemote?: boolean;

  @ApiPropertyOptional({ example: 'Office' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ example: 40.7128 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  latitude?: number;

  @ApiPropertyOptional({ example: -74.0060 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  longitude?: number;

  @ApiPropertyOptional({ example: 8 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  workingHours?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  overtimeHours?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lateMinutes?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  earlyLeaveMinutes?: number;

  @ApiPropertyOptional({ example: 60 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  breakDuration?: number;

  @ApiPropertyOptional({ example: 'Notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: 'approver-uuid' })
  @IsOptional()
  @IsString()
  approvedBy?: string;
}

