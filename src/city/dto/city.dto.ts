import { IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCityDto {
  @ApiProperty({ example: 'Lahore' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 'country-uuid' })
  @IsNotEmpty()
  @IsString()
  countryId: string;

  @ApiProperty({ example: 'state-uuid' })
  @IsNotEmpty()
  @IsString()
  stateId: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateCityDto {
  @ApiProperty({ example: 'city-uuid' })
  @IsNotEmpty()
  @IsString()
  id: string;

  @ApiProperty({ example: 'Karachi' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'country-uuid' })
  @IsOptional()
  @IsString()
  countryId?: string;

  @ApiPropertyOptional({ example: 'state-uuid' })
  @IsOptional()
  @IsString()
  stateId?: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}

