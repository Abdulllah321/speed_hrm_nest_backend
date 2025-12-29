import { IsNotEmpty, IsString, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMaritalStatusDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateMaritalStatusDto {
  @IsOptional()
  @IsString({ message: 'id must be a string' })
  id?: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  status?: string;
}

// DTO for bulk updates where id is required in each item
export class BulkUpdateMaritalStatusItemDto {
  @IsNotEmpty({ message: 'id must be a string, id should not be empty' })
  @IsString({ message: 'id must be a string, id should not be empty' })
  id: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class BulkUpdateMaritalStatusDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateMaritalStatusItemDto)
  items: BulkUpdateMaritalStatusItemDto[];
}

