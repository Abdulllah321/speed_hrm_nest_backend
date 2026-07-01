import { IsNotEmpty, IsString, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateFolderDto {
  @ApiProperty({ example: 'Reports 2026' })
  @IsNotEmpty()
  @IsString()
  name: string;
}

export class RenameFolderDto {
  @ApiProperty({ example: 'Reports 2026 Q2' })
  @IsNotEmpty()
  @IsString()
  name: string;
}

export class UpdateExportDto {
  @ApiProperty({ example: 'New Name.xlsx', required: false })
  @IsOptional()
  @IsString()
  fileName?: string;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  isFavorite?: boolean;

  @ApiProperty({ example: 'folder-uuid', required: false, nullable: true })
  @IsOptional()
  @IsString()
  folderId?: string | null;
}
