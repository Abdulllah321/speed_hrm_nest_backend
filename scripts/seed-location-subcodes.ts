import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';

/**
 * LOCATION SUB-CODE SEEDING
 * ─────────────────────────
 * Updates the `shortCode` (sub code) field on existing Location records.
 * If a location with the given name does not exist, it creates one.
 *
 * Usage:
 *   bun ./scripts/seed-location-subcodes.ts
 *   bun ./scripts/seed-location-subcodes.ts --tenant speed_limit
 */

interface LocationSeed {
  shortCode: string;  // the sub-code name/description
  code: string;       // existing code in Location table — used for lookup
}

// ── Unique location → sub-code pairs parsed from the provided data ──────────
const locations: LocationSeed[] = [
  { shortCode: 'Corporate Office', code: 'C00001' },
  { shortCode: 'C.O.-Sales Administration', code: 'C10002' },
  { shortCode: 'C.O.-Sports Brands', code: 'C10003' },
  { shortCode: 'C.O. C & K/Pedro', code: 'C10005' },
  { shortCode: 'C.O.-Speed Sports Online', code: 'C10004' },
  { shortCode: 'C.O.-PLM', code: 'C20001' },
  { shortCode: 'C.O.-Watches', code: 'C30001' },
  { shortCode: 'WH', code: 'C40001' },
  { shortCode: 'SS-DMC', code: 'SS1002' },
  { shortCode: 'SS-TF', code: 'SS1012' },
  { shortCode: 'SS-LM', code: 'SS1001' },
  { shortCode: 'SS-FA', code: 'SS1004' },
  { shortCode: 'SS-EM', code: 'SS1005' },
  { shortCode: 'SS-DML', code: 'SS1006' },
  { shortCode: 'SS SGM', code: 'SS1007' },
  { shortCode: 'SS WTC', code: 'SS1008' },
  { shortCode: 'SS-MM', code: 'SS1009' },
  { shortCode: 'SS-LG', code: 'SS1010' },
  { shortCode: 'NDC', code: 'N10001' },
  { shortCode: 'NXM', code: 'N10002' },
  { shortCode: 'NPM', code: 'N10003' },
  { shortCode: 'NCM', code: 'N10004' },
  { shortCode: 'NSGM', code: 'N10005' },
  { shortCode: 'Adi LOM', code: 'A10001' },
  { shortCode: 'Adi JI', code: 'A10002' },
  { shortCode: 'Adi MS', code: 'A10003' },
  { shortCode: 'Puma DML', code: 'PU1001' },
  { shortCode: 'C&K DMC', code: 'CK1001' },
  { shortCode: 'C&K LM', code: 'CK1002' },
  { shortCode: 'C&K CM', code: 'CK1006' },
  { shortCode: 'C&K PM', code: 'CK1004' },
  { shortCode: 'C&K DML', code: 'CK1005' },
  { shortCode: 'P DMC', code: 'P10001' },
  { shortCode: 'P PM', code: 'P10002' },
  { shortCode: 'P DML', code: 'P10003' },
  { shortCode: 'DMC BTQ', code: 'W10001' },
  { shortCode: 'IWC LM', code: 'W10006' },
  { shortCode: 'IWC DMTR', code: 'W10007' },
  { shortCode: 'IWC DML', code: 'W10009' },
  { shortCode: 'IWC RWP', code: 'W10010' },
  { shortCode: 'IWC SIALKOT', code: 'W10011' },
  { shortCode: 'EM BTQ', code: 'W10002' },
  { shortCode: 'PM BTQ', code: 'W10003' },
  { shortCode: 'Kingson', code: 'W10008' },
  { shortCode: 'SGM BTQ', code: 'W10004' },
  { shortCode: 'WTC BTQ', code: 'W10005' },
  { shortCode: 'A. S. S.', code: 'C30002' },
];

function decrypt(encryptedText: string, masterKeyString: string): string {
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const parts = encryptedText.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted text format');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(parts[2], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function seedLocationSubcodes(prisma: PrismaClient) {
  let updated = 0, skipped = 0;

  // Clean up duplicate locations created by previous run
  const duplicateCodes = locations.map(loc => loc.shortCode);
  try {
    const deleteResult = await prisma.location.deleteMany({
      where: {
        code: { in: duplicateCodes }
      }
    });
    if (deleteResult.count > 0) {
      console.log(`  🧹 Cleaned up ${deleteResult.count} duplicate locations`);
    }
  } catch (err: any) {
    console.warn(`  ⚠️  Failed to clean up duplicates: ${err.message}`);
  }

  for (const loc of locations) {
    try {
      // Find by code
      const existing = await prisma.location.findUnique({
        where: { code: loc.code },
      });

      if (existing) {
        // Update shortCode on existing location
        await prisma.location.update({
          where: { id: existing.id },
          data: { shortCode: loc.shortCode },
        });
        console.log(`  ✏️  Updated: ${loc.code} (${existing.name}) → shortCode: ${loc.shortCode}`);
        updated++;
      } else {
        console.warn(`  ⚠️  Location not found for code: ${loc.code}, skipping...`);
        skipped++;
      }
    } catch (err: any) {
      console.warn(`  ⚠️  Failed ${loc.code} (${loc.shortCode}): ${err.message}`);
      skipped++;
    }
  }

  console.log(`  ✅ Locations: ${updated} updated, ${skipped} skipped`);
}

async function main() {
  console.log('🚀 Starting Location Sub-Code Seeding...');

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (!managementUrl || !masterKey) {
    console.error('❌ DATABASE_URL_MANAGEMENT and MASTER_ENCRYPTION_KEY required in .env');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: managementUrl });
  const adapter = new PrismaPg(pool);
  const management = new ManagementClient({ adapter } as any);

  try {
    const tenantArgIdx = process.argv.indexOf('--tenant');
    const specificTenant = tenantArgIdx !== -1 ? process.argv[tenantArgIdx + 1] : null;

    const companies = await management.company.findMany({
      where: { status: 'active', ...(specificTenant ? { dbName: specificTenant } : {}) },
    });

    if (companies.length === 0) {
      console.log('ℹ️ No active companies found.');
      return;
    }

    for (const company of companies) {
      console.log(`\n👉 Processing: ${company.name} (${company.code})`);
      try {
        let connectionString = company.dbUrl;
        if (company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch {
            console.warn(`  ⚠️  Decryption failed, using stored dbUrl`);
          }
        }
        if (!connectionString) { console.error(`  ❌ No connection details`); continue; }

        const tenantPool = new Pool({ connectionString });
        const tenantAdapter = new PrismaPg(tenantPool);
        const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

        try {
          await tenantPrisma.$connect();
          await seedLocationSubcodes(tenantPrisma);
        } finally {
          await tenantPrisma.$disconnect();
          await tenantPool.end();
        }
      } catch (err: any) {
        console.error(`  ❌ Failed: ${err.message}`);
      }
    }

    console.log('\n✨ Done.');
  } finally {
    await management.$disconnect();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
