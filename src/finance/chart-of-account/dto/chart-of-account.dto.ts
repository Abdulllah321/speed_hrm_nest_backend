import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
} from 'class-validator';

export enum AccountType {
  ASSET = 'ASSET',
  LIABILITY = 'LIABILITY',
  EQUITY = 'EQUITY',
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
}

export class CreateChartOfAccountDto {
  @ApiProperty({ example: '1000', description: 'Unique account code' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ example: 'Current Assets', description: 'Account name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ enum: AccountType, example: AccountType.ASSET })
  @IsEnum(AccountType)
  @IsNotEmpty()
  type: AccountType;

  @ApiProperty({ example: true, description: 'Is this a group account?' })
  @IsBoolean()
  @IsOptional()
  isGroup?: boolean;

  @ApiPropertyOptional({ example: 'parent-uuid', description: 'Parent account ID' })
  @IsString()
  @IsOptional()
  parentId?: string;

  @ApiPropertyOptional({ example: 0, description: 'Initial balance' })
  @IsNumber()
  @IsOptional()
  balance?: number;

  @ApiPropertyOptional({ example: true, description: 'Is the account active?' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateChartOfAccountDto extends CreateChartOfAccountDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  id?: string;
}
