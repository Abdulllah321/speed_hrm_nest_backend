// @ts-nocheck
import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';

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

async function fixDraftPRs(prisma: PrismaClient) {
  // Find all DRAFT purchase returns
  const draftReturns = await prisma.purchaseReturn.findMany({
    where: {
      status: 'DRAFT',
    },
    include: {
      supplier: true,
    },
  });

  console.log(`  🔍 Found ${draftReturns.length} DRAFT Purchase Returns.`);

  let updated = 0;
  for (const pr of draftReturns) {
    if (!pr.supplier) {
      console.warn(`  ⚠️ PR ${pr.returnNumber} has no supplier linked. Skipping.`);
      continue;
    }

    const correctGst = pr.supplier.gstNumber || pr.supplier.strnNo || '';
    const cleanGst = (correctGst.trim().toLowerCase() === 'registered') ? '' : correctGst;

    console.log(`  Updating PR ${pr.returnNumber}: Current GST#='${pr.supplierGstNumber}', Correct GST#='${cleanGst}'`);

    await prisma.purchaseReturn.update({
      where: { id: pr.id },
      data: {
        supplierGstNumber: cleanGst,
      },
    });
    updated++;
  }

  console.log(`  ✅ Successfully updated ${updated} DRAFT Purchase Returns.`);
}

async function main() {
  console.log('🚀 Starting DRAFT Purchase Return GST Sync...');

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
    const companies = await management.company.findMany({
      where: { status: 'active' },
    });

    if (companies.length === 0) {
      console.log('ℹ️ No active companies found.');
      return;
    }

    for (const company of companies) {
      console.log(`\n👉 Processing company: ${company.name} (${company.code})`);
      try {
        let connectionString = company.dbUrl;
        if (company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch {
            console.warn(`  ⚠️ Decryption failed, using stored dbUrl`);
          }
        }
        if (!connectionString) { console.error(`  ❌ No connection details`); continue; }

        const tenantPool = new Pool({ connectionString });
        const tenantAdapter = new PrismaPg(tenantPool);
        const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

        try {
          await tenantPrisma.$connect();
          await fixDraftPRs(tenantPrisma);
        } finally {
          await tenantPrisma.$disconnect();
          await tenantPool.end();
        }
      } catch (err: any) {
        console.error(`  ❌ Failed: ${err.message}`);
      }
    }

    console.log('\n✨ All done.');
  } finally {
    await management.$disconnect();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
