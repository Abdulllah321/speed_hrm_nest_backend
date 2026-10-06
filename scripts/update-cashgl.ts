import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

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

async function main() {
  const jsonPath = path.join(__dirname, '..', 'data', 'location-cashgl.json');
  const fileContent = fs.readFileSync(jsonPath, 'utf-8');
  const data = JSON.parse(fileContent);

  console.log(`Loaded ${data.length} records from location-cashgl.json`);

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT || process.env.DATABASE_URL;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (!managementUrl) {
    console.error('❌ DATABASE_URL_MANAGEMENT or DATABASE_URL environment variable is missing.');
    process.exit(1);
  }

  const mPool = new Pool({ connectionString: managementUrl });
  const mAdapter = new PrismaPg(mPool);
  const management = new ManagementClient({ adapter: mAdapter as any });

  let companies: any[] = [];
  try {
    companies = await management.company.findMany({
      where: { status: 'active' },
    });
  } catch (err: any) {
    console.warn(`ℹ️ Multi-tenant check skipped or failed (${err.message}). Make sure you are connecting to the core database.`);
  } finally {
    await management.$disconnect();
    await mPool.end();
  }

  if (companies.length === 0) {
    console.log('No active companies found. Exiting.');
    return;
  }

  console.log(`\n🏢 Found ${companies.length} tenant companies. Running cash GL code updates for each...`);

  for (const company of companies) {
    console.log(`\n👉 Processing Tenant: ${company.name} (${company.code})`);
    
    let connectionString = company.dbUrl;
    if (company.dbPassword && masterKey) {
      try {
        const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
        connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
      } catch (e) {
        console.warn(`  ⚠️ Decryption failed, using default connectionUrl`);
      }
    }

    if (!connectionString) {
      console.warn(`  ⚠️ No connection string available for tenant ${company.name}, skipping...`);
      continue;
    }

    const tPool = new Pool({ connectionString });
    const tAdapter = new PrismaPg(tPool);
    const tenantPrisma = new PrismaClient({ adapter: tAdapter as any });

    try {
      await tenantPrisma.$connect();
      let updatedCount = 0;
      let notFoundCount = 0;

      for (const item of data) {
        const locationCode = item['tagId'] ? item['tagId'].trim() : null;
        const glCode = item['GL Code'] ? item['GL Code'].trim() : null;

        if (!locationCode || !glCode) continue;

        try {
          await tenantPrisma.location.update({
            where: { code: locationCode },
            data: { cashGLCode: glCode },
          });
          console.log(`  ✅ Updated location [${locationCode}] with GL Code: ${glCode}`);
          updatedCount++;
        } catch (error: any) {
          if (error.code === 'P2025') {
            // Location not found in this tenant, which is normal for multi-tenant if stores belong to different tenants
            notFoundCount++;
          } else {
            console.error(`  ❌ Error updating location [${locationCode}]:`, error.message);
          }
        }
      }
      console.log(`  --- Summary for ${company.name} ---`);
      console.log(`  Successfully updated: ${updatedCount}`);
      console.log(`  Locations not found: ${notFoundCount}`);
    } catch (e: any) {
      console.error(`  ❌ Failed to process tenant ${company.name}:`, e.message);
    } finally {
      await tenantPrisma.$disconnect();
      await tPool.end();
    }
  }

  console.log(`\n🎉 All tenants processed.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
