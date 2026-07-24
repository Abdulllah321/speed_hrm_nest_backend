import { IsNotEmpty, IsOptional, IsString, IsEmail, IsIn, ValidateIf, IsNumber } from 'class-validator';

export class CreateCustomerDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  traderId?: string;

  @IsString()
  @IsOptional()
  company?: string;

  @IsString()
  @IsOptional()
  subCode?: string;

  @IsString()
  @IsOptional()
  brands?: string;

  @IsNumber()
  @IsOptional()
  baseMargin?: number;

  @IsNumber()
  @IsOptional()
  cashMargin?: number;

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  deliveryAddress?: string;

  @IsString()
  @IsOptional()
  contactNo?: string;

  @ValidateIf(o => o.email !== '' && o.email !== null && o.email !== undefined)
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  cnicNo?: string;

  @IsString()
  @IsOptional()
  ntn?: string;

  @IsString()
  @IsOptional()
  strn?: string;

  @IsString()
  @IsOptional()
  @IsIn(['ERP', 'POS', 'BOTH'])
  customerType?: 'ERP' | 'POS' | 'BOTH';
}

export class UpdateCustomerDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  traderId?: string;

  @IsString()
  @IsOptional()
  company?: string;

  @IsString()
  @IsOptional()
  subCode?: string;

  @IsString()
  @IsOptional()
  brands?: string;

  @IsNumber()
  @IsOptional()
  baseMargin?: number;

  @IsNumber()
  @IsOptional()
  cashMargin?: number;

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  deliveryAddress?: string;

  @IsString()
  @IsOptional()
  contactNo?: string;

  @ValidateIf(o => o.email !== '' && o.email !== null && o.email !== undefined)
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  cnicNo?: string;

  @IsString()
  @IsOptional()
  ntn?: string;

  @IsString()
  @IsOptional()
  strn?: string;

  @IsString()
  @IsOptional()
  @IsIn(['ERP', 'POS', 'BOTH'])
  customerType?: 'ERP' | 'POS' | 'BOTH';
}

