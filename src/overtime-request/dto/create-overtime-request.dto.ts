import { IsNotEmpty, IsString, IsNumber, IsOptional, IsDateString, IsEnum } from 'class-validator';

export enum OvertimeType {
  WEEKDAY = 'weekday',
  HOLIDAY = 'holiday',
}

export class CreateOvertimeRequestDto {
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @IsNotEmpty()
  @IsEnum(OvertimeType)
  overtimeType: OvertimeType;

  @IsNotEmpty()
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNotEmpty()
  @IsDateString()
  date: string;

  @IsNotEmpty()
  @IsNumber()
  weekdayOvertimeHours: number;

  @IsNotEmpty()
  @IsNumber()
  holidayOvertimeHours: number;
}

export class UpdateOvertimeRequestDto {
  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsEnum(OvertimeType)
  overtimeType?: OvertimeType;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsNumber()
  weekdayOvertimeHours?: number;

  @IsOptional()
  @IsNumber()
  holidayOvertimeHours?: number;

  @IsOptional()
  @IsString()
  status?: string;
}

