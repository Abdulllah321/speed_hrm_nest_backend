import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CprDetailUpdateDto {
  @ApiProperty({ description: 'The payment voucher detail ID' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ description: 'The CPR number to set or clear', required: false })
  @IsString()
  @IsOptional()
  cprNo?: string | null;
}

export class UpdateVoucherCprDto {
  @ApiProperty({ type: [CprDetailUpdateDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CprDetailUpdateDto)
  details: CprDetailUpdateDto[];
}
