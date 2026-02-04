import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, PartialType } from '@nestjs/swagger';

export class CreateSaleTypeDto {
  @ApiProperty({ example: 'Type A' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 'active', required: false })
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateSaleTypeDto extends PartialType(CreateSaleTypeDto) {}
