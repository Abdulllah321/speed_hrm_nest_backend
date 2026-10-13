import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import * as crypto from 'crypto';

/**
 * Decrypts AES-256-GCM encrypted database password for tenant connection.
 */
function decrypt(encryptedText: string, masterKeyString: string): string {
  if (!encryptedText) return '';
  if (!masterKeyString || masterKeyString.length < 32) {
    throw new Error('MASTER_ENCRYPTION_KEY must be at least 32 characters');
  }
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

function cleanLocCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function parseFlexibleDate(val: any): Date | null {
  if (val === undefined || val === null || val === '') return null;
  const str = String(val).trim();
  if (!str || str === 'null' || str === '-' || str === '0') return null;

  if (str.includes('/')) {
    const [datePart, timePart] = str.split(/\s+/);
    const parts = datePart.split('/').map(Number);
    if (parts.length === 3) {
      let [m, d, y] = parts; // US Format: M/D/YY or M/D/YYYY
      const year = y < 100 ? 2000 + y : y;
      let hh = 0, mm = 0, ss = 0;
      if (timePart) {
        const tParts = timePart.split(':').map(Number);
        hh = tParts[0] || 0;
        mm = tParts[1] || 0;
        ss = tParts[2] || 0;
      }
      const parsed = new Date(Date.UTC(year, m - 1, d, hh, mm, ss));
      if (!isNaN(parsed.getTime())) return parsed;
    }
  }

  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function getFiscalYearSuffix(d: Date): string {
  const month = d.getUTCMonth(); // 0-indexed: 6 = July
  const year = d.getUTCFullYear();
  const fyEndingYear = month >= 6 ? year + 1 : year;
  return String(fyEndingYear).slice(-2);
}

function formatDate(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

interface PreparedVoucher {
  voucher: {
    id: string;
    code: string;
    voucherType: 'EXCHANGE' | 'CREDIT' | 'CLAIM';
    faceValue: Prisma.Decimal;
    discount: Prisma.Decimal;
    description: string;
    issuedByLocationId: string;
    sourceOrderId: string | null;
    customerId: string | null;
    isActive: boolean;
    isRedeemed: boolean;
    expiresAt: Date | null;
    createdAt: Date;
  };
  location: {
    id: string;
    voucherId: string;
    locationId: string;
  };
  transaction: {
    id: string;
    voucherId: string;
    locationId: string;
    action: string;
    amountUsed: Prisma.Decimal;
    notes: string;
    createdAt: Date;
  };
}

async function processTenant(
  prisma: PrismaClient,
  companyName: string,
  isDryRun: boolean,
) {
  console.log(`\n======================================================`);
  console.log(`🏢 Processing Tenant: [${companyName}]`);
  console.log(`======================================================`);

  // 1. Load Locations
  const locations = await prisma.location.findMany({
    where: { isDeleted: false },
    select: { id: true, name: true, code: true, shortCode: true },
  });
  console.log(`📍 Found ${locations.length} active locations in DB.`);
  const locMap = new Map<string, typeof locations[0]>();
  for (const l of locations) {
    if (l.code) locMap.set(l.code.toUpperCase(), l);
    if (l.shortCode) locMap.set(cleanLocCode(l.shortCode), l);
  }

  // 2. Pre-load existing voucher codes to guarantee 0 duplicates
  const existingVouchers = await prisma.voucher.findMany({
    select: { id: true, code: true, voucherType: true, faceValue: true },
  });
  const existingCodeMap = new Map<string, typeof existingVouchers[0]>();
  for (const v of existingVouchers) {
    existingCodeMap.set(v.code.toUpperCase(), v);
  }
  console.log(`🔒 Loaded ${existingCodeMap.size.toLocaleString()} existing voucher codes in DB.`);

  const generatedCodesInRun = new Set<string>();
  const allPrepared: PreparedVoucher[] = [];

  // ─────────────────────────────────────────────────────────────
  // 3. Process EXCHANGE VOUCHERS (outstanding-exchange-voucher.md)
  // ─────────────────────────────────────────────────────────────
  console.log(`\n------------------------------------------------------`);
  console.log(`📑 1/3 Parsing: outstanding-exchange-voucher.md`);
  console.log(`------------------------------------------------------`);
  const excPath = path.join(__dirname, '../data/outstanding-exchange-voucher.md');
  if (!fs.existsSync(excPath)) {
    throw new Error(`File not found: ${excPath}`);
  }

  const excLines = fs
    .readFileSync(excPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim().startsWith('|') && !l.includes('---') && !l.includes('CostCentre'));

  // Group by (locCode, docNo) to sum lines for multi-item return memos
  const excGroups = new Map<string, any[]>();
  for (const line of excLines) {
    const cols = line.split('|').map((c) => c.trim());
    if (cols.length > 1 && cols[0] === '') cols.shift();
    if (cols.length > 0 && cols[cols.length - 1] === '') cols.pop();
    if (cols.length < 9) continue;

    const [costCentre, locCode, docNo, docDateStr, saleInv, saleDateStr, excInv, excDateStr, totalNetStr, remarks] = cols;
    const key = `${locCode.toUpperCase()}::${docNo}`;
    const list = excGroups.get(key) || [];
    list.push({
      costCentre,
      locCode,
      docNo,
      docDateStr,
      saleInv: saleInv ? String(saleInv).trim() : null,
      totalNet: parseFloat(totalNetStr) || 0,
      remarks: remarks ? String(remarks).trim() : '',
    });
    excGroups.set(key, list);
  }

  let excNewCount = 0;
  let excSkippedCount = 0;
  let excTotalVal = 0;

  for (const [key, rows] of excGroups.entries()) {
    const sample = rows[0];
    const loc = locMap.get(sample.locCode.toUpperCase());
    if (!loc) {
      console.warn(`⚠️ Location not found for Exchange code: ${sample.locCode}`);
      continue;
    }

    const shortCode = loc.shortCode ? cleanLocCode(loc.shortCode) : cleanLocCode(loc.code);
    const date = parseFlexibleDate(sample.docDateStr) || new Date('2025-07-01');
    const fySuffix = getFiscalYearSuffix(date);
    const padDoc = String(sample.docNo).padStart(5, '0');
    const code = `EXC-${shortCode}${fySuffix}-${padDoc}`;
    const totalNet = Math.round(rows.reduce((sum, r) => sum + r.totalNet, 0) * 100) / 100;

    // Deduplication check
    if (existingCodeMap.has(code.toUpperCase()) || generatedCodesInRun.has(code.toUpperCase())) {
      excSkippedCount++;
      continue;
    }

    generatedCodesInRun.add(code.toUpperCase());
    excNewCount++;
    excTotalVal += totalNet;

    const combinedRemarks = rows.map((r) => r.remarks).filter(Boolean).join(' | ');
    const description = [
      `EXCHANGE Voucher Doc #${sample.docNo}`,
      sample.saleInv ? `(Sale #${sample.saleInv})` : '',
      combinedRemarks ? `- ${combinedRemarks}` : '',
    ]
      .filter(Boolean)
      .join(' ');

    const voucherId = crypto.randomUUID();
    allPrepared.push({
      voucher: {
        id: voucherId,
        code,
        voucherType: 'EXCHANGE',
        faceValue: new Prisma.Decimal(totalNet),
        discount: new Prisma.Decimal(0),
        description,
        issuedByLocationId: loc.id,
        sourceOrderId: null,
        customerId: null,
        isActive: true,
        isRedeemed: false,
        expiresAt: null,
        createdAt: date,
      },
      location: {
        id: crypto.randomUUID(),
        voucherId,
        locationId: loc.id,
      },
      transaction: {
        id: crypto.randomUUID(),
        voucherId,
        locationId: loc.id,
        action: 'ISSUED',
        amountUsed: new Prisma.Decimal(0),
        notes: `Exchange Voucher #${sample.docNo} issued at ${loc.name} (PKR ${totalNet.toLocaleString()})`,
        createdAt: date,
      },
    });
  }

  console.log(`   - Total Exchange Memos in File: ${excGroups.size}`);
  console.log(`   - Already in DB (Skipped)     : ${excSkippedCount}`);
  console.log(`   - New to Import               : ${excNewCount} (PKR ${excTotalVal.toLocaleString()})`);

  // ─────────────────────────────────────────────────────────────
  // 4. Process CREDIT VOUCHERS (outstanding-credit-voucher.md)
  // ─────────────────────────────────────────────────────────────
  console.log(`\n------------------------------------------------------`);
  console.log(`💳 2/3 Parsing: outstanding-credit-voucher.md`);
  console.log(`------------------------------------------------------`);
  const crdPath = path.join(__dirname, '../data/outstanding-credit-voucher.md');
  if (!fs.existsSync(crdPath)) {
    throw new Error(`File not found: ${crdPath}`);
  }

  const crdLines = fs
    .readFileSync(crdPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim().startsWith('|') && !l.includes('---') && !l.includes('CostCentre'));

  let crdNewCount = 0;
  let crdSkippedCount = 0;
  let crdTotalVal = 0;

  for (const line of crdLines) {
    const cols = line.split('|').map((c) => c.trim());
    if (cols.length > 1 && cols[0] === '') cols.shift();
    if (cols.length > 0 && cols[cols.length - 1] === '') cols.pop();
    if (cols.length < 8) continue;

    // Use RTL indexing to safely handle embedded pipes in addresses
    const locId = cols[1];
    const toDateStr = cols[cols.length - 1];
    const fromDateStr = cols[cols.length - 2];
    const amountStr = cols[cols.length - 4];
    const saleInvStr = cols[cols.length - 5];
    const docDateStr = cols[cols.length - 6];
    const docNoStr = cols[cols.length - 7];

    const loc = locMap.get(locId.toUpperCase());
    if (!loc) {
      console.warn(`⚠️ Location not found for Credit code: ${locId}`);
      continue;
    }

    const shortCode = loc.shortCode ? cleanLocCode(loc.shortCode) : cleanLocCode(loc.code);
    const date = parseFlexibleDate(docDateStr) || new Date('2025-07-01');
    const fySuffix = getFiscalYearSuffix(date);
    const padDoc = String(docNoStr).padStart(5, '0');
    const code = `CRD-${shortCode}${fySuffix}-${padDoc}`;
    const amount = parseFloat(amountStr);

    if (isNaN(amount) || amount <= 0) {
      continue;
    }

    // Deduplication check
    if (existingCodeMap.has(code.toUpperCase()) || generatedCodesInRun.has(code.toUpperCase())) {
      crdSkippedCount++;
      continue;
    }

    generatedCodesInRun.add(code.toUpperCase());
    crdNewCount++;
    crdTotalVal += amount;

    const expiryDate = parseFlexibleDate(toDateStr);
    const description = [
      `Credit Voucher Issued | CrV#: ${docNoStr} | ${formatDate(date)}`,
      saleInvStr && saleInvStr !== 'N/A' && saleInvStr !== '-' ? `| Sale Ref: #${saleInvStr}` : '',
    ]
      .filter(Boolean)
      .join(' ');

    const voucherId = crypto.randomUUID();
    allPrepared.push({
      voucher: {
        id: voucherId,
        code,
        voucherType: 'CREDIT',
        faceValue: new Prisma.Decimal(amount),
        discount: new Prisma.Decimal(0),
        description,
        issuedByLocationId: loc.id,
        sourceOrderId: null,
        customerId: null,
        isActive: true,
        isRedeemed: false,
        expiresAt: expiryDate,
        createdAt: date,
      },
      location: {
        id: crypto.randomUUID(),
        voucherId,
        locationId: loc.id,
      },
      transaction: {
        id: crypto.randomUUID(),
        voucherId,
        locationId: loc.id,
        action: 'ISSUED',
        amountUsed: new Prisma.Decimal(0),
        notes: `Credit Voucher CrV# ${docNoStr} issued at ${loc.name} (PKR ${amount.toLocaleString()})`,
        createdAt: date,
      },
    });
  }

  console.log(`   - Total Credit Rows in File   : ${crdLines.length}`);
  console.log(`   - Already in DB (Skipped)     : ${crdSkippedCount}`);
  console.log(`   - New to Import               : ${crdNewCount} (PKR ${crdTotalVal.toLocaleString()})`);

  // ─────────────────────────────────────────────────────────────
  // 5. Process CLAIM VOUCHERS (outstanding-claim-voucher.md)
  // ─────────────────────────────────────────────────────────────
  console.log(`\n------------------------------------------------------`);
  console.log(`🛡️ 3/3 Parsing: outstanding-claim-voucher.md`);
  console.log(`------------------------------------------------------`);
  const clmPath = path.join(__dirname, '../data/outstanding-claim-voucher.md');
  if (!fs.existsSync(clmPath)) {
    throw new Error(`File not found: ${clmPath}`);
  }

  const clmLines = fs
    .readFileSync(clmPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim().startsWith('|') && !l.includes('---') && !l.includes('CostCentre'));

  let clmNewCount = 0;
  let clmSkippedCount = 0;
  let clmTotalVal = 0;

  for (const line of clmLines) {
    const cols = line.split('|').map((c) => c.trim());
    if (cols.length > 1 && cols[0] === '') cols.shift();
    if (cols.length > 0 && cols[cols.length - 1] === '') cols.pop();
    if (cols.length < 14) continue;

    const [
      costCentre,
      locId,
      docDateStr,
      docNoStr,
      saleDoc,
      saleDate,
      redeemDoc,
      redeemDate,
      custName,
      custMobile,
      custEmail,
      custAddr,
      remarks,
      totalNetStr,
    ] = cols;

    const loc = locMap.get(locId.toUpperCase());
    if (!loc) {
      console.warn(`⚠️ Location not found for Claim code: ${locId}`);
      continue;
    }

    const shortCode = loc.shortCode ? cleanLocCode(loc.shortCode) : cleanLocCode(loc.code);
    const date = parseFlexibleDate(docDateStr) || new Date('2025-07-01');
    const fySuffix = getFiscalYearSuffix(date);
    const padDoc = String(docNoStr).padStart(5, '0');
    const code = `CLM-${shortCode}${fySuffix}-${padDoc}`;
    const amount = parseFloat(totalNetStr);

    if (isNaN(amount) || amount <= 0) {
      continue;
    }

    // Deduplication check
    if (existingCodeMap.has(code.toUpperCase()) || generatedCodesInRun.has(code.toUpperCase())) {
      clmSkippedCount++;
      continue;
    }

    generatedCodesInRun.add(code.toUpperCase());
    clmNewCount++;
    clmTotalVal += amount;

    // Customer resolution or linking
    let customerId: string | null = null;
    const cleanPhone = custMobile ? custMobile.replace(/[^0-9]/g, '') : '';
    const cleanName = custName && custName !== '-' && custName.trim() !== '' ? custName.trim() : null;

    if (!isDryRun && (cleanPhone.length >= 7 || cleanName)) {
      let cust = null;
      if (cleanPhone.length >= 7) {
        cust = await prisma.customer.findFirst({
          where: { contactNo: { contains: cleanPhone.slice(-7) } },
        });
      }
      if (!cust && cleanName) {
        cust = await prisma.customer.findFirst({
          where: { name: { equals: cleanName, mode: 'insensitive' } },
        });
      }
      if (!cust && cleanName) {
        try {
          cust = await prisma.customer.create({
            data: {
              name: cleanName,
              contactNo: custMobile || null,
              email: custEmail && custEmail !== '-' && custEmail.includes('@') ? custEmail.trim() : null,
              address: custAddr && custAddr !== '-' ? custAddr.trim() : null,
              customerType: 'POS',
            },
          });
        } catch (e: any) {
          // Fallback if duplicate phone constraint or similar
          cust = await prisma.customer.findFirst({
            where: { name: { equals: cleanName, mode: 'insensitive' } },
          });
        }
      }
      if (cust) {
        customerId = cust.id;
      }
    }

    const description = [
      `CLAIM Voucher Doc #${docNoStr}`,
      saleDoc && saleDoc !== '-' ? `(Sale #${saleDoc})` : '',
      remarks && remarks !== '-' ? `- ${remarks}` : '',
    ]
      .filter(Boolean)
      .join(' ');

    const voucherId = crypto.randomUUID();
    allPrepared.push({
      voucher: {
        id: voucherId,
        code,
        voucherType: 'CLAIM',
        faceValue: new Prisma.Decimal(amount),
        discount: new Prisma.Decimal(0),
        description,
        issuedByLocationId: loc.id,
        sourceOrderId: null,
        customerId,
        isActive: true,
        isRedeemed: false,
        expiresAt: null,
        createdAt: date,
      },
      location: {
        id: crypto.randomUUID(),
        voucherId,
        locationId: loc.id,
      },
      transaction: {
        id: crypto.randomUUID(),
        voucherId,
        locationId: loc.id,
        action: 'ISSUED',
        amountUsed: new Prisma.Decimal(0),
        notes: `Claim Voucher #${docNoStr} issued at ${loc.name} (PKR ${amount.toLocaleString()})`,
        createdAt: date,
      },
    });
  }

  console.log(`   - Total Claim Rows in File    : ${clmLines.length}`);
  console.log(`   - Already in DB (Skipped)     : ${clmSkippedCount}`);
  console.log(`   - New to Import               : ${clmNewCount} (PKR ${clmTotalVal.toLocaleString()})`);

  // ─────────────────────────────────────────────────────────────
  // 6. Execution / Summary
  // ─────────────────────────────────────────────────────────────
  const totalNewVouchers = allPrepared.length;
  const totalNewFaceValue = excTotalVal + crdTotalVal + clmTotalVal;
  const totalSkipped = excSkippedCount + crdSkippedCount + clmSkippedCount;

  console.log(`\n======================================================`);
  console.log(`📊 OVERALL BATCH SUMMARY FOR [${companyName}]`);
  console.log(`======================================================`);
  console.log(`   - Exchange Vouchers to Insert : ${excNewCount.toLocaleString()} (PKR ${excTotalVal.toLocaleString()})`);
  console.log(`   - Credit Vouchers to Insert   : ${crdNewCount.toLocaleString()} (PKR ${crdTotalVal.toLocaleString()})`);
  console.log(`   - Claim Vouchers to Insert    : ${clmNewCount.toLocaleString()} (PKR ${clmTotalVal.toLocaleString()})`);
  console.log(`   - Total New Vouchers          : ${totalNewVouchers.toLocaleString()}`);
  console.log(`   - Total New Face Value        : PKR ${totalNewFaceValue.toLocaleString()}`);
  console.log(`   - Total Skipped (Existing DB) : ${totalSkipped.toLocaleString()}`);
  console.log(`======================================================\n`);

  if (isDryRun) {
    console.log(`⚠️ [DRY-RUN] Execution completed without database modifications.`);
    return;
  }

  if (totalNewVouchers === 0) {
    console.log(`✨ All vouchers are already up to date in DB. Nothing to insert.`);
    return;
  }

  // 7. Insert into DB in Chunks of 100 within transactions
  console.log(`📥 Inserting ${totalNewVouchers.toLocaleString()} vouchers into database...`);
  const CHUNK_SIZE = 100;
  const totalBatches = Math.ceil(totalNewVouchers / CHUNK_SIZE);

  for (let b = 0; b < totalBatches; b++) {
    const chunk = allPrepared.slice(b * CHUNK_SIZE, (b + 1) * CHUNK_SIZE);

    const vData = chunk.map((c) => c.voucher);
    const locData = chunk.map((c) => c.location);
    const txData = chunk.map((c) => c.transaction);

    await prisma.$transaction(
      async (tx) => {
        await tx.voucher.createMany({ data: vData });
        await tx.voucherLocation.createMany({ data: locData });
        await tx.voucherTransaction.createMany({ data: txData });
      },
      { timeout: 60000 },
    );

    const progressPct = (((b + 1) / totalBatches) * 100).toFixed(1);
    process.stdout.write(
      `\r   ⚡ [IMPORTING] Batch ${b + 1}/${totalBatches} (${Math.min((b + 1) * CHUNK_SIZE, totalNewVouchers)}/${totalNewVouchers} - ${progressPct}%)`,
    );
  }
  console.log('\n');

  // 8. Verification from Database
  console.log(`\n======================================================`);
  console.log(`✅ DATABASE VERIFICATION SUMMARY [${companyName}]`);
  console.log(`======================================================`);
  for (const vType of ['EXCHANGE', 'CREDIT', 'CLAIM']) {
    const totalCount = await prisma.voucher.count({
      where: { voucherType: vType, isDeleted: false },
    });
    const outstandingCount = await prisma.voucher.count({
      where: { voucherType: vType, isDeleted: false, isRedeemed: false },
    });
    const redeemedCount = await prisma.voucher.count({
      where: { voucherType: vType, isDeleted: false, isRedeemed: true },
    });
    const sumVal = await prisma.voucher.aggregate({
      where: { voucherType: vType, isDeleted: false },
      _sum: { faceValue: true },
    });
    console.log(
      `   - ${vType.padEnd(8)}: Total=${totalCount.toLocaleString()} | Outstanding=${outstandingCount.toLocaleString()} | Redeemed=${redeemedCount.toLocaleString()} | FaceValue=PKR ${Number(sumVal._sum.faceValue || 0).toLocaleString()}`,
    );
  }
  console.log(`======================================================\n`);
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('-d');
  const tenantFilter = process.argv.find((arg) => arg.startsWith('--tenant='))?.split('=')[1];

  console.log(`\n======================================================`);
  console.log(`🚀 OUTSTANDING VOUCHERS IMPORT PIPELINE`);
  console.log(`   (EXCHANGE, CREDIT, CLAIM)`);
  console.log(`======================================================`);
  if (isDryRun) {
    console.log(`⚠️ DRY RUN MODE: No changes will be written.`);
  }

  const directDbArg = process.argv.find((arg) => arg.startsWith('--db='))?.split('=')[1];
  if (directDbArg) {
    console.log(`🔌 Connecting directly to target database URL...`);
    const pool = new Pool({ connectionString: directDbArg });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter } as any);
    try {
      await processTenant(prisma, 'Custom DB Target', isDryRun);
    } finally {
      await prisma.$disconnect();
      await pool.end();
    }
    return;
  }

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT || process.env.DATABASE_URL;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (managementUrl && masterKey) {
    const pool = new Pool({ connectionString: managementUrl });
    const adapter = new PrismaPg(pool);
    const management = new ManagementClient({ adapter } as any);

    let companies: any[] = [];
    try {
      const where: any = { status: 'active' };
      if (tenantFilter) {
        where.OR = [
          { name: { contains: tenantFilter, mode: 'insensitive' } },
          { dbName: { contains: tenantFilter, mode: 'insensitive' } },
          { code: { contains: tenantFilter, mode: 'insensitive' } },
        ];
      }
      companies = await management.company.findMany({ where });
    } catch (err: any) {
      console.warn(`ℹ️ Multi-tenant lookup skipped: ${err.message}`);
    } finally {
      await management.$disconnect();
      await pool.end();
    }

    if (companies.length > 0) {
      console.log(`🏢 Found ${companies.length} active tenant companies.`);
      for (const company of companies) {
        let connectionString = company.dbUrl;
        if (company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch (e: any) {
            console.warn(`⚠️ Could not decrypt password for company ${company.name}, using dbUrl directly.`);
          }
        }

        const tenantPool = new Pool({ connectionString });
        const tenantAdapter = new PrismaPg(tenantPool);
        const prisma = new PrismaClient({ adapter: tenantAdapter } as any);

        try {
          await processTenant(prisma, company.name, isDryRun);
        } finally {
          await prisma.$disconnect();
          await tenantPool.end();
        }
      }
      return;
    }
  }

  // Fallback to direct DATABASE_URL
  const fallbackUrl = process.env.DATABASE_URL || 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi';
  console.log(`🔌 Connecting via direct fallback URL...`);
  const pool = new Pool({ connectionString: fallbackUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as any);

  try {
    await processTenant(prisma, 'Speed Sports (Direct)', isDryRun);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch(console.error);
