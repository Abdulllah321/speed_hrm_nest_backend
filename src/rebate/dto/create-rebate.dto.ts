import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRebateDto {
  @ApiProperty({ example: 'emp-uuid' })
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @ApiProperty({ example: 'rebate-nature-uuid' })
  @IsNotEmpty()
  @IsString()
  rebateNatureId: string;

  @ApiProperty({ example: 5000.0 })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  rebateAmount: number;

  @ApiProperty({ example: '2023-12', description: 'Format: YYYY-MM' })
  @IsNotEmpty()
  @IsString()
  monthYear: string; // Format: "YYYY-MM"

  @ApiPropertyOptional({ example: 'Additional remarks' })
  @IsOptional()
  @IsString()
  remarks?: string;

  @ApiPropertyOptional({
    example: '/uploads/file-123.pdf',
    description: 'File path/URL',
  })
  @IsOptional()
  @IsString()
  attachment?: string;
}

export class UpdateRebateDto {
  @ApiPropertyOptional({ example: 'emp-uuid' })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({ example: 'rebate-nature-uuid' })
  @IsOptional()
  @IsString()
  rebateNatureId?: string;

  @ApiPropertyOptional({ example: 6000.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  rebateAmount?: number;

  @ApiPropertyOptional({ example: '2023-12', description: 'Format: YYYY-MM' })
  @IsOptional()
  @IsString()
  monthYear?: string;

  @ApiPropertyOptional({ example: 'Updated remarks' })
  @IsOptional()
  @IsString()
  remarks?: string;

  @ApiPropertyOptional({
    example: 'approved',
    enum: ['pending', 'approved', 'rejected'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['pending', 'approved', 'rejected'], {
    message: 'status must be one of: pending, approved, rejected',
  })
  status?: string;

  @ApiPropertyOptional({
    example: '/uploads/file-123.pdf',
    description: 'File path/URL',
  })
  @IsOptional()
  @IsString()
  attachment?: string;
}
