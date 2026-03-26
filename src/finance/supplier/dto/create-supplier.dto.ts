import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsEmail,
  IsArray,
} from 'class-validator';
import { SupplierNature, SupplierType } from '@prisma/client';

export class CreateSupplierDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ enum: SupplierType, default: SupplierType.LOCAL })
  @IsEnum(SupplierType)
  @IsOptional()
  type?: SupplierType;

  @ApiPropertyOptional({ enum: SupplierNature })
  @IsEnum(SupplierNature)
  @IsOptional()
  nature?: SupplierNature;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  brand?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  country?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  contactNo?: string;

  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  website?: string;

  // Tax Info
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  cnicNo?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  ntnNo?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  strnNo?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  srbNo?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  praNo?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  ictNo?: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  chartOfAccountIds: string[];
}
