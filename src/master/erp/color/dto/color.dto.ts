import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class CreateColorDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateColorDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class BulkUpdateColorItemDto {
  @IsNotEmpty()
  @IsString()
  id: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  status?: string;
}
