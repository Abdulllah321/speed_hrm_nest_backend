import {
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
  Inject,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'async_hooks';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

export interface PrismaServiceContext {
  tenantId: string;
  companyId: string;
  dbUrl: string;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  // Instance variables to support manual instantiation (backward compatibility for background jobs)
  private readonly manualTenantId: string | null = null;
  private readonly manualDbUrl: string | null = null;

  // A static map to cache the actual PrismaClient instances
  private static readonly clientsPool = new Map<string, PrismaClient>();

  // AsyncLocalStorage to maintain active tenant context per asynchronous execution branch
  public static readonly asyncLocalStorage = new AsyncLocalStorage<PrismaServiceContext>();

  constructor(
    @Optional()
    @Inject('PRISMA_SERVICE_OPTIONS')
    options?: { tenantId?: string; tenantDbUrl?: string },
  ) {
    if (options && options.tenantDbUrl) {
      // 1. Manual instantiation for background/export jobs
      // Return a normal, standalone PrismaClient instance connected to that URL.
      const pool = new Pool({
        connectionString: options.tenantDbUrl,
        max: 5, // smaller pool for single job processors
        idleTimeoutMillis: 15000,
        connectionTimeoutMillis: 5000,
      });

      pool.on('error', (err) => {
        console.error(`Manual pool error:`, err);
      });

      const adapter = new PrismaPg(pool);

      super({
        adapter: adapter as any,
      });

      this.manualTenantId = options.tenantId || null;
      this.manualDbUrl = options.tenantDbUrl || null;
      (this as any)._pgPool = pool;
      return;
    }

    // 2. Singleton / Proxy behavior for standard Dependency Injection
    // Run the base PrismaClient constructor once with a no-op adapter
    // to satisfy the requirement that a valid driver adapter is always provided.
    const noOpPool = new Pool({ max: 0 });
    const noOpAdapter = new PrismaPg(noOpPool);

    super({
      adapter: noOpAdapter as any,
    });

    (this as any)._noOpPool = noOpPool;

    // Return a Proxy to delegate all dynamic model and query property accesses
    // transparently to the active tenant's PrismaClient instance.
    return new Proxy(this, {
      get(target, prop, receiver) {
        // A. Delegate helper methods and NestJS provider lifecycle methods to the target
        const ownMethods = [
          'getTenantClient',
          'onModuleInit',
          'onModuleDestroy',
          'beforeApplicationShutdown',
          'onApplicationShutdown',
          'onApplicationBootstrap',
          'ensureTenantContext',
          'getTenantId',
          'getTenantDbUrl',
          'logger',
          'manualTenantId',
          'manualDbUrl',
          '$disconnect',
        ];
        if (ownMethods.includes(prop as string)) {
          return Reflect.get(target, prop, receiver);
        }

        // B. Delegate JavaScript/TypeScript inspects, private properties, and Promise properties
        if (
          typeof prop === 'symbol' ||
          prop.startsWith('_') ||
          prop === 'constructor' ||
          prop === 'then'
        ) {
          return Reflect.get(target, prop, receiver);
        }

        // C. Retrieve context and delegate other model / query properties to the tenant client
        const context = PrismaService.asyncLocalStorage.getStore();
        if (!context) {
          throw new Error(
            `PrismaService context is missing. Ensure the user is authenticated and the TenantMiddleware has set the context before calling database operations (Accessed property: ${String(prop)}).`
          );
        }

        const client = target.getTenantClient(context.companyId, context.dbUrl);
        const value = Reflect.get(client, prop);
        if (typeof value === 'function') {
          return value.bind(client);
        }
        return value;
      },
    });
  }

  /**
   * Retrieves or instantiates a unique Prisma Client for a given tenant company
   */
  getTenantClient(companyId: string, dbUrl: string): PrismaClient {
    let client = PrismaService.clientsPool.get(companyId);

    if (!client) {
      this.logger.log(
        `Creating new connection pool and PrismaClient for tenant company: ${companyId}`,
      );

      const pool = new Pool({
        connectionString: dbUrl,
        max: 10, // Max 10 connections per tenant pool (highly efficient and lightweight)
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });

      pool.on('error', (err) => {
        this.logger.error(`Pool error for tenant company ${companyId}:`, err);
      });

      const adapter = new PrismaPg(pool);

      // Create instance ONCE per company context.
      client = new PrismaClient({
        adapter: adapter as any,
      });

      // Track pool on the client for safe teardown
      (client as any)._pgPool = pool;

      PrismaService.clientsPool.set(companyId, client);
    }

    return client;
  }

  /**
   * Helper method to verify if a tenant database context is active
   */
  ensureTenantContext(): void {
    if (this.manualTenantId) return;
    const context = PrismaService.asyncLocalStorage.getStore();
    if (!context || !context.companyId) {
      throw new Error(
        'Tenant database context is required for this operation. Ensure user is authenticated and has a valid company.',
      );
    }
  }

  /**
   * Retrieves active tenant ID (represents tenant/company identity)
   */
  getTenantId(): string | null {
    if (this.manualTenantId) return this.manualTenantId;
    const context = PrismaService.asyncLocalStorage.getStore();
    return context ? context.tenantId : null;
  }

  /**
   * Retrieves active tenant database connection URL
   */
  getTenantDbUrl(): string | null {
    if (this.manualDbUrl) return this.manualDbUrl;
    const context = PrismaService.asyncLocalStorage.getStore();
    return context ? context.dbUrl : null;
  }

  /**
   * Called by TenantMiddleware's clearCache method or dynamic actions
   */
  static async cleanupTenantPool(companyId: string): Promise<void> {
    const client = PrismaService.clientsPool.get(companyId);
    if (client) {
      await client.$disconnect();
      const pool = (client as any)._pgPool;
      if (pool) {
        try {
          await pool.end();
        } catch (error) {
          console.error(`Error closing pool for company ${companyId}:`, error);
        }
      }
      PrismaService.clientsPool.delete(companyId);
    }
  }

  static async cleanupAllPools(): Promise<void> {
    for (const [companyId, client] of PrismaService.clientsPool.entries()) {
      try {
        await client.$disconnect();
        const pool = (client as any)._pgPool;
        if (pool) {
          await pool.end();
        }
      } catch (error) {
        console.error(`Error disconnecting client for company ${companyId}:`, error);
      }
    }
    PrismaService.clientsPool.clear();
  }

  async $disconnect() {
    await super.$disconnect();
    if (this.manualDbUrl && (this as any)._pgPool) {
      try {
        await (this as any)._pgPool.end();
      } catch (err) {
        this.logger.error(`Error closing manual pool:`, err);
      }
    }
  }

  async onModuleDestroy() {
    this.logger.log('Destroying PrismaService singleton - cleaning up all tenant connection pools...');
    await PrismaService.cleanupAllPools();
    if ((this as any)._noOpPool) {
      try {
        await (this as any)._noOpPool.end();
      } catch (error) {
        // Safe cleanup logging fallback
      }
    }
  }
}
