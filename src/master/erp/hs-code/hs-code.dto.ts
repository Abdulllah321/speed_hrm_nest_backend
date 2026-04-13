import { IsNotEmpty, IsOptional, IsString, IsNumber, Min } from 'class-validator';

export class CreateHsCodeDto {
    @IsString()
    @IsNotEmpty()
    hsCode: string;

    @IsOptional()
    @IsNumber()
    @Min(0)
    customsDutyCd?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    regulatoryDutyRd?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    additionalCustomsDutyAcd?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    salesTax?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    additionalSalesTax?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    incomeTax?: number;



    @IsOptional()
    @IsString()
    status?: string;
}

export class UpdateHsCodeDto {
    @IsOptional()
    @IsString()
    hsCode?: string;

    @IsOptional()
    @IsNumber()
    @Min(0)
    customsDutyCd?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    regulatoryDutyRd?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    additionalCustomsDutyAcd?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    salesTax?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    additionalSalesTax?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    incomeTax?: number;



    @IsOptional()
    @IsString()
    status?: string;
}
