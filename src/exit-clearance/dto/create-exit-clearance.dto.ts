import { IsNotEmpty, IsString, IsOptional, IsBoolean, IsDateString } from 'class-validator';

export class CreateExitClearanceDto {
  @IsNotEmpty()
  @IsString()
  employeeName: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsString()
  subDepartment?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  leavingReason?: string;

  @IsOptional()
  @IsDateString()
  contractEnd?: string;

  @IsNotEmpty()
  @IsDateString()
  lastWorkingDate: string;

  @IsOptional()
  @IsString()
  reportingManager?: string;

  // IT Department
  @IsOptional()
  @IsBoolean()
  itAccessControl?: boolean;

  @IsOptional()
  @IsBoolean()
  itPasswordInactivated?: boolean;

  @IsOptional()
  @IsBoolean()
  itLaptopReturned?: boolean;

  @IsOptional()
  @IsBoolean()
  itEquipment?: boolean;

  @IsOptional()
  @IsBoolean()
  itWifiDevice?: boolean;

  @IsOptional()
  @IsBoolean()
  itMobileDevice?: boolean;

  @IsOptional()
  @IsBoolean()
  itSimCard?: boolean;

  @IsOptional()
  @IsBoolean()
  itBillsSettlement?: boolean;

  // Finance Department
  @IsOptional()
  @IsBoolean()
  financeAdvance?: boolean;

  @IsOptional()
  @IsBoolean()
  financeLoan?: boolean;

  @IsOptional()
  @IsBoolean()
  financeOtherLiabilities?: boolean;

  // Admin Department
  @IsOptional()
  @IsBoolean()
  adminVehicle?: boolean;

  @IsOptional()
  @IsBoolean()
  adminKeys?: boolean;

  @IsOptional()
  @IsBoolean()
  adminOfficeAccessories?: boolean;

  @IsOptional()
  @IsBoolean()
  adminMobilePhone?: boolean;

  @IsOptional()
  @IsBoolean()
  adminVisitingCards?: boolean;

  // HR Department
  @IsOptional()
  @IsBoolean()
  hrEobi?: boolean;

  @IsOptional()
  @IsBoolean()
  hrProvidentFund?: boolean;

  @IsOptional()
  @IsBoolean()
  hrIdCard?: boolean;

  @IsOptional()
  @IsBoolean()
  hrMedical?: boolean;

  @IsOptional()
  @IsBoolean()
  hrThumbImpression?: boolean;

  @IsOptional()
  @IsBoolean()
  hrLeavesRemaining?: boolean;

  @IsOptional()
  @IsBoolean()
  hrOtherCompensation?: boolean;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  approvalStatus?: string;
}

export class UpdateExitClearanceDto {
  @IsNotEmpty()
  @IsString()
  id: string;

  employeeName?: string;
  designation?: string;
  department?: string;
  subDepartment?: string;
  location?: string;
  leavingReason?: string;
  contractEnd?: string;
  lastWorkingDate?: string;
  reportingManager?: string;
  itAccessControl?: boolean;
  itPasswordInactivated?: boolean;
  itLaptopReturned?: boolean;
  itEquipment?: boolean;
  itWifiDevice?: boolean;
  itMobileDevice?: boolean;
  itSimCard?: boolean;
  itBillsSettlement?: boolean;
  financeAdvance?: boolean;
  financeLoan?: boolean;
  financeOtherLiabilities?: boolean;
  adminVehicle?: boolean;
  adminKeys?: boolean;
  adminOfficeAccessories?: boolean;
  adminMobilePhone?: boolean;
  adminVisitingCards?: boolean;
  hrEobi?: boolean;
  hrProvidentFund?: boolean;
  hrIdCard?: boolean;
  hrMedical?: boolean;
  hrThumbImpression?: boolean;
  hrLeavesRemaining?: boolean;
  hrOtherCompensation?: boolean;
  note?: string;
  approvalStatus?: string;
}

