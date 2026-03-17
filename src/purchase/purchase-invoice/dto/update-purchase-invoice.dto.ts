import { PartialType } from '@nestjs/mapped-types';
import { CreatePurchaseInvoiceDto, CreatePurchaseInvoiceItemDto } from './create-purchase-invoice.dto';
import { IsOptional, IsEnum, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdatePurchaseInvoiceDto extends PartialType(CreatePurchaseInvoiceDto) {
  @IsOptional()
  @IsEnum(['DRAFT', 'SUBMITTED', 'APPROVED', 'CANCELLED'])
  status?: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'CANCELLED';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseInvoiceItemDto)
  items?: CreatePurchaseInvoiceItemDto[];
}