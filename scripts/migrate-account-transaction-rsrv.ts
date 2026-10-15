import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import * as crypto from 'crypto';
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

async function processTenant(tenantName: string, dbUrl: string, isDryRun: boolean) {
  console.log(`\n======================================================`);
  console.log(`🏢 Processing Tenant: ${tenantName}`);
  console.log(`======================================================`);

  const pool = new Pool({ connectionString: dbUrl });
  const client = await pool.connect();

  try {
    const checkRes = await client.query(`
      SELECT COUNT(*)::int as count 
      FROM "AccountTransaction"
      WHERE "sourceType" = 'RECEIPT_VOUCHER' 
        AND ("sourceRef" LIKE 'RSRV%' OR "sourceRef" LIKE 'RS-RV%');
    `);

    const countToUpdate = checkRes.rows[0].count;
    console.log(`Found ${countToUpdate} RSRV transaction lines currently labeled as 'RECEIPT_VOUCHER'.`);

    if (countToUpdate === 0) {
      console.log(`✅ All RSRV transactions are already correctly labeled.`);
      return;
    }

    if (isDryRun) {
      console.log(`🔍 [DRY RUN] Would update ${countToUpdate} rows from 'RECEIPT_VOUCHER' to 'RSRV'.`);
      return;
    }

    await client.query('BEGIN');

    const updateRes = await client.query(`
      UPDATE "AccountTransaction"
      SET "sourceType" = 'RSRV'
      WHERE "sourceType" = 'RECEIPT_VOUCHER' 
        AND ("sourceRef" LIKE 'RSRV%' OR "sourceRef" LIKE 'RS-RV%');
    `);

    const remainingRes = await client.query(`
      SELECT COUNT(*)::int as count 
      FROM "AccountTransaction"
      WHERE "sourceType" = 'RECEIPT_VOUCHER' 
        AND ("sourceRef" LIKE 'RSRV%' OR "sourceRef" LIKE 'RS-RV%');
    `);

    await client.query('COMMIT');

    console.log(`✨ Successfully updated ${updateRes.rowCount} rows to 'RSRV'!`);
    console.log(`   - Remaining legacy lines: ${remainingRes.rows[0].count}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`❌ Error updating tenant ${tenantName}:`, err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('-d');
  console.log(`🚀 RSRV AccountTransaction Migration Tool ${isDryRun ? '[DRY RUN]' : '[LIVE MODE]'}`);

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (managementUrl && masterKey) {
    const mgmtPool = new Pool({ connectionString: managementUrl });
    const mgmtAdapter = new PrismaPg(mgmtPool);
    const management = new ManagementClient({ adapter: mgmtAdapter } as any);

    try {
      const companies = await management.company.findMany({
        where: { status: 'active' },
      });

      console.log(`📡 Found ${companies.length} active tenant companies.`);
      for (const company of companies) {
        let connStr = company.dbUrl;
        if (company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connStr = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch (e) {
            console.warn(`   ⚠️ Decryption fallback for ${company.code}`);
          }
        }
        if (connStr) {
          await processTenant(`${company.name} (${company.code})`, connStr, isDryRun);
        }
      }
    } finally {
      await management.$disconnect();
      await mgmtPool.end();
    }
  } else if (process.env.DATABASE_URL) {
    console.log(`🔗 Running against primary DATABASE_URL...`);
    await processTenant('Primary DB', process.env.DATABASE_URL, isDryRun);
  } else {
    console.error(`❌ Neither DATABASE_URL_MANAGEMENT nor DATABASE_URL is defined.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
