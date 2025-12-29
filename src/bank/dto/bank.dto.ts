import { IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBankDto {
  @ApiProperty({ example: 'HBL' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'HBL123' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({ example: '123' })
  @IsOptional()
  @IsString()
  accountNumberPrefix?: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateBankDto {
  @ApiProperty({ example: 'bank-uuid' })
  @IsNotEmpty()
  @IsString()
  id: string;

  @ApiPropertyOptional({ example: 'Meezan Bank' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'MZN123' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({ example: '456' })
  @IsOptional()
  @IsString()
  accountNumberPrefix?: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}
