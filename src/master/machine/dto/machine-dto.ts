import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, PartialType } from '@nestjs/swagger';

export class CreateMachineDto {
  @ApiProperty({ example: 'Machine A' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 'active', required: false })
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateMachineDto extends PartialType(CreateMachineDto) {}
