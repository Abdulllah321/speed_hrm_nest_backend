import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSeasonDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  status?: string;
}

export class UpdateSeasonDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  status?: string;
}

export class BulkUpdateSeasonItemDto {
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

export class CreateSeasonsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSeasonDto)
  items: CreateSeasonDto[];
}

export class BulkUpdateSeasonsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateSeasonItemDto)
  items: BulkUpdateSeasonItemDto[];
}
