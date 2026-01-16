import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsDateString,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ========== Social Security Institution DTOs ==========
export class CreateSocialSecurityInstitutionDto {
  @ApiProperty({ example: 'SESSI' })
  @IsNotEmpty()
  @IsString()
  code: string;

  @ApiProperty({ example: 'Sindh Employees Social Security Institution' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Sindh' })
  @IsOptional()
  @IsString()
  province?: string;

  @ApiPropertyOptional({
    example: 'Social security institution for Sindh province',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'https://sessi.org.pk' })
  @IsOptional()
  @IsString()
  website?: string;

  @ApiPropertyOptional({ example: '+92-21-12345678' })
  @IsOptional()
  @IsString()
  contactNumber?: string;

  @ApiPropertyOptional({ example: 'Karachi, Pakistan' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 6.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  contributionRate?: number;
}

export class UpdateSocialSecurityInstitutionDto {
  @ApiProperty({ example: 'institution-uuid' })
  @IsNotEmpty()
  @IsString()
  id: string;

  @ApiPropertyOptional({ example: 'SESSI' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({
    example: 'Sindh Employees Social Security Institution',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'Sindh' })
  @IsOptional()
  @IsString()
  province?: string;

  @ApiPropertyOptional({
    example: 'Social security institution for Sindh province',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'https://sessi.org.pk' })
  @IsOptional()
  @IsString()
  website?: string;

  @ApiPropertyOptional({ example: '+92-21-12345678' })
  @IsOptional()
  @IsString()
  contactNumber?: string;

  @ApiPropertyOptional({ example: 'Karachi, Pakistan' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 6.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  contributionRate?: number;
}

// ========== Employer Registration DTOs ==========
export class CreateSocialSecurityEmployerRegistrationDto {
  @ApiProperty({ example: 'institution-uuid' })
  @IsNotEmpty()
  @IsString()
  institutionId: string;

  @ApiProperty({ example: 'SESSI-EMP-2024-001' })
  @IsNotEmpty()
  @IsString()
  registrationNumber: string;

  @ApiProperty({ example: 'ABC Company Ltd' })
  @IsNotEmpty()
  @IsString()
  employerName: string;

  @ApiProperty({ example: 'company' })
  @IsNotEmpty()
  @IsString()
  employerType: string;

  @ApiProperty({ example: '123 Main Street, Karachi' })
  @IsNotEmpty()
  @IsString()
  businessAddress: string;

  @ApiPropertyOptional({ example: 'Karachi' })
  @IsOptional()
  @IsString()
  businessCity?: string;

  @ApiPropertyOptional({ example: 'Sindh' })
  @IsOptional()
  @IsString()
  businessState?: string;

  @ApiPropertyOptional({ example: 'Pakistan' })
  @IsOptional()
  @IsString()
  businessCountry?: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  contactPerson?: string;

  @ApiPropertyOptional({ example: '+92-300-1234567' })
  @IsOptional()
  @IsString()
  contactNumber?: string;

  @ApiPropertyOptional({ example: 'contact@company.com' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiProperty({ example: '2024-01-01T00:00:00Z' })
  @IsNotEmpty()
  @IsDateString()
  registrationDate: string;

  @ApiPropertyOptional({ example: '2025-12-31T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  totalEmployees?: number;

  @ApiPropertyOptional({ example: 50000.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  monthlyContribution?: number;

  @ApiPropertyOptional({ example: 'Additional notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    example: { certificate: 'https://example.com/cert.pdf' },
  })
  @IsOptional()
  @IsObject()
  documentUrls?: any;
}

export class UpdateSocialSecurityEmployerRegistrationDto {
  @ApiProperty({ example: 'registration-uuid' })
  @IsNotEmpty()
  @IsString()
  id: string;

  @ApiPropertyOptional({ example: 'SESSI-EMP-2024-001' })
  @IsOptional()
  @IsString()
  registrationNumber?: string;

  @ApiPropertyOptional({ example: 'ABC Company Ltd' })
  @IsOptional()
  @IsString()
  employerName?: string;

  @ApiPropertyOptional({ example: 'company' })
  @IsOptional()
  @IsString()
  employerType?: string;

  @ApiPropertyOptional({ example: '123 Main Street, Karachi' })
  @IsOptional()
  @IsString()
  businessAddress?: string;

  @ApiPropertyOptional({ example: 'Karachi' })
  @IsOptional()
  @IsString()
  businessCity?: string;

  @ApiPropertyOptional({ example: 'Sindh' })
  @IsOptional()
  @IsString()
  businessState?: string;

  @ApiPropertyOptional({ example: 'Pakistan' })
  @IsOptional()
  @IsString()
  businessCountry?: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  contactPerson?: string;

  @ApiPropertyOptional({ example: '+92-300-1234567' })
  @IsOptional()
  @IsString()
  contactNumber?: string;

  @ApiPropertyOptional({ example: 'contact@company.com' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ example: '2024-01-01T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  registrationDate?: string;

  @ApiPropertyOptional({ example: '2025-12-31T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  totalEmployees?: number;

  @ApiPropertyOptional({ example: 50000.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  monthlyContribution?: number;

  @ApiPropertyOptional({ example: 'Additional notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    example: { certificate: 'https://example.com/cert.pdf' },
  })
  @IsOptional()
  @IsObject()
  documentUrls?: any;
}

// ========== Employee Registration DTOs ==========
export class CreateSocialSecurityEmployeeRegistrationDto {
  @ApiProperty({ example: 'institution-uuid' })
  @IsNotEmpty()
  @IsString()
  institutionId: string;

  @ApiProperty({ example: 'employer-registration-uuid' })
  @IsNotEmpty()
  @IsString()
  employerRegistrationId: string;

  @ApiProperty({ example: 'employee-uuid' })
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @ApiProperty({ example: 'SESSI-EMP-2024-001-001' })
  @IsNotEmpty()
  @IsString()
  registrationNumber: string;

  @ApiPropertyOptional({ example: 'CARD-123456' })
  @IsOptional()
  @IsString()
  cardNumber?: string;

  @ApiProperty({ example: '2024-01-01T00:00:00Z' })
  @IsNotEmpty()
  @IsDateString()
  registrationDate: string;

  @ApiPropertyOptional({ example: '2025-12-31T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 6.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  contributionRate?: number;

  @ApiProperty({ example: 50000.0 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  baseSalary: number;

  @ApiProperty({ example: 3000.0 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  monthlyContribution: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isEmployerContribution?: boolean;

  @ApiPropertyOptional({ example: 1500.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  employeeContribution?: number;

  @ApiPropertyOptional({ example: 1500.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  employerContribution?: number;

  @ApiPropertyOptional({ example: '2024-01-15T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  cardIssueDate?: string;

  @ApiPropertyOptional({ example: '2025-12-31T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  cardExpiryDate?: string;

  @ApiPropertyOptional({ example: 'issued' })
  @IsOptional()
  @IsString()
  cardStatus?: string;

  @ApiPropertyOptional({ example: { card: 'https://example.com/card.pdf' } })
  @IsOptional()
  @IsObject()
  documentUrls?: any;

  @ApiPropertyOptional({ example: 'Additional notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateSocialSecurityEmployeeRegistrationDto {
  @ApiProperty({ example: 'registration-uuid' })
  @IsNotEmpty()
  @IsString()
  id: string;

  @ApiPropertyOptional({ example: 'SESSI-EMP-2024-001-001' })
  @IsOptional()
  @IsString()
  registrationNumber?: string;

  @ApiPropertyOptional({ example: 'CARD-123456' })
  @IsOptional()
  @IsString()
  cardNumber?: string;

  @ApiPropertyOptional({ example: '2024-01-01T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  registrationDate?: string;

  @ApiPropertyOptional({ example: '2025-12-31T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 6.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  contributionRate?: number;

  @ApiPropertyOptional({ example: 50000.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  baseSalary?: number;

  @ApiPropertyOptional({ example: 3000.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  monthlyContribution?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isEmployerContribution?: boolean;

  @ApiPropertyOptional({ example: 1500.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  employeeContribution?: number;

  @ApiPropertyOptional({ example: 1500.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  employerContribution?: number;

  @ApiPropertyOptional({ example: '2024-01-15T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  cardIssueDate?: string;

  @ApiPropertyOptional({ example: '2025-12-31T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  cardExpiryDate?: string;

  @ApiPropertyOptional({ example: 'issued' })
  @IsOptional()
  @IsString()
  cardStatus?: string;

  @ApiPropertyOptional({ example: { card: 'https://example.com/card.pdf' } })
  @IsOptional()
  @IsObject()
  documentUrls?: any;

  @ApiPropertyOptional({ example: 'Additional notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ========== Contribution DTOs ==========
export class CreateSocialSecurityContributionDto {
  @ApiProperty({ example: 'institution-uuid' })
  @IsNotEmpty()
  @IsString()
  institutionId: string;

  @ApiProperty({ example: 'employer-registration-uuid' })
  @IsNotEmpty()
  @IsString()
  employerRegistrationId: string;

  @ApiProperty({ example: 'employee-registration-uuid' })
  @IsNotEmpty()
  @IsString()
  employeeRegistrationId: string;

  @ApiProperty({ example: 'employee-uuid' })
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @ApiProperty({ example: '01' })
  @IsNotEmpty()
  @IsString()
  month: string;

  @ApiProperty({ example: '2024' })
  @IsNotEmpty()
  @IsString()
  year: string;

  @ApiProperty({ example: '2024-01-15T00:00:00Z' })
  @IsNotEmpty()
  @IsDateString()
  date: string;

  @ApiProperty({ example: 50000.0 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  baseSalary: number;

  @ApiProperty({ example: 6.0 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  contributionRate: number;

  @ApiProperty({ example: 3000.0 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  contributionAmount: number;

  @ApiPropertyOptional({ example: 1500.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  employeeContribution?: number;

  @ApiPropertyOptional({ example: 1500.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  employerContribution?: number;

  @ApiPropertyOptional({ example: 'pending' })
  @IsOptional()
  @IsString()
  paymentStatus?: string;

  @ApiPropertyOptional({ example: '2024-01-20T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @ApiPropertyOptional({ example: 'PAY-REF-123456' })
  @IsOptional()
  @IsString()
  paymentReference?: string;

  @ApiPropertyOptional({ example: '2024-01-25T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ example: 100.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lateFee?: number;

  @ApiPropertyOptional({ example: 'Additional notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'payroll-detail-uuid' })
  @IsOptional()
  @IsString()
  payrollDetailId?: string;
}

export class UpdateSocialSecurityContributionDto {
  @ApiProperty({ example: 'contribution-uuid' })
  @IsNotEmpty()
  @IsString()
  id: string;

  @ApiPropertyOptional({ example: 50000.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  baseSalary?: number;

  @ApiPropertyOptional({ example: 6.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  contributionRate?: number;

  @ApiPropertyOptional({ example: 3000.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  contributionAmount?: number;

  @ApiPropertyOptional({ example: 1500.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  employeeContribution?: number;

  @ApiPropertyOptional({ example: 1500.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  employerContribution?: number;

  @ApiPropertyOptional({ example: 'paid' })
  @IsOptional()
  @IsString()
  paymentStatus?: string;

  @ApiPropertyOptional({ example: '2024-01-20T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @ApiPropertyOptional({ example: 'PAY-REF-123456' })
  @IsOptional()
  @IsString()
  paymentReference?: string;

  @ApiPropertyOptional({ example: '2024-01-25T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ example: 100.0 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lateFee?: number;

  @ApiPropertyOptional({ example: 'Additional notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'payroll-detail-uuid' })
  @IsOptional()
  @IsString()
  payrollDetailId?: string;
}
