import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename, extname } from 'path';
import { execSync } from 'child_process';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/**
 * Helper to parse connection string components
 */
function parseUrl(url: string) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port || '5432',
      database: parsed.pathname.slice(1),
      username: parsed.username,
      password: parsed.password,
      protocol: parsed.protocol
    };
  } catch (e) {
    return null;
  }
}

/**
 * Execute SQL backup file against a specific database
 */
async function restoreDatabase(connectionString: string, filePath: string): Promise<void> {
  const config = parseUrl(connectionString);
  if (!config) {
    console.error(`❌ Invalid connection string for ${filePath}`);
    return;
  }

  console.log(`📦 Restoring ${basename(filePath)} to database '${config.database}'...`);

  try {
    // Check file format
    const fileBuffer = readFileSync(filePath);
    // "PGDM" header for custom format
    const isCustomFormat = fileBuffer.length > 4 &&
      fileBuffer[0] === 0x50 && fileBuffer[1] === 0x47 &&
      fileBuffer[2] === 0x44 && fileBuffer[3] === 0x4d;

    if (isCustomFormat) {
      console.log('   ↳ Detected pg_dump custom format, using pg_restore...');

      const pgRestoreCmd = `pg_restore --no-owner --no-acl --clean --if-exists -h ${config.host} -p ${config.port} -U ${config.username} -d ${config.database} "${filePath}"`;

      try {
        execSync(pgRestoreCmd, {
          env: { ...process.env, PGPASSWORD: config.password },
          stdio: 'inherit',
          shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
        });
        console.log('   ✅ Restored successfully.');
      } catch (error) {
        console.warn('   ⚠️  pg_restore encountered errors (check output above).');
      }
    } else {
      // Plain SQL execution
      console.log('   ↳ Executing plain SQL file...');

      // We need a temporary pool for this specific connection
      const tempPool = new Pool({ connectionString });
      const client = await tempPool.connect();

      try {
        const sqlContent = readFileSync(filePath, 'utf-8');
        // Split by semicolons, ignoring comments? 
        // Simple splitting might break on semicolons in strings. 
        // For large dumps, standard pg client query might handle the whole string if it's multiple statements?
        // Yes, pg driver allows multiple statements in one query text.

        await client.query(sqlContent);
        console.log('   ✅ SQL executed successfully.');
      } catch (err: any) {
        console.error(`   ❌ SQL Execution failed: ${err.message}`);
      } finally {
        client.release();
        await tempPool.end();
      }
    }
  } catch (error: any) {
    console.error(`   ❌ Restoration failed: ${error.message}`);
  }
}

async function main() {
  console.log('🌱 Seeding database...');
  console.log('');

  // Define backup locations
  const possibleBackupDirs = [
    join(process.cwd(), 'backup'),
    join(process.cwd(), '..', 'backup'),
  ];

  const backupDir = possibleBackupDirs.find(d => existsSync(d) && statSync(d).isDirectory());

  if (process.env.RUN_BACKUP_RESTORE === 'true') {
    if (backupDir) {
      console.log(`📂 Found multi-tenant backup directory: ${backupDir}`);

      // 1. Restore Roles (Global)
      // We can use Master connection for global operations
      const rolesFile = join(backupDir, 'roles', 'company_roles.sql');
      if (existsSync(rolesFile)) {
        console.log('👤 Restoring global roles...');
        // Roles restoration usually works best with plain psql usage or just execution.
        // It connects to the cluster, database selection is less important but credentials must be su/admin.
        // We'll use MANAGEMENT DB connection for this.
        await restoreDatabase(process.env.DATABASE_URL_MANAGEMENT || process.env.DATABASE_URL!, rolesFile);
      }

      // 2. Restore Master Data
      const masterFile = join(backupDir, 'master', 'master_data.sql');
      if (existsSync(masterFile)) {
        console.log('🏢 Restoring Master Database...');
        if (!process.env.DATABASE_URL_MANAGEMENT) {
          console.error('❌ DATABASE_URL_MANAGEMENT is not defined in .env');
        } else {
          await restoreDatabase(process.env.DATABASE_URL_MANAGEMENT, masterFile);
        }
      }

      // 3. Restore Tenant Databases
      const companiesDir = join(backupDir, 'companies');
      if (existsSync(companiesDir)) {
        console.log('🏭 Restoring Tenant Databases...');
        const files = readdirSync(companiesDir).filter(f => f.endsWith('.sql'));

        // Base connection URL to swap DB name
        const baseUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_MANAGEMENT!;
        const baseConfig = parseUrl(baseUrl);

        if (baseConfig) {
          for (const file of files) {
            const dbName = basename(file, '.sql');
            // Construct connection string for this tenant
            const tenantUrl = `${baseConfig.protocol}//${baseConfig.username}:${baseConfig.password}@${baseConfig.host}:${baseConfig.port}/${dbName}`;

            await restoreDatabase(tenantUrl, join(companiesDir, file));
          }
        }
      }

    } else {
      // Fallback to legacy single file
      console.log('⚠️  Multi-tenant backup dir not found. Searching for legacy backup.sql...');

      const possibleFiles = [
        join(process.cwd(), 'backup.sql'),
        join(process.cwd(), '..', 'backup.sql'),
      ];

      const legacyFile = possibleFiles.find(f => existsSync(f));

      if (legacyFile) {
        await restoreDatabase(process.env.DATABASE_URL!, legacyFile);
      } else {
        console.log('ℹ️  No backup files found. Skipping restore.');
      }
    }
  } else {
    console.log('Skipping backup restore (RUN_BACKUP_RESTORE not set)');
  }

  // 4. Run specific seeds
  try {
    console.log('🌱 Running specific seeds (ChartOfAccounts)...');
    await seedChartOfAccounts(prisma);
  } catch (e) {
    console.error('Error running specific seeds:', e);
  }

  console.log('');
  console.log('✅ Database seeding finished.');
}

import { seedChartOfAccounts } from './seeds/chart-of-accounts';

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
