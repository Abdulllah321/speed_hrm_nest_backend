import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, PartialType } from '@nestjs/swagger';

export class CreateSalesmanDto {
  @ApiProperty({ example: 'John Doe' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 'active', required: false })
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateSalesmanDto extends PartialType(CreateSalesmanDto) {}
