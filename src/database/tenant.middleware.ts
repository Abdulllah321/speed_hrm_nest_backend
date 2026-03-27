import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { PrismaMasterService } from './prisma-master.service';
import { PrismaService } from './prisma.service';
import { FastifyRequest } from 'fastify';
import { ServerResponse } from 'http';
import type { Company, Tenant } from '@prisma/management-client';
import { EncryptionService } from '../common/utils/encryption.service';

interface TenantCacheEntry {
  tenantId: string;
  companyId: string;
  dbName: string;
  dbUrl: string;
  expiresAt: number;
}

type CompanyWithTenant = Company & { tenant: Tenant };

// Extend FastifyRequest to include tenant properties
interface TenantRequest extends FastifyRequest {
  tenantId?: string;
  companyId?: string;
  tenantDbName?: string;
  tenantDbUrl?: string;
  user?: any;
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name);
  private readonly tenantCache = new Map<string, TenantCacheEntry>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly prismaMaster: PrismaMasterService,
    private readonly encryptionService: EncryptionService,
  ) { }

  async use(req: TenantRequest, res: ServerResponse, next: () => void) {
    try {
      const tenantIdentifier = this.extractTenantIdentifier(req);
      const companyIdentifier = this.extractCompanyIdentifier(req);

      // If no identifiers provided, continue without tenant context
      if (!tenantIdentifier && !companyIdentifier) {
        this.logger.debug('No tenant/company context found in request');
        return next();
      }

      // Check cache first
      const cacheKey = `${tenantIdentifier || 'none'}-${companyIdentifier || 'none'}`;
      const cached = this.tenantCache.get(cacheKey);

      if (cached && cached.expiresAt > Date.now()) {
        this.attachTenantContext(req, cached);
        return next();
      }

      // Fetch company with tenant from database
      const company = await this.findCompany(
        tenantIdentifier,
        companyIdentifier,
      );

      if (!company) {
        // If it's an auth route, we allow it to proceed without tenant context
        // This is important because auth routes are no longer broadly excluded in DatabaseModule
        const isAuthRoute = req.url.startsWith('/api/auth/');
        if (isAuthRoute) {
          this.logger.debug(
            `No company found for auth route, proceeding without tenant context: URL=${req.url}, Tenant=${tenantIdentifier}`,
          );
          return next();
        }

        this.logger.warn(
          `No active company found for tenant=${tenantIdentifier}, company=${companyIdentifier}`,
        );
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ message: 'Company not found or inactive' }));
        return;
      }

      if (!company.tenant || !company.tenant.isActive) {
        this.logger.warn(`Tenant is inactive for company: ${company.id}`);
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ message: 'Tenant is inactive' }));
        return;
      }

      // Use stored dbUrl and decrypt password dynamically
      let dbUrl = company.dbUrl;

      if (!dbUrl) {
        this.logger.error(
          `Company ${company.id} has no database URL configured`,
        );
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ message: 'Database configuration error' }));
        return;
      }

      // If company has dbPassword (encrypted), we decrypt it and rebuild the URL
      // This prevents the plain password from being stored in the database
      if (company.dbPassword) {
        try {
          const plainPassword = this.encryptionService.decrypt(company.dbPassword);
          const encodedPassword = encodeURIComponent(String(plainPassword));

          if (company.dbUser && company.dbHost && company.dbName) {
            const port = company.dbPort || 5432;
            const encodedUser = encodeURIComponent(company.dbUser);
            const encodedHost = company.dbHost; // Host usually doesn't need encoding unless it's a domain with special chars
            const encodedDbName = encodeURIComponent(company.dbName);

            dbUrl = `postgresql://${encodedUser}:${encodedPassword}@${encodedHost}:${port}/${encodedDbName}?schema=public`;

            // Mask password in debug log
            const maskedUrl = `postgresql://${encodedUser}:****@${encodedHost}:${port}/${encodedDbName}`;
            this.logger.debug(`Constructed DB URL for company ${company.id}: ${maskedUrl}`);
          }
        } catch (err: any) {
          this.logger.error(`Failed to decrypt database password for company ${company.id}: ${err.message}`);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ message: 'Database configuration error' }));
          return;
        }
      }

      // Cache the tenant context
      const cacheEntry: TenantCacheEntry = {
        tenantId: company.tenant.id,
        companyId: company.id,
        dbName: company.dbName,
        dbUrl,
        expiresAt: Date.now() + this.CACHE_TTL,
      };

      this.tenantCache.set(cacheKey, cacheEntry);

      // Attach to request
      this.attachTenantContext(req, cacheEntry);

      this.logger.debug(
        `Tenant context set: Tenant=${company.tenant.id}, Company=${company.id} -> ${company.dbName}`,
      );

      next();
    } catch (error) {
      this.logger.error(`Error in TenantMiddleware: ${error}`);
      // Don't throw - send error response instead to prevent server crash
      try {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            status: false,
            message: 'Internal server error in tenant middleware',
          }),
        );
        return;
      } catch (sendError) {
        // If we can't send response, just log and call next to prevent crash
        this.logger.error(`Failed to send error response: ${sendError}`);
        next();
      }
    }
  }

  /**
   * Find company by tenant or company identifier
   */
  private async findCompany(
    tenantIdentifier: string | null,
    companyIdentifier: string | null,
  ): Promise<CompanyWithTenant | null> {
    // Priority 1: Find by company identifier (most specific)
    if (companyIdentifier) {
      const company = await this.prismaMaster.company.findFirst({
        where: {
          OR: [{ id: companyIdentifier }, { code: companyIdentifier }],
          status: 'active',
        },
        include: {
          tenant: true,
        },
      });

      if (company && company.tenant) {
        return company as CompanyWithTenant;
      }
    }

    // Priority 2: Find by tenant identifier (get first active company)
    if (tenantIdentifier) {
      const tenant = await this.prismaMaster.tenant.findFirst({
        where: {
          OR: [{ id: tenantIdentifier }, { code: tenantIdentifier }],
          isActive: true,
        },
        include: {
          companies: {
            where: { status: 'active' },
            orderBy: { createdAt: 'asc' }, // First created company
            take: 1,
          },
        },
      });

      if (tenant && tenant.companies.length > 0) {
        return { ...tenant.companies[0], tenant } as CompanyWithTenant;
      }
    }

    return null;
  }

  /**
   * Attach tenant context to request object
   */
  private attachTenantContext(
    req: TenantRequest,
    context: TenantCacheEntry,
  ): void {
    req.tenantId = context.tenantId;
    req.companyId = context.companyId;
    req.tenantDbName = context.dbName;
    req.tenantDbUrl = context.dbUrl;
  }

  /**
   * Extract tenant identifier from request
   */
  private extractTenantIdentifier(req: TenantRequest): string | null {
    // 1. Check header
    const headerTenantId = req.headers['x-tenant-id'] as string | undefined;
    if (headerTenantId) {
      return headerTenantId;
    }

    // 2. Check subdomain
    const host = req.headers.host as string | undefined;
    if (host) {
      const subdomain = host.split('.')[0];
      if (
        subdomain &&
        ![
          'www',
          'api',
          'admin',
          'localhost',
          'hr',
          'erp',
          'pos',
          'master',
          'auth',
        ].includes(subdomain)
      ) {
        return subdomain;
      }
    }

    // 3. Check query parameter
    const queryTenantId = (req.query as any)?.tenantId as string | undefined;
    if (queryTenantId) {
      return queryTenantId;
    }

    // 4. Check cookies
    const cookieTenantId =
      this.getCookieValue(req, 'tenantId') ||
      this.getCookieValue(req, 'tenantCode') ||
      this.getCookieValue(req, 'companyCode');
    if (cookieTenantId) {
      return cookieTenantId;
    }

    // 5. Check JWT token
    const user = req.user as any;
    if (user?.tenantId) {
      return user.tenantId;
    }

    return null;
  }

  /**
   * Extract company identifier from request
   */
  private extractCompanyIdentifier(req: TenantRequest): string | null {
    // 1. Check header
    const headerCompanyId = req.headers['x-company-id'] as string | undefined;
    if (headerCompanyId) {
      return headerCompanyId;
    }

    // 2. Check query parameter
    const queryCompanyId = (req.query as any)?.companyId as string | undefined;
    if (queryCompanyId) {
      return queryCompanyId;
    }

    // 3. Check cookies
    const cookieCompanyId =
      this.getCookieValue(req, 'companyId') ||
      this.getCookieValue(req, 'companyCode') ||
      this.getCookieValue(req, 'tenantCode');
    if (cookieCompanyId) {
      return cookieCompanyId;
    }

    // 4. Check JWT token
    const user = req.user as any;
    if (user?.companyId) {
      return user.companyId;
    }

    return null;
  }

  /**
   * Helper to get cookie value from Fastify request
   */
  private getCookieValue(req: TenantRequest, name: string): string | null {
    // Fastify cookie parsing - check if @fastify/cookie is installed
    if (req.cookies && req.cookies[name]) {
      return req.cookies[name];
    }

    // Manual parse from header as fallback
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      const cookies = cookieHeader.split(';').reduce(
        (acc, c) => {
          const parts = c.trim().split('=');
          if (parts.length >= 2) {
            acc[parts[0]] = parts.slice(1).join('=');
          }
          return acc;
        },
        {} as Record<string, string>,
      );

      const value = cookies[name];
      if (value) {
        try {
          return decodeURIComponent(value);
        } catch {
          return value;
        }
      }
    }

    return null;
  }

  /**
   * Clear cache for specific tenant/company or all
   */
  async clearCache(tenantId?: string, companyId?: string): Promise<void> {
    if (tenantId || companyId) {
      // Clear specific entries
      const keysToDelete: string[] = [];

      for (const [key, value] of this.tenantCache.entries()) {
        if (
          (tenantId && value.tenantId === tenantId) ||
          (companyId && value.companyId === companyId)
        ) {
          keysToDelete.push(key);
          // Cleanup pool for this company
          await PrismaService.cleanupTenantPool(value.companyId);
        }
      }

      keysToDelete.forEach((key) => this.tenantCache.delete(key));
      this.logger.log(
        `Cleared cache for tenant=${tenantId}, company=${companyId}`,
      );
    } else {
      // Clear all
      this.tenantCache.clear();
      await PrismaService.cleanupAllPools();
      this.logger.log('Cleared all caches and pools');
    }
  }
}
