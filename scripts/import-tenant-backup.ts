import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { execSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

function decrypt(encryptedText: string, masterKeyString: string): string {
  if (!masterKeyString || masterKeyString.length < 32) {
    throw new Error('MASTER_ENCRYPTION_KEY must be at least 32 characters');
  }
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const algorithm = 'aes-256-gcm';

  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
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

async function restoreTenantBackup() {
  const backupFile = process.argv[2];
  if (!backupFile) {
    console.log(`
Usage:
  bun scripts/import-tenant-backup.ts <path-to-backup-file.sql-or-.dump> [--tenant=spl]

Example:
  bun scripts/import-tenant-backup.ts live_tenant.sql
  bun scripts/import-tenant-backup.ts live_tenant.dump
`);
    process.exit(1);
  }

  const resolvedPath = path.resolve(backupFile);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`❌ Backup file not found at: ${resolvedPath}`);
    process.exit(1);
  }

  const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
  const targetTenantCode = tenantArg ? tenantArg.split('=')[1] : null;

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (!managementUrl || !masterKey) {
    console.error('❌ DATABASE_URL_MANAGEMENT or MASTER_ENCRYPTION_KEY not set in .env');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: managementUrl });
  const adapter = new PrismaPg(pool);
  const management = new ManagementClient({ adapter } as any);

  let targetCompany: any = null;

  try {
    const companies = await management.company.findMany({ where: { status: 'active' } });
    if (companies.length === 0) {
      console.error('❌ No active companies found in master database.');
      process.exit(1);
    }

    if (targetTenantCode) {
      targetCompany = companies.find((c) => c.code.toLowerCase() === targetTenantCode.toLowerCase());
    } else {
      targetCompany = companies[0];
    }

    if (!targetCompany) {
      console.error(`❌ Target company matching '${targetTenantCode}' not found.`);
      process.exit(1);
    }
  } finally {
    await management.$disconnect();
    await pool.end();
  }

  console.log(`\n==================================================`);
  console.log(`📦 RESTORING LIVE TENANT BACKUP`);
  console.log(`==================================================`);
  console.log(`🏢 Target Tenant DB : ${targetCompany.dbName} (${targetCompany.name})`);
  console.log(`📄 Backup File      : ${resolvedPath}`);

  let dbPassword = targetCompany.dbPassword;
  if (dbPassword && masterKey) {
    try {
      dbPassword = decrypt(dbPassword, masterKey);
    } catch (e) {
      console.warn('  ⚠️ Password decryption failed, using default pass');
    }
  }

  const dbUser = targetCompany.dbUser || 'postgres';
  const dbHost = targetCompany.dbHost || 'localhost';
  const dbPort = targetCompany.dbPort || 5432;
  const dbName = targetCompany.dbName;

  const env = {
    ...process.env,
    PGPASSWORD: dbPassword || 'root',
  };

  const isSql = resolvedPath.endsWith('.sql');
  let cmd = '';

  if (isSql) {
    cmd = `psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -f "${resolvedPath}"`;
  } else {
    cmd = `pg_restore -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -v --clean --if-exists "${resolvedPath}"`;
  }

  console.log(`\n⏳ Executing restore command...`);
  console.log(`> ${cmd}\n`);

  try {
    execSync(cmd, {
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
    });
    console.log(`\n==================================================`);
    console.log(`✅ TENANT BACKUP RESTORED SUCCESSFULLY!`);
    console.log(`==================================================`);

    console.log(`\n🔄 Syncing schema to ensure database constraints match...`);
    execSync('bun run prisma:tenant:push', { stdio: 'inherit' });
  } catch (err: any) {
    console.error(`\n❌ Error restoring backup: ${err.message}`);
    process.exit(1);
  }
}

restoreTenantBackup();
