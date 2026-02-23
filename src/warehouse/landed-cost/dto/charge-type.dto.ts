import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateChargeTypeDto {
  @ApiProperty({ example: 'Freight-in' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'uuid-of-chart-of-account' })
  @IsString()
  @IsNotEmpty()
  accountId: string;
}
