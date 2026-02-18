import { PartialType } from '@nestjs/mapped-types';
import { CreatePurchaseRequisitionDto } from './create-purchase-requisition.dto';
import { IsString, IsOptional, IsEnum } from 'class-validator';

export class UpdatePurchaseRequisitionDto extends PartialType(
  CreatePurchaseRequisitionDto,
) {
  @IsString()
  @IsOptional()
  @IsEnum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CONVERTED_TO_RFQ'])
  status?: string;
}
