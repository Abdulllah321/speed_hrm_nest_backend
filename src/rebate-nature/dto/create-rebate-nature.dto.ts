import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  IsBoolean,
  IsIn,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRebateNatureDto {
  @ApiProperty({ example: 'Charitable Donation' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    example: 'other',
    enum: ['fixed', 'other'],
    description: 'Type of rebate nature',
  })
  @IsString()
  @IsOptional()
  @IsIn(['fixed', 'other'])
  type?: string;

  @ApiProperty({
    example: 'Education',
    description: 'Category for fixed type rebate natures',
  })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiProperty({ example: 30 })
  @IsNumber()
  @IsOptional()
  @Min(0)
  maxInvestmentPercentage?: number;

  @ApiProperty({ example: 2000000 })
  @IsNumber()
  @IsOptional()
  @Min(0)
  maxInvestmentAmount?: number;

  @ApiProperty({ example: 'Deduction under section 61' })
  @IsString()
  @IsOptional()
  details?: string;

  @ApiProperty({ example: '61' })
  @IsString()
  @IsOptional()
  underSection?: string;

  @ApiProperty({ example: false })
  @IsBoolean()
  @IsOptional()
  isAgeDependent?: boolean;

  @ApiProperty({ example: 'active' })
  @IsString()
  @IsOptional()
  status?: string;
}
