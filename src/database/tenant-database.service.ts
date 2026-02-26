import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaMasterService } from './prisma-master.service';
import { EncryptionService } from '../common/utils/encryption.service';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { PrismaService } from './prisma.service';

const execAsync = promisify(exec);

@Injectable()
export class TenantDatabaseService implements OnModuleInit {
  private readonly logger = new Logger(TenantDatabaseService.name);

  private dbHost!: string;
  private dbPort!: string;
  private dbSuperUser!: string;
  private dbSuperPassword!: string;

  constructor(
    private readonly prismaMaster: PrismaMasterService,
    private readonly encryptionService: EncryptionService,
  ) { }

  async onModuleInit() {
    const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
    if (managementUrl) {
      const url = new URL(managementUrl);
      this.dbHost = url.hostname;
      this.dbPort = url.port || '5432';
      this.dbSuperUser = url.username;
      this.dbSuperPassword = url.password;
    }
  }

  private generateDatabaseName(companyCode: string): string {
    const sanitizedCode = companyCode.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const timestamp = Date.now().toString(36);
    return `tenant_${sanitizedCode}_${timestamp}`;
  }

  private generateDatabaseUser(companyCode: string): string {
    const sanitizedCode = companyCode.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const timestamp = Date.now().toString(36);
    return `user_${sanitizedCode}_${timestamp}`;
  }

  private async databaseExists(dbName: string): Promise<boolean> {
    try {
      const pool = this.prismaMaster.getPool();
      const result = await pool.query(
        `SELECT 1 FROM pg_database WHERE datname = $1`,
        [dbName],
      );
      return result.rowCount !== null && result.rowCount > 0;
    } catch (error) {
      this.logger.error(`Error checking database existence: ${error}`);
      return false;
    }
  }

  private async userExists(dbUser: string): Promise<boolean> {
    try {
      const pool = this.prismaMaster.getPool();
      const result = await pool.query(
        `SELECT 1 FROM pg_roles WHERE rolname = $1`,
        [dbUser],
      );
      return result.rowCount !== null && result.rowCount > 0;
    } catch (error) {
      this.logger.error(`Error checking user existence: ${error}`);
      return false;
    }
  }

  private async createDatabaseUser(
    dbUser: string,
    dbPassword: string,
  ): Promise<void> {
    const pool = this.prismaMaster.getPool();

    const exists = await this.userExists(dbUser);
    if (exists) {
      this.logger.warn(
        `Database user ${dbUser} already exists, skipping creation`,
      );
      return;
    }

    this.logger.log(`Creating database user: ${dbUser}`);

    try {
      // Create user with limited privileges
      await pool.query(`
        CREATE USER ${dbUser} WITH PASSWORD '${dbPassword}' 
        NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT LOGIN;
      `);

      this.logger.log(`Database user ${dbUser} created successfully`);
    } catch (error: any) {
      if (error.code === '42710') {
        // duplicate_object
        this.logger.warn(
          `Database user ${dbUser} already exists (concurrent creation)`,
        );
      } else {
        this.logger.error(
          `Failed to create database user ${dbUser}: ${error.message}`,
        );
        throw error;
      }
    }
  }

  private async createDatabase(dbName: string, dbUser: string): Promise<void> {
    const pool = this.prismaMaster.getPool();
    const exists = await this.databaseExists(dbName);

    if (exists) {
      this.logger.warn(`Database ${dbName} already exists, skipping creation`);
      return;
    }

    this.logger.log(`Creating new tenant database: ${dbName}`);

    try {
      const sanitizedDbName = dbName.replace(/[^a-zA-Z0-9_]/g, '');

      // Create database owned by the tenant user
      await pool.query(`CREATE DATABASE "${sanitizedDbName}" OWNER ${dbUser}`);

      this.logger.log(`Database ${dbName} created successfully`);
    } catch (error: any) {
      if (error.code === '42P04') {
        // duplicate_database
        this.logger.warn(
          `Database ${dbName} already exists (concurrent creation)`,
        );
      } else {
        this.logger.error(
          `Failed to create database ${dbName}: ${error.message}`,
        );
        throw error;
      }
    }
  }

  private async grantDatabasePrivileges(
    dbName: string,
    dbUser: string,
  ): Promise<void> {
    this.logger.log(
      `Granting privileges on database ${dbName} to user ${dbUser}`,
    );

    // Connect to the new database to grant schema-level privileges
    const { Pool } = require('pg');
    const tenantPool = new Pool({
      host: this.dbHost,
      port: parseInt(this.dbPort),
      user: this.dbSuperUser,
      password: this.dbSuperPassword,
      database: dbName,
    });

    try {
      // Grant privileges on public schema
      await tenantPool.query(`
        GRANT ALL PRIVILEGES ON SCHEMA public TO ${dbUser};
      `);

      // Grant privileges on all tables (for existing tables)
      await tenantPool.query(`
        GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${dbUser};
      `);

      // Grant privileges on all sequences
      await tenantPool.query(`
        GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${dbUser};
      `);

      // Grant default privileges for future tables
      await tenantPool.query(`
        ALTER DEFAULT PRIVILEGES IN SCHEMA public 
        GRANT ALL PRIVILEGES ON TABLES TO ${dbUser};
      `);

      // Grant default privileges for future sequences
      await tenantPool.query(`
        ALTER DEFAULT PRIVILEGES IN SCHEMA public 
        GRANT ALL PRIVILEGES ON SEQUENCES TO ${dbUser};
      `);

      this.logger.log(`Privileges granted successfully to ${dbUser}`);
    } catch (error: any) {
      this.logger.error(`Failed to grant privileges: ${error.message}`);
      throw error;
    } finally {
      await tenantPool.end();
    }
  }

  private generateDatabaseUrl(
    dbName: string,
    dbUser: string,
  ): string {
    return `postgresql://${dbUser}:[password]@${this.dbHost}:${this.dbPort}/${dbName}?schema=public`;
  }


  private async runMigrations(dbUrl: string): Promise<void> {
    this.logger.log('Running migrations on tenant database...');

    try {
      const env = {
        ...process.env,
        DATABASE_URL: dbUrl,
      };

      this.logger.log(`Using schema from: prisma/schema`);

      const { stdout, stderr } = await execAsync(
        `bunx prisma db push --schema=prisma/schema --accept-data-loss`,
        { env },
      );

      if (stdout) {
        this.logger.log(`Migration output: ${stdout}`);
      }
      if (stderr && !stderr.includes('warn')) {
        this.logger.warn(`Migration stderr: ${stderr}`);
      }

      this.logger.log('Migrations completed successfully');
    } catch (error: any) {
      this.logger.error(`Migration failed: ${error.message}`);
      throw error;
    }
  }

  async provisionTenantDatabase(companyCode: string): Promise<{
    dbName: string;
    dbUrl: string;
    dbUser: string;
    dbPassword: string;
    encryptedPassword: string;
  }> {
    const dbName = this.generateDatabaseName(companyCode);
    const dbUser = this.generateDatabaseUser(companyCode);
    const dbPassword = this.encryptionService.generateSecurePassword(32);

    this.logger.log(`Provisioning tenant database for company: ${companyCode}`);
    this.logger.log(`Database: ${dbName}, User: ${dbUser}`);

    try {
      // 1. Create database user
      await this.createDatabaseUser(dbUser, dbPassword);

      // 2. Create database owned by the user
      await this.createDatabase(dbName, dbUser);

      // 3. Grant necessary privileges
      await this.grantDatabasePrivileges(dbName, dbUser);

      // 4. Generate connection URL for saving to DB (without password)
      const dbUrl = this.generateDatabaseUrl(dbName, dbUser);

      // 5. Run migrations (requires actual password)
      const encodedPassword = encodeURIComponent(dbPassword);
      const migrationDbUrl = `postgresql://${dbUser}:${encodedPassword}@${this.dbHost}:${this.dbPort}/${dbName}?schema=public`;
      await this.runMigrations(migrationDbUrl);

      // 6. Encrypt password for storage
      const encryptedPassword = this.encryptionService.encrypt(dbPassword);

      this.logger.log(`Tenant database provisioned successfully: ${dbName}`);

      return {
        dbName,
        dbUrl,
        dbUser,
        dbPassword,
        encryptedPassword,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to provision tenant database: ${error.message}`,
      );

      // Cleanup on failure
      await this.cleanupFailedProvisioning(dbName, dbUser);

      throw error;
    }
  }

  private async cleanupFailedProvisioning(
    dbName: string,
    dbUser: string,
  ): Promise<void> {
    const pool = this.prismaMaster.getPool();

    try {
      this.logger.log(`Cleaning up failed provisioning: ${dbName}, ${dbUser}`);

      // Try to drop database
      try {
        await pool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
      } catch (error) {
        this.logger.warn(`Could not drop database ${dbName}: ${error}`);
      }

      // Try to drop user
      try {
        await pool.query(`DROP USER IF EXISTS ${dbUser}`);
      } catch (error) {
        this.logger.warn(`Could not drop user ${dbUser}: ${error}`);
      }
    } catch (error) {
      this.logger.error(`Error during cleanup: ${error}`);
    }
  }

  async deleteDatabase(
    dbName: string,
    tenantId: string,
    dbUser?: string,
  ): Promise<void> {
    const pool = this.prismaMaster.getPool();
    this.logger.warn(`Deleting tenant database: ${dbName}`);

    try {
      // 1. Cleanup connection pool
      await PrismaService.cleanupTenantPool(tenantId);
      this.logger.log(`Cleaned up connection pool for tenant: ${tenantId}`);

      // 2. Terminate all connections
      await pool.query(
        `
        SELECT pg_terminate_backend(pg_stat_activity.pid)
        FROM pg_stat_activity
        WHERE pg_stat_activity.datname = $1
          AND pid <> pg_backend_pid()
      `,
        [dbName],
      );

      // Small delay to ensure connections are terminated
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 3. Drop the database
      const sanitizedDbName = dbName.replace(/[^a-zA-Z0-9_]/g, '');
      await pool.query(`DROP DATABASE IF EXISTS "${sanitizedDbName}"`);
      this.logger.log(`Database ${dbName} deleted successfully`);

      // 4. Drop the database user if provided
      if (dbUser) {
        await pool.query(`DROP USER IF EXISTS ${dbUser}`);
        this.logger.log(`Database user ${dbUser} deleted successfully`);
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to delete database ${dbName}: ${error.message}`,
      );
      throw error;
    }
  }
}
