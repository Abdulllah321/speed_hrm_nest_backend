import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateItemSubclassDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  itemClassId: string;

  @IsString()
  @IsOptional()
  status?: string;
}

export class UpdateItemSubclassDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  itemClassId?: string;

  @IsString()
  @IsOptional()
  status?: string;
}

export class BulkUpdateItemSubclassItemDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  itemClassId: string;

  @IsString()
  @IsOptional()
  status?: string;
}

export class CreateItemSubclassesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateItemSubclassDto)
  items: CreateItemSubclassDto[];
}

export class BulkUpdateItemSubclassesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateItemSubclassItemDto)
  items: BulkUpdateItemSubclassItemDto[];
}
