import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdatePosDto {
    @ApiProperty({ description: 'Name of the POS', required: false })
    @IsString()
    @IsOptional()
    name?: string;

    @ApiProperty({ description: 'Status of the POS', required: false })
    @IsString()
    @IsOptional()
    status?: string;
}
