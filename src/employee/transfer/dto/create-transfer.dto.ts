import { IsNotEmpty, IsOptional, IsString, IsDateString } from 'class-validator';

export class CreateTransferDto {
    @IsNotEmpty()
    @IsString()
    employeeId: string;

    @IsNotEmpty()
    @IsDateString()
    transferDate: string;

    @IsNotEmpty()
    @IsString()
    newLocationId: string; // Assuming Location determines City and State, or user selects all 3 explicitly. Based on requirement "Location / City / Province", user might select any. But usually Location implies City/State. However, I'll allow all 3 to be passed if needed, or just Location and derive others if possible. For now, I'll require explicit IDs for flexibility as requested.
    // Actually, allow optionality if only changing location within same city?
    // Let's make them optional but validate at least one is changing or effectively new.

    @IsOptional()
    @IsString()
    newCityId?: string;

    @IsOptional()
    @IsString()
    newStateId?: string; // Province

    @IsOptional()
    @IsString()
    reason?: string;
}
