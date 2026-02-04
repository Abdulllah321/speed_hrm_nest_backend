import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, PartialType } from '@nestjs/swagger';

export class CreateSalePoolDto {
  @ApiProperty({ example: 'Pool A' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 'active', required: false })
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateSalePoolDto extends PartialType(CreateSalePoolDto) {}
