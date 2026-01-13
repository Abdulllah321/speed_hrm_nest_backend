import { IsNotEmpty, IsString, IsEmail, IsOptional, IsBoolean, IsDateString, IsNumber, IsDecimal } from 'class-validator';
import { Transform, Type } from 'class-transformer';
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

  @ApiPropertyOptional({ example: 'dept-uuid' })
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional({ example: 'subdept-uuid' })
  @IsOptional()
  @IsString()
  subDepartmentId?: string;

  @ApiPropertyOptional({ example: 'grade-uuid' })
  @IsOptional()
  @IsString()
  employeeGradeId?: string;

  @ApiProperty({ example: 'attendance-id-123' })
  @IsNotEmpty()
  @IsString()
  attendanceId: string;

  @ApiPropertyOptional({ example: 'designation-uuid' })
  @IsOptional()
  @IsString()
  designationId?: string;

  @ApiPropertyOptional({ example: 'marital-status-uuid' })
  @IsOptional()
  @IsString()
  maritalStatusId?: string;

  @ApiPropertyOptional({ example: 'emp-status-uuid' })
  @IsOptional()
  @IsString()
  employmentStatusId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  department?: string;
  @ApiPropertyOptional()
  @IsOptional()
  subDepartment?: string;
  @ApiPropertyOptional()
  @IsOptional()
  employeeGrade?: string;
  @ApiPropertyOptional()
  @IsOptional()
  designation?: string;
  @ApiPropertyOptional()
  @IsOptional()
  maritalStatus?: string;
  @ApiPropertyOptional()
  @IsOptional()
  employmentStatus?: string;

  @ApiPropertyOptional({ example: '2024-06-01' })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => (value === '' ? null : value))
  probationExpiryDate?: string;

  @ApiProperty({ example: '42101-1234567-1' })
  @IsNotEmpty()
  @IsString()
  cnicNumber: string;

  @ApiPropertyOptional({ example: '2030-01-01' })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => (value === '' ? null : value))
  cnicExpiryDate?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  lifetimeCnic?: boolean;

  @ApiPropertyOptional({ example: '2024-01-01' })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => (value === '' ? null : value))
  joiningDate?: string;

  @ApiProperty({ example: '1990-01-01' })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => (value === '' ? null : value))
  dateOfBirth?: string;

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
  @Transform(({ value }) => (value === '' ? null : value))
  personalEmail?: string;

  @ApiPropertyOptional({ example: 'john.doe@company.com' })
  @IsOptional()
  @IsEmail()
  @Transform(({ value }) => (value === '' ? null : value))
  officialEmail?: string;

  @ApiPropertyOptional({ example: 'country-uuid' })
  @IsOptional()
  @IsString()
  countryId?: string;

  @ApiPropertyOptional({ example: 'state-uuid' })
  @IsOptional()
  @IsString()
  stateId?: string;

  @ApiPropertyOptional({ example: 'city-uuid' })
  @IsOptional()
  @IsString()
  cityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  country?: string;
  @ApiPropertyOptional()
  @IsOptional()
  province?: string;
  @ApiPropertyOptional()
  @IsOptional()
  state?: string;
  @ApiPropertyOptional()
  @IsOptional()
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

  @ApiPropertyOptional({ example: '0800B656361' })
  @IsOptional()
  @IsString()
  eobiId?: string;

  @ApiPropertyOptional({ example: 'AA001' })
  @IsOptional()
  @IsString()
  eobiCode?: string;

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

  @ApiPropertyOptional({ example: 'manager-uuid' })
  @IsOptional()
  @IsString()
  reportingManager?: string;

  @ApiPropertyOptional({ example: 'policy-uuid' })
  @IsOptional()
  @IsString()
  workingHoursPolicyId?: string;

  @ApiPropertyOptional({ example: 'location-uuid' })
  @IsOptional()
  @IsString()
  locationId?: string;

  @ApiPropertyOptional({ example: 'leaves-policy-uuid' })
  @IsOptional()
  @IsString()
  leavesPolicyId?: string;

  @ApiPropertyOptional({ example: 'allocation-uuid' })
  @IsOptional()
  @IsString()
  allocationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  workingHoursPolicy?: string;
  @ApiPropertyOptional()
  @IsOptional()
  location?: string;
  @ApiPropertyOptional()
  @IsOptional()
  leavesPolicy?: string;
  @ApiPropertyOptional()
  @IsOptional()
  allocation?: string;

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

  @ApiPropertyOptional({ example: 'HBL' })
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional({ example: '1234567890' })
  @IsOptional()
  @IsString()
  accountNumber?: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  accountTitle?: string;

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

  @ApiPropertyOptional()
  @IsOptional()
  emergencyContactPersonName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  selectedEquipments?: any;

  @ApiPropertyOptional()
  @IsOptional()
  avatarUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  eobiDocumentUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  documentUrls?: any;

  @ApiPropertyOptional()
  @IsOptional()
  @ApiPropertyOptional()
  @IsOptional()
  qualifications?: any;

  @ApiPropertyOptional()
  @IsOptional()
  socialSecurityRegistrations?: any;
}

export class UpdateEmployeeDto {
  @ApiPropertyOptional({ example: 'uuid' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({ example: 'EMP-001' })
  @IsOptional()
  @IsString()
  employeeId?: string;
  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  employeeName?: string;
  @ApiPropertyOptional({ example: 'Richard Doe' })
  @IsOptional()
  @IsString()
  fatherHusbandName?: string;
  @ApiPropertyOptional({ example: 'dept-uuid' })
  @IsOptional()
  @IsString()
  departmentId?: string;
  @ApiPropertyOptional({ example: 'subdept-uuid' })
  @IsOptional()
  @IsString()
  subDepartmentId?: string;
  @ApiPropertyOptional({ example: 'grade-uuid' })
  @IsOptional()
  @IsString()
  employeeGradeId?: string;
  @ApiPropertyOptional({ example: 'attendance-id' })
  @IsOptional()
  @IsString()
  attendanceId?: string;
  @ApiPropertyOptional({ example: 'designation-uuid' })
  @IsOptional()
  @IsString()
  designationId?: string;
  @ApiPropertyOptional({ example: 'marital-status-uuid' })
  @IsOptional()
  @IsString()
  maritalStatusId?: string;
  @ApiPropertyOptional({ example: 'emp-status-uuid' })
  @IsOptional()
  @IsString()
  employmentStatusId?: string;
  @ApiPropertyOptional({ example: '2024-06-01' })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => (value === '' ? null : value))
  probationExpiryDate?: string;
  @ApiPropertyOptional({ example: '42101-1234567-1' })
  @IsOptional()
  @IsString()
  cnicNumber?: string;
  @ApiPropertyOptional({ example: '2030-01-01' })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => (value === '' ? null : value))
  cnicExpiryDate?: string;
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  lifetimeCnic?: boolean;
  @ApiPropertyOptional({ example: '2024-01-01' })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => (value === '' ? null : value))
  joiningDate?: string;
  @ApiPropertyOptional({ example: '1990-01-01' })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => (value === '' ? null : value))
  dateOfBirth?: string;
  @ApiPropertyOptional({ example: 'Pakistani' })
  @IsOptional()
  @IsString()
  nationality?: string;
  @ApiPropertyOptional({ example: 'Male' })
  @IsOptional()
  @IsString()
  gender?: string;
  @ApiPropertyOptional({ example: '+923001234567' })
  @IsOptional()
  @IsString()
  contactNumber?: string;
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
  @Transform(({ value }) => (value === '' ? null : value))
  personalEmail?: string;
  @ApiPropertyOptional({ example: 'john.official@company.com' })
  @IsOptional()
  @IsEmail()
  @Transform(({ value }) => (value === '' ? null : value))
  officialEmail?: string;
  @ApiPropertyOptional({ example: 'country-uuid' })
  @IsOptional()
  @IsString()
  countryId?: string;
  @ApiPropertyOptional({ example: 'state-uuid' })
  @IsOptional()
  @IsString()
  stateId?: string;
  @ApiPropertyOptional({ example: 'city-uuid' })
  @IsOptional()
  @IsString()
  cityId?: string;
  @ApiPropertyOptional({ example: 'DHA' })
  @IsOptional()
  @IsString()
  area?: string;
  @ApiPropertyOptional({ example: 150000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  employeeSalary?: number;
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  eobi?: boolean;
  @ApiPropertyOptional({ example: '0800B656361' })
  @IsOptional()
  @IsString()
  eobiId?: string;
  @ApiPropertyOptional({ example: 'AA001' })
  @IsOptional()
  @IsString()
  eobiCode?: string;
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
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  daysOff?: string;
  @ApiPropertyOptional({ example: 'manager-uuid' })
  @IsOptional()
  @IsString()
  reportingManager?: string;
  @ApiPropertyOptional({ example: 'policy-uuid' })
  @IsOptional()
  @IsString()
  workingHoursPolicyId?: string;
  @ApiPropertyOptional({ example: 'location-uuid' })
  @IsOptional()
  @IsString()
  locationId?: string;
  @ApiPropertyOptional({ example: 'leaves-policy-uuid' })
  @IsOptional()
  @IsString()
  leavesPolicyId?: string;

  // Legacy fields for backward compatibility
  @ApiPropertyOptional()
  @IsOptional()
  department?: string;
  @ApiPropertyOptional()
  @IsOptional()
  subDepartment?: string;
  @ApiPropertyOptional()
  @IsOptional()
  employeeGrade?: string;
  @ApiPropertyOptional()
  @IsOptional()
  designation?: string;
  @ApiPropertyOptional()
  @IsOptional()
  maritalStatus?: string;
  @ApiPropertyOptional()
  @IsOptional()
  employmentStatus?: string;
  @ApiPropertyOptional()
  @IsOptional()
  country?: string;
  @ApiPropertyOptional()
  @IsOptional()
  province?: string;
  @ApiPropertyOptional()
  @IsOptional()
  state?: string;
  @ApiPropertyOptional()
  @IsOptional()
  city?: string;
  @ApiPropertyOptional()
  @IsOptional()
  workingHoursPolicy?: string;
  @ApiPropertyOptional()
  @IsOptional()
  location?: string;
  @ApiPropertyOptional()
  @IsOptional()
  leavesPolicy?: string;
  @ApiPropertyOptional()
  @IsOptional()
  allocation?: string;
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  allowRemoteAttendance?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currentAddress?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  permanentAddress?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankName?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountNumber?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountTitle?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  laptop?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  card?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  mobileSim?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  key?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  tools?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountType?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  password?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  roles?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  emergencyContactPersonName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  equipmentAssignments?: any;

  @ApiPropertyOptional()
  @IsOptional()
  avatarUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  eobiDocumentUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  documentUrls?: any;

  @ApiPropertyOptional()
  @IsOptional()
  @ApiPropertyOptional()
  @IsOptional()
  qualifications?: any;

  @ApiPropertyOptional()
  @IsOptional()
  socialSecurityRegistrations?: any;
}

