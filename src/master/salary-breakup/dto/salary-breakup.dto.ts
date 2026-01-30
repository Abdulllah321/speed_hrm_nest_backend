import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSalaryBreakupDto {
  @ApiProperty({ example: 'Basic Salary' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 50.5 })
  @IsNotEmpty()
  @IsNumber({}, { message: 'Percentage must be a number' })
  @Type(() => Number)
  percentage: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value === 'true' || value === 'yes';
    return false;
  })
  @Type(() => Boolean)
  isTaxable?: boolean;

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

  @ApiProperty({ example: 50.5 })
  @IsNotEmpty()
  @IsNumber({}, { message: 'Percentage must be a number' })
  @Type(() => Number)
  percentage: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value === 'true' || value === 'yes';
    return false;
  })
  @Type(() => Boolean)
  isTaxable?: boolean;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}
