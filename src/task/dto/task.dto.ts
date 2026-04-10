import {
  IsNotEmpty, IsString, IsOptional, IsIn, IsInt, IsArray,
  IsBoolean, IsDateString, IsNumber, Min, Max, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTaskDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  projectId: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  listId: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: ['todo', 'in_progress', 'in_review', 'done', 'cancelled'] })
  @IsOptional()
  @IsIn(['todo', 'in_progress', 'in_review', 'done', 'cancelled'])
  status?: string;

  @ApiPropertyOptional({ enum: ['none', 'low', 'medium', 'high', 'urgent'] })
  @IsOptional()
  @IsIn(['none', 'low', 'medium', 'high', 'urgent'])
  priority?: string;

  @ApiPropertyOptional({ enum: ['task', 'bug', 'feature', 'improvement'] })
  @IsOptional()
  @IsIn(['task', 'bug', 'feature', 'improvement'])
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  parentTaskId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  estimatedHours?: number;

  @ApiPropertyOptional({ description: 'Initial assignee employee IDs', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  assigneeIds?: string[];
}

export class UpdateTaskDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  listId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: ['none', 'low', 'medium', 'high', 'urgent'] })
  @IsOptional()
  @IsIn(['none', 'low', 'medium', 'high', 'urgent'])
  priority?: string;

  @ApiPropertyOptional({ enum: ['task', 'bug', 'feature', 'improvement'] })
  @IsOptional()
  @IsIn(['task', 'bug', 'feature', 'improvement'])
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  estimatedHours?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  actualHours?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  completionPercentage?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isBlocked?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  blockedReason?: string;
}

export class ChangeTaskStatusDto {
  @ApiProperty({ enum: ['todo', 'in_progress', 'in_review', 'done', 'cancelled'] })
  @IsNotEmpty()
  @IsIn(['todo', 'in_progress', 'in_review', 'done', 'cancelled'])
  status: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  actualHours?: number;
}

export class AssigneeEntryDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @ApiPropertyOptional({ enum: ['primary', 'collaborator', 'reviewer'] })
  @IsOptional()
  @IsIn(['primary', 'collaborator', 'reviewer'])
  role?: string;
}

export class UpdateAssigneesDto {
  @ApiProperty({ type: [AssigneeEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssigneeEntryDto)
  assignees: AssigneeEntryDto[];
}

export class ReorderTasksDto {
  @ApiProperty({ description: 'Ordered array of task IDs within a list', type: [String] })
  @IsArray()
  @IsString({ each: true })
  ids: string[];

  @ApiPropertyOptional({ description: 'Target listId when moving between columns' })
  @IsOptional()
  @IsString()
  listId?: string;
}

export class BulkTaskActionDto {
  @ApiProperty({ description: 'Task IDs to act on', type: [String] })
  @IsArray()
  @IsString({ each: true })
  taskIds: string[];

  @ApiProperty({ enum: ['change_status', 'reassign', 'delete', 'change_priority'] })
  @IsNotEmpty()
  @IsIn(['change_status', 'reassign', 'delete', 'change_priority'])
  action: string;

  @ApiPropertyOptional({ description: 'New status (for change_status action)' })
  @IsOptional()
  @IsIn(['todo', 'in_progress', 'in_review', 'done', 'cancelled'])
  status?: string;

  @ApiPropertyOptional({ description: 'New priority (for change_priority action)' })
  @IsOptional()
  @IsIn(['none', 'low', 'medium', 'high', 'urgent'])
  priority?: string;

  @ApiPropertyOptional({ description: 'Employee IDs to assign (for reassign action)', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  assigneeIds?: string[];
}

export class CreateCommentDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  content: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  parentCommentId?: string;
}

export class UpdateCommentDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  content: string;
}
