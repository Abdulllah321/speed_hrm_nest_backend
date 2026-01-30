import { IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEmployeeGradeDto {
  @ApiProperty({ example: 'G-18' })
  @IsNotEmpty()
  @IsString()
  grade: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateEmployeeGradeDto {
  @ApiProperty({ example: 'grade-uuid' })
  @IsNotEmpty()
  @IsString()
  id: string;

  @ApiProperty({ example: 'G-19' })
  @IsNotEmpty()
  @IsString()
  grade: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}
