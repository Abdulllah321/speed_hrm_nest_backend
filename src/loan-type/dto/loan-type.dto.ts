import { IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateLoanTypeDto {
  @ApiProperty({ example: 'Personal Loan' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateLoanTypeDto {
  @ApiProperty({ example: 'loan-type-uuid' })
  @IsNotEmpty()
  @IsString()
  id: string;

  @ApiProperty({ example: 'Home Loan' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}

