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

function excelDateToJSDate(serial: number): Date {
  const utc_days = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400;
  const date_info = new Date(utc_value * 1000);
  const fractional_day = serial - Math.floor(serial) + 0.0000001;
  let total_seconds = Math.floor(86400 * fractional_day);
  const seconds = total_seconds % 60;
  total_seconds -= seconds;
  const hours = Math.floor(total_seconds / 3600);
  const minutes = Math.floor((total_seconds / 60) % 60);
  return new Date(date_info.getFullYear(), date_info.getMonth(), date_info.getDate(), hours, minutes, seconds);
}

function parseDateFromNarrationOrSerial(serialDate: number, narration: string): Date {
  if (narration) {
    const match = narration.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (match) {
      const [_, day, month, year] = match;
      return new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), 0, 0, 0));
    }
  }
  return excelDateToJSDate(serialDate);
}

function formatDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function getFiscalYearSuffix(d: Date): string {
  const month = d.getMonth(); // 0-indexed (6 = July)
  const year = d.getFullYear();
  const fyEndingYear = month >= 6 ? year + 1 : year;
  return String(fyEndingYear).slice(-2);
}

interface ParsedRow {
  storeName: string;
  locCode: string;
  crNo: string;
  creditAmt: number;
  date: Date;
  fySuffix: string;
}

function parseFlexibleDate(val: any): Date | null {
  if (val === undefined || val === null || val === '') return null;

  if (typeof val === 'number') {
    let num = val;
    if (num < 100000) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      return new Date(excelEpoch.getTime() + num * 86400000);
    }
  }

  const str = String(val).trim();
  if (!str || str === 'null' || str === '-' || str === '0') return null;

  if (str.includes('/')) {
    const [datePart, timePart] = str.split(/\s+/);
    const parts = datePart.split('/').map(Number);
    if (parts.length === 3) {
      let [d, m, y] = parts;
      if (d <= 12 && m > 12) {
        // It's MM/DD/YY
        const temp = d;
        d = m;
        m = temp;
      }
      const [hh, mm, ss] = (timePart || '00:00:00').split(':').map(Number);
      const year = y < 100 ? 2000 + y : y;
      const parsed = new Date(Date.UTC(year, m - 1, d, hh || 0, mm || 0, ss || 0));
      if (!isNaN(parsed.getTime())) return parsed;
    }
  }

  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export function readAndParseCreditVouchers(filePath: string): ParsedRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Data file not found at: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  const rows: ParsedRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|') || line.includes('---') || line.includes('__EMPTY') || line.includes('CostCentre')) {
      continue;
    }
    const cols = line.split('|').map((c) => c.trim());
    if (cols.length > 1 && cols[0] === '') cols.shift();
    if (cols.length > 0 && cols[cols.length - 1] === '') cols.pop();
    
    if (cols.length >= 8) {
      let storeName = cols[0];
      let locCode = cols[1];

      const crNo = String(cols[4]).trim();
      const docDateStr = cols[5];
      const creditAmt = parseFloat(cols[7]);

      if (!isNaN(creditAmt) && creditAmt > 0) {
        const date = parseFlexibleDate(docDateStr) || new Date('2026-07-01');
        const fySuffix = getFiscalYearSuffix(date);
        rows.push({
          storeName,
          locCode,
          crNo,
          creditAmt,
          date,
          fySuffix,
        });
      }
    }
  }

  return rows;
}

export async function cleanExistingCreditVouchers(prisma: PrismaClient) {
  console.log(`🧹 Checking existing CREDIT vouchers in database...`);

  const existingCount = await prisma.voucher.count({
    where: { voucherType: 'CREDIT' },
  });

  if (existingCount === 0) {
    console.log(`ℹ️ No existing CREDIT vouchers found in database.`);
    return;
  }

  console.log(`🗑️ Removing ${existingCount.toLocaleString()} existing CREDIT vouchers and dependent records...`);

  // Unlink PosClaim and PosReturn
  await prisma.posClaim.updateMany({
    where: { voucher: { voucherType: 'CREDIT' } },
    data: { voucherId: null },
  });

  await prisma.posReturn.updateMany({
    where: { voucher: { voucherType: 'CREDIT' } },
    data: { voucherId: null },
  });

  // Delete redemptions and transactions
  const deletedRedemptions = await prisma.voucherRedemption.deleteMany({
    where: { voucher: { voucherType: 'CREDIT' } },
  });

  const deletedTransactions = await prisma.voucherTransaction.deleteMany({
    where: { voucher: { voucherType: 'CREDIT' } },
  });

  const deletedLocations = await prisma.voucherLocation.deleteMany({
    where: { voucher: { voucherType: 'CREDIT' } },
  });

  const deletedVouchers = await prisma.voucher.deleteMany({
    where: { voucherType: 'CREDIT' },
  });

  console.log(`   - Deleted ${deletedVouchers.count} vouchers, ${deletedRedemptions.count} redemptions, ${deletedTransactions.count} transactions.`);
}

async function processTenantCreditVouchers(
  prisma: PrismaClient,
  companyName: string,
  rows: ParsedRow[],
  isDryRun: boolean,
  deleteOnly: boolean = false,
) {
  console.log(`\n======================================================`);
  console.log(`🏢 Processing Tenant: [${companyName}]`);
  console.log(`======================================================`);

  if (isDryRun) {
    const existingCount = await prisma.voucher.count({
      where: { voucherType: 'CREDIT' },
    });
    console.log(`⚠️ [DRY-RUN] Would remove ${existingCount.toLocaleString()} existing CREDIT vouchers.`);
  } else {
    await cleanExistingCreditVouchers(prisma);
  }

  if (deleteOnly) {
    console.log(`✨ Cleanup completed for tenant [${companyName}] (--delete-only active).`);
    return;
  }

  // 1. Fetch Locations
  const locations = await prisma.location.findMany({
    where: { isDeleted: false },
    select: { id: true, name: true, code: true, shortCode: true },
  });
  console.log(`📍 Found ${locations.length} active locations in DB.`);

  const locMap = new Map<string, typeof locations[0]>();
  for (const l of locations) {
    locMap.set(l.code.toUpperCase(), l);
    if (l.shortCode) {
      locMap.set(l.shortCode.toUpperCase(), l);
    }
  }

  // 2. Fetch existing redemptions from other voucher types (e.g. Corporate/Gift/Exchange)
  const existingRedemptions = await prisma.voucherRedemption.findMany({
    select: { orderId: true },
  });
  const alreadyRedeemedOrderIds = new Set(existingRedemptions.map((r) => r.orderId));
  console.log(`🔒 Excluded ${alreadyRedeemedOrderIds.size} orders already redeemed by other voucher types.`);

  // 3. Load Candidate SalesOrders with voucherAmount > 0 for settlement matching
  console.log(`🔍 Loading SalesOrders with voucherAmount > 0 from 2026-07-01 onwards...`);
  const candidateOrders = await prisma.salesOrder.findMany({
    where: {
      voucherAmount: { gt: 0 },
      createdAt: { gte: new Date('2026-07-01T00:00:00.000Z') },
    },
    select: {
      id: true,
      orderNumber: true,
      locationId: true,
      voucherAmount: true,
      grandTotal: true,
      createdAt: true,
      notes: true,
      customerId: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const availableOrders = candidateOrders.filter((o) => !alreadyRedeemedOrderIds.has(o.id));
  console.log(`📦 Available unlinked sales orders with voucher tender: ${availableOrders.length}`);

  // 4. Generate Codes & Match Settlements
  const generatedCodes = new Set<string>();
  const matchedOrderIds = new Set<string>();
  const preparedVouchers: any[] = [];
  const orderNotesToUpdate: Array<{ id: string; notes: string }> = [];

  let redeemedCount = 0;
  let unredeemedCount = 0;
  let redeemedValue = 0;
  let unredeemedValue = 0;

  const sortedRows = [...rows].sort((a, b) => b.date.getTime() - a.date.getTime());

  for (const r of sortedRows) {
    const loc = locMap.get(r.locCode.toUpperCase());
    if (!loc) {
      console.warn(`⚠️ Unknown location code: ${r.locCode} (${r.storeName})`);
      continue;
    }

    const cleanShortCode = (loc.shortCode || loc.code)
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase();

    let code = `CRD-${cleanShortCode}${r.fySuffix}-${r.crNo.padStart(5, '0')}`;
    if (generatedCodes.has(code)) {
      let suffix = 2;
      while (generatedCodes.has(`${code}-${suffix}`)) {
        suffix++;
      }
      code = `${code}-${suffix}`;
    }
    generatedCodes.add(code);

    const vTime = r.date.getTime();

    // 3-Tier Matching against SalesOrders with voucherAmount
    // Tier 1: Same location, exact amount (+- 1 Rs), order date >= voucher date
    let matchedOrder = availableOrders.find(
      (o) =>
        !matchedOrderIds.has(o.id) &&
        o.locationId === loc.id &&
        Math.abs(Number(o.voucherAmount) - r.creditAmt) < 1.0 &&
        o.createdAt.getTime() >= vTime,
    );

    // Tier 2: Same location, exact amount (+- 1 Rs), any date in fiscal year
    if (!matchedOrder) {
      matchedOrder = availableOrders.find(
        (o) =>
          !matchedOrderIds.has(o.id) &&
          o.locationId === loc.id &&
          Math.abs(Number(o.voucherAmount) - r.creditAmt) < 1.0,
      );
    }

    // Tier 3: Cross-store redemption (any location), exact amount (+- 1 Rs), order date >= voucher date
    if (!matchedOrder) {
      matchedOrder = availableOrders.find(
        (o) =>
          !matchedOrderIds.has(o.id) &&
          Math.abs(Number(o.voucherAmount) - r.creditAmt) < 1.0 &&
          o.createdAt.getTime() >= vTime,
      );
    }

    const isRedeemed = Boolean(matchedOrder);
    const voucherId = crypto.randomUUID();

    let description = `Credit Voucher Issued | CrV#: ${r.crNo} | ${formatDate(r.date)}`;

    if (matchedOrder) {
      matchedOrderIds.add(matchedOrder.id);
      redeemedCount++;
      redeemedValue += r.creditAmt;
      description += ` (Settled in Sales Order: ${matchedOrder.orderNumber})`;

      // Prepare order notes update
      const existingNotes = matchedOrder.notes || '';
      if (!existingNotes.includes(code)) {
        orderNotesToUpdate.push({
          id: matchedOrder.id,
          notes: existingNotes
            ? `${existingNotes} | [Credit Voucher Redeemed: ${code} (PKR ${r.creditAmt.toLocaleString()})]`
            : `[Credit Voucher Redeemed: ${code} (PKR ${r.creditAmt.toLocaleString()})]`,
        });
      }
    } else {
      unredeemedCount++;
      unredeemedValue += r.creditAmt;
    }

    preparedVouchers.push({
      voucher: {
        id: voucherId,
        code,
        voucherType: 'CREDIT',
        faceValue: r.creditAmt,
        discount: 0,
        description,
        issuedByLocationId: loc.id,
        sourceOrderId: matchedOrder ? matchedOrder.id : null,
        customerId: matchedOrder?.customerId || null,
        createdAt: r.date,
        isActive: true,
        isRedeemed,
      },
      location: {
        id: crypto.randomUUID(),
        voucherId,
        locationId: loc.id,
      },
      redemption: matchedOrder
        ? {
            id: crypto.randomUUID(),
            voucherId,
            orderId: matchedOrder.id,
            amountUsed: new Prisma.Decimal(r.creditAmt),
            createdAt: matchedOrder.createdAt, // Exact settlement date from uploaded sales data!
          }
        : null,
      issuedTransaction: {
        id: crypto.randomUUID(),
        voucherId,
        locationId: loc.id,
        action: 'ISSUED',
        amountUsed: new Prisma.Decimal(0),
        notes: `Credit Voucher CrV# ${r.crNo} issued at ${loc.name}`,
        createdAt: r.date,
      },
      redeemedTransaction: matchedOrder
        ? {
            id: crypto.randomUUID(),
            voucherId,
            orderId: matchedOrder.id,
            locationId: matchedOrder.locationId,
            action: 'REDEEMED',
            amountUsed: new Prisma.Decimal(r.creditAmt), // Exact settled amount!
            notes: `Redeemed in Sales Order ${matchedOrder.orderNumber} (PKR ${r.creditAmt.toLocaleString()})`,
            createdAt: matchedOrder.createdAt, // Exact settlement date!
          }
        : null,
    });
  }

  console.log(`\n======================================================`);
  console.log(`📊 PREPARATION SUMMARY FOR [${companyName}]`);
  console.log(`======================================================`);
  console.log(`   - Total Credit Vouchers (>= 01-07-2026): ${rows.length.toLocaleString()}`);
  console.log(`   - Total Face Value (PKR)               : PKR ${(redeemedValue + unredeemedValue).toLocaleString()}`);
  console.log(`   - Settled / Redeemed Vouchers          : ${redeemedCount.toLocaleString()} (PKR ${redeemedValue.toLocaleString()})`);
  console.log(`   - Active / Outstanding Vouchers        : ${unredeemedCount.toLocaleString()} (PKR ${unredeemedValue.toLocaleString()})`);
  console.log(`======================================================\n`);

  if (isDryRun) {
    console.log(`⚠️ [DRY-RUN] Execution completed without database modifications.`);
    return;
  }

  // 5. Insert into Database in Chunks of 100
  console.log(`📥 Inserting ${preparedVouchers.length} Credit Vouchers into database...`);
  const CHUNK_SIZE = 100;
  const totalBatches = Math.ceil(preparedVouchers.length / CHUNK_SIZE);

  for (let b = 0; b < totalBatches; b++) {
    const chunk = preparedVouchers.slice(b * CHUNK_SIZE, (b + 1) * CHUNK_SIZE);

    const vData = chunk.map((c) => c.voucher);
    const locData = chunk.map((c) => c.location);
    const redData = chunk.map((c) => c.redemption).filter(Boolean);
    const txData = [
      ...chunk.map((c) => c.issuedTransaction),
      ...chunk.map((c) => c.redeemedTransaction).filter(Boolean),
    ];

    await prisma.$transaction(
      async (tx) => {
        await tx.voucher.createMany({ data: vData });
        await tx.voucherLocation.createMany({ data: locData });
        if (redData.length > 0) {
          await tx.voucherRedemption.createMany({ data: redData as any });
        }
        if (txData.length > 0) {
          await tx.voucherTransaction.createMany({ data: txData as any });
        }
      },
      { timeout: 60000 },
    );

    const progressPct = (((b + 1) / totalBatches) * 100).toFixed(1);
    process.stdout.write(`\r   ⚡ [IMPORTING] Batch ${b + 1}/${totalBatches} (${Math.min((b + 1) * CHUNK_SIZE, preparedVouchers.length)}/${preparedVouchers.length} vouchers - ${progressPct}%)`);
  }
  console.log('\n');

  // 6. Update SalesOrder notes with redemption tags
  if (orderNotesToUpdate.length > 0) {
    console.log(`📝 Updating notes on ${orderNotesToUpdate.length} redeemed SalesOrders...`);
    for (const item of orderNotesToUpdate) {
      await prisma.salesOrder.update({
        where: { id: item.id },
        data: { notes: item.notes },
      });
    }
  }

  // 7. Verification Summary
  const countInDb = await prisma.voucher.count({
    where: { voucherType: 'CREDIT', isDeleted: false },
  });
  const redeemedInDb = await prisma.voucher.count({
    where: { voucherType: 'CREDIT', isDeleted: false, isRedeemed: true },
  });
  const activeInDb = await prisma.voucher.count({
    where: { voucherType: 'CREDIT', isDeleted: false, isRedeemed: false },
  });
  const sumInDb = await prisma.voucher.aggregate({
    where: { voucherType: 'CREDIT', isDeleted: false },
    _sum: { faceValue: true },
  });

  console.log(`\n======================================================`);
  console.log(`✅ VERIFICATION IN DATABASE [${companyName}]`);
  console.log(`======================================================`);
  console.log(`   - Total Active CREDIT in DB  : ${countInDb.toLocaleString()}`);
  console.log(`   - Settled (Redeemed) in DB   : ${redeemedInDb.toLocaleString()}`);
  console.log(`   - Active (Outstanding) in DB : ${activeInDb.toLocaleString()}`);
  console.log(`   - Total Face Value in DB     : PKR ${Number(sumInDb._sum.faceValue || 0).toLocaleString()}`);
  console.log(`======================================================\n`);
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('-d');
  const deleteOnly = process.argv.includes('--delete-only') || process.argv.includes('--wipe-only');
  const tenantFilter = process.argv.find((arg) => arg.startsWith('--tenant='))?.split('=')[1];

  let filePath = path.join(__dirname, '..', 'data', 'credit-voucher.md');
  const fileArg = process.argv.find((arg) => arg.startsWith('--file=') || arg.startsWith('--path='));
  if (fileArg) {
    const customPath = fileArg.split('=')[1];
    filePath = path.isAbsolute(customPath) ? customPath : path.join(process.cwd(), customPath);
  }

  console.log(`\n======================================================`);
  console.log(`🚀 CREDIT VOUCHERS IMPORT & SETTLEMENT PIPELINE`);
  console.log(`======================================================`);
  console.log(`📄 Target Data File: ${filePath}`);
  if (isDryRun) {
    console.log(`⚠️ DRY RUN MODE: No changes will be written.`);
  }
  if (deleteOnly) {
    console.log(`🗑️ DELETE-ONLY MODE: Existing credit vouchers will be deleted.`);
  }

  const rows = deleteOnly ? [] : readAndParseCreditVouchers(filePath);
  if (!deleteOnly) {
    console.log(`📄 Successfully parsed ${rows.length.toLocaleString()} credit vouchers issued on or after 2026-07-01.`);
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
      console.log(`\n🏢 Found ${companies.length} active tenant companies. Executing...`);
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
          await processTenantCreditVouchers(prisma, company.name, rows, isDryRun, deleteOnly);
        } catch (err: any) {
          console.error(`❌ Error processing tenant ${company.name}:`, err);
        } finally {
          await prisma.$disconnect();
          await tenantPool.end();
        }
      }
      return;
    }
  }

  // Fallback to direct TENANT_DATABASE_URL or DATABASE_URL
  const directUrl =
    process.env.TENANT_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi?schema=public';

  console.log(`\n⚙️ Connecting directly via database URL...`);
  const directPool = new Pool({ connectionString: directUrl });
  const directAdapter = new PrismaPg(directPool);
  const prisma = new PrismaClient({ adapter: directAdapter } as any);

  try {
    await processTenantCreditVouchers(prisma, 'Direct Database', rows, isDryRun, deleteOnly);
  } finally {
    await prisma.$disconnect();
    await directPool.end();
  }
}

main().catch((err) => {
  console.error('❌ Fatal error in credit vouchers script:', err);
  process.exit(1);
});
