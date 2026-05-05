import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsArray } from 'class-validator';

export class CreateUnitOfMeasurementDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  abbreviation: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateUnitOfMeasurementDto extends PartialType(CreateUnitOfMeasurementDto) {}

export class BulkUpdateUnitOfMeasurementItemDto extends UpdateUnitOfMeasurementDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  id: string;
}

export class BulkUpdateUnitOfMeasurementDto {
  @ApiProperty({ type: [BulkUpdateUnitOfMeasurementItemDto] })
  @IsArray()
  items: BulkUpdateUnitOfMeasurementItemDto[];
}
