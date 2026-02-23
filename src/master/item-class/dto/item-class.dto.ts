import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateItemClassDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  status?: string;
}

export class UpdateItemClassDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  status?: string;
}

export class BulkUpdateItemClassItemDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  status?: string;
}

export class CreateItemClassesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateItemClassDto)
  items: CreateItemClassDto[];
}

export class BulkUpdateItemClassesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateItemClassItemDto)
  items: BulkUpdateItemClassItemDto[];
}
