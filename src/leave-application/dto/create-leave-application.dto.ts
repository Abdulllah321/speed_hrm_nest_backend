import { IsNotEmpty, IsString, IsEnum, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum DayType {
  FULL_DAY = 'fullDay',
  HALF_DAY = 'halfDay',
  SHORT_LEAVE = 'shortLeave',
}

export class CreateLeaveApplicationDto {
  @ApiProperty({ example: 'emp-uuid' })
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @ApiProperty({ example: 'lt-uuid' })
  @IsNotEmpty()
  @IsString()
  leaveTypeId: string;

  @ApiProperty({ enum: DayType, example: DayType.FULL_DAY })
  @IsNotEmpty()
  @IsEnum(DayType)
  dayType: DayType;

  @ApiProperty({ example: '2023-11-10' })
  @IsNotEmpty()
  @IsDateString()
  fromDate: string;

  @ApiProperty({ example: '2023-11-12' })
  @IsNotEmpty()
  @IsDateString()
  toDate: string;

  @ApiProperty({ example: 'Annual Vacation' })
  @IsNotEmpty()
  @IsString()
  reasonForLeave: string;

  @ApiProperty({ example: '123 Beach Ave' })
  @IsNotEmpty()
  @IsString()
  addressWhileOnLeave: string;
}

