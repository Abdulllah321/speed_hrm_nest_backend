import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class CreateGenderDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateGenderDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class BulkUpdateGenderItemDto {
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
