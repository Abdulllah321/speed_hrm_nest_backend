import { Injectable, Logger } from '@nestjs/common';
import { PrismaMasterService } from '../database/prisma-master.service';
import { ProvisionTenantDto, ProvisionUserDto } from './dto/integration.dto';
import { CompanyService } from '../admin/company/company.service';

/**
 * Service for handling DriveSafe integration operations.
 * Manages tenant and user provisioning via server-to-server HMAC-authenticated APIs.
 */
@Injectable()
export class IntegrationService {
  private readonly logger = new Logger(IntegrationService.name);

  constructor(
    private readonly prismaMaster: PrismaMasterService,
    private readonly companyService: CompanyService,
  ) {}

  /**
   * Provision or update a Tenant (Dealer) from DriveSafe.
   * Creates the tenant record in Master DB. Physical database creation is handled separately.
   */
  async provisionTenant(dto: ProvisionTenantDto) {
    const { externalId, name, code, isActive = true } = dto;

    // Check if tenant already exists
    let tenant = await this.prismaMaster.tenant.findUnique({
      where: { externalId },
    });

    if (tenant) {
      // Update existing tenant
      this.logger.log(`Updating existing tenant: ${externalId}`);
      tenant = await this.prismaMaster.tenant.update({
        where: { externalId },
        data: {
          name,
          code: code || tenant.code,
          isActive,
        },
      });
    } else {
      // Create new company & tenant (handles physical DB provisioning)
      const tenantCode = code || this.generateCode(name);
      this.logger.log(
        `Provisioning new company for dealer: ${externalId} with code: ${tenantCode}`,
      );

      const result = await this.companyService.createCompany({
        name,
        code: tenantCode,
        externalId,
      });

      if (!result.status) {
        throw new Error(result.message || 'Failed to provision company');
      }

      // Fetch the created tenant (createCompany returns Company, we need Tenant for consistency)
      tenant = await this.prismaMaster.tenant.findUnique({
        where: { externalId },
      });
    }

    return {
      status: true,
      message: tenant ? 'Tenant updated' : 'Tenant created',
      data: {
        id: tenant?.id,
        externalId: tenant?.externalId,
        code: tenant?.code,
        name: tenant?.name,
        isActive: tenant?.isActive,
      },
    };
  }

  /**
   * Provision or update a User from DriveSafe.
   * Links user to tenant and optionally assigns a role.
   */
  async provisionUser(dto: ProvisionUserDto) {
    const {
      externalId,
      dealerId,
      email,
      firstName,
      lastName,
      role,
      isActive = true,
    } = dto;

    // Find the tenant by DriveSafe dealer_id
    const tenant = await this.prismaMaster.tenant.findUnique({
      where: { externalId: dealerId },
    });

    if (!tenant) {
      this.logger.warn(`Tenant not found for dealerId: ${dealerId}`);
      return {
        status: false,
        message: `Tenant not found for dealer: ${dealerId}. Provision tenant first.`,
      };
    }

    // Find or resolve role
    let roleRecord: any = null;
    if (role) {
      roleRecord = await this.prismaMaster.role.findFirst({
        where: { name: { equals: role, mode: 'insensitive' } },
      });
    }

    // Check if user already exists
    let user = await this.prismaMaster.user.findUnique({
      where: { externalId },
    });

    if (user) {
      // Update existing user
      this.logger.log(`Updating existing user: ${externalId}`);
      user = await this.prismaMaster.user.update({
        where: { externalId },
        data: {
          email,
          firstName,
          lastName,
          status: isActive ? 'active' : 'inactive',
          roleId: roleRecord?.id || user.roleId,
          tenantId: tenant.id,
        },
      });
    } else {
      // Create new user
      this.logger.log(`Creating new SSO user: ${externalId}`);
      user = await this.prismaMaster.user.create({
        data: {
          externalId,
          email,
          firstName,
          lastName,
          password: null, // SSO users have no password
          authProvider: 'drivesafe_sso',
          status: isActive ? 'active' : 'inactive',
          roleId: roleRecord?.id || null, // Ensure roleId is string | null
          tenantId: tenant.id,
          isDashboardEnabled: true,
          isFirstPassword: false,
          mustChangePassword: false,
        },
      });
    }

    return {
      status: true,
      message: user ? 'User updated' : 'User created',
      data: {
        id: user.id,
        externalId: user.externalId,
        email: user.email,
        tenantId: user.tenantId,
        role: roleRecord?.name || null,
      },
    };
  }

  /**
   * Deactivate a Tenant and all its users.
   */
  async deactivateTenant(externalId: string) {
    const tenant = await this.prismaMaster.tenant.findUnique({
      where: { externalId },
    });

    if (!tenant) {
      return { status: false, message: 'Tenant not found' };
    }

    // Deactivate tenant
    await this.prismaMaster.tenant.update({
      where: { externalId },
      data: { isActive: false },
    });

    // Deactivate all users linked to this tenant
    await this.prismaMaster.user.updateMany({
      where: { tenantId: tenant.id },
      data: { status: 'inactive' },
    });

    this.logger.log(`Deactivated tenant: ${externalId}`);

    return {
      status: true,
      message: 'Tenant and users deactivated',
    };
  }

  /**
   * Generate a URL-safe code from a name.
   */
  private generateCode(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 32);
  }
}
