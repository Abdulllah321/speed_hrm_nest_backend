import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class CreateSilhouetteDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateSilhouetteDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class BulkUpdateSilhouetteItemDto {
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
