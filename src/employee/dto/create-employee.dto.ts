import { IsNotEmpty, IsString, IsEmail, IsOptional, IsBoolean, IsDateString, IsNumber, IsDecimal } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEmployeeDto {
  @ApiProperty({ example: 'EMP-001' })
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @ApiProperty({ example: 'John Doe' })
  @IsNotEmpty()
  @IsString()
  employeeName: string;

  @ApiProperty({ example: 'Richard Doe' })
  @IsNotEmpty()
  @IsString()
  fatherHusbandName: string;

  @ApiProperty({ example: 'dept-uuid' })
  @IsNotEmpty()
  @IsString()
  departmentId: string;

  @ApiPropertyOptional({ example: 'subdept-uuid' })
  @IsOptional()
  @IsString()
  subDepartmentId?: string;

  @ApiProperty({ example: 'grade-uuid' })
  @IsNotEmpty()
  @IsString()
  employeeGradeId: string;

  @ApiProperty({ example: 'attendance-id-123' })
  @IsNotEmpty()
  @IsString()
  attendanceId: string;

  @ApiProperty({ example: 'designation-uuid' })
  @IsNotEmpty()
  @IsString()
  designationId: string;

  @ApiProperty({ example: 'marital-status-uuid' })
  @IsNotEmpty()
  @IsString()
  maritalStatusId: string;

  @ApiProperty({ example: 'emp-status-uuid' })
  @IsNotEmpty()
  @IsString()
  employmentStatusId: string;

  @ApiPropertyOptional()
  department?: string;
  @ApiPropertyOptional()
  subDepartment?: string;
  @ApiPropertyOptional()
  employeeGrade?: string;
  @ApiPropertyOptional()
  designation?: string;
  @ApiPropertyOptional()
  maritalStatus?: string;
  @ApiPropertyOptional()
  employmentStatus?: string;

  @ApiPropertyOptional({ example: '2024-06-01' })
  @IsOptional()
  @IsDateString()
  probationExpiryDate?: string;

  @ApiProperty({ example: '42101-1234567-1' })
  @IsNotEmpty()
  @IsString()
  cnicNumber: string;

  @ApiPropertyOptional({ example: '2030-01-01' })
  @IsOptional()
  @IsDateString()
  cnicExpiryDate?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  lifetimeCnic?: boolean;

  @ApiProperty({ example: '2024-01-01' })
  @IsNotEmpty()
  @IsDateString()
  joiningDate: string;

  @ApiProperty({ example: '1990-01-01' })
  @IsNotEmpty()
  @IsDateString()
  dateOfBirth: string;

  @ApiProperty({ example: 'Pakistani' })
  @IsNotEmpty()
  @IsString()
  nationality: string;

  @ApiProperty({ example: 'Male' })
  @IsNotEmpty()
  @IsString()
  gender: string;

  @ApiProperty({ example: '+923001234567' })
  @IsNotEmpty()
  @IsString()
  contactNumber: string;

  @ApiPropertyOptional({ example: '+923007654321' })
  @IsOptional()
  @IsString()
  emergencyContactNumber?: string;

  @ApiPropertyOptional({ example: 'Jane Doe' })
  @IsOptional()
  @IsString()
  emergencyContactPerson?: string;

  @ApiPropertyOptional({ example: 'john.personal@example.com' })
  @IsOptional()
  @IsEmail()
  personalEmail?: string;

  @ApiProperty({ example: 'john.doe@company.com' })
  @IsNotEmpty()
  @IsEmail()
  officialEmail: string;

  @ApiProperty({ example: 'country-uuid' })
  @IsNotEmpty()
  @IsString()
  countryId: string;

  @ApiProperty({ example: 'state-uuid' })
  @IsNotEmpty()
  @IsString()
  stateId: string;

  @ApiProperty({ example: 'city-uuid' })
  @IsNotEmpty()
  @IsString()
  cityId: string;

  @ApiPropertyOptional()
  country?: string;
  @ApiPropertyOptional()
  province?: string;
  @ApiPropertyOptional()
  state?: string;
  @ApiPropertyOptional()
  city?: string;

  @ApiPropertyOptional({ example: 'DHA Phase 6' })
  @IsOptional()
  @IsString()
  area?: string;

  @ApiProperty({ example: 150000 })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  employeeSalary: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  eobi?: boolean;

  @ApiPropertyOptional({ example: 'EOBI-123' })
  @IsOptional()
  @IsString()
  eobiNumber?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  providentFund?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  overtimeApplicable?: boolean;

  @ApiPropertyOptional({ example: 'Saturday,Sunday' })
  @IsOptional()
  @IsString()
  daysOff?: string;

  @ApiProperty({ example: 'manager-uuid' })
  @IsNotEmpty()
  @IsString()
  reportingManager: string;

  @ApiProperty({ example: 'policy-uuid' })
  @IsNotEmpty()
  @IsString()
  workingHoursPolicyId: string;

  @ApiProperty({ example: 'branch-uuid' })
  @IsNotEmpty()
  @IsString()
  branchId: string;

  @ApiProperty({ example: 'leaves-policy-uuid' })
  @IsNotEmpty()
  @IsString()
  leavesPolicyId: string;

  @ApiPropertyOptional()
  workingHoursPolicy?: string;
  @ApiPropertyOptional()
  branch?: string;
  @ApiPropertyOptional()
  leavesPolicy?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  allowRemoteAttendance?: boolean;

  @ApiPropertyOptional({ example: '123 Street, City' })
  @IsOptional()
  @IsString()
  currentAddress?: string;

  @ApiPropertyOptional({ example: '456 Lane, City' })
  @IsOptional()
  @IsString()
  permanentAddress?: string;

  @ApiProperty({ example: 'HBL' })
  @IsNotEmpty()
  @IsString()
  bankName: string;

  @ApiProperty({ example: '1234567890' })
  @IsNotEmpty()
  @IsString()
  accountNumber: string;

  @ApiProperty({ example: 'John Doe' })
  @IsNotEmpty()
  @IsString()
  accountTitle: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  laptop?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  card?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  mobileSim?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  key?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  tools?: boolean;

  @ApiPropertyOptional({ example: 'Current' })
  @IsOptional()
  @IsString()
  accountType?: string;

  @ApiPropertyOptional({ example: 'password123' })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional({ example: 'role-uuid' })
  @IsOptional()
  @IsString()
  roles?: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateEmployeeDto {
  @ApiProperty({ example: 'uuid' })
  @IsNotEmpty()
  @IsString()
  id: string;

  @ApiPropertyOptional({ example: 'EMP-001' })
  employeeId?: string;
  @ApiPropertyOptional({ example: 'John Doe' })
  employeeName?: string;
  @ApiPropertyOptional({ example: 'Richard Doe' })
  fatherHusbandName?: string;
  @ApiPropertyOptional({ example: 'dept-uuid' })
  departmentId?: string;
  @ApiPropertyOptional({ example: 'subdept-uuid' })
  subDepartmentId?: string;
  @ApiPropertyOptional({ example: 'grade-uuid' })
  employeeGradeId?: string;
  @ApiPropertyOptional({ example: 'attendance-id' })
  attendanceId?: string;
  @ApiPropertyOptional({ example: 'designation-uuid' })
  designationId?: string;
  @ApiPropertyOptional({ example: 'marital-status-uuid' })
  maritalStatusId?: string;
  @ApiPropertyOptional({ example: 'emp-status-uuid' })
  employmentStatusId?: string;
  @ApiPropertyOptional({ example: '2024-06-01' })
  probationExpiryDate?: string;
  @ApiPropertyOptional({ example: '42101-1234567-1' })
  cnicNumber?: string;
  @ApiPropertyOptional({ example: '2030-01-01' })
  cnicExpiryDate?: string;
  @ApiPropertyOptional({ example: false })
  lifetimeCnic?: boolean;
  @ApiPropertyOptional({ example: '2024-01-01' })
  joiningDate?: string;
  @ApiPropertyOptional({ example: '1990-01-01' })
  dateOfBirth?: string;
  @ApiPropertyOptional({ example: 'Pakistani' })
  nationality?: string;
  @ApiPropertyOptional({ example: 'Male' })
  gender?: string;
  @ApiPropertyOptional({ example: '+923001234567' })
  contactNumber?: string;
  @ApiPropertyOptional({ example: '+923007654321' })
  emergencyContactNumber?: string;
  @ApiPropertyOptional({ example: 'Jane Doe' })
  emergencyContactPerson?: string;
  @ApiPropertyOptional({ example: 'john.personal@example.com' })
  personalEmail?: string;
  @ApiPropertyOptional({ example: 'john.official@company.com' })
  officialEmail?: string;
  @ApiPropertyOptional({ example: 'country-uuid' })
  countryId?: string;
  @ApiPropertyOptional({ example: 'state-uuid' })
  stateId?: string;
  @ApiPropertyOptional({ example: 'city-uuid' })
  cityId?: string;
  @ApiPropertyOptional({ example: 'DHA' })
  area?: string;
  @ApiPropertyOptional({ example: 150000 })
  employeeSalary?: number;
  @ApiPropertyOptional({ example: true })
  eobi?: boolean;
  @ApiPropertyOptional({ example: 'EOBI-123' })
  eobiNumber?: string;
  @ApiPropertyOptional({ example: true })
  providentFund?: boolean;
  @ApiPropertyOptional({ example: true })
  overtimeApplicable?: boolean;
  @ApiPropertyOptional()
  daysOff?: string;
  @ApiPropertyOptional({ example: 'manager-uuid' })
  reportingManager?: string;
  @ApiPropertyOptional({ example: 'policy-uuid' })
  workingHoursPolicyId?: string;
  @ApiPropertyOptional({ example: 'branch-uuid' })
  branchId?: string;
  @ApiPropertyOptional({ example: 'leaves-policy-uuid' })
  leavesPolicyId?: string;

  // Legacy fields for backward compatibility
  @ApiPropertyOptional()
  department?: string;
  @ApiPropertyOptional()
  subDepartment?: string;
  @ApiPropertyOptional()
  employeeGrade?: string;
  @ApiPropertyOptional()
  designation?: string;
  @ApiPropertyOptional()
  maritalStatus?: string;
  @ApiPropertyOptional()
  employmentStatus?: string;
  @ApiPropertyOptional()
  country?: string;
  @ApiPropertyOptional()
  province?: string;
  @ApiPropertyOptional()
  state?: string;
  @ApiPropertyOptional()
  city?: string;
  @ApiPropertyOptional()
  workingHoursPolicy?: string;
  @ApiPropertyOptional()
  branch?: string;
  @ApiPropertyOptional()
  leavesPolicy?: string;
  @ApiPropertyOptional({ example: false })
  allowRemoteAttendance?: boolean;
  @ApiPropertyOptional()
  currentAddress?: string;
  @ApiPropertyOptional()
  permanentAddress?: string;
  @ApiPropertyOptional()
  bankName?: string;
  @ApiPropertyOptional()
  accountNumber?: string;
  @ApiPropertyOptional()
  accountTitle?: string;
  @ApiPropertyOptional()
  laptop?: boolean;
  @ApiPropertyOptional()
  card?: boolean;
  @ApiPropertyOptional()
  mobileSim?: boolean;
  @ApiPropertyOptional()
  key?: boolean;
  @ApiPropertyOptional()
  tools?: boolean;
  @ApiPropertyOptional()
  accountType?: string;
  @ApiPropertyOptional()
  password?: string;
  @ApiPropertyOptional()
  roles?: string;
  @ApiPropertyOptional()
  status?: string;
}

