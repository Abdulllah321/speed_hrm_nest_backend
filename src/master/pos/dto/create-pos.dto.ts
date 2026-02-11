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

    @ApiProperty({ description: 'Status of the POS', default: 'active' })
    @IsString()
    @IsOptional()
    status?: string;
}
