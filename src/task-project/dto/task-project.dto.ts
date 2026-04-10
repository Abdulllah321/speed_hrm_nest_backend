import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsIn,
  IsDateString,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTaskProjectDto {
  @ApiProperty({ example: 'Q2 Onboarding' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 'PROJ-001' })
  @IsNotEmpty()
  @IsString()
  code: string;

  @ApiPropertyOptional({ example: '#6366f1' })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiPropertyOptional({ enum: ['active', 'archived', 'on_hold'] })
  @IsOptional()
  @IsIn(['active', 'archived', 'on_hold'])
  status?: string;

  @ApiProperty({ example: 'employee-uuid' })
  @IsNotEmpty()
  @IsString()
  ownerId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ enum: ['public', 'private', 'department'] })
  @IsOptional()
  @IsIn(['public', 'private', 'department'])
  visibility?: string;
}

export class UpdateTaskProjectDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiPropertyOptional({ enum: ['active', 'archived', 'on_hold'] })
  @IsOptional()
  @IsIn(['active', 'archived', 'on_hold'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ enum: ['public', 'private', 'department'] })
  @IsOptional()
  @IsIn(['public', 'private', 'department'])
  visibility?: string;
}

export class AddProjectMemberDto {
  @ApiProperty({ example: 'employee-uuid' })
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @ApiPropertyOptional({ enum: ['owner', 'manager', 'member', 'viewer'] })
  @IsOptional()
  @IsIn(['owner', 'manager', 'member', 'viewer'])
  role?: string;
}

export class BulkAddProjectMembersDto {
  @ApiProperty({ type: [AddProjectMemberDto] })
  @IsArray()
  members: AddProjectMemberDto[];
}
