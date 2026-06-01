import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsArray, IsOptional } from 'class-validator';

export class PreviewPayrollDto {
  @ApiProperty({
    description: 'Month for payroll generation',
    example: '12',
  })
  @IsString()
  month: string;

  @ApiProperty({
    description: 'Year for payroll generation',
    example: '2026',
  })
  @IsString()
  year: string;

  @ApiProperty({
    description: 'Optional array of employee IDs. Leave empty for all employees.',
    example: [],
    required: false,
  })
  @IsArray()
  @IsOptional()
  employeeIds?: string[];
}

export class ConfirmPayrollDto {
  @ApiProperty({
    description: 'Month for payroll generation',
    example: '12',
  })
  @IsString()
  month: string;

  @ApiProperty({
    description: 'Year for payroll generation',
    example: '2026',
  })
  @IsString()
  year: string;

  @ApiProperty({
    description: 'User ID who is generating the payroll',
    example: 'user-id-here',
  })
  @IsString()
  generatedBy: string;

  @ApiProperty({
    description: 'Payroll details from preview response',
    example: [],
  })
  @IsArray()
  details: any[];
}