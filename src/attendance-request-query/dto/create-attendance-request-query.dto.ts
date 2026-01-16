import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAttendanceRequestQueryDto {
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

  @ApiPropertyOptional({ example: '09:00' })
  @IsOptional()
  @IsString()
  clockInTimeRequest?: string | null;

  @ApiPropertyOptional({ example: '18:00' })
  @IsOptional()
  @IsString()
  clockOutTimeRequest?: string | null;

  @ApiPropertyOptional({ example: '13:00' })
  @IsOptional()
  @IsString()
  breakIn?: string | null;

  @ApiPropertyOptional({ example: '14:00' })
  @IsOptional()
  @IsString()
  breakOut?: string | null;

  @ApiProperty({ example: 'Forgot to clock in' })
  @IsNotEmpty()
  @IsString()
  query: string;

  @ApiPropertyOptional({
    example: 'pending',
    enum: ['pending', 'approved', 'rejected'],
  })
  @IsOptional()
  @IsString()
  approvalStatus?: string; // default "pending"
}
