import { IsNotEmpty, IsString, IsOptional, IsBoolean, IsDateString, IsNumber, IsDecimal } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAttendanceDto {
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @IsNotEmpty()
  @IsDateString()
  date: string;

  @IsOptional()
  @IsDateString()
  checkIn?: string;

  @IsOptional()
  @IsDateString()
  checkOut?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsBoolean()
  isRemote?: boolean;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  longitude?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  workingHours?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  overtimeHours?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lateMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  earlyLeaveMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  breakDuration?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  approvedBy?: string;
}

export class UpdateAttendanceDto {
  @IsNotEmpty()
  @IsString()
  id: string;

  @IsOptional()
  @IsDateString()
  checkIn?: string;

  @IsOptional()
  @IsDateString()
  checkOut?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsBoolean()
  isRemote?: boolean;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  longitude?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  workingHours?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  overtimeHours?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lateMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  earlyLeaveMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  breakDuration?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  approvedBy?: string;
}

