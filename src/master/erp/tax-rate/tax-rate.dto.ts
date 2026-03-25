import { IsOptional, IsNumber } from 'class-validator';

export class CreateTaxRateDto {
  @IsNumber()
  taxRate1!: number;
}

export class UpdateTaxRateDto {
  @IsOptional()
  @IsNumber()
  taxRate1?: number;
}
