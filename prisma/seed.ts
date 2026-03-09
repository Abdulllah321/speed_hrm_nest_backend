// @ts-nocheck
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import * as crypto from 'crypto';
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


/**
 * Create database if it doesn't exist
 */
async function createDatabase(dbName: string) {
  const baseUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_MANAGEMENT!;
  const config = parseUrl(baseUrl);

  if (!config) {
    console.error('❌ Could not parse connection string for database creation');
    return;
  }

  // Connect to 'postgres' maintenance database
  const maintenancePool = new Pool({
    user: config.username,
    password: config.password,
    host: config.host,
    port: parseInt(config.port),
    database: 'postgres',
  });

  try {
    // Check if DB exists
    const checkRes = await maintenancePool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [dbName]
    );

    if (checkRes.rowCount === 0) {
      console.log(`✨ Creating database '${dbName}'...`);
      await maintenancePool.query(`CREATE DATABASE "${dbName}"`);
      console.log(`   ✅ Database '${dbName}' created.`);
    } else {
      // console.log(`   ℹ️  Database '${dbName}' already exists.`);
    }
  } catch (e: any) {
    console.warn(`   ⚠️  Error checking/creating database '${dbName}': ${e.message}`);
  } finally {
    await maintenancePool.end();
  }
}

/**
 * Push schema to tenant database
 */
async function pushTenantSchema(connectionString: string) {
  try {
    console.log('   ↳ Pushing schema to tenant database...');
    // We rely on the prisma/schema path for tenants.
    // Env variable override for just this command
    const env = { ...process.env, DATABASE_URL: connectionString };

    // Using --skip-generate to speed it up, assuming client is already generated
    execSync('bunx prisma db push --schema prisma/schema --accept-data-loss --config prisma.config.ts', {
      env,
      stdio: 'ignore' // Hide output to reduce noise, or 'pipe' if we want to log errors
    });
    console.log('   ✅ Schema pushed successfully.');
  } catch (e: any) {
    console.error(`   ❌ Schema push failed: ${e.message}`);
  }
}

/**
 * Decrypt password using AES-256-GCM
 * (Logic copied from EncryptionService)
 */
function decrypt(encryptedText: string, masterKeyString: string): string {
  if (!masterKeyString || masterKeyString.length < 32) {
    throw new Error('MASTER_ENCRYPTION_KEY must be at least 32 characters');
  }
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const algorithm = 'aes-256-gcm';

  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format: ' + encryptedText);
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(algorithm, masterKey, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
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
  console.log('RUN_BACKUP_RESTORE =', process.env.RUN_BACKUP_RESTORE);

  if (String(process.env.RUN_BACKUP_RESTORE).toLowerCase() === 'true') {
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
          // Ensure master DB exists (though usually it does if we are running seed)
          // const masterConfig = parseUrl(process.env.DATABASE_URL_MANAGEMENT);
          // if (masterConfig) await createDatabase(masterConfig.database);

          await restoreDatabase(process.env.DATABASE_URL_MANAGEMENT, masterFile);
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
    console.log('no data restored from backup')
  }


  console.log('');
  console.log('✅ Database seeding finished.');
}



main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
