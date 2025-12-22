import { IsNotEmpty, IsString, IsNumber, IsOptional, IsDateString, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAdvanceSalaryItemDto {
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @IsNotEmpty()
  @IsDateString()
  neededOn: string; // When the advance salary is needed

  @IsNotEmpty()
  @IsString()
  deductionMonth: string; // Format: "01" to "12"

  @IsNotEmpty()
  @IsString()
  deductionYear: string; // Format: "YYYY"

  @IsNotEmpty()
  @IsString()
  deductionMonthYear: string; // Format: "YYYY-MM"

  @IsNotEmpty()
  @IsString()
  reason: string; // Detailed reason
}

export class CreateAdvanceSalaryDto {
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAdvanceSalaryItemDto)
  advanceSalaries: CreateAdvanceSalaryItemDto[];
}

export class UpdateAdvanceSalaryDto {
  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsDateString()
  neededOn?: string;

  @IsOptional()
  @IsString()
  deductionMonth?: string;

  @IsOptional()
  @IsString()
  deductionYear?: string;

  @IsOptional()
  @IsString()
  deductionMonthYear?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  approvalStatus?: string; // pending, approved, rejected

  @IsOptional()
  @IsString()
  rejectionReason?: string;

  @IsOptional()
  @IsString()
  status?: string; // pending, active, completed, cancelled, rejected
}

export class ApproveAdvanceSalaryDto {
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
