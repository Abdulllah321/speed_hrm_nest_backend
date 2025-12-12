import { IsNotEmpty, IsString, IsDateString, IsOptional } from 'class-validator';

export class CreateHolidayDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsDateString()
  dateFrom: string;

  @IsNotEmpty()
  @IsDateString()
  dateTo: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateHolidayDto {
  @IsNotEmpty()
  @IsString()
  id: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsDateString()
  dateFrom: string;

  @IsNotEmpty()
  @IsDateString()
  dateTo: string;

  @IsOptional()
  @IsString()
  status?: string;
}

