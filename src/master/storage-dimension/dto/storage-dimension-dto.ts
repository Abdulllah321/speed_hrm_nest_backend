import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class CreateStorageDimensionDto {
    @IsNotEmpty()
    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    createdById?: string;
}

export class UpdateStorageDimensionDto {
    @IsNotEmpty()
    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    status?: string;
}
