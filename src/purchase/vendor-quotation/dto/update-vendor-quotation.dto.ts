import { PartialType } from '@nestjs/mapped-types';
import { CreateVendorQuotationDto } from './create-vendor-quotation.dto';
import { IsString, IsOptional, IsEnum } from 'class-validator';

export class UpdateVendorQuotationDto extends PartialType(
  CreateVendorQuotationDto,
) {
  @IsString()
  @IsOptional()
  @IsEnum(['DRAFT', 'SUBMITTED', 'SELECTED', 'REJECTED', 'EXPIRED'])
  status?: string;
}
