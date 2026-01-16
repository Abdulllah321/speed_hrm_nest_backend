import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  Min,
  Max,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAllowanceHeadDto {
  @ApiProperty({ example: 'House Rent Allowance' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Amount', enum: ['Amount', 'Percentage'] })
  @IsOptional()
  @IsEnum(['Amount', 'Percentage'])
  calculationType?: string;

  @ApiPropertyOptional({ example: 1000 })
  @ValidateIf((o) => o.calculationType === 'Amount')
  @IsNotEmpty({ message: 'Amount is required when calculation type is Amount' })
  @IsNumber({}, { message: 'Amount must be a number' })
  @Type(() => Number)
  @Min(0, { message: 'Amount must be greater than or equal to 0' })
  amount?: number;

  @ApiPropertyOptional({ example: 10 })
  @ValidateIf((o) => o.calculationType === 'Percentage')
  @IsNotEmpty({
    message: 'Percentage is required when calculation type is Percentage',
  })
  @IsNumber({}, { message: 'Percentage must be a number' })
  @Type(() => Number)
  @Min(0, { message: 'Percentage must be greater than or equal to 0' })
  @Max(100, { message: 'Percentage must be less than or equal to 100' })
  percentage?: number;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateAllowanceHeadDto {
  @ApiProperty({ example: 'ah-uuid' })
  @IsNotEmpty()
  @IsString()
  id: string;

  @ApiProperty({ example: 'Medical Allowance' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Amount', enum: ['Amount', 'Percentage'] })
  @IsOptional()
  @IsEnum(['Amount', 'Percentage'])
  calculationType?: string;

  @ApiPropertyOptional({ example: 0 })
  @ValidateIf((o) => o.calculationType === 'Amount')
  @IsOptional()
  @IsNumber({}, { message: 'Amount must be a number' })
  @Type(() => Number)
  @Min(0, { message: 'Amount must be greater than or equal to 0' })
  amount?: number;

  @ApiPropertyOptional({ example: 15 })
  @ValidateIf((o) => o.calculationType === 'Percentage')
  @IsOptional()
  @IsNumber({}, { message: 'Percentage must be a number' })
  @Type(() => Number)
  @Min(0, { message: 'Percentage must be greater than or equal to 0' })
  @Max(100, { message: 'Percentage must be less than or equal to 100' })
  percentage?: number;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}
