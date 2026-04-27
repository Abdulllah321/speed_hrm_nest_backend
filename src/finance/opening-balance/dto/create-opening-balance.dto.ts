import { IsString, IsNumber, IsEnum, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateOpeningBalanceDto {
  @ApiProperty({ description: 'Account ID' })
  @IsString()
  accountId: string;

  @ApiProperty({ description: 'Transaction type', enum: ['DEBIT', 'CREDIT'] })
  @IsEnum(['DEBIT', 'CREDIT'])
  type: 'DEBIT' | 'CREDIT';

  @ApiProperty({ description: 'Opening balance amount' })
  @IsNumber()
  amount: number;

  @ApiProperty({ description: 'Transaction date', required: false })
  @IsOptional()
  @IsDateString()
  date?: string;
}
