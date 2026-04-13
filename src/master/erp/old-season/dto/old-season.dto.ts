import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateOldSeasonDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  status?: string;
}

export class UpdateOldSeasonDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  status?: string;
}

export class BulkUpdateOldSeasonItemDto {
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

export class CreateOldSeasonsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOldSeasonDto)
  items: CreateOldSeasonDto[];
}

export class BulkUpdateOldSeasonsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateOldSeasonItemDto)
  items: BulkUpdateOldSeasonItemDto[];
}
