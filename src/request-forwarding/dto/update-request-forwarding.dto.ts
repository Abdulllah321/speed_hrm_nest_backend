import { IsString, IsOptional, IsArray, IsNumber, ValidateNested, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateApprovalLevelDto {
  @IsNumber()
  level: number;

  @IsString()
  @IsIn(['specific-employee', 'department-head', 'sub-department-head', 'reporting-manager'])
  approverType: string;

  @IsOptional()
  @IsString()
  @IsIn(['auto', 'specific'])
  departmentHeadMode?: string | null;

  @IsOptional()
  @IsString()
  specificEmployeeId?: string | null;

  @IsOptional()
  @IsString()
  departmentId?: string | null;

  @IsOptional()
  @IsString()
  subDepartmentId?: string | null;
}

export class UpdateRequestForwardingDto {
  @IsString()
  @IsIn(['auto-approved', 'multi-level'])
  approvalFlow: string;

  @IsOptional()
  @IsString()
  @IsIn(['active', 'inactive'])
  status?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateApprovalLevelDto)
  levels?: UpdateApprovalLevelDto[];
}
