import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsArray,
  IsUUID,
} from 'class-validator';

export class CreateRfqDto {
  @IsUUID()
  @IsNotEmpty()
  purchaseRequisitionId: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  vendorIds?: string[];
}
