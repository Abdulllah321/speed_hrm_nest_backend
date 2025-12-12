import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class CreateSalaryBreakupDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  details?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateSalaryBreakupDto {
  @IsNotEmpty()
  @IsString()
  id: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  details?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

