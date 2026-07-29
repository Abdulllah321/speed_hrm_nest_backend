import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsArray,
  ValidateNested,
  IsEmail,
} from 'class-validator';
import { Type } from 'class-transformer';

export class EzcommerceCustomerDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  city?: string;
}

export class EzcommerceOrderItemDto {
  @IsString()
  @IsNotEmpty()
  BarCode: string;

  @IsNumber()
  @IsNotEmpty()
  quantity: number;

  @IsNumber()
  @IsNotEmpty()
  unitPrice: number;

  @IsNumber()
  @IsOptional()
  discountAmount?: number;

  @IsNumber()
  @IsOptional()
  netTotal?: number;
}

export class EzcommerceConfirmOrderDto {
  @IsString()
  @IsNotEmpty()
  orderNo: string;

  @IsString()
  @IsNotEmpty()
  center_id: string;

  @IsString()
  @IsOptional()
  orderDate?: string;

  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @IsString()
  @IsOptional()
  paymentStatus?: string;

  @IsNumber()
  @IsOptional()
  shippingFee?: number;

  @IsString()
  @IsOptional()
  notes?: string;

  @ValidateNested()
  @Type(() => EzcommerceCustomerDto)
  @IsNotEmpty()
  customer: EzcommerceCustomerDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EzcommerceOrderItemDto)
  @IsNotEmpty()
  items: EzcommerceOrderItemDto[];
}
