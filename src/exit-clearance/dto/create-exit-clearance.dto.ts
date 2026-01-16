import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsBoolean,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateExitClearanceDto {
  @ApiProperty({ example: 'John Doe' })
  @IsNotEmpty()
  @IsString()
  employeeName: string;

  @ApiPropertyOptional({ example: 'Software Engineer' })
  @IsOptional()
  @IsString()
  designation?: string;

  @ApiPropertyOptional({ example: 'Engineering' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ example: 'Backend' })
  @IsOptional()
  @IsString()
  subDepartment?: string;

  @ApiPropertyOptional({ example: 'Head Office' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ example: 'Resignation' })
  @IsOptional()
  @IsString()
  leavingReason?: string;

  @ApiPropertyOptional({ example: '2023-12-31' })
  @IsOptional()
  @IsDateString()
  contractEnd?: string;

  @ApiProperty({ example: '2023-11-30' })
  @IsNotEmpty()
  @IsDateString()
  lastWorkingDate: string;

  @ApiPropertyOptional({ example: 'Manager Name' })
  @IsOptional()
  @IsString()
  reportingManager?: string;

  // IT Department
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  itAccessControl?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  itPasswordInactivated?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  itLaptopReturned?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  itEquipment?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  itWifiDevice?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  itMobileDevice?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  itSimCard?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  itBillsSettlement?: boolean;

  // Finance Department
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  financeAdvance?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  financeLoan?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  financeOtherLiabilities?: boolean;

  // Admin Department
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  adminVehicle?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  adminKeys?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  adminOfficeAccessories?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  adminMobilePhone?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  adminVisitingCards?: boolean;

  // HR Department
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  hrEobi?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  hrProvidentFund?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  hrIdCard?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  hrMedical?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  hrThumbImpression?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  hrLeavesRemaining?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  hrOtherCompensation?: boolean;

  @ApiPropertyOptional({ example: 'Cleared all dues' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    example: 'pending',
    enum: ['pending', 'approved', 'rejected'],
  })
  @IsOptional()
  @IsString()
  approvalStatus?: string;
}

export class UpdateExitClearanceDto {
  @ApiProperty({ example: 'clearance-uuid' })
  @IsNotEmpty()
  @IsString()
  id: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  employeeName?: string;

  @ApiPropertyOptional({ example: 'Software Engineer' })
  @IsOptional()
  @IsString()
  designation?: string;

  @ApiPropertyOptional({ example: 'Engineering' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ example: 'Backend' })
  @IsOptional()
  @IsString()
  subDepartment?: string;

  @ApiPropertyOptional({ example: 'Head Office' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ example: 'Resignation' })
  @IsOptional()
  @IsString()
  leavingReason?: string;

  @ApiPropertyOptional({ example: '2023-12-31' })
  @IsOptional()
  @IsDateString()
  contractEnd?: string;

  @ApiPropertyOptional({ example: '2023-11-30' })
  @IsOptional()
  @IsDateString()
  lastWorkingDate?: string;

  @ApiPropertyOptional({ example: 'Manager Name' })
  @IsOptional()
  @IsString()
  reportingManager?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  itAccessControl?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  itPasswordInactivated?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  itLaptopReturned?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  itEquipment?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  itWifiDevice?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  itMobileDevice?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  itSimCard?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  itBillsSettlement?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  financeAdvance?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  financeLoan?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  financeOtherLiabilities?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  adminVehicle?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  adminKeys?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  adminOfficeAccessories?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  adminMobilePhone?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  adminVisitingCards?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  hrEobi?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  hrProvidentFund?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  hrIdCard?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  hrMedical?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  hrThumbImpression?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  hrLeavesRemaining?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  hrOtherCompensation?: boolean;

  @ApiPropertyOptional({ example: 'Cleared all dues' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ example: 'approved' })
  @IsOptional()
  @IsString()
  approvalStatus?: string;
}
