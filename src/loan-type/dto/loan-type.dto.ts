import { IsNotEmpty, IsString, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

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
  @ApiPropertyOptional({ example: 'loan-type-uuid' })
  @IsOptional()
  @IsString({ message: 'id must be a string' })
  id?: string;

  @ApiProperty({ example: 'Home Loan' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}

// DTO for bulk updates where id is required in each item
export class BulkUpdateLoanTypeItemDto {
  @ApiProperty({ example: 'loan-type-uuid' })
  @IsNotEmpty({ message: 'id must be a string, id should not be empty' })
  @IsString({ message: 'id must be a string, id should not be empty' })
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

export class BulkUpdateLoanTypeDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateLoanTypeItemDto)
  items: BulkUpdateLoanTypeItemDto[];
}

