import { IsNotEmpty, IsOptional, IsString, IsEmail, IsIn } from 'class-validator';

export class CreateCustomerDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  contactNo?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  @IsIn(['ERP', 'POS', 'BOTH'])
  customerType?: 'ERP' | 'POS' | 'BOTH';
}

export class UpdateCustomerDto {
  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  contactNo?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  @IsIn(['ERP', 'POS', 'BOTH'])
  customerType?: 'ERP' | 'POS' | 'BOTH';
}
