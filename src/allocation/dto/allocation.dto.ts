import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateAllocationDto {
    @ApiProperty({ example: 'Allocation 1' })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiProperty({ example: 'active', required: false })
    @IsString()
    @IsOptional()
    status?: string;
}

export class UpdateAllocationDto extends PartialType(CreateAllocationDto) { }

export class CreateBulkAllocationDto {
    @ApiProperty({ type: [String], example: ['Allocation 1', 'Allocation 2'] })
    @IsNotEmpty()
    names: string[];
}
