import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListImportsQueryDto {
  @ApiProperty({ required: false, description: 'Filter by module name (e.g. ITEMS, COA, STOCK)' })
  @IsOptional()
  @IsString()
  moduleName?: string;

  @ApiProperty({ required: false, description: 'Filter by status (validating, validated, pending, processing, completed, failed, cancelled)' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ required: false, description: 'Search by filename' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
