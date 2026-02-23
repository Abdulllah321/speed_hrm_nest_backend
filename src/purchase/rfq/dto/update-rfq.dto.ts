import { PartialType } from '@nestjs/mapped-types';
import { CreateRfqDto } from './create-rfq.dto';
import { IsString, IsOptional, IsEnum, IsArray, IsUUID } from 'class-validator';

export class UpdateRfqDto extends PartialType(CreateRfqDto) {
  @IsString()
  @IsOptional()
  @IsEnum(['DRAFT', 'SENT', 'CLOSED'])
  status?: string;
}

export class AddVendorsDto {
  @IsArray()
  @IsUUID('4', { each: true })
  @IsNotEmpty()
  vendorIds: string[];
}

function IsNotEmpty(): (target: object, propertyKey: string | symbol) => void {
  return (target: object, propertyKey: string | symbol) => {};
}
