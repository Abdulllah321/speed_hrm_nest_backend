// @ts-nocheck
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Client, Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { getFiscalYearLabel, generateNextFolioNumber } from '../src/common/utils/voucher-number.util';

function extractRsrvNumber(text?: string | null): number | null {
  if (!text) return null;
  const match = text.match(/RS[-_\s]?RV\s*#?\s*:?\s*(\d+)/i);
  if (match && match[1]) {
    const num = parseInt(match[1], 10);
    if (!isNaN(num)) return num;
  }
  return null;
}

async function migrateRsrvVouchers(prisma: PrismaClient, dbName: string, isDryRun: boolean = false) {
  if (isDryRun) {
    console.log(`\n🔍 [DRY RUN MODE] Auditing DB "${dbName}"...`);
  } else {
    console.log(`\n🚀 Migrating RSRV Vouchers for DB "${dbName}"...`);
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

  console.log(`Found ${rsrvVouchers.length} potential RSRV vouchers in DB "${dbName}".`);

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
    console.log(`🔍 [DRY RUN FINISHED] DB "${dbName}": Would update ${updatedCount} out of ${rsrvVouchers.length} vouchers.\n`);
  } else {
    console.log(`✨ Migration completed for DB "${dbName}". Total vouchers updated: ${updatedCount}/${rsrvVouchers.length}\n`);
  }
}

async function main() {
  const isDryRun = process.argv.includes('--dryrun') || process.argv.includes('--dry-run');

  console.log('=====================================================');
  console.log(isDryRun ? '🔍 RUNNING IN DRY-RUN MODE (--dryrun)' : '🚀 RUNNING LIVE MIGRATION MODE');
  console.log(isDryRun ? 'No database records will be modified.' : 'Database records WILL be updated.');
  console.log('=====================================================\n');

  const ports = [5432, 5433];
  let foundAnyDb = false;

  for (const port of ports) {
    // 1. Get all databases on PostgreSQL server via pg Client
    const adminConn = `postgresql://speedlimit:speedlimit123@127.0.0.1:${port}/postgres`;
    const pgClient = new Client({ connectionString: adminConn, connectionTimeoutMillis: 2000 });
    
    let dbNames: string[] = [];
    try {
      await pgClient.connect();
      const res = await pgClient.query("SELECT datname FROM pg_database WHERE datistemplate = false AND datname NOT IN ('postgres', 'template1', 'template0')");
      dbNames = res.rows.map(r => r.datname);
      await pgClient.end();
    } catch {
      try { await pgClient.end(); } catch {}
      // Fallback list of common DB names
      dbNames = ['speedlimit', 'speedlimit_management', 'speedlimit_tenant', 'speed_limit_db'];
    }

    for (const dbName of dbNames) {
      const connectionString = `postgresql://speedlimit:speedlimit123@127.0.0.1:${port}/${dbName}?schema=public`;
      const pool = new Pool({ connectionString, connectionTimeoutMillis: 2000 });

      try {
        // Quick raw SQL check to see if ReceiptVoucher table exists in this DB
        const rawCheckClient = new Client({ connectionString, connectionTimeoutMillis: 2000 });
        await rawCheckClient.connect();
        
        let hasTable = false;
        try {
          const tblRes = await rawCheckClient.query(`SELECT count(*) FROM "ReceiptVoucher"`);
          hasTable = true;
          const totalCount = parseInt(tblRes.rows[0].count, 10);
          console.log(`🎯 Found database "${dbName}" on port ${port} with ${totalCount} ReceiptVoucher records!`);
        } catch {
          hasTable = false;
        } finally {
          await rawCheckClient.end();
        }

        if (hasTable) {
          foundAnyDb = true;
          const adapter = new PrismaPg(pool);
          const prisma = new PrismaClient({ adapter });
          try {
            await prisma.$connect();
            await migrateRsrvVouchers(prisma, dbName, isDryRun);
          } finally {
            await prisma.$disconnect();
          }
        }
      } catch {
        // DB connection error
      } finally {
        try { await pool.end(); } catch {}
      }
    }
  }

  if (!foundAnyDb) {
    console.log('⚠️ Could not find any PostgreSQL database containing the "ReceiptVoucher" table.');
  }
}

main().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});
