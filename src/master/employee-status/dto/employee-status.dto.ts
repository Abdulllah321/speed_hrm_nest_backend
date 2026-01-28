import { IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEmployeeStatusDto {
  @ApiProperty({ example: 'Permanent' })
  @IsNotEmpty()
  @IsString()
  status: string;

  @ApiPropertyOptional({ example: 'Full-time' })
  @IsOptional()
  @IsString()
  statusType?: string;
}

export class UpdateEmployeeStatusDto {
  @ApiProperty({ example: 'uuid' })
  @IsNotEmpty()
  @IsString()
  id: string;

  @ApiProperty({ example: 'Contract' })
  @IsNotEmpty()
  @IsString()
  status: string;

  @ApiPropertyOptional({ example: 'Part-time' })
  @IsOptional()
  @IsString()
  statusType?: string;
}
