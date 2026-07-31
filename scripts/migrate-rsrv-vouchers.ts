// @ts-nocheck
import 'dotenv/config';
import { PrismaService } from '../src/database/prisma.service';
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

/**
 * Robustly extracts RSRV numbers from text.
 * Handles formats like:
 * - RSRV 522
 * - RSRV # 965
 * - RSRV#522
 * - RSRV NO. 522
 * - RSRV NUM 522
 * - RS-RV 522 / RS_RV 522
 * - RSRV-522 / RSRV:522 / RSRV.522
 */
function extractRsrvNumber(text?: string | null): number | null {
  if (!text) return null;
  // Match RSRV sequence numbers (1 to 4 digits) to avoid false matches on long invoice/phone numbers
  const match = text.match(/(?:RS[-_\.\s]?RV|RSRV)\s*(?:NO\.?|NUM\.?|NUMBER|#|:|-|\.)?\s*(\d{1,4})\b/i);
  if (match && match[1]) {
    const num = parseInt(match[1], 10);
    if (!isNaN(num) && num > 0 && num <= 1000) return num;
  }
  return null;
}

function analyzeRsrvGaps(extractedNumbers: number[]): { min: number; max: number; missing: number[] } | null {
  if (extractedNumbers.length === 0) return null;
  const sorted = Array.from(new Set(extractedNumbers)).sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  
  const missing: number[] = [];
  const presentSet = new Set(sorted);
  for (let n = min; n <= max; n++) {
    if (!presentSet.has(n)) {
      missing.push(n);
    }
  }
  return { min, max, missing };
}

async function migrateRsrvVouchers(prisma: any, dbName: string, isDryRun: boolean = false) {
  if (isDryRun) {
    console.log(`\n🔍 [DRY RUN MODE] Auditing DB "${dbName}"...`);
  } else {
    console.log(`\n🚀 Migrating RSRV Vouchers for DB "${dbName}"...`);
  }

  // Find candidate vouchers (checking description, remarks, refBillNo, and detail narrations)
  const rsrvVouchers = await prisma.receiptVoucher.findMany({
    where: {
      OR: [
        { type: 'rs_rv' },
        { rvNo: { startsWith: 'RS-RV-' } },
        { rvNo: { startsWith: 'RSRV-' } },
        { description: { contains: 'RSRV', mode: 'insensitive' } },
        { description: { contains: 'RS-RV', mode: 'insensitive' } },
        { remarks: { contains: 'RSRV', mode: 'insensitive' } },
        { remarks: { contains: 'RS-RV', mode: 'insensitive' } },
        { details: { some: { narration: { contains: 'RSRV', mode: 'insensitive' } } } },
        { details: { some: { narration: { contains: 'RS-RV', mode: 'insensitive' } } } },
      ],
    },
    include: {
      details: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Auditing ${rsrvVouchers.length} candidate vouchers in DB "${dbName}"...\n`);

  let updatedCount = 0;
  let skippedCount = 0;
  const extractedNumbers: number[] = [];

  for (const rv of rsrvVouchers) {
    const fyLabel = getFiscalYearLabel(rv.rvDate || rv.createdAt);
    
    // Combine text fields including line detail narrations to extract RSRV number e.g. "RSRV 522"
    const lineNarrations = rv.details?.map((d: any) => d.narration).filter(Boolean).join(' ') || '';
    const combinedText = `${rv.remarks || ''} ${rv.description || ''} ${rv.rvNo || ''} ${rv.refBillNo || ''} ${lineNarrations}`;
    
    const extractedNum = extractRsrvNumber(combinedText);
    
    if (extractedNum !== null) {
      extractedNumbers.push(extractedNum);
    }

    const isExplicitManualRsrv = extractedNum !== null;
    const isAlreadyRsrvFormat = rv.rvNo.startsWith('RS-RV-') || rv.rvNo.startsWith('RSRV-') || rv.type === 'rs_rv';

    // STRICT SAFETY FILTER:
    // Only migrate if there is an explicit "RSRV 522" or "RSRV # 965" typed in remarks/description/narration
    // or if the voucher was already created as RS-RV / RSRV.
    if (!isExplicitManualRsrv && !isAlreadyRsrvFormat) {
      skippedCount++;
      continue;
    }

    let newRvNo = rv.rvNo;
    if (extractedNum !== null) {
      newRvNo = `RSRV-${fyLabel}-${extractedNum.toString().padStart(5, '0')}`;
    } else if (rv.rvNo.startsWith('RS-RV-')) {
      const suffix = rv.rvNo.replace('RS-RV-', '');
      newRvNo = `RSRV-${fyLabel}-${suffix}`;
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
        console.log(`   Extracted RSRV #: ${extractedNum ?? 'N/A'} | Proposed Folio: "${folio}"`);
        console.log(`   Remarks/Description: "${rv.remarks || rv.description || lineNarrations || ''}"\n`);
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
          console.log(`   Extracted RSRV #: ${extractedNum ?? 'N/A'} | Folio: "${folio}"`);
          console.log(`   Remarks: "${rv.remarks || rv.description || lineNarrations || ''}"\n`);
        } catch (err: any) {
          console.error(`❌ Failed to update voucher ${rv.id} (${rv.rvNo}):`, err.message);
        }
      }
    }
  }

  // Print Gap Audit Summary
  const gapReport = analyzeRsrvGaps(extractedNumbers);
  if (gapReport) {
    console.log(`=====================================================`);
    console.log(`📊 RSRV SEQUENCE & GAP AUDIT REPORT ("${dbName}"):`);
    console.log(`   Detected RSRV Range   : RSRV # ${gapReport.min}  --->  RSRV # ${gapReport.max}`);
    console.log(`   Explicit RSRV Vouchers: ${extractedNumbers.length} found`);
    
    if (gapReport.missing.length > 0) {
      console.log(`\n⚠️  MISSING / SKIPPED IN SEQUENCE (${gapReport.missing.length} missing in range 1..${gapReport.max}):`);
      const formattedMissing = gapReport.missing.map(n => `RSRV # ${n}`).join(', ');
      console.log(`   ${formattedMissing}`);
    } else {
      console.log(`\n✅  SEQUENCE COMPLETE: Zero missing numbers between RSRV #${gapReport.min} and #${gapReport.max}!`);
    }
    console.log(`=====================================================\n`);
  }

  if (isDryRun) {
    console.log(`🔍 [DRY RUN FINISHED] DB "${dbName}":`);
    console.log(`   Matched & Would Migrate: ${updatedCount} voucher(s) (with explicit RSRV numbers)`);
    console.log(`   Skipped (autogenerated/standard): ${skippedCount} voucher(s)\n`);
  } else {
    console.log(`✨ Migration completed for DB "${dbName}". Total vouchers migrated: ${updatedCount}/${rsrvVouchers.length} (Skipped ${skippedCount})\n`);
  }
}

async function main() {
  const isDryRun = process.argv.includes('--dryrun') || process.argv.includes('--dry-run');

  console.log('=====================================================');
  console.log(isDryRun ? '🔍 RUNNING IN DRY-RUN MODE (--dryrun)' : '🚀 RUNNING LIVE MIGRATION MODE');
  console.log(isDryRun ? 'No database records will be modified.' : 'Database records WILL be updated.');
  console.log('=====================================================\n');

  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  const managementUrl = (process.env.DATABASE_URL_MANAGEMENT || '').replace('localhost', '127.0.0.1').replace(':5433', ':5432');

  if (managementUrl && masterKey) {
    try {
      const pool = new Pool({ connectionString: managementUrl });
      const adapter = new PrismaPg(pool);
      const management = new ManagementClient({ adapter } as any);

      const companies = await management.company.findMany({
        where: { status: 'active' },
      });

      console.log(`📡 Found ${companies.length} active tenant companies in Master DB.`);

      for (const company of companies) {
        let tenantUrl = company.dbUrl;
        if (company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            tenantUrl = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || '127.0.0.1'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch {}
        }

        if (!tenantUrl) continue;
        tenantUrl = tenantUrl.replace('localhost', '127.0.0.1').replace(':5433', ':5432');

        console.log(`\n👉 Connecting to tenant: ${company.name} (${company.code})...`);
        const prisma = new PrismaService({ tenantDbUrl: tenantUrl });

        try {
          await migrateRsrvVouchers(prisma, company.code, isDryRun);
        } catch (err: any) {
          console.error(`❌ Migration error for ${company.code}: ${err.message}`);
        } finally {
          await prisma.$disconnect();
        }
      }

      await management.$disconnect();
      await pool.end();
      return;
    } catch (mErr: any) {
      console.warn(`⚠️ Management DB connect skipped/failed (${mErr.message}).`);
    }
  }

  // Fallback to DATABASE_URL in .env
  const singleDbUrl = (process.env.DATABASE_URL || '').replace('localhost', '127.0.0.1').replace(':5433', ':5432');
  if (singleDbUrl) {
    console.log(`\n📡 Connecting to single DB using DATABASE_URL...`);
    const prisma = new PrismaService({ tenantDbUrl: singleDbUrl });
    try {
      await migrateRsrvVouchers(prisma, 'SINGLE_DB', isDryRun);
    } finally {
      await prisma.$disconnect();
    }
  }
}

main().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});
