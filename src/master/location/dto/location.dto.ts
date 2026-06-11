import { IsNotEmpty, IsString, IsOptional, IsBoolean, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateLocationDto {
  @ApiProperty({ example: 'Main Location' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'LOC01' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({ example: 'SSDMC' })
  @IsOptional()
  @IsString()
  shortCode?: string;

  @ApiPropertyOptional({ example: '123 Main St' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'city-uuid' })
  @IsOptional()
  @IsString()
  cityId?: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: '12010001' })
  @IsOptional()
  @IsString()
  cashGLCode?: string;
}

export class UpdateLocationDto {
  @ApiProperty({ example: 'location-uuid' })
  @IsNotEmpty()
  @IsString()
  id: string;

  @ApiProperty({ example: 'Downtown Location' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'LOC01' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({ example: 'SSDMC' })
  @IsOptional()
  @IsString()
  shortCode?: string;

  @ApiPropertyOptional({ example: '456 Market St' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'city-uuid' })
  @IsOptional()
  @IsString()
  cityId?: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: '12010001' })
  @IsOptional()
  @IsString()
  cashGLCode?: string;
}

export class UpdateLocationOtherInfoDto {
  @ApiPropertyOptional({ example: '123456789' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 34.0151 })
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional({ example: 71.5249 })
  @IsOptional()
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  geoFenceEnabled?: boolean;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @IsNumber()
  geoFenceRadius?: number;

  @ApiPropertyOptional({ example: '192.168.1.1,192.168.1.2' })
  @IsOptional()
  @IsString()
  ipWhitelist?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  ipWhitelistEnabled?: boolean;

  @ApiPropertyOptional({ example: 'BPOS-001' })
  @IsOptional()
  @IsString()
  fbrBposId?: string;

  @ApiPropertyOptional({ example: 'bearer-token-xyz' })
  @IsOptional()
  @IsString()
  fbrBearerToken?: string;

  @ApiPropertyOptional({ example: '1234567-8' })
  @IsOptional()
  @IsString()
  fbrNtn?: string;

  @ApiPropertyOptional({ example: 'Seller Name' })
  @IsOptional()
  @IsString()
  fbrSellerName?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  fbrEnabled?: boolean;
}

