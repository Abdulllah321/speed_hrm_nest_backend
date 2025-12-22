import { IsNotEmpty, IsString, IsNumber, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateBonusItemDto {
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @IsOptional()
  @IsNumber()
  percentage?: number;
}

export class CreateBonusDto {
  @IsNotEmpty()
  @IsString()
  bonusTypeId: string;

  @IsNotEmpty()
  @IsString()
  bonusMonthYear: string; // Format: "YYYY-MM"

  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBonusItemDto)
  bonuses: CreateBonusItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateBonusDto {
  @IsOptional()
  @IsString()
  bonusTypeId?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsNumber()
  percentage?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class BulkCreateBonusDto {
  @IsNotEmpty()
  @IsString()
  bonusTypeId: string;

  @IsNotEmpty()
  @IsString()
  bonusMonthYear: string; // Format: "YYYY-MM"

  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBonusItemDto)
  bonuses: CreateBonusItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
