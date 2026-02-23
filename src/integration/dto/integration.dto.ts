import { IsString, IsOptional, IsBoolean, IsEmail } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for provisioning/syncing a Tenant (Dealer) from DriveSafe
 */
export class ProvisionTenantDto {
  @ApiProperty({ description: 'DriveSafe dealer_id', example: 'dealer_12345' })
  @IsString()
  externalId: string;

  @ApiProperty({ description: 'Dealer business name', example: 'ABC Motors' })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Short code for subdomain',
    example: 'abc-motors',
  })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({ description: 'Tenant active status', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * DTO for provisioning/syncing a User from DriveSafe
 */
export class ProvisionUserDto {
  @ApiProperty({ description: 'DriveSafe user_id', example: 'user_67890' })
  @IsString()
  externalId: string;

  @ApiProperty({
    description: 'DriveSafe dealer_id (tenant)',
    example: 'dealer_12345',
  })
  @IsString()
  dealerId: string;

  @ApiProperty({ description: 'User email address' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'User first name' })
  @IsString()
  firstName: string;

  @ApiProperty({ description: 'User last name' })
  @IsString()
  lastName: string;

  @ApiPropertyOptional({ description: 'Role name in HRM', example: 'manager' })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({ description: 'User active status', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * DTO for deactivating a Tenant
 */
export class DeactivateTenantDto {
  @ApiProperty({ description: 'DriveSafe dealer_id', example: 'dealer_12345' })
  @IsString()
  externalId: string;
}
