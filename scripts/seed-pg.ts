import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

function decrypt(encryptedText: string, masterKeyString: string): string {
  if (!masterKeyString || masterKeyString.length < 32) throw new Error('MASTER_ENCRYPTION_KEY must be at least 32 characters');
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const parts = encryptedText.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted text format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, Buffer.from(parts[0], 'hex'));
  decipher.setAuthTag(Buffer.from(parts[1], 'hex'));
  let decrypted = decipher.update(parts[2], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function syncTenantSnapshots(tenantPool: Pool, dbIdentifier: string) {
  console.log(`\n======================================================================`);
  console.log(`🛠️  Syncing monthly_stock_snapshots for: ${dbIdentifier}`);
  console.log(`======================================================================`);

  // 1. Audit records BEFORE deletion
  const beforeCountRes = await tenantPool.query('SELECT COUNT(*) as count FROM monthly_stock_snapshots;');
  const existingCount = parseInt(beforeCountRes.rows[0].count, 10);
  console.log(`📊 Current snapshot records in database: ${existingCount.toLocaleString()}`);

  if (existingCount > 0) {
    const datesRes = await tenantPool.query(`
      SELECT date::text, COUNT(*) as count 
      FROM monthly_stock_snapshots 
      GROUP BY date 
      ORDER BY date DESC;
    `);
    console.log(`📅 Breakdown of existing snapshots to be cleared:`);
    for (const r of datesRes.rows) {
      console.log(`   - Date: ${r.date} -> ${parseInt(r.count, 10).toLocaleString()} records`);
    }
  } else {
    console.log(`ℹ️  Table monthly_stock_snapshots is currently empty.`);
  }

  // 2. Clear old snapshots
  console.log(`\n🧹 Step 1: Wiping previous snapshots (TRUNCATE TABLE monthly_stock_snapshots CASCADE)...`);
  await tenantPool.query('TRUNCATE TABLE monthly_stock_snapshots CASCADE;');

  const verifyEmptyRes = await tenantPool.query('SELECT COUNT(*) as count FROM monthly_stock_snapshots;');
  const remainingCount = parseInt(verifyEmptyRes.rows[0].count, 10);
  console.log(`✅ Table cleared successfully. Verified remaining rows: ${remainingCount}`);

  // 3. Compute and insert new September 30 / October 1 00:00:00 snapshots
  console.log(`\n⏳ Step 2: Computing closing balances from stock_ledgers up to 2026-10-01 00:00:00...`);
  const startTime = Date.now();

  await tenantPool.query(`
    INSERT INTO monthly_stock_snapshots (id, date, item_id, warehouse_id, location_id, closing_qty, unit_cost)
    SELECT 
      gen_random_uuid(),
      '2026-10-01 00:00:00'::timestamp,
      s.item_id, 
      s.warehouse_id, 
      loc.id as location_id, 
      SUM(s.qty),
      COALESCE(
          (SELECT COALESCE(unit_cost, rate) FROM stock_ledgers l2 
           WHERE l2.item_id = s.item_id 
           AND l2.created_at <= '2026-10-01 00:00:00'::timestamp 
           AND (l2.unit_cost > 0 OR l2.rate > 0)
           ORDER BY l2.created_at DESC LIMIT 1), 
           0
      ) as unit_cost
    FROM stock_ledgers s
    LEFT JOIN "Location" loc ON loc.id = s.location_id
    WHERE s.created_at <= '2026-10-01 00:00:00'::timestamp
    GROUP BY s.item_id, s.warehouse_id, loc.id
    HAVING SUM(s.qty) != 0;
  `);

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

  // 4. Audit records AFTER insertion
  const afterCountRes = await tenantPool.query('SELECT COUNT(*) as count FROM monthly_stock_snapshots;');
  const newCount = parseInt(afterCountRes.rows[0].count, 10);
  console.log(`✨ Step 3: Inserted ${newCount.toLocaleString()} fresh snapshot records for 2026-10-01 in ${durationSec}s.`);

  // 5. Sample row preview
  const sampleRes = await tenantPool.query(`
    SELECT m.date::text, m.closing_qty, m.unit_cost, i.sku, i."barCode", w.name as warehouse_name, l.name as location_name
    FROM monthly_stock_snapshots m
    LEFT JOIN "Item" i ON i.id = m.item_id
    LEFT JOIN "Warehouse" w ON w.id = m.warehouse_id
    LEFT JOIN "Location" l ON l.id = m.location_id
    ORDER BY m.closing_qty DESC
    LIMIT 3;
  `);

  if (sampleRes.rows.length > 0) {
    console.log(`\n🔍 Sample snapshot entries:`);
    for (const r of sampleRes.rows) {
      console.log(`   • Item: ${r.sku || r.barCode || 'N/A'} | Closing Qty: ${r.closing_qty} | Unit Cost: PKR ${r.unit_cost || 0} | Warehouse: ${r.warehouse_name || 'N/A'} | Location: ${r.location_name || 'None'}`);
    }
  }
}

async function main() {
  console.log('🚀 Starting Monthly Stock Snapshot Seeder...');

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (managementUrl && masterKey) {
    const mPool = new Pool({ connectionString: managementUrl });
    const adapter = new PrismaPg(mPool);
    const management = new ManagementClient({ adapter } as any);

    try {
      const companies = await management.company.findMany({ where: { status: 'active' } });
      console.log(`📡 Connected to Management DB. Found ${companies.length} active company tenant(s).`);

      for (const company of companies) {
        let connectionString = company.dbUrl;

        if (company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch (e) {
            console.warn(`⚠️  Decryption failed for tenant ${company.code}`);
          }
        }

        if (!connectionString) {
          connectionString = `postgresql://${company.dbUser || 'postgres'}:root@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
        }

        const tenantPool = new Pool({ connectionString });
        try {
          await syncTenantSnapshots(tenantPool, `${company.name} (${company.dbName})`);
        } catch (err: any) {
          console.error(`❌ Failed processing tenant ${company.code}: ${err.message}`);
        } finally {
          await tenantPool.end();
        }
      }
      return;
    } finally {
      await management.$disconnect();
      await mPool.end();
    }
  }

  // Fallback if DATABASE_URL_MANAGEMENT is not provided
  const directDbUrl = process.env.DATABASE_URL;
  if (directDbUrl) {
    console.log(`📡 Operating directly on DATABASE_URL tenant...`);
    const directPool = new Pool({ connectionString: directDbUrl });
    try {
      await syncTenantSnapshots(directPool, 'Direct DATABASE_URL');
    } finally {
      await directPool.end();
    }
    return;
  }

  console.error('❌ Neither DATABASE_URL_MANAGEMENT + MASTER_ENCRYPTION_KEY nor DATABASE_URL found in environment.');
  process.exit(1);
}

main().catch((err) => {
  console.error('❌ Fatal seeder error:', err);
  process.exit(1);
});
