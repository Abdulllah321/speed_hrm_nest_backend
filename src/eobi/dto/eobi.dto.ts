import { IsNotEmpty, IsString, IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEobiDto {
  @ApiProperty({ example: 'Regular EOBI' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 500 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  amount: number;

  @ApiProperty({ example: '2023-01' })
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

  @ApiProperty({ example: 600 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  amount: number;

  @ApiProperty({ example: '2023-02' })
  @IsNotEmpty()
  @IsString()
  yearMonth: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}

