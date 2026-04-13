import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateKpiTemplateDto {
  @ApiProperty({ example: 'Attendance Rate' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Measures employee attendance percentage' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 'attendance', enum: ['attendance', 'performance', 'productivity', 'custom'] })
  @IsNotEmpty()
  @IsString()
  @IsIn(['attendance', 'performance', 'productivity', 'custom'])
  category: string;

  @ApiProperty({ example: 'auto', enum: ['manual', 'auto'] })
  @IsNotEmpty()
  @IsString()
  @IsIn(['manual', 'auto'])
  metricType: string;

  @ApiPropertyOptional({ example: 'attendance_rate' })
  @IsOptional()
  @IsString()
  formula?: string;

  @ApiPropertyOptional({ example: '%' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({ example: 90 })
  @IsOptional()
  @IsNumber()
  targetValue?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  weight?: number;
}

export class UpdateKpiTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: ['attendance', 'performance', 'productivity', 'custom'] })
  @IsOptional()
  @IsString()
  @IsIn(['attendance', 'performance', 'productivity', 'custom'])
  category?: string;

  @ApiPropertyOptional({ enum: ['manual', 'auto'] })
  @IsOptional()
  @IsString()
  @IsIn(['manual', 'auto'])
  metricType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  formula?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  targetValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  weight?: number;

  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional()
  @IsString()
  @IsIn(['active', 'inactive'])
  status?: string;
}

export class CreateKpiReviewDto {
  @ApiProperty({ example: 'employee-uuid' })
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @ApiProperty({ example: 'template-uuid' })
  @IsNotEmpty()
  @IsString()
  kpiTemplateId: string;

  @ApiProperty({ example: '2026-Q1' })
  @IsNotEmpty()
  @IsString()
  period: string;

  @ApiProperty({ example: 'quarterly', enum: ['monthly', 'quarterly', 'yearly'] })
  @IsNotEmpty()
  @IsString()
  @IsIn(['monthly', 'quarterly', 'yearly'])
  periodType: string;

  @ApiProperty({ example: 90 })
  @IsNotEmpty()
  @IsNumber()
  targetValue: number;

  @ApiPropertyOptional({ example: 85 })
  @IsOptional()
  @IsNumber()
  actualValue?: number;

  @ApiPropertyOptional({ example: 'Good performance this quarter' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateKpiReviewDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  actualValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  targetValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ enum: ['pending', 'submitted', 'approved', 'rejected'] })
  @IsOptional()
  @IsString()
  @IsIn(['pending', 'submitted', 'approved', 'rejected'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
