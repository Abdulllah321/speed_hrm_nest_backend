import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAttendanceExemptionDto {
  @ApiPropertyOptional({ example: 'approved', enum: ['pending', 'approved', 'rejected'] })
  @IsOptional()
  @IsString()
  approvalStatus?: string;

  @ApiPropertyOptional({ example: 'approver-uuid' })
  @IsOptional()
  @IsString()
  approvedBy?: string;

  @ApiPropertyOptional({ example: 'Not valid reason' })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}

