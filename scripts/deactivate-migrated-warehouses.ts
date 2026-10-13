import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';

function decrypt(encryptedText: string, masterKeyString: string): string {
  if (!masterKeyString || masterKeyString.length < 32) {
    throw new Error('MASTER_ENCRYPTION_KEY must be at least 32 characters');
  }
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const parts = encryptedText.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted text format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, Buffer.from(parts[0], 'hex'));
  decipher.setAuthTag(Buffer.from(parts[1], 'hex'));
  let decrypted = decipher.update(parts[2], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function deactivateWarehouses(pool: Pool, tenantLabel: string) {
  console.log(`\n======================================================================`);
  console.log(`🚀 Deactivating Migrated Warehouses (C20001 & C30001) for: ${tenantLabel}`);
  console.log(`======================================================================`);

  const before = await pool.query(`
    SELECT id, code, name, "isActive", "isDeleted" 
    FROM "Warehouse"
    ORDER BY code
  `);
  console.log('Warehouses Before:', before.rows);

  const res = await pool.query(`
    UPDATE "Warehouse"
    SET "isActive" = false, "isDeleted" = true, "deletedAt" = NOW()
    WHERE code IN ('C20001', 'C30001') OR name IN ('PLM', 'Corporate In-Hand')
  `);
  console.log(`✅ Updated ${res.rowCount} warehouses (set isActive = false, isDeleted = true, deletedAt = NOW()).`);

  const after = await pool.query(`
    SELECT id, code, name, "isActive", "isDeleted" 
    FROM "Warehouse"
    ORDER BY code
  `);
  console.log('Warehouses After:', after.rows);

  const activeOnly = await pool.query(`
    SELECT id, code, name, "isActive", "isDeleted" 
    FROM "Warehouse"
    WHERE "isActive" = true AND "isDeleted" = false
    ORDER BY code
  `);
  console.log(`\n🎉 Active Warehouses Remaining (${activeOnly.rows.length}):`);
  for (const w of activeOnly.rows) {
    console.log(`   - [${w.code}] ${w.name}`);
  }
}

async function main() {
  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (managementUrl && masterKey) {
    const mgmtPool = new Pool({ connectionString: managementUrl });
    const mgmtAdapter = new PrismaPg(mgmtPool);
    const management = new ManagementClient({ adapter: mgmtAdapter } as any);

    try {
      const companies = await management.company.findMany({ where: { status: 'active' } });
      console.log(`📡 Connected to Management DB. Found ${companies.length} active company tenant(s).`);

      for (const company of companies) {
        let connectionString = company.dbUrl;

        if (company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch (e: any) {
            console.warn(`⚠️  Decryption failed for tenant ${company.code}: ${e.message}`);
          }
        }

        if (!connectionString) {
          connectionString = `postgresql://${company.dbUser || 'postgres'}:root@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
        }

        const tenantPool = new Pool({ connectionString });
        try {
          await deactivateWarehouses(tenantPool, `${company.name} (${company.dbName})`);
        } catch (err: any) {
          console.error(`❌ Operation failed for tenant ${company.code}: ${err.message}`);
        } finally {
          await tenantPool.end();
        }
      }
    } finally {
      await management.$disconnect();
      await mgmtPool.end();
    }
  } else {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await deactivateWarehouses(pool, 'Direct Database');
    } finally {
      await pool.end();
    }
  }
}

main().catch(console.error);
