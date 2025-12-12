import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class CreateEmployeeGradeDto {
  @IsNotEmpty()
  @IsString()
  grade: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateEmployeeGradeDto {
  @IsNotEmpty()
  @IsString()
  id: string;

  @IsNotEmpty()
  @IsString()
  grade: string;

  @IsOptional()
  @IsString()
  status?: string;
}

