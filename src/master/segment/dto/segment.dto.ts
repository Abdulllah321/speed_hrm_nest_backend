import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSegmentDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  status?: string;
}

export class CreateSegmentsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSegmentDto)
  items: CreateSegmentDto[];
}

export class UpdateSegmentDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  status?: string;
}

export class BulkUpdateSegmentItemDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  status?: string;
}

export class BulkUpdateSegmentsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateSegmentItemDto)
  items: BulkUpdateSegmentItemDto[];
}
