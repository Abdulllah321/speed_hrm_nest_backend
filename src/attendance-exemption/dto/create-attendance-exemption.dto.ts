import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAttendanceExemptionDto {
  @ApiPropertyOptional({ example: 'emp-uuid' })
  @IsOptional()
  @IsString()
  employeeId?: string | null;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  employeeName?: string | null;

  @ApiPropertyOptional({ example: 'Engineering' })
  @IsOptional()
  @IsString()
  department?: string | null;

  @ApiPropertyOptional({ example: 'Backend' })
  @IsOptional()
  @IsString()
  subDepartment?: string | null;

  @ApiProperty({ example: '2023-11-01' })
  @IsNotEmpty()
  @IsDateString()
  attendanceDate: string; // ISO date string

  @ApiProperty({ example: 'Late' })
  @IsNotEmpty()
  @IsString()
  flagType: string; // Late, Absent, Early Leave, Missing Check-in, Missing Check-out, Other

  @ApiProperty({ example: 'Medical Emergency' })
  @IsNotEmpty()
  @IsString()
  exemptionType: string; // Medical Emergency, Family Emergency, Official Duty, Approved Leave, System Error, Other

  @ApiProperty({ example: 'Went to hospital' })
  @IsNotEmpty()
  @IsString()
  reason: string;

  @ApiPropertyOptional({
    example: 'pending',
    enum: ['pending', 'approved', 'rejected'],
  })
  @IsOptional()
  @IsString()
  approvalStatus?: string; // default "pending"
}
