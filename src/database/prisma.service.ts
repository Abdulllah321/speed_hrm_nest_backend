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
let staticDummyPool: Pool | null = null;
let staticDummyAdapter: PrismaPg | null = null;
const logger = new Logger('PrismaPoolCache');

@Injectable({ scope: Scope.REQUEST })
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly tenantId: string | null = null;
  private readonly isInitialized: boolean = false;

  constructor(@Inject(REQUEST) private readonly request: TenantRequest) {
    // In Fastify, the middleware might set properties on the raw node request (req.raw)
    // while the REQUEST provider gives us the Fastify Request object.
    const rawReq = (request as any).raw || {};
    const tenantDbUrl = request.tenantDbUrl || rawReq.tenantDbUrl;
    const tenantId = request.tenantId || rawReq.tenantId;

    // If no tenant context, create/use a minimal dummy instance
    // This happens during routes like /auth/login which don't have tenant context
    if (!tenantDbUrl || !tenantId) {
      if (!staticDummyPool) {
        logger.debug('Creating persistent dummy pool for context-less requests');
        staticDummyPool = new Pool({
          connectionString: 'postgresql://invalid:invalid@localhost:5432/invalid',
          max: 1,
        });
        staticDummyAdapter = new PrismaPg(staticDummyPool);
      }

      super({ adapter: staticDummyAdapter } as any);
      this.isInitialized = false;
      return;
    }

    // Normal tenant initialization
    let pool = poolCache.get(tenantId);

    if (!pool) {
      logger.log(`Creating new connection pool for tenant: ${tenantId}`);
      pool = new Pool({
        connectionString: tenantDbUrl,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
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
        'Tenant database context is required for this operation. Ensure user is authenticated and has a valid company.'
      );
    }
  }

  async onModuleDestroy() {
    // Only disconnect the PrismaClient instance. 
    // Pools are shared and should be closed via static cleanupAllPools or when process exits.
    if (this.isInitialized) {
      this.logger.debug(`Disconnecting PrismaClient instance for tenant: ${this.tenantId}`);
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
    logger.log(`Cleaning up ${poolCache.size} tenant connection pools and static resources...`);

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
      }
    );

    if (staticDummyPool) {
      cleanupPromises.push((async () => {
        try {
          await staticDummyPool!.end();
          staticDummyPool = null;
          staticDummyAdapter = null;
          logger.debug('Closed static dummy pool');
        } catch (error) {
          logger.error('Error closing static dummy pool:', error);
        }
      })());
    }

    await Promise.all(cleanupPromises);
    poolCache.clear();
    logger.log('All tenant pools and static resources cleaned up');
  }

  static getPoolStats(): { tenantId: string; totalCount: number; idleCount: number; waitingCount: number }[] {
    return Array.from(poolCache.entries()).map(([tenantId, pool]) => ({
      tenantId,
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    }));
  }
}