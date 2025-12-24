import { IsNotEmpty, IsString, IsNumber, IsOptional, IsDateString, IsArray, ValidateNested, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateLoanRequestItemDto {
  @ApiProperty({ example: 'emp-uuid' })
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @ApiProperty({ example: 'lt-uuid' })
  @IsNotEmpty()
  @IsString()
  loanTypeId: string;

  @ApiProperty({ example: 50000 })
  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @ApiProperty({ example: '2023-05-01' })
  @IsNotEmpty()
  @IsDateString()
  requestedDate: string;

  @ApiPropertyOptional({ example: '2023-06' })
  @IsOptional()
  @IsString()
  repaymentStartMonthYear?: string; // Format: "YYYY-MM"

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  numberOfInstallments?: number;

  @ApiProperty({ example: 'Home Renovation' })
  @IsNotEmpty()
  @IsString()
  reason: string;

  @ApiPropertyOptional({ example: 'Urgent' })
  @IsOptional()
  @IsString()
  additionalDetails?: string;
}

export class CreateLoanRequestDto {
  @ApiProperty({ type: [CreateLoanRequestItemDto] })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateLoanRequestItemDto)
  loanRequests: CreateLoanRequestItemDto[];
  
  // Note: Currently only single employee loan requests are supported
  // The array structure is maintained for API consistency, but only one item should be provided
}

export class UpdateLoanRequestDto {
  @ApiPropertyOptional({ example: 'lt-uuid' })
  @IsOptional()
  @IsString()
  loanTypeId?: string;

  @ApiPropertyOptional({ example: 55000 })
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiPropertyOptional({ example: '2023-05-05' })
  @IsOptional()
  @IsDateString()
  requestedDate?: string;

  @ApiPropertyOptional({ example: '2023-07' })
  @IsOptional()
  @IsString()
  repaymentStartMonthYear?: string;

  @ApiPropertyOptional({ example: 24 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  numberOfInstallments?: number;

  @ApiPropertyOptional({ example: 'Updated Reason' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ example: 'Updated details' })
  @IsOptional()
  @IsString()
  additionalDetails?: string;

  @ApiPropertyOptional({ example: 'pending', enum: ['pending', 'approved', 'rejected'] })
  @IsOptional()
  @IsString()
  approvalStatus?: string; // pending, approved, rejected

  @ApiPropertyOptional({ example: 'Low credit score' })
  @IsOptional()
  @IsString()
  rejectionReason?: string;

  @ApiPropertyOptional({ example: 'pending', enum: ['pending', 'approved', 'rejected', 'disbursed', 'completed', 'cancelled'] })
  @IsOptional()
  @IsString()
  status?: string; // pending, approved, rejected, disbursed, completed, cancelled
}

export class ApproveLoanRequestDto {
  @ApiPropertyOptional({ example: 'Incomplete documents' })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
