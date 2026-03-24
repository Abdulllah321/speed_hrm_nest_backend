import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/management-client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

@Injectable()
export class PrismaMasterService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaMasterService.name);
  private readonly pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL_MANAGEMENT;
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL_MANAGEMENT environment variable is not set',
      );
    }

    const pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    const adapter = new PrismaPg(pool);
    super({ adapter } as any);
    this.pool = pool;
  }

  async onModuleInit() {
    this.logger.log('Connecting to Master Database...');
    await this.$connect();
    this.logger.log('Master Database connected successfully');
  }

  private isPoolEnded = false;

  async onModuleDestroy() {
    if (this.isPoolEnded) return;

    this.logger.log('Disconnecting from Master Database...');
    try {
      await this.$disconnect();
      await this.pool.end();
      this.isPoolEnded = true;
      this.logger.log('Master Database disconnected');
    } catch (error) {
      this.logger.error('Error during Master Database disconnect:', error);
    }
  }

  getPool() {
    return this.pool;
  }
}
