import { IsNotEmpty, IsString, IsNumber, IsOptional, IsDateString, IsArray, ValidateNested, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateLoanRequestItemDto {
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @IsNotEmpty()
  @IsString()
  loanTypeId: string;

  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @IsNotEmpty()
  @IsDateString()
  requestedDate: string;

  @IsOptional()
  @IsString()
  repaymentStartMonthYear?: string; // Format: "YYYY-MM"

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  numberOfInstallments?: number;

  @IsNotEmpty()
  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  additionalDetails?: string;
}

export class CreateLoanRequestDto {
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateLoanRequestItemDto)
  loanRequests: CreateLoanRequestItemDto[];
  
  // Note: Currently only single employee loan requests are supported
  // The array structure is maintained for API consistency, but only one item should be provided
}

export class UpdateLoanRequestDto {
  @IsOptional()
  @IsString()
  loanTypeId?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsDateString()
  requestedDate?: string;

  @IsOptional()
  @IsString()
  repaymentStartMonthYear?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  numberOfInstallments?: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  additionalDetails?: string;

  @IsOptional()
  @IsString()
  approvalStatus?: string; // pending, approved, rejected

  @IsOptional()
  @IsString()
  rejectionReason?: string;

  @IsOptional()
  @IsString()
  status?: string; // pending, approved, rejected, disbursed, completed, cancelled
}

export class ApproveLoanRequestDto {
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
