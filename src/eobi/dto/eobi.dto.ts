import { IsNotEmpty, IsString, IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEobiDto {
  @ApiProperty({ example: 'Regular EOBI' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: '0800B656361' })
  @IsOptional()
  @IsString()
  eobiId?: string;

  @ApiPropertyOptional({ example: 'AA001' })
  @IsOptional()
  @IsString()
  eobiCode?: string;

  @ApiPropertyOptional({ example: 500 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  amount?: number;

  @ApiProperty({ example: 2000 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  employerContribution: number;

  @ApiProperty({ example: 400 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  employeeContribution: number;

  @ApiProperty({ example: 'January 2024' })
  @IsNotEmpty()
  @IsString()
  yearMonth: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateEobiDto {
  @ApiProperty({ example: 'eobi-uuid' })
  @IsNotEmpty()
  @IsString()
  id: string;

  @ApiProperty({ example: 'Updated EOBI' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: '0800B656361' })
  @IsOptional()
  @IsString()
  eobiId?: string;

  @ApiPropertyOptional({ example: 'AA001' })
  @IsOptional()
  @IsString()
  eobiCode?: string;

  @ApiPropertyOptional({ example: 600 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  amount?: number;

  @ApiProperty({ example: 2000 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  employerContribution: number;

  @ApiProperty({ example: 400 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  employeeContribution: number;

  @ApiProperty({ example: 'February 2024' })
  @IsNotEmpty()
  @IsString()
  yearMonth: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}
