import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdatePosDto {
  @ApiProperty({ description: 'Name of the POS', required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ description: 'Company ID', required: false })
  @IsString()
  @IsOptional()
  companyId?: string;

  @ApiProperty({ description: 'Terminal PIN (4-6 digits)', required: false })
  @IsString()
  @IsOptional()
  terminalPin?: string;

  @ApiProperty({ description: 'Status of the POS', required: false })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiProperty({
    description: 'Whether this is the parent (master) terminal for the outlet. Setting true will demote the current parent.',
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  isParent?: boolean;
}

