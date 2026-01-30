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

    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    super({ adapter } as any);
    this.pool = pool;
  }

  async onModuleInit() {
    this.logger.log('Connecting to Master Database...');
    await this.$connect();
    this.logger.log('Master Database connected successfully');
  }

  async onModuleDestroy() {
    this.logger.log('Disconnecting from Master Database...');
    await this.$disconnect();
    await this.pool.end();
    this.logger.log('Master Database disconnected');
  }

  getPool() {
    return this.pool;
  }
}
