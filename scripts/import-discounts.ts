import { PrismaClient } from '@prisma/client';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

require('dotenv').config();

function decrypt(encryptedText: string, masterKeyString: string): string {
  if (!encryptedText || !masterKeyString || masterKeyString.length < 32) {
    throw new Error('MASTER_ENCRYPTION_KEY must be at least 32 characters');
  }
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const algorithm = 'aes-256-gcm';
  const parts = encryptedText.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted text format');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  const decipher = crypto.createDecipheriv(algorithm, masterKey, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function processTenant(prisma: PrismaClient, rows: { sku: string; discount: number }[]) {
  console.log(`\n  Processing ${rows.length} discount rows...`);
  
  console.log(`  🧹 Wiping all existing item discounts...`);
  try {
    await prisma.item.updateMany({
      data: { discountRate: null },
    });
  } catch (err: any) {
    console.error(`  ❌ Failed to wipe existing discounts:`, err.message);
  }

  let updatedCount = 0;
  let notFoundCount = 0;

  // Process in chunks to avoid overwhelming the database
  const chunkSize = 100;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    
    await Promise.all(
      chunk.map(async (row) => {
        try {
          const item = await prisma.item.findFirst({
            where: { sku: row.sku },
            select: { id: true },
          });

          if (!item) {
            notFoundCount++;
            return;
          }

          await prisma.item.update({
            where: { id: item.id },
            data: { discountRate: row.discount },
          });
          
          updatedCount++;
        } catch (err: any) {
          console.error(`    ❌ Error updating SKU ${row.sku}:`, err.message);
        }
      })
    );
  }

  console.log(`  ✅ Successfully updated discounts for ${updatedCount} items. (Not found: ${notFoundCount})`);
}

async function run() {
  const mdPath = path.join(__dirname, '../data/discount.md');
  if (!fs.existsSync(mdPath)) {
    console.error(`File not found: ${mdPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(mdPath, 'utf-8');
  const lines = content.split('\n');
  
  const parsedRows: { sku: string; discount: number }[] = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    if (trimmed.includes('---')) continue;
    
    const parts = trimmed.split('|').map(p => p.trim());
    if (parts.length < 3) continue;
    
    const sku = parts[1];
    const discountStr = parts[2];
    
    if (sku === 'SKU' || sku === 'sku') continue; // Header row
    if (!sku) continue;
    
    const discount = parseFloat(discountStr) || 0;
    parsedRows.push({ sku, discount });
  }

  console.log(`📦 Loaded ${parsedRows.length} discount entries from discount.md`);

  const explicitDb = process.argv.find(a => a.startsWith('--db='))?.split('=')[1];
  const managementUrl = process.env.DATABASE_URL_MANAGEMENT || process.env.DATABASE_URL;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (!explicitDb && managementUrl && masterKey) {
    const mgmtPool = new Pool({ connectionString: managementUrl });
    const mgmtAdapter = new PrismaPg(mgmtPool);
    const management = new ManagementClient({ adapter: mgmtAdapter } as any);

    let companies: any[] = [];
    try {
      companies = await management.company.findMany({
        where: { status: 'active' },
      });
    } catch (err: any) {
      console.warn(`ℹ️ Multi-tenant check skipped (${err.message}).`);
    } finally {
      await management.$disconnect();
      await mgmtPool.end();
    }

    if (companies.length > 0) {
      console.log(`\n🏢 Found ${companies.length} tenant companies. Running discount import for each...`);
      for (const company of companies) {
        console.log(`\n👉 Processing Tenant: ${company.name} (${company.code})`);
        let connectionString = company.dbUrl;
        if (company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch (e) {
            console.warn(`  ⚠️ Decryption failed for tenant dbPassword`);
          }
        }

        const pool = new Pool({ connectionString });
        const adapter = new PrismaPg(pool);
        const prisma = new PrismaClient({ adapter } as any);

        try {
          await prisma.$connect();
          await processTenant(prisma, parsedRows);
        } catch (err: any) {
          console.error(`  ❌ Failed to connect/process tenant ${company.code}:`, err.message);
        } finally {
          await prisma.$disconnect();
          await pool.end();
        }
      }
      console.log('\n🎉 Finished processing all tenants.');
      return;
    }
  }

  // Fallback to single database
  console.log(`\n⚙️ Running in single database mode...`);
  const pool = explicitDb ? new Pool({ connectionString: explicitDb }) : undefined;
  const adapter = pool ? new PrismaPg(pool) : undefined;
  const prisma = new PrismaClient(adapter ? { adapter } as any : undefined);

  try {
    await prisma.$connect();
    await processTenant(prisma, parsedRows);
    console.log('\n🎉 Import complete.');
  } catch (err: any) {
    console.error('❌ Failed to run import:', err.message);
  } finally {
    await prisma.$disconnect();
    if (pool) await pool.end();
  }
}

run().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
