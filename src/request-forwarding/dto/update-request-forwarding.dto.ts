import {
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  ValidateNested,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateApprovalLevelDto {
  @ApiProperty({ example: 1 })
  @IsNumber()
  level: number;

  @ApiProperty({
    example: 'department-head',
    enum: [
      'specific-employee',
      'department-head',
      'sub-department-head',
      'reporting-manager',
    ],
  })
  @IsString()
  @IsIn([
    'specific-employee',
    'department-head',
    'sub-department-head',
    'reporting-manager',
  ])
  approverType: string;

  @ApiPropertyOptional({ example: 'auto', enum: ['auto', 'specific'] })
  @IsOptional()
  @IsString()
  @IsIn(['auto', 'specific'])
  departmentHeadMode?: string | null;

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

export class UpdateRequestForwardingDto {
  @ApiPropertyOptional({
    example: 'multi-level',
    enum: ['auto-approved', 'multi-level'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['auto-approved', 'multi-level'])
  approvalFlow: string;

  @ApiPropertyOptional({ example: 'active', enum: ['active', 'inactive'] })
  @IsOptional()
  @IsString()
  @IsIn(['active', 'inactive'])
  status?: string;

  @ApiPropertyOptional({ type: [UpdateApprovalLevelDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateApprovalLevelDto)
  levels?: UpdateApprovalLevelDto[];
}
