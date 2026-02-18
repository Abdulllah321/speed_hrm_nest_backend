import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePosDto {
  @ApiProperty({ description: 'Name of the POS' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Location ID' })
  @IsString()
  @IsNotEmpty()
  locationId: string;

    @ApiProperty({ description: 'Company ID' })
    @IsString()
    @IsOptional()
    companyId?: string;

    @ApiProperty({ description: 'Terminal PIN (4-6 digits)' })
    @IsString()
    @IsOptional()
    terminalPin?: string;

    @ApiProperty({ description: 'Unique Terminal Code (e.g. MAIN-01)', required: false })
    @IsString()
    @IsOptional()
    terminalCode?: string;

    @ApiProperty({ description: 'Status of the POS', default: 'active' })
    @IsString()
    @IsOptional()
    status?: string;
}
