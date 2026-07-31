import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsNotEmpty } from 'class-validator';

export class CreateCprDto {
  @ApiProperty({
    description: 'Reference to matched Employee ID',
    example: 'uuid-string',
    required: false,
  })
  @IsString()
  @IsOptional()
  employeeId?: string;

  @ApiProperty({
    description: 'CNIC of the taxpayer',
    example: '42501-1498900-1',
  })
  @IsString()
  @IsNotEmpty()
  cnic: string;

  @ApiProperty({
    description: 'Name of the taxpayer',
    example: 'ABDUL RAHIM',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'City of the taxpayer',
    example: 'KARACHI',
    required: false,
  })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiProperty({
    description: 'CPR Number',
    example: 'IT-20260529-0101-1714853',
  })
  @IsString()
  @IsNotEmpty()
  cprNo: string;

  @ApiProperty({
    description: 'Car Amount',
    example: 2209835,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  carAmount?: number;

  @ApiProperty({
    description: 'Tax Payer NTN',
    example: '1234567-8',
    required: false,
  })
  @IsString()
  @IsOptional()
  ntn?: string;

  @ApiProperty({
    description: 'Annual taxable amount',
    example: 1200000,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  taxableAmountAnnual?: number;

  @ApiProperty({
    description: 'Gross taxable amount',
    example: 100000,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  taxableAmountGross?: number;

  @ApiProperty({
    description: 'Monthly tax amount',
    example: 15000,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  taxAmountMonthlyTax?: number;

  @ApiProperty({
    description: 'Annual tax amount',
    example: 180000,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  taxAmountAnnual?: number;

  @ApiProperty({
    description: 'Tax Period',
    example: '2026-05',
    required: false,
  })
  @IsString()
  @IsOptional()
  taxPeriod?: string;

  @ApiProperty({
    description: 'Payment Date',
    example: '2026-05-29T10:00:00.000Z',
    required: false,
  })
  @IsString()
  @IsOptional()
  paymentDate?: string;
}

export class UpdateCprDto {
  @ApiProperty({
    description: 'Reference to matched Employee ID',
    example: 'uuid-string',
    required: false,
  })
  @IsString()
  @IsOptional()
  employeeId?: string;

  @ApiProperty({
    description: 'CNIC of the taxpayer',
    example: '42501-1498900-1',
    required: false,
  })
  @IsString()
  @IsOptional()
  cnic?: string;

  @ApiProperty({
    description: 'Name of the taxpayer',
    example: 'ABDUL RAHIM',
    required: false,
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    description: 'City of the taxpayer',
    example: 'KARACHI',
    required: false,
  })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiProperty({
    description: 'CPR Number',
    example: 'IT-20260529-0101-1714853',
    required: false,
  })
  @IsString()
  @IsOptional()
  cprNo?: string;

  @ApiProperty({
    description: 'Car Amount',
    example: 2209835,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  carAmount?: number;

  @ApiProperty({
    description: 'Tax Payer NTN',
    example: '1234567-8',
    required: false,
  })
  @IsString()
  @IsOptional()
  ntn?: string;

  @ApiProperty({
    description: 'Annual taxable amount',
    example: 1200000,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  taxableAmountAnnual?: number;

  @ApiProperty({
    description: 'Gross taxable amount',
    example: 100000,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  taxableAmountGross?: number;

  @ApiProperty({
    description: 'Monthly tax amount',
    example: 15000,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  taxAmountMonthlyTax?: number;

  @ApiProperty({
    description: 'Annual tax amount',
    example: 180000,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  taxAmountAnnual?: number;

  @ApiProperty({
    description: 'Tax Period',
    example: '2026-05',
    required: false,
  })
  @IsString()
  @IsOptional()
  taxPeriod?: string;

  @ApiProperty({
    description: 'Payment Date',
    example: '2026-05-29T10:00:00.000Z',
    required: false,
  })
  @IsString()
  @IsOptional()
  paymentDate?: string;
}
