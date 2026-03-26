import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsArray } from 'class-validator';

export class CreateDivisionDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  brandId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  headId?: string; // If divisions have heads? The user didn't specify, but Department had it. I'll include it as optional or omit if not in schema.
  // Schema for Division: id, name, brandId, status, createdById. NO headId.
}

export class UpdateDivisionDto extends PartialType(CreateDivisionDto) {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  id: string;
}

export class BulkUpdateDivisionDto {
  @ApiProperty({ type: [UpdateDivisionDto] })
  @IsArray()
  items: UpdateDivisionDto[];
}
