import { IsNotEmpty, IsString, IsEmail, IsOptional, IsBoolean, IsDateString, IsNumber, IsDecimal } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateEmployeeDto {
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @IsNotEmpty()
  @IsString()
  employeeName: string;

  @IsNotEmpty()
  @IsString()
  fatherHusbandName: string;

  @IsNotEmpty()
  @IsString()
  department: string;

  @IsOptional()
  @IsString()
  subDepartment?: string;

  @IsNotEmpty()
  @IsString()
  employeeGrade: string;

  @IsNotEmpty()
  @IsString()
  attendanceId: string;

  @IsNotEmpty()
  @IsString()
  designation: string;

  @IsNotEmpty()
  @IsString()
  maritalStatus: string;

  @IsNotEmpty()
  @IsString()
  employmentStatus: string;

  @IsOptional()
  @IsDateString()
  probationExpiryDate?: string;

  @IsNotEmpty()
  @IsString()
  cnicNumber: string;

  @IsOptional()
  @IsDateString()
  cnicExpiryDate?: string;

  @IsOptional()
  @IsBoolean()
  lifetimeCnic?: boolean;

  @IsNotEmpty()
  @IsDateString()
  joiningDate: string;

  @IsNotEmpty()
  @IsDateString()
  dateOfBirth: string;

  @IsNotEmpty()
  @IsString()
  nationality: string;

  @IsNotEmpty()
  @IsString()
  gender: string;

  @IsNotEmpty()
  @IsString()
  contactNumber: string;

  @IsOptional()
  @IsString()
  emergencyContactNumber?: string;

  @IsOptional()
  @IsString()
  emergencyContactPerson?: string;

  @IsOptional()
  @IsEmail()
  personalEmail?: string;

  @IsNotEmpty()
  @IsEmail()
  officialEmail: string;

  @IsNotEmpty()
  @IsString()
  country: string;

  @IsNotEmpty()
  @IsString()
  province: string;

  @IsNotEmpty()
  @IsString()
  city: string;

  @IsOptional()
  @IsString()
  area?: string;

  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  employeeSalary: number;

  @IsOptional()
  @IsBoolean()
  eobi?: boolean;

  @IsOptional()
  @IsString()
  eobiNumber?: string;

  @IsOptional()
  @IsBoolean()
  providentFund?: boolean;

  @IsOptional()
  @IsBoolean()
  overtimeApplicable?: boolean;

  @IsOptional()
  @IsString()
  daysOff?: string;

  @IsNotEmpty()
  @IsString()
  reportingManager: string;

  @IsNotEmpty()
  @IsString()
  workingHoursPolicy: string;

  @IsNotEmpty()
  @IsString()
  branch: string;

  @IsNotEmpty()
  @IsString()
  leavesPolicy: string;

  @IsOptional()
  @IsBoolean()
  allowRemoteAttendance?: boolean;

  @IsOptional()
  @IsString()
  currentAddress?: string;

  @IsOptional()
  @IsString()
  permanentAddress?: string;

  @IsNotEmpty()
  @IsString()
  bankName: string;

  @IsNotEmpty()
  @IsString()
  accountNumber: string;

  @IsNotEmpty()
  @IsString()
  accountTitle: string;

  @IsOptional()
  @IsBoolean()
  laptop?: boolean;

  @IsOptional()
  @IsBoolean()
  card?: boolean;

  @IsOptional()
  @IsBoolean()
  mobileSim?: boolean;

  @IsOptional()
  @IsBoolean()
  key?: boolean;

  @IsOptional()
  @IsBoolean()
  tools?: boolean;

  @IsOptional()
  @IsString()
  accountType?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  roles?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateEmployeeDto {
  @IsNotEmpty()
  @IsString()
  id: string;

  employeeId?: string;
  employeeName?: string;
  fatherHusbandName?: string;
  department?: string;
  subDepartment?: string;
  employeeGrade?: string;
  attendanceId?: string;
  designation?: string;
  maritalStatus?: string;
  employmentStatus?: string;
  probationExpiryDate?: string;
  cnicNumber?: string;
  cnicExpiryDate?: string;
  lifetimeCnic?: boolean;
  joiningDate?: string;
  dateOfBirth?: string;
  nationality?: string;
  gender?: string;
  contactNumber?: string;
  emergencyContactNumber?: string;
  emergencyContactPerson?: string;
  personalEmail?: string;
  officialEmail?: string;
  country?: string;
  province?: string;
  city?: string;
  area?: string;
  employeeSalary?: number;
  eobi?: boolean;
  eobiNumber?: string;
  providentFund?: boolean;
  overtimeApplicable?: boolean;
  daysOff?: string;
  reportingManager?: string;
  workingHoursPolicy?: string;
  branch?: string;
  leavesPolicy?: string;
  allowRemoteAttendance?: boolean;
  currentAddress?: string;
  permanentAddress?: string;
  bankName?: string;
  accountNumber?: string;
  accountTitle?: string;
  laptop?: boolean;
  card?: boolean;
  mobileSim?: boolean;
  key?: boolean;
  tools?: boolean;
  accountType?: string;
  password?: string;
  roles?: string;
  status?: string;
}

