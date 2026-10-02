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

async function main() {
  console.log('🚀 Starting Multi-Tenant Snapshot Seeder...');

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (!managementUrl || !masterKey) {
      console.error('❌ DATABASE_URL_MANAGEMENT or MASTER_ENCRYPTION_KEY not found in .env');
      process.exit(1);
  }

  const mPool = new Pool({ connectionString: managementUrl });
  const adapter = new PrismaPg(mPool);
  const management = new ManagementClient({ adapter } as any);

  try {
      const companies = await management.company.findMany({ where: { status: 'active' } });
      console.log(`📡 Found ${companies.length} active companies. Syncing snapshots...`);

      for (const company of companies) {
          console.log(`\n👉 Processing tenant: ${company.name} (${company.code})`);
          let connectionString = company.dbUrl;

          if (company.dbPassword) {
              try {
                  const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
                  connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
              } catch (e) {
                  console.warn(`   ⚠️  Decryption failed for ${company.code}`);
              }
          }

          if (!connectionString) {
              console.error(`   ❌ No connection details for ${company.code}`);
              continue;
          }

          const tenantPool = new Pool({ connectionString });
          try {
              console.log(`   🛠️  Running raw SQL seed on: ${company.dbName}`);
              await tenantPool.query(`DELETE FROM monthly_stock_snapshots;`);
              await tenantPool.query(`
                  INSERT INTO monthly_stock_snapshots (id, date, item_id, warehouse_id, location_id, closing_qty, unit_cost)
                  SELECT 
                    gen_random_uuid(),
                    '2026-10-01 00:00:00'::timestamp,
                    s.item_id, 
                    s.warehouse_id, 
                    s.location_id, 
                    SUM(s.qty),
                    MAX(s.unit_cost)
                  FROM stock_ledgers s
                  WHERE s.created_at <= '2026-10-01 00:00:00'::timestamp
                  GROUP BY s.item_id, s.warehouse_id, s.location_id
                  HAVING SUM(s.qty) != 0
              `);
              console.log(`   ✅ Success! Snapshots inserted for 1st October.`);
          } catch (err: any) {
              console.error(`   ❌ Failed: ${err.message}`);
          } finally {
              await tenantPool.end();
          }
      }
      console.log('\n✨ All tenants processed.');
  } finally {
      await management.$disconnect();
      await mPool.end();
  }
}

main();
