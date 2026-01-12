import { IsNotEmpty, IsString, IsEmail, IsOptional, IsBoolean, IsDateString, IsNumber, IsDecimal } from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * DTO for rejoining an employee
 * Allows updating ALL fields except CNIC (which is used to identify the employee)
 */
export class RejoinEmployeeDto {
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @IsNotEmpty()
  @IsString()
  attendanceId: string;

  @IsNotEmpty()
  @IsDateString()
  joiningDate: string;

  // All employee fields that can be updated on rejoin
  @IsOptional()
  @IsString()
  employeeName?: string;

  @IsOptional()
  @IsString()
  fatherHusbandName?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  subDepartmentId?: string;

  @IsOptional()
  @IsString()
  employeeGradeId?: string;

  @IsOptional()
  @IsString()
  designationId?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value === '' ? null : value))
  maritalStatusId?: string;

  @IsOptional()
  @IsString()
  employmentStatusId?: string;

  @IsOptional()
  @IsDateString()
  probationExpiryDate?: string;

  @IsOptional()
  @IsDateString()
  cnicExpiryDate?: string;

  @IsOptional()
  @IsBoolean()
  lifetimeCnic?: boolean;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  nationality?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  contactNumber?: string;

  @IsOptional()
  @IsString()
  emergencyContactNumber?: string;

  @IsOptional()
  @IsString()
  emergencyContactPerson?: string;

  @IsOptional()
  @IsEmail()
  @Transform(({ value }) => (value === '' ? null : value))
  personalEmail?: string;

  @IsOptional()
  @IsEmail()
  @Transform(({ value }) => (value === '' ? null : value))
  officialEmail?: string;

  @IsOptional()
  @IsString()
  countryId?: string;

  @IsOptional()
  @IsString()
  stateId?: string;

  @IsOptional()
  @IsString()
  cityId?: string;

  @IsOptional()
  @IsString()
  area?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  employeeSalary?: number;

  @IsOptional()
  @IsBoolean()
  eobi?: boolean;

  @IsOptional()
  @IsString()
  eobiId?: string;

  @IsOptional()
  @IsString()
  eobiCode?: string;

  @IsOptional()
  @IsString()
  eobiNumber?: string;

  @IsOptional()
  @IsString()
  eobiDocumentUrl?: string;

  @IsOptional()
  providentFund?: boolean;

  @IsOptional()
  @IsBoolean()
  overtimeApplicable?: boolean;

  @IsOptional()
  @IsString()
  daysOff?: string;

  @IsOptional()
  @IsString()
  reportingManager?: string;

  @IsOptional()
  @IsString()
  workingHoursPolicyId?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  leavesPolicyId?: string;

  @IsOptional()
  @IsString()
  allocationId?: string;

  @IsOptional()
  @IsString()
  allocation?: string;

  @IsOptional()
  @IsBoolean()
  allowRemoteAttendance?: boolean;

  @IsOptional()
  @IsString()
  currentAddress?: string;

  @IsOptional()
  @IsString()
  permanentAddress?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsOptional()
  @IsString()
  accountTitle?: string;

  @IsOptional()
  documentUrls?: any; // JSON field

  @IsOptional()
  @IsString()
  remarks?: string;

  // Legacy fields for backward compatibility
  @IsOptional()
  department?: string;
  @IsOptional()
  subDepartment?: string;
  @IsOptional()
  employeeGrade?: string;
  @IsOptional()
  designation?: string;
  @IsOptional()
  maritalStatus?: string;
  @IsOptional()
  employmentStatus?: string;
  @IsOptional()
  country?: string;
  @IsOptional()
  province?: string;
  @IsOptional()
  state?: string;
  @IsOptional()
  city?: string;
  @IsOptional()
  workingHoursPolicy?: string;
  @IsOptional()
  location?: string;
  @IsOptional()
  leavesPolicy?: string;

  @IsOptional()
  emergencyContactPersonName?: string;

  @IsOptional()
  selectedEquipments?: any;

  @IsOptional()
  avatarUrl?: string;

  @IsOptional()
  qualifications?: any;

  @IsOptional()
  socialSecurityRegistrations?: any;
}
