import { IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSalaryBreakupDto {
  @ApiProperty({ example: 'Basic Salary' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Basic salary component' })
  @IsOptional()
  @IsString()
  details?: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateSalaryBreakupDto {
  @ApiProperty({ example: 'breakup-uuid' })
  @IsNotEmpty()
  @IsString()
  id: string;

  @ApiProperty({ example: 'House Rent Allowance' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'HRA component' })
  @IsOptional()
  @IsString()
  details?: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}

