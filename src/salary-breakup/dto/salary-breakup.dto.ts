import { IsNotEmpty, IsString, IsOptional, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSalaryBreakupDto {
  @ApiProperty({ example: 'Basic Salary' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Basic salary component' })
  @IsOptional()
  @IsString()
  details?: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateSalaryBreakupDto {
  @ApiPropertyOptional({ example: 'breakup-uuid' })
  @IsOptional()
  @IsString({ message: 'id must be a string' })
  id?: string;

  @ApiProperty({ example: 'House Rent Allowance' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'HRA component' })
  @IsOptional()
  @IsString()
  details?: string;

  @ApiPropertyOptional({ example: 50.5 })
  @IsOptional()
  @IsNumber({}, { message: 'Percentage must be a number' })
  @Type(() => Number)
  percentage?: number;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}

