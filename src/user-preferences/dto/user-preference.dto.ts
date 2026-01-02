import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpsertUserPreferenceDto {
  @ApiProperty({ example: 'table-column-visibility-employees-table' })
  @IsNotEmpty()
  @IsString()
  key: string;

  @ApiProperty({ example: '{"column1": false, "column2": true}' })
  @IsNotEmpty()
  @IsString()
  value: string;
}

