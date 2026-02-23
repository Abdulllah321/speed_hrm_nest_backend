import { IsString, IsEmail, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Expected JWT payload structure from DriveSafe SSO
 */
export interface DriveSafeSsoPayload {
  dealer_id: string; // Tenant external ID
  dealer_name: string; // Dealer business name
  user_id: string; // User external ID
  name: string; // User full name
  email: string; // User email
  role: string; // Role name (e.g., "manager", "admin")
  iss: string; // Issuer (DriveSafe)
  aud: string; // Audience (HRM)
  exp: number; // Expiration timestamp
  iat?: number; // Issued at timestamp
}

/**
 * DTO for SSO token query parameter
 */
export class SsoTokenDto {
  @ApiProperty({ description: 'JWT token from DriveSafe' })
  @IsString()
  token: string;
}
