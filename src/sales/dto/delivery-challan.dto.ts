import { IsString, IsNumber, IsArray, IsOptional, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class DeliveryChallanItemDto {
  @IsString()
  itemId: string;

  @Transform(({ value }) => Number(value))
  @IsNumber()
  deliveredQty: number;

  @Transform(({ value }) => Number(value))
  @IsNumber()
  salePrice: number;
}

export class CreateDeliveryChallanDto {
  @IsString()
  salesOrderId: string;

  @IsString()
  driverName: string;

  @IsString()
  vehicleNo: string;

  @IsOptional()
  @IsString()
  transportMode?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveryChallanItemDto)
  items: DeliveryChallanItemDto[];
}