import { IsNotEmpty, IsString, IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTaxSlabDto {
  @ApiProperty({ example: 'Slab 1' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 0 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  minAmount: number;

  @ApiProperty({ example: 600000 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  maxAmount: number;

  @ApiProperty({ example: 0 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  rate: number;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateTaxSlabDto {
  @ApiProperty({ example: 'slab-uuid' })
  @IsNotEmpty()
  @IsString()
  id: string;

  @ApiProperty({ example: 'Slab 2' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 600001 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  minAmount: number;

  @ApiProperty({ example: 1200000 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  maxAmount: number;

  @ApiProperty({ example: 5 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  rate: number;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}
