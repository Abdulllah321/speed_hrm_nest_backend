import { IsNotEmpty, IsString, IsOptional, IsEnum, IsNumber, Min, Max, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateBonusTypeDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsEnum(['Amount', 'Percentage'])
  calculationType?: string;

  @ValidateIf((o) => o.calculationType === 'Amount')
  @IsNotEmpty({ message: 'Amount is required when calculation type is Amount' })
  @IsNumber({}, { message: 'Amount must be a number' })
  @Type(() => Number)
  @Min(0, { message: 'Amount must be greater than or equal to 0' })
  amount?: number;

  @ValidateIf((o) => o.calculationType === 'Percentage')
  @IsNotEmpty({ message: 'Percentage is required when calculation type is Percentage' })
  @IsNumber({}, { message: 'Percentage must be a number' })
  @Type(() => Number)
  @Min(0, { message: 'Percentage must be greater than or equal to 0' })
  @Max(100, { message: 'Percentage must be less than or equal to 100' })
  percentage?: number;

  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateBonusTypeDto {
  @IsNotEmpty()
  @IsString()
  id: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsEnum(['Amount', 'Percentage'])
  calculationType?: string;

  @ValidateIf((o) => o.calculationType === 'Amount')
  @IsOptional()
  @IsNumber({}, { message: 'Amount must be a number' })
  @Type(() => Number)
  @Min(0, { message: 'Amount must be greater than or equal to 0' })
  amount?: number;

  @ValidateIf((o) => o.calculationType === 'Percentage')
  @IsOptional()
  @IsNumber({}, { message: 'Percentage must be a number' })
  @Type(() => Number)
  @Min(0, { message: 'Percentage must be greater than or equal to 0' })
  @Max(100, { message: 'Percentage must be less than or equal to 100' })
  percentage?: number;

  @IsOptional()
  @IsString()
  status?: string;
}

