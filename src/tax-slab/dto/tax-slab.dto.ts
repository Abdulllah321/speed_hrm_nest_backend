import { IsNotEmpty, IsString, IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTaxSlabDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  minAmount: number;

  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  maxAmount: number;

  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  rate: number;

  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateTaxSlabDto {
  @IsNotEmpty()
  @IsString()
  id: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  minAmount: number;

  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  maxAmount: number;

  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  rate: number;

  @IsOptional()
  @IsString()
  status?: string;
}

