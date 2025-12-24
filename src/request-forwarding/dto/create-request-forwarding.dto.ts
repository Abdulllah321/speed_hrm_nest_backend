import { IsNotEmpty, IsString, IsOptional, IsArray, IsNumber, ValidateNested, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateApprovalLevelDto {
  @ApiProperty({ example: 1 })
  @IsNumber()
  level: number;

  @ApiProperty({ example: 'department-head', enum: ['specific-employee', 'department-head', 'sub-department-head', 'reporting-manager'] })
  @IsString()
  @IsIn(['specific-employee', 'department-head', 'sub-department-head', 'reporting-manager'])
  approverType: string;

  @ApiPropertyOptional({ example: 'auto', enum: ['auto', 'specific'] })
  @IsOptional()
  @IsString()
  @IsIn(['auto', 'specific'])
  departmentHeadMode?: string;

  @ApiPropertyOptional({ example: 'emp-uuid' })
  @IsOptional()
  @IsString()
  specificEmployeeId?: string | null;

  @ApiPropertyOptional({ example: 'dept-uuid' })
  @IsOptional()
  @IsString()
  departmentId?: string | null;

  @ApiPropertyOptional({ example: 'sub-dept-uuid' })
  @IsOptional()
  @IsString()
  subDepartmentId?: string | null;
}

export class CreateRequestForwardingDto {
  @ApiProperty({ example: 'leave-encashment', enum: ['exemption', 'attendance', 'advance-salary', 'loan', 'overtime', 'leave-encashment'] })
  @IsNotEmpty()
  @IsString()
  requestType: string;

  @ApiProperty({ example: 'multi-level', enum: ['auto-approved', 'multi-level'] })
  @IsNotEmpty()
  @IsString()
  @IsIn(['auto-approved', 'multi-level'])
  approvalFlow: string;

  @ApiPropertyOptional({ type: [CreateApprovalLevelDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateApprovalLevelDto)
  levels?: CreateApprovalLevelDto[];
}
