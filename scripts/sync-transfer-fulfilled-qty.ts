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
    // 1. Inspect mismatches before
    const summaryBefore = await client.query(`
      SELECT 
        tr.status,
        COUNT(DISTINCT tr.id)::int AS "distinctRequests",
        COUNT(tri.id)::int AS "mismatchedItems",
        SUM(tri.quantity)::numeric AS "totalSentQty",
        SUM(tri."fulfilledQty")::numeric AS "totalFulfilledQty"
      FROM "TransferRequestItem" tri
      JOIN "TransferRequest" tr ON tri."transferRequestId" = tr.id
      WHERE tr.status IN ('COMPLETED', 'APPROVED')
        AND tri.quantity != tri."fulfilledQty"
      GROUP BY tr.status
    `);

    if (summaryBefore.rows.length === 0) {
      console.log(`✅ No mismatched TransferRequestItems found for COMPLETED/APPROVED requests.`);
      return;
    }

    console.log(`⚠️ Found mismatched items before sync:`);
    for (const row of summaryBefore.rows) {
      console.log(
        `   - Status: ${row.status} | Requests: ${row.distinctRequests} | Items: ${row.mismatchedItems} | Sent Qty: ${row.totalSentQty} | Fulfilled Qty: ${row.totalFulfilledQty}`
      );
    }

    if (isDryRun) {
      console.log(`\n🔍 [DRY RUN] Would update ${summaryBefore.rows.reduce((acc, r) => acc + Number(r.mismatchedItems), 0)} items.`);
      console.log(`   Run without --dry-run to commit changes.`);
      return;
    }

    // 2. Perform transactional update
    await client.query('BEGIN');

    const updateRes = await client.query(`
      UPDATE "TransferRequestItem" tri
      SET "fulfilledQty" = tri.quantity
      FROM "TransferRequest" tr
      WHERE tri."transferRequestId" = tr.id
        AND tr.status IN ('COMPLETED', 'APPROVED')
        AND tri.quantity != tri."fulfilledQty";
    `);

    const remainingRes = await client.query(`
      SELECT COUNT(*)::int AS remaining
      FROM "TransferRequestItem" tri
      JOIN "TransferRequest" tr ON tri."transferRequestId" = tr.id
      WHERE tr.status IN ('COMPLETED', 'APPROVED')
        AND tri.quantity != tri."fulfilledQty";
    `);

    await client.query('COMMIT');

    console.log(`\n✨ Successfully updated ${updateRes.rowCount} TransferRequestItems!`);
    console.log(`   - Remaining mismatches: ${remainingRes.rows[0].remaining}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`❌ Error processing tenant ${tenantName}:`, error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('-d');
  console.log(`🚀 Transfer Request Fulfilled Qty Sync Tool ${isDryRun ? '[DRY RUN]' : '[LIVE MODE]'}`);

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
