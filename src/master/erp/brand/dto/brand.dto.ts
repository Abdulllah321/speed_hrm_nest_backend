import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsArray } from 'class-validator';

export class CreateBrandDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateBrandDto extends PartialType(CreateBrandDto) {}

export class BulkUpdateBrandItemDto extends UpdateBrandDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  id: string;
}

export class BulkUpdateBrandDto {
  @ApiProperty({ type: [BulkUpdateBrandItemDto] })
  @IsArray()
  items: BulkUpdateBrandItemDto[];
}
