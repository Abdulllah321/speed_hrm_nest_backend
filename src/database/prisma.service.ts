import {
  Injectable,
  Inject,
  Logger,
  OnModuleDestroy,
  Scope,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

interface TenantRequest extends Request {
  tenantId?: string;
  tenantDbName?: string;
  tenantDbUrl?: string;
}

const poolCache = new Map<string, Pool>();
const adapterCache = new Map<string, PrismaPg>();
let noop: PrismaPg | null = null; // Reusable no-op adapter
const logger = new Logger('PrismaPoolCache');

/**
 * Create a no-op adapter that will error if actually used
 * This allows PrismaClient to initialize without throwing during construction
 */
function createNoOpAdapter(): PrismaPg {
  // Create a pool that cannot actually connect
  // We'll only use this for initialization, not for actual queries
  const noOpPool = new Pool({
    max: 0, // No connections allowed
  });

  return new PrismaPg(noOpPool);
}

@Injectable({ scope: Scope.REQUEST })
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly tenantId: string | null = null;
  private readonly isInitialized: boolean = false;

  constructor(@Inject(REQUEST) private readonly request: TenantRequest) {
    // In Fastify, the middleware might set properties on the raw node request (req.raw)
    // while the REQUEST provider gives us the Fastify Request object.
    const rawReq = (request as any)?.raw || {};
    const tenantDbUrl = request?.tenantDbUrl || rawReq.tenantDbUrl;
    const tenantId = request?.tenantId || rawReq.tenantId;

    // If no tenant context, create with a no-op adapter
    // Any attempt to query will fail with a clear error message
    if (!tenantDbUrl || !tenantId) {
      if (!noop) {
        noop = createNoOpAdapter();
      }

      super({ adapter: noop } as any);
      this.isInitialized = false;
      this.logger.debug(
        'PrismaService created without tenant context - calls will fail with ensureTenantContext() check',
      );
      return;
    }

    // Normal tenant initialization
    let pool = poolCache.get(tenantId);

    if (!pool) {
      logger.log(`Creating new connection pool for tenant: ${tenantId}`);
      pool = new Pool({
        connectionString: tenantDbUrl,
        max: 20, // Increased from 10
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000, // Increased from 2000 to handle heavier queries
      });

      // Increase listener limit to accommodate multiple Prisma clients
      // although caching should keep this is check
      pool.setMaxListeners(100);

      pool.on('error', (err) => {
        logger.error(`Pool error for tenant ${tenantId}:`, err);
      });

      poolCache.set(tenantId, pool);
    } else {
      logger.debug(`Reusing existing pool for tenant: ${tenantId}`);
    }

    // Use cached adapter to prevent MaxListenersExceededWarning
    let adapter = adapterCache.get(tenantId);
    if (!adapter) {
      adapter = new PrismaPg(pool);
      adapterCache.set(tenantId, adapter);
    }

    super({ adapter: adapter as any });

    this.tenantId = tenantId;
    this.isInitialized = true;

    this.logger.debug(`PrismaService initialized for tenant: ${tenantId}`);
  }

  // Helper method to check if tenant DB is available
  ensureTenantContext(): void {
    if (!this.isInitialized) {
      throw new Error(
        'Tenant database context is required for this operation. Ensure user is authenticated and has a valid company.',
      );
    }
  }

  getTenantId(): string | null {
    return this.tenantId;
  }

  getTenantDbUrl(): string | null {
    // We need to re-extract it from the request if possible, or store it
    const rawReq = (this.request as any)?.raw || {};
    return this.request?.tenantDbUrl || rawReq.tenantDbUrl || null;
  }

  async onModuleDestroy() {
    // Only disconnect the PrismaClient instance.
    // Pools are shared and should be closed via static cleanupAllPools or when process exits.
    if (this.isInitialized) {
      this.logger.debug(
        `Disconnecting PrismaClient instance for tenant: ${this.tenantId}`,
      );
      await this.$disconnect();
    }
  }

  static async cleanupTenantPool(tenantId: string): Promise<void> {
    const pool = poolCache.get(tenantId);
    if (pool) {
      logger.log(`Closing pool and clearing adapter for tenant: ${tenantId}`);
      adapterCache.delete(tenantId);
      await pool.end();
      poolCache.delete(tenantId);
    }
  }

  static async cleanupAllPools(): Promise<void> {
    logger.log(`Cleaning up ${poolCache.size} tenant connection pools...`);

    // Cleanup adapters first
    adapterCache.clear();

    const cleanupPromises = Array.from(poolCache.entries()).map(
      async ([tenantId, pool]) => {
        try {
          await pool.end();
          logger.debug(`Closed pool for tenant: ${tenantId}`);
        } catch (error) {
          logger.error(`Error closing pool for tenant ${tenantId}:`, error);
        }
      },
    );

    // Cleanup no-op pool if it exists
    if (noop) {
      cleanupPromises.push(
        (async () => {
          try {
            // The no-op pool has max: 0, so there's nothing to clean
            noop = null;
            logger.debug('Cleaned up no-op adapter');
          } catch (error) {
            logger.error('Error cleaning no-op adapter:', error);
          }
        })(),
      );
    }

    await Promise.all(cleanupPromises);
    poolCache.clear();
    logger.log('All tenant pools and adapters cleaned up');
  }

  static getPoolStats(): {
    tenantId: string;
    totalCount: number;
    idleCount: number;
    waitingCount: number;
  }[] {
    return Array.from(poolCache.entries()).map(([tenantId, pool]) => ({
      tenantId,
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    }));
  }
}
