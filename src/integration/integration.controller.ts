import {
  Body,
  Controller,
  Post,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { HmacAuthGuard } from './guards/hmac-auth.guard';
import { IntegrationService } from './integration.service';
import {
  ProvisionTenantDto,
  ProvisionUserDto,
  DeactivateTenantDto,
} from './dto/integration.dto';

/**
 * Controller for DriveSafe server-to-server integration APIs.
 * All endpoints are secured with HMAC-SHA256 authentication.
 */
@ApiTags('Integration')
@Controller('api/integration')
@UseGuards(HmacAuthGuard)
@ApiHeader({
  name: 'X-Signature',
  description: 'HMAC-SHA256 signature',
  required: true,
})
@ApiHeader({
  name: 'X-Timestamp',
  description: 'Unix timestamp (ms)',
  required: true,
})
export class IntegrationController {
  constructor(private readonly service: IntegrationService) {}

  /**
   * Provision or update a Tenant (Dealer).
   * Called by DriveSafe when a new dealer is onboarded or dealer info changes.
   */
  @Post('tenants')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Provision or update a tenant (dealer)' })
  @ApiResponse({ status: 200, description: 'Tenant provisioned successfully' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid HMAC signature',
  })
  async provisionTenant(@Body() dto: ProvisionTenantDto) {
    return this.service.provisionTenant(dto);
  }

  /**
   * Provision or update a User.
   * Called by DriveSafe when a new dealer user is created or updated.
   */
  @Post('users')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Provision or update a user' })
  @ApiResponse({ status: 200, description: 'User provisioned successfully' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid HMAC signature',
  })
  async provisionUser(@Body() dto: ProvisionUserDto) {
    return this.service.provisionUser(dto);
  }

  /**
   * Deactivate a Tenant and all associated users.
   * Called by DriveSafe when a dealer is offboarded.
   */
  @Post('tenants/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a tenant and its users' })
  @ApiResponse({ status: 200, description: 'Tenant deactivated successfully' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid HMAC signature',
  })
  async deactivateTenant(@Body() dto: DeactivateTenantDto) {
    return this.service.deactivateTenant(dto.externalId);
  }
}
