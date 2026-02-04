import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, PartialType } from '@nestjs/swagger';

export class CreateCompanyGroupDto {
  @ApiProperty({ example: 'Group A' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 'active', required: false })
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateCompanyGroupDto extends PartialType(CreateCompanyGroupDto) {}
