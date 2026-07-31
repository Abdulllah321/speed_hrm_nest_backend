// @ts-nocheck
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';
import { getFiscalYearLabel, generateNextFolioNumber } from '../src/common/utils/voucher-number.util';

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

function extractRsrvNumber(text?: string | null): number | null {
  if (!text) return null;
  const match = text.match(/RS[-_\s]?RV\s*#?\s*:?\s*(\d+)/i);
  if (match && match[1]) {
    const num = parseInt(match[1], 10);
    if (!isNaN(num)) return num;
  }
  return null;
}

async function migrateRsrvVouchers(prisma: PrismaClient, tenantCode: string = 'MAIN', isDryRun: boolean = false) {
  if (isDryRun) {
    console.log(`🔍 [DRY RUN MODE] Auditing RSRV candidates for ${tenantCode} (no DB changes will be saved)...`);
  } else {
    console.log(`🚀 Starting Smart RSRV Voucher Migration for ${tenantCode}...`);
  }

  const rsrvVouchers = await prisma.receiptVoucher.findMany({
    where: {
      OR: [
        { type: 'rs_rv' },
        { rvNo: { startsWith: 'RS-RV-' } },
        { rvNo: { startsWith: 'RSRV-' } },
        { description: { contains: 'RSRV', mode: 'insensitive' } },
        { description: { contains: 'RS-RV', mode: 'insensitive' } },
        { description: { contains: 'POS Reconciliation', mode: 'insensitive' } },
        { remarks: { contains: 'RSRV', mode: 'insensitive' } },
        { remarks: { contains: 'RS-RV', mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${rsrvVouchers.length} potential RSRV vouchers in ${tenantCode}.\n`);

  let updatedCount = 0;

  for (const rv of rsrvVouchers) {
    const fyLabel = getFiscalYearLabel(rv.rvDate || rv.createdAt);
    
    // Check if remarks, description, or rvNo contains explicit RSRV number e.g. "RSRV # 963"
    const extractedNum = extractRsrvNumber(rv.remarks) || extractRsrvNumber(rv.description) || extractRsrvNumber(rv.rvNo);
    
    let newRvNo = rv.rvNo;
    if (extractedNum !== null) {
      newRvNo = `RSRV-${fyLabel}-${extractedNum.toString().padStart(5, '0')}`;
    } else if (rv.rvNo.startsWith('RS-RV-')) {
      const suffix = rv.rvNo.replace('RS-RV-', '');
      newRvNo = `RSRV-${fyLabel}-${suffix}`;
    } else if (!rv.rvNo.startsWith('RSRV-')) {
      newRvNo = `RSRV-${fyLabel}-${rv.id.slice(-5).toUpperCase()}`;
    }

    let folio = rv.folio;
    if (!folio) {
      folio = await generateNextFolioNumber(prisma, rv.rvDate || rv.createdAt);
    }

    const needsTypeUpdate = rv.type !== 'rs_rv';
    const needsRvNoUpdate = newRvNo !== rv.rvNo;
    const needsFolioUpdate = folio !== rv.folio;

    if (needsTypeUpdate || needsRvNoUpdate || needsFolioUpdate) {
      updatedCount++;
      if (isDryRun) {
        console.log(`🔍 [DRY RUN] Would Migrate Voucher [ID: ${rv.id}]:`);
        console.log(`   Original rvNo: "${rv.rvNo}" -> Proposed RSRV No: "${newRvNo}"`);
        console.log(`   Extracted Number: ${extractedNum ?? 'None'} | Proposed Folio: "${folio}"`);
        console.log(`   Remarks/Description: "${rv.remarks || rv.description || ''}"\n`);
      } else {
        try {
          await prisma.receiptVoucher.update({
            where: { id: rv.id },
            data: {
              type: 'rs_rv',
              rvNo: newRvNo,
              folio: folio,
            },
          });
          console.log(`✅ Migrated Voucher [ID: ${rv.id}]:`);
          console.log(`   Original rvNo: "${rv.rvNo}" -> New RSRV No: "${newRvNo}"`);
          console.log(`   Extracted Number: ${extractedNum ?? 'None'} | Folio: "${folio}"`);
          console.log(`   Remarks: "${rv.remarks || rv.description || ''}"\n`);
        } catch (err: any) {
          console.error(`❌ Failed to update voucher ${rv.id} (${rv.rvNo}):`, err.message);
        }
      }
    }
  }

  if (isDryRun) {
    console.log(`🔍 [DRY RUN FINISHED] Would update ${updatedCount} out of ${rsrvVouchers.length} vouchers.\n`);
  } else {
    console.log(`✨ Migration completed for ${tenantCode}. Total vouchers updated: ${updatedCount}/${rsrvVouchers.length}\n`);
  }
}

async function main() {
  const isDryRun = process.argv.includes('--dryrun') || process.argv.includes('--dry-run');

  if (isDryRun) {
    console.log('=====================================================');
    console.log('🔍 RUNNING IN DRY-RUN MODE (--dryrun)');
    console.log('No database records will be modified or saved.');
    console.log('=====================================================\n');
  }

  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  let managementUrl = process.env.DATABASE_URL_MANAGEMENT || process.env.DATABASE_URL;

  if (!managementUrl) {
    console.error('No DATABASE_URL or DATABASE_URL_MANAGEMENT set in environment.');
    process.exit(1);
  }

  managementUrl = managementUrl.replace('localhost', '127.0.0.1').replace(':5433', ':5432');

  if (masterKey) {
    try {
      const pool = new Pool({ connectionString: managementUrl });
      const adapter = new PrismaPg(pool);
      const management = new ManagementClient({ adapter } as any);

      const companies = await management.company.findMany({
        where: { status: 'active' },
      });

      console.log(`📡 Found ${companies.length} active tenant companies in Master DB.`);

      for (const company of companies) {
        console.log(`\n👉 Processing tenant: ${company.name} (${company.code})...`);
        try {
          let connectionString = company.dbUrl;
          if (company.dbPassword) {
            try {
              const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
              connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || '127.0.0.1'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
            } catch (e) {
              console.warn(`   ⚠️ Decryption failed for ${company.code}, using dbUrl...`);
            }
          }
          if (!connectionString) continue;
          connectionString = connectionString.replace('localhost', '127.0.0.1').replace(':5433', ':5432');

          const tenantPool = new Pool({ connectionString });
          const tenantAdapter = new PrismaPg(tenantPool);
          const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

          try {
            await tenantPrisma.$connect();
            await migrateRsrvVouchers(tenantPrisma, company.code, isDryRun);
          } finally {
            await tenantPrisma.$disconnect();
            await tenantPool.end();
          }
        } catch (err: any) {
          console.error(`   ❌ Error for tenant ${company.code}: ${err.message}`);
        }
      }

      await management.$disconnect();
      await pool.end();
      return;
    } catch (mErr: any) {
      console.warn(`⚠️ Multi-tenant connect error (${mErr.message}).`);
    }
  }

  // Single DB Fallback
  console.log('📡 Running Single Database Migration...');
  const connStr = (process.env.DATABASE_URL || 'postgresql://speedlimit:speedlimit123@127.0.0.1:5432/speedlimit')
    .replace('localhost', '127.0.0.1').replace(':5433', ':5432');
  const tenantPool = new Pool({ connectionString: connStr });
  const tenantAdapter = new PrismaPg(tenantPool);
  const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

  try {
    await tenantPrisma.$connect();
    await migrateRsrvVouchers(tenantPrisma, 'SINGLE_DB', isDryRun);
  } finally {
    await tenantPrisma.$disconnect();
    await tenantPool.end();
  }
}

main().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});
