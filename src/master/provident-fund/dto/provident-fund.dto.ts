import { IsNotEmpty, IsString, IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProvidentFundDto {
  @ApiProperty({ example: 'Standard PF' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 5.0 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  percentage: number;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateProvidentFundDto {
  @ApiProperty({ example: 'pf-uuid' })
  @IsNotEmpty()
  @IsString()
  id: string;

  @ApiProperty({ example: 'Updated PF' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 6.0 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  percentage: number;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}
