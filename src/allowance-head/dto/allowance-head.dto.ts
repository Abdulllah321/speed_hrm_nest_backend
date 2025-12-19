import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class CreateAllowanceHeadDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateAllowanceHeadDto {
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

