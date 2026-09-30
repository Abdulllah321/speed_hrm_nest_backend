import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';

function decrypt(encryptedText: string, masterKeyString: string): string {
  if (!encryptedText || !masterKeyString || masterKeyString.length < 32) {
    return '';
  }
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const algorithm = 'aes-256-gcm';

  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    return '';
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

async function runMergeForTenant(tenantPrisma: any, companyName: string) {
  console.log(`[${companyName}] Fetching all MerchantConfigs...`);
  const merchants = await tenantPrisma.merchantConfig.findMany();

  // Group by costCentreTag and merchantCode
  const groups: Record<string, any[]> = {};
  for (const m of merchants) {
    const key = `${m.costCentreTag}_${m.merchantCode}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  }

  const tablesResult = await tenantPrisma.$queryRawUnsafe(`
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE column_name IN ('merchant_config_id', 'merchant_id') 
      AND table_schema = 'public'
      AND table_name != 'pos_merchant_configs';
  `);

  for (const [key, group] of Object.entries(groups)) {
    if (group.length <= 1) continue; // No duplicates

    // Identify the "Real" merchant and the "Duplicates"
    // The real one usually has a numeric tagId (e.g. A10002) OR commissionRate != 0.015
    let realMerchant = group.find((m: any) => /A\d+/.test(m.tagId) || Number(m.commissionRate) !== 0.015);
    
    if (!realMerchant) {
      // If we can't cleanly identify, just pick the first one that has the lowest commission rate, 
      // or just pick the first one.
      realMerchant = group.reduce((prev, current) => 
        (Number(prev.commissionRate) < Number(current.commissionRate)) ? prev : current
      );
    }

    const duplicates = group.filter(m => m.id !== realMerchant.id);

    console.log(`\n[${companyName}] 🔄 Found duplicates for ${key}:`);
    console.log(`   ✅ REAL: ${realMerchant.description} (Tag: ${realMerchant.tagId}, Rate: ${realMerchant.commissionRate})`);
    
    for (const dup of duplicates) {
      console.log(`   🗑️ DUP : ${dup.description} (Tag: ${dup.tagId}, Rate: ${dup.commissionRate})`);

      // 1. Merge MerchantConfigLocation manually due to unique constraints
      const locations = await tenantPrisma.merchantConfigLocation.findMany({ where: { merchantConfigId: dup.id } });
      for (const loc of locations) {
        const existing = await tenantPrisma.merchantConfigLocation.findFirst({
          where: { merchantConfigId: realMerchant.id, locationId: loc.locationId }
        });
        
        if (existing) {
          // Already linked to real merchant, delete duplicate link
          await tenantPrisma.merchantConfigLocation.delete({ where: { id: loc.id } });
        } else {
          // Re-link to real merchant
          await tenantPrisma.merchantConfigLocation.update({
            where: { id: loc.id },
            data: { merchantConfigId: realMerchant.id }
          });
        }
      }

      // 2. Update all other related tables dynamically (SalesOrders, Vouchers, PosSales, etc.)
      for (const { table_name, column_name } of tablesResult) {
        if (table_name === 'pos_merchant_config_locations' || table_name === 'MerchantConfigLocation') continue;
        
        await tenantPrisma.$executeRawUnsafe(`
          UPDATE "${table_name}"
          SET "${column_name}" = $1
          WHERE "${column_name}" = $2
        `, realMerchant.id, dup.id);
      }

      // 3. Delete the duplicate merchant safely
      try {
        await tenantPrisma.merchantConfig.delete({ where: { id: dup.id } });
        console.log(`   ✅ Successfully deleted duplicate ${dup.id}`);
      } catch (e: any) {
        console.error(`   ❌ Could not delete ${dup.id}: ${e.message}`);
        // Fallback: Rename and disable
        await tenantPrisma.merchantConfig.update({
          where: { id: dup.id },
          data: { tagId: 'DUP-' + dup.tagId, isActive: false }
        });
      }
    }
  }
}

async function main() {
  console.log('🚀 Starting Multi-Tenant Merchant Duplicate Merge...');

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT || process.env.DATABASE_URL;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (!managementUrl) {
    console.error('❌ Missing DATABASE_URL / DATABASE_URL_MANAGEMENT');
    return;
  }

  if (managementUrl && masterKey) {
    const pool = new Pool({ connectionString: managementUrl });
    const adapter = new PrismaPg(pool);
    const management = new ManagementClient({ adapter } as any);

    let companies: any[] = [];
    try {
      companies = await management.company.findMany({ where: { status: 'active' } });
    } catch (err: any) {
      console.warn(`ℹ️ Multi-tenant check skipped. Running in single-tenant mode.`);
    } finally {
      await management.$disconnect();
      await pool.end();
    }

    if (companies.length > 0) {
      console.log(`🏢 Found ${companies.length} tenant companies. Running merge for each...`);
      for (const company of companies) {
        let connectionString = company.dbUrl;
        if (company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch (e) {
            console.warn(`  ⚠️ Decryption failed for ${company.name}`);
          }
        }
        if (!connectionString) continue;

        const tenantPool = new Pool({ connectionString });
        const tenantAdapter = new PrismaPg(tenantPool);
        const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });
        try {
          await tenantPrisma.$connect();
          await runMergeForTenant(tenantPrisma, company.name);
        } catch (e) {
           console.error(`❌ Failed to run for tenant ${company.name}: `, e);
        } finally {
          await tenantPrisma.$disconnect();
          await tenantPool.end();
        }
      }
      return;
    }
  }

  // Fallback if not using management database approach
  console.log('🔗 Running on primary DATABASE_URL (single-tenant fallback)...');
  const pool = new Pool({ connectionString: managementUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  try {
    await prisma.$connect();
    await runMergeForTenant(prisma, 'Primary');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch(console.error);
