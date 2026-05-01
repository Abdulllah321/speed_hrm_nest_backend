import { Injectable, Logger } from '@nestjs/common';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { TenantDatabaseService } from '../../database/tenant-database.service';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';

export interface CompanyResponse {
  id: string;
  tenantId: string | null;
  name: string;
  code: string;
  status: string;
  dbName: string;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const selectSafeFields = {
  id: true,
  tenantId: true,
  name: true,
  code: true,
  status: true,
  dbName: true,
  parentId: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class CompanyService {
  private readonly logger = new Logger(CompanyService.name);

  constructor(
    private readonly prismaMaster: PrismaMasterService,
    private readonly tenantDb: TenantDatabaseService,
    private readonly activityLogsService: ActivityLogsService,
  ) { }

  /**
   * List all companies ordered by creation date (newest first)
   */
  async listCompanies(): Promise<{ status: boolean; data: CompanyResponse[] }> {
    const companies = (await this.prismaMaster.company.findMany({
      select: selectSafeFields,
      orderBy: { createdAt: 'desc' },
    })) as CompanyResponse[];

    return { status: true, data: companies };
  }

  /**
   * Get a specific company by ID
   */
  async getCompanyById(id: string): Promise<{
    status: boolean;
    data: CompanyResponse | null;
    message?: string;
  }> {
    const company = (await this.prismaMaster.company.findUnique({
      where: { id },
      select: selectSafeFields,
    })) as CompanyResponse | null;

    if (!company) {
      return { status: false, data: null, message: 'Company not found' };
    }

    return { status: true, data: company };
  }

  /**
   * Get a specific company by code
   */
  async getCompanyByCode(code: string): Promise<{
    status: boolean;
    data: CompanyResponse | null;
    message?: string;
  }> {
    const company = (await this.prismaMaster.company.findUnique({
      where: { code },
      select: selectSafeFields,
    })) as CompanyResponse | null;

    if (!company) {
      return { status: false, data: null, message: 'Company not found' };
    }

    return { status: true, data: company };
  }

  /**
   * Create a new company with its own tenant database
   * This will:
   * 1. Create a new PostgreSQL database for the tenant
   * 2. Run migrations on the tenant database
   * 3. Store the company record in master database
   */
  async createCompany(
    input: {
      name: string;
      code: string;
      externalId?: string; // DriveSafe dealer_id
    },
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ): Promise<{
    status: boolean;
    data?: CompanyResponse;
    message?: string;
  }> {
    try {
      // Validate input
      if (!input.name?.trim()) {
        return { status: false, message: 'Company name is required' };
      }
      if (!input.code?.trim()) {
        return { status: false, message: 'Company code is required' };
      }

      // Check if company code already exists
      const existingCompany = await this.prismaMaster.company.findUnique({
        where: { code: input.code.toLowerCase() },
      });

      if (existingCompany) {
        return { status: false, message: 'Company code already exists' };
      }

      this.logger.log(`Creating new company: ${input.name} (${input.code})`);

      // 1) Ensure a Tenant exists for this organization
      let tenant;

      // If externalId provided, check by that first
      if (input.externalId) {
        tenant = await this.prismaMaster.tenant.findUnique({
          where: { externalId: input.externalId },
        });
      }

      // If not found by externalId, try by code
      if (!tenant) {
        tenant = await this.prismaMaster.tenant.findUnique({
          where: { code: input.code.toLowerCase().trim() },
        });
      }

      if (!tenant) {
        this.logger.log(`Creating new tenant for organization: ${input.name}`);
        tenant = await this.prismaMaster.tenant.create({
          data: {
            name: input.name.trim(),
            code: input.code.toLowerCase().trim(),
            externalId: input.externalId,
            isActive: true,
          },
        });
      } else if (input.externalId && !tenant.externalId) {
        // Link existing tenant to DriveSafe if not already linked
        await this.prismaMaster.tenant.update({
          where: { id: tenant.id },
          data: { externalId: input.externalId },
        });
      }

      // 2) Provision physical tenant DB with dedicated user
      const { dbName, dbUrl, dbUser, encryptedPassword } =
        await this.tenantDb.provisionTenantDatabase(input.code);

      this.logger.log(
        `Tenant database provisioned: ${dbName} with user: ${dbUser}`,
      );

      // Parse DB URL to extract host and port
      const parsedUrl = new URL(dbUrl);

      // 3) Store company in master DB linked to tenant and with encrypted credentials
      const company = (await this.prismaMaster.company.create({
        data: {
          name: input.name.trim(),
          code: input.code.toLowerCase().trim(),
          tenantId: tenant.id,
          dbName,
          dbUrl,
          dbHost: parsedUrl.hostname,
          dbPort: parseInt(parsedUrl.port) || 5432,
          dbUser,
          dbPassword: encryptedPassword,
          status: 'active',
        },
        select: selectSafeFields,
      })) as CompanyResponse;

      this.logger.log(
        `Company created successfully: ${company.id} for tenant: ${tenant.id}`,
      );

      runInBackground(
        'Create Company',
        this.activityLogsService.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'admin',
          entity: 'Company',
          entityId: company.id,
          description: `Created company ${company.name} (${company.code})`,
          newValues: JSON.stringify({ name: input.name, code: input.code }),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return { status: true, data: company };
    } catch (error: any) {
      this.logger.error(
        `Failed to create company: ${error.message}`,
        error.stack,
      );

      runInBackground(
        'Create Company (Failure)',
        this.activityLogsService.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'admin',
          entity: 'Company',
          description: `Failed to create company ${input.name}`,
          errorMessage: error?.message,
          newValues: JSON.stringify({ name: input.name, code: input.code }),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );

      return {
        status: false,
        message: error.message || 'Failed to create company',
      };
    }
  }

  /**
   * Update company details (not the database)
   */
  async updateCompany(
    id: string,
    input: { name?: string; status?: string },
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ): Promise<{ status: boolean; data?: CompanyResponse; message?: string }> {
    try {
      const existing = await this.prismaMaster.company.findUnique({
        where: { id },
        select: selectSafeFields,
      });

      const company = (await this.prismaMaster.company.update({
        where: { id },
        data: {
          ...(input.name && { name: input.name.trim() }),
          ...(input.status && { status: input.status }),
        },
        select: selectSafeFields,
      })) as CompanyResponse;

      runInBackground(
        'Update Company',
        this.activityLogsService.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'admin',
          entity: 'Company',
          entityId: id,
          description: `Updated company ${company.name} (${company.code})`,
          oldValues: JSON.stringify(existing),
          newValues: JSON.stringify(input),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return { status: true, data: company };
    } catch (error: any) {
      runInBackground(
        'Update Company (Failure)',
        this.activityLogsService.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'admin',
          entity: 'Company',
          entityId: id,
          description: `Failed to update company ${id}`,
          errorMessage: error?.message,
          newValues: JSON.stringify(input),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );

      if (error.code === 'P2025') {
        return { status: false, message: 'Company not found' };
      }
      return {
        status: false,
        message: error.message || 'Failed to update company',
      };
    }
  }

  /**
   * Get the first active company (for auto-selection on login)
   */
  async getFirstActiveCompany(): Promise<{
    status: boolean;
    data: CompanyResponse | null;
  }> {
    const company = (await this.prismaMaster.company.findFirst({
      where: { status: 'active' },
      select: selectSafeFields,
      orderBy: { createdAt: 'asc' },
    })) as CompanyResponse | null;

    return { status: true, data: company };
  }

  /**
   * Check if any companies exist
   */
  async hasCompanies(): Promise<boolean> {
    const count = await this.prismaMaster.company.count();
    return count > 0;
  }
}
