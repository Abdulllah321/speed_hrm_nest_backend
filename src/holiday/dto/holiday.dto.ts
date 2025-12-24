import { IsNotEmpty, IsString, IsDateString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateHolidayDto {
  @ApiProperty({ example: 'Eid Holiday' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: '2023-04-21' })
  @IsNotEmpty()
  @IsDateString()
  dateFrom: string;

  @ApiProperty({ example: '2023-04-23' })
  @IsNotEmpty()
  @IsDateString()
  dateTo: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateHolidayDto {
  @ApiProperty({ example: 'holiday-uuid' })
  @IsNotEmpty()
  @IsString()
  id: string;

  @ApiProperty({ example: 'Updated Holiday' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: '2023-04-22' })
  @IsNotEmpty()
  @IsDateString()
  dateFrom: string;

  @ApiProperty({ example: '2023-04-24' })
  @IsNotEmpty()
  @IsDateString()
  dateTo: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}

