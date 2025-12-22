import { IsNotEmpty, IsString, IsEmail, IsOptional, IsBoolean, IsDateString, IsNumber, IsDecimal } from 'class-validator';
import { Type } from 'class-transformer';

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
  personalEmail?: string;

  @IsOptional()
  @IsEmail()
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
  branchId?: string;

  @IsOptional()
  @IsString()
  leavesPolicyId?: string;

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
  department?: string;
  subDepartment?: string;
  employeeGrade?: string;
  designation?: string;
  maritalStatus?: string;
  employmentStatus?: string;
  country?: string;
  province?: string;
  state?: string;
  city?: string;
  workingHoursPolicy?: string;
  branch?: string;
  leavesPolicy?: string;
}
