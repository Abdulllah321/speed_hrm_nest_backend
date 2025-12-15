import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class CreateEmployeeStatusDto {
  @IsNotEmpty()
  @IsString()
  status: string;

  @IsOptional()
  @IsString()
  statusType?: string;
}

export class UpdateEmployeeStatusDto {
  @IsNotEmpty()
  @IsString()
  id: string;

  @IsNotEmpty()
  @IsString()
  status: string;

  @IsOptional()
  @IsString()
  statusType?: string;
}

