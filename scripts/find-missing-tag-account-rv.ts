// @ts-nocheck
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

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

interface MissingTagRow {
  tenantCode?: string;
  tenantName?: string;
  rvId: string;
  rvNo: string;
  rvType: string;
  rvDate: string;
  rvStatus: string;
  debitAccountCode?: string;
  debitAccountName?: string;
  customerName?: string;
  detailId: string;
  lineAccountCode: string;
  lineAccountName: string;
  tagAccountId: string;
  debit: number;
  credit: number;
  narration: string;
  refBillNo: string;
}

async function findMissingTagAccounts(prisma: PrismaClient, tenantCode: string = 'DEFAULT'): Promise<MissingTagRow[]> {
  const vouchers = await prisma.receiptVoucher.findMany({
    where: {
      details: {
        some: {
          OR: [
            { tagAccountId: null },
            { tagAccountId: '' },
          ],
        },
      },
    },
    include: {
      details: {
        where: {
          OR: [
            { tagAccountId: null },
            { tagAccountId: '' },
          ],
        },
        include: {
          account: { select: { code: true, name: true } },
          tagAccount: { select: { code: true, name: true } },
        },
      },
      debitAccount: { select: { code: true, name: true } },
      customer: { select: { name: true } },
    },
    orderBy: { rvDate: 'desc' },
  });

  const exportRows: MissingTagRow[] = [];

  for (const rv of vouchers) {
    const rvDateStr = rv.rvDate ? new Date(rv.rvDate).toISOString().slice(0, 10) : '';

    for (const detail of rv.details) {
      exportRows.push({
        tenantCode,
        rvId: rv.id,
        rvNo: rv.rvNo,
        rvType: rv.type,
        rvDate: rvDateStr,
        rvStatus: rv.status,
        debitAccountCode: rv.debitAccount?.code || '',
        debitAccountName: rv.debitAccount?.name || '',
        customerName: rv.customer?.name || '',
        detailId: detail.id,
        lineAccountCode: detail.account?.code || 'N/A',
        lineAccountName: detail.account?.name || 'N/A',
        tagAccountId: detail.tagAccountId || '(NULL)',
        debit: Number(detail.debit || 0),
        credit: Number(detail.credit || 0),
        narration: detail.narration || '',
        refBillNo: detail.refBillNo || '',
      });
    }
  }

  return exportRows;
}

async function main() {
  console.log('🚀 Starting Receipt Voucher Missing Tag Account Audit Script...\n');

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  const singleDbUrl = process.env.DATABASE_URL;

  let allResults: MissingTagRow[] = [];

  if (managementUrl && masterKey) {
    try {
      // Multi-tenant mode
      const pool = new Pool({ connectionString: managementUrl });
      const adapter = new PrismaPg(pool);
      const management = new ManagementClient({ adapter } as any);

      try {
        const companies = await management.company.findMany({
          where: { status: 'active' },
        });

        console.log(`📡 Found ${companies.length} active tenant companies in Master DB.`);

        for (const company of companies) {
          console.log(`\n👉 Auditing tenant: ${company.name} (${company.code})...`);

          try {
            let connectionString = company.dbUrl;
            if (company.dbPassword) {
              try {
                const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
                connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
              } catch (e) {
                console.warn(`   ⚠️ Decryption failed for ${company.code}, trying stored dbUrl...`);
              }
            }

            if (!connectionString) {
              console.error(`   ❌ No valid connection details for ${company.code}`);
              continue;
            }

            const tenantPool = new Pool({ connectionString });
            const tenantAdapter = new PrismaPg(tenantPool);
            const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

            try {
              await tenantPrisma.$connect();
              const rows = await findMissingTagAccounts(tenantPrisma, company.code);
              console.log(`   📊 Found ${rows.length} detail line(s) missing tag accounts in ${company.code}.`);
              allResults.push(...rows);
            } finally {
              await tenantPrisma.$disconnect();
              await tenantPool.end();
            }
          } catch (err: any) {
            console.error(`   ❌ Error querying tenant ${company.code}: ${err.message}`);
          }
        }
      } finally {
        await management.$disconnect();
        await pool.end();
      }
    } catch (mErr: any) {
      console.warn(`⚠️ Could not connect to Master DB (${mErr.message}).`);
      if (singleDbUrl) {
        console.log('📡 Falling back to Single Database Mode (DATABASE_URL)...');
        try {
          const tenantPool = new Pool({ connectionString: singleDbUrl });
          const tenantAdapter = new PrismaPg(tenantPool);
          const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

          try {
            await tenantPrisma.$connect();
            allResults = await findMissingTagAccounts(tenantPrisma, 'MAIN');
            console.log(`📊 Found ${allResults.length} detail line(s) missing tag accounts.`);
          } finally {
            await tenantPrisma.$disconnect();
            await tenantPool.end();
          }
        } catch (e: any) {
          console.error(`❌ Single database connection failed: ${e.message}`);
        }
      }
    }
  } else if (singleDbUrl) {
    // Single database mode
    console.log('📡 Running in Single Database Mode (using DATABASE_URL)...');
    try {
      const tenantPool = new Pool({ connectionString: singleDbUrl });
      const tenantAdapter = new PrismaPg(tenantPool);
      const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

      try {
        await tenantPrisma.$connect();
        allResults = await findMissingTagAccounts(tenantPrisma, 'MAIN');
        console.log(`📊 Found ${allResults.length} detail line(s) missing tag accounts.`);
      } finally {
        await tenantPrisma.$disconnect();
        await tenantPool.end();
      }
    } catch (e: any) {
      console.error(`❌ Single database connection failed: ${e.message}`);
    }
  } else {
    console.error('❌ Neither DATABASE_URL nor DATABASE_URL_MANAGEMENT found in .env');
    process.exit(1);
  }

  // ── Print Summary & Output Files ──────────────────────────────────────────
  console.log('\n================================================================');
  console.log(`📋 AUDIT RESULTS SUMMARY:`);
  console.log(`   - Total Detail Lines Missing Tag Accounts: ${allResults.length}`);

  const distinctVouchers = new Set(allResults.map(r => r.rvNo));
  console.log(`   - Total Distinct Receipt Vouchers Affected: ${distinctVouchers.size}`);
  console.log('================================================================\n');

  if (allResults.length > 0) {
    console.log('Top 10 Sample Affected Lines:');
    console.table(allResults.slice(0, 10).map(r => ({
      RV_No: r.rvNo,
      Date: r.rvDate,
      Status: r.rvStatus,
      Account_Code: r.lineAccountCode,
      Account_Name: r.lineAccountName,
      Debit: r.debit,
      Credit: r.credit,
    })));

    // Save Excel report
    const workbook = XLSX.utils.book_new();

    // Sheet 1: Summary
    const summaryData = [
      { Metric: 'Audit Timestamp', Value: new Date().toISOString() },
      { Metric: 'Total Affected Lines', Value: allResults.length },
      { Metric: 'Total Affected Vouchers', Value: distinctVouchers.size },
    ];
    const summarySheet = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

    // Sheet 2: Missing Tag Account Details
    const detailsSheet = XLSX.utils.json_to_sheet(allResults);
    XLSX.utils.book_append_sheet(workbook, detailsSheet, 'Missing Tag Lines');

    const excelPath = path.join(process.cwd(), 'missing-tag-account-receipt-vouchers.xlsx');
    XLSX.writeFile(workbook, excelPath);
    console.log(`\n💾 Excel audit report written to: ${excelPath}`);

    // Save JSON report
    const jsonPath = path.join(process.cwd(), 'missing-tag-account-receipt-vouchers.json');
    fs.writeFileSync(jsonPath, JSON.stringify(allResults, null, 2));
    console.log(`💾 JSON data dump written to: ${jsonPath}`);
  } else {
    console.log('🎉 Excellent! No Receipt Vouchers with missing tag accounts found.');
  }

  console.log('\n✨ Audit completed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
