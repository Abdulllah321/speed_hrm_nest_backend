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

function formatDate(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function getFiscalYearSuffix(d: Date): string {
  const month = d.getUTCMonth(); // 0-indexed (6 = July)
  const year = d.getUTCFullYear();
  const fyEndingYear = month >= 6 ? year + 1 : year;
  return String(fyEndingYear).slice(-2);
}

export interface ParsedRow {
  storeName: string;
  locCode: string;
  crNo: string;
  creditAmt: number;
  date: Date;
  fySuffix: string;
  narration?: string;
}

function parseFlexibleDate(val: any, narration?: string): Date | null {
  if (narration) {
    const match = narration.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (match) {
      const [_, day, month, year] = match;
      return new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), 0, 0, 0));
    }
  }

  if (val === undefined || val === null || val === '') return null;

  if (typeof val === 'number') {
    let num = val;
    if (num > 30000 && num < 100000) {
      return excelDateToJSDate(num);
    }
  }

  const str = String(val).trim();
  if (!str || str === 'null' || str === '-' || str === '0') return null;

  if (/^\d{5}$/.test(str)) {
    return excelDateToJSDate(parseInt(str, 10));
  }

  if (str.includes('/')) {
    const [datePart, timePart] = str.split(/\s+/);
    const parts = datePart.split('/').map(Number);
    if (parts.length === 3) {
      let [d, m, y] = parts;
      if (d <= 12 && m > 12) {
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

const STORE_NAME_TO_CODE: Record<string, string> = {
  // Nike
  'NIKE-DOLMEN CLIFTON': 'N10001',
  'NIKE-XINHUA MALL': 'N10002',
  'NIKE-PACKAGES MALL': 'N10003',
  'NIKE-CENTAURUS MALL': 'N10004',
  'NIKE-SAFA GOLD MALL': 'N10005',

  // Charles & Keith
  'CHARLES & KEITH-DOLMEN CLIFTON': 'CK1001',
  'C&K-DOLMEN CLIFTON': 'CK1001',
  'CHARLES & KEITH-LUCKY ONE': 'CK1002',
  'CHARLES & KEITH-LUCKY ONE MALL': 'CK1002',
  'C&K-LUCKY ONE MALL': 'CK1002',
  'CHARLES & KEITH-EMPORIUM MALL': 'CK1003',
  'C&K-EMPORIUM MALL': 'CK1003',
  'CHARLES & KEITH-PACKAGES MALL': 'CK1004',
  'C&K-PACKAGES MALL': 'CK1004',
  'CHARLES & KEITH-DOLMEN LAHORE': 'CK1005',
  'C&K-DOLMEN LAHORE': 'CK1005',
  'CHARLES & KEITH-CENTAURUS MALL': 'CK1006',
  'C&K-CENTAURUS MALL': 'CK1006',

  // Pedro
  'PEDRO-DOLMEN CLIFTON': 'P10001',
  'PEDRO-PACKAGES MALL': 'P10002',
  'PEDRO-DOLMEN LAHORE': 'P10003',
  'PEDRO-ONLINE': 'P10004',

  // Puma
  'PUMA - DOLMEN LAHORE': 'PU1001',
  'PUMA-DOLMEN LAHORE': 'PU1001',
  'PUMA-UNITED MALL MULTAN': 'PU1002',

  // Adidas
  'ADIDAS-LUCKY ONE MALL': 'A10001',
  'ADIDAS-JINNAH ICON MALL': 'A10002',
  'ADIDAS-MADISON SQUARE MALL': 'A10003',

  // Speed Sports
  'SPEED SPORTS-LUCKY ONE MALL': 'SS1001',
  'SPEED SPORTS-DOLMEN CLIFTON': 'SS1002',
  'SPEED SPORTS - ZAMZAM ARCADE': 'SS1003',
  'SPEED SPORTS-ZAMZAM ARCADE': 'SS1003',
  'SPEED SPORTS-FOUNTAIN AVENUE': 'SS1004',
  'SPEED SPORTS-EMPORIUM MALL': 'SS1005',
  'SPEED SPORTS-DOLMEN LAHORE': 'SS1006',
  'SPEED SPORTS SAFA-1': 'SS1007',
  'SPEED SPORTS-SAFA GOLD MALL': 'SS1007',
  'SPEED SPORTS-GIGA MALL': 'SS1008',
  'SPEED SPORTS-MALL OF MULTAN': 'SS1009',
  'SPEED SPORTS-LYALLPUR GALLERIA': 'SS1010',
  'SPEED SPORTS-ONLINE': 'SS1011',
  'SPEED SPORTS-THE FORUM': 'SS1012',
};

function normalizeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export function readAndParseCreditVouchers(filePath: string): ParsedRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Data file not found at: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  let storeCol = -1;
  let locCol = -1;
  let dateCol = -1;
  let crNoCol = -1;
  let amtCol = -1;
  let narrationCol = -1;

  const rows: ParsedRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|') || line.includes('---')) {
      continue;
    }

    const rawCols = line.split('|').map((c) => c.trim());
    if (rawCols.length > 1 && rawCols[0] === '') rawCols.shift();
    if (rawCols.length > 0 && rawCols[rawCols.length - 1] === '') rawCols.pop();

    const lowerCols = rawCols.map((c) => c.toLowerCase());

    // Check if this line is a table header
    const isHeader = lowerCols.some(
      (c) => c.includes('voucher') || c.includes('store') || c.includes('location'),
    );

    if (isHeader && (storeCol === -1 || crNoCol === -1)) {
      for (let c = 0; c < lowerCols.length; c++) {
        const h = lowerCols[c];
        if (h.includes('store') || (h === 'name' && storeCol === -1)) {
          storeCol = c;
        } else if (h.includes('location id') || h.includes('locationid') || h === 'location') {
          locCol = c;
        } else if (h.includes('date')) {
          dateCol = c;
        } else if (h.includes('credit voucher no') || h.includes('credit voucher number') || h.includes('voucher no')) {
          crNoCol = c;
        } else if (h === 'credit' || h.includes('amount')) {
          amtCol = c;
        } else if (h.includes('narration') || h.includes('remarks')) {
          narrationCol = c;
        }
      }
      continue;
    }

    // Default legacy fallback column mapping if header wasn't matched explicitly
    const actualStoreCol = storeCol >= 0 ? storeCol : 0;
    const actualLocCol = locCol >= 0 ? locCol : 1;
    const actualDateCol = dateCol >= 0 ? dateCol : 2;
    const actualCrNoCol = crNoCol >= 0 ? crNoCol : 3;
    const actualAmtCol = amtCol >= 0 ? amtCol : 4;

    if (rawCols.length <= Math.max(actualStoreCol, actualCrNoCol, actualAmtCol)) {
      continue;
    }

    const storeName = rawCols[actualStoreCol] || '';
    const locCode = actualLocCol >= 0 && actualLocCol < rawCols.length ? rawCols[actualLocCol] : '';
    const dateRaw = actualDateCol >= 0 && actualDateCol < rawCols.length ? rawCols[actualDateCol] : '';
    let crNo = String(rawCols[actualCrNoCol]).trim();
    const amtStr = String(rawCols[actualAmtCol]).replace(/,/g, '').trim();
    const creditAmt = parseFloat(amtStr);

    let narration = '';
    if (narrationCol >= 0 && rawCols.length > narrationCol) {
      narration = rawCols.slice(narrationCol).join(' | ');
    } else if (rawCols.length > 5) {
      narration = rawCols.slice(5).join(' | ');
    }

    if (isNaN(creditAmt) || creditAmt <= 0) continue;
    if (!crNo || crNo === '-' || crNo.startsWith('-')) continue;

    const date = parseFlexibleDate(dateRaw, narration) || new Date('2026-09-01');
    const fySuffix = getFiscalYearSuffix(date);

    rows.push({
      storeName,
      locCode,
      crNo,
      creditAmt,
      date,
      fySuffix,
      narration,
    });
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
  wipeExisting: boolean = false,
  deleteOnly: boolean = false,
) {
  console.log(`\n======================================================`);
  console.log(`🏢 Processing Tenant: [${companyName}]`);
  console.log(`======================================================`);

  if (wipeExisting || deleteOnly) {
    if (isDryRun) {
      const existingCount = await prisma.voucher.count({
        where: { voucherType: 'CREDIT' },
      });
      console.log(`⚠️ [DRY-RUN] Would remove ${existingCount.toLocaleString()} existing CREDIT vouchers.`);
    } else {
      await cleanExistingCreditVouchers(prisma);
    }
  } else {
    console.log(`🛡️ Safe incremental mode active: existing vouchers will NOT be wiped.`);
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

  const locCodeMap = new Map<string, typeof locations[0]>();
  const locShortCodeMap = new Map<string, typeof locations[0]>();
  const locNameMap = new Map<string, typeof locations[0]>();

  for (const l of locations) {
    locCodeMap.set(l.code.toUpperCase(), l);
    if (l.shortCode) {
      locShortCodeMap.set(l.shortCode.toUpperCase(), l);
      locShortCodeMap.set(normalizeName(l.shortCode), l);
    }
    locNameMap.set(normalizeName(l.name), l);
  }

  function resolveLocation(r: ParsedRow) {
    // 1. Check exact dictionary mapping
    const directCode = STORE_NAME_TO_CODE[r.storeName];
    if (directCode && locCodeMap.has(directCode.toUpperCase())) {
      return locCodeMap.get(directCode.toUpperCase())!;
    }

    // 2. Check normalized name matching
    const normStore = normalizeName(r.storeName);
    if (locNameMap.has(normStore)) {
      return locNameMap.get(normStore)!;
    }

    // 3. Check locCode against code or shortCode
    if (r.locCode) {
      const upperLoc = r.locCode.toUpperCase();
      if (locCodeMap.has(upperLoc)) return locCodeMap.get(upperLoc)!;
      if (locShortCodeMap.has(upperLoc)) return locShortCodeMap.get(upperLoc)!;
    }

    // 4. Fuzzy fallback matching
    for (const l of locations) {
      const normL = normalizeName(l.name);
      if (normL.includes(normStore) || normStore.includes(normL)) {
        return l;
      }
    }

    return null;
  }

  // 2. Fetch existing codes from DB to avoid collision
  const existingVouchersInDb = await prisma.voucher.findMany({
    select: { code: true },
  });
  const existingCodesInDb = new Set(existingVouchersInDb.map((v) => v.code));
  console.log(`📋 Found ${existingCodesInDb.size} existing voucher codes in database.`);

  // 3. Fetch existing redemptions from other voucher types (e.g. Corporate/Gift/Exchange)
  const existingRedemptions = await prisma.voucherRedemption.findMany({
    select: { orderId: true },
  });
  const alreadyRedeemedOrderIds = new Set(existingRedemptions.map((r) => r.orderId));
  console.log(`🔒 Excluded ${alreadyRedeemedOrderIds.size} orders already redeemed by vouchers.`);

  // 4. Load Candidate SalesOrders with voucherAmount > 0 for settlement matching
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

  // 5. Generate Codes & Match Settlements
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
    const loc = resolveLocation(r);
    if (!loc) {
      console.warn(`⚠️ Unknown location: ${r.storeName} (code: ${r.locCode})`);
      continue;
    }

    const cleanShortCode = (loc.shortCode || loc.code)
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase();

    let code = `CRD-${cleanShortCode}${r.fySuffix}-${r.crNo.padStart(5, '0')}`;
    if (generatedCodes.has(code) || existingCodesInDb.has(code)) {
      let suffix = 2;
      while (generatedCodes.has(`${code}-${suffix}`) || existingCodesInDb.has(`${code}-${suffix}`)) {
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

    let description = r.narration || `Credit Voucher Issued | CrV#: ${r.crNo} | ${formatDate(r.date)}`;

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
            createdAt: matchedOrder.createdAt,
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
            amountUsed: new Prisma.Decimal(r.creditAmt),
            notes: `Redeemed in Sales Order ${matchedOrder.orderNumber} (PKR ${r.creditAmt.toLocaleString()})`,
            createdAt: matchedOrder.createdAt,
          }
        : null,
    });
  }

  console.log(`\n======================================================`);
  console.log(`📊 PREPARATION SUMMARY FOR [${companyName}]`);
  console.log(`======================================================`);
  console.log(`   - Total Credit Vouchers to Import      : ${preparedVouchers.length.toLocaleString()}`);
  console.log(`   - Total Face Value (PKR)               : PKR ${(redeemedValue + unredeemedValue).toLocaleString()}`);
  console.log(`   - Settled / Redeemed Vouchers          : ${redeemedCount.toLocaleString()} (PKR ${redeemedValue.toLocaleString()})`);
  console.log(`   - Active / Outstanding Vouchers        : ${unredeemedCount.toLocaleString()} (PKR ${unredeemedValue.toLocaleString()})`);
  console.log(`======================================================\n`);

  if (isDryRun) {
    console.log(`⚠️ [DRY-RUN] Execution completed without database modifications.`);
    return;
  }

  // 6. Insert into Database in Chunks of 100
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

  // 7. Update SalesOrder notes with redemption tags
  if (orderNotesToUpdate.length > 0) {
    console.log(`📝 Updating notes on ${orderNotesToUpdate.length} redeemed SalesOrders...`);
    for (const item of orderNotesToUpdate) {
      await prisma.salesOrder.update({
        where: { id: item.id },
        data: { notes: item.notes },
      });
    }
  }

  // 8. Verification Summary
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
  const wipeExisting = process.argv.includes('--clean') || process.argv.includes('--wipe');
  const deleteOnly = process.argv.includes('--delete-only') || process.argv.includes('--wipe-only');
  const tenantFilter = process.argv.find((arg) => arg.startsWith('--tenant='))?.split('=')[1];

  let filePath = path.join(__dirname, '..', 'data', 'credit_vouchers_1_25.md');
  const fileArg = process.argv.find((arg) => arg.startsWith('--file=') || arg.startsWith('--path='));
  if (fileArg) {
    const customPath = fileArg.split('=')[1];
    filePath = path.isAbsolute(customPath) ? customPath : path.join(process.cwd(), customPath);
  } else if (!fs.existsSync(filePath)) {
    // fallback to legacy file if credit_vouchers_1_25.md doesn't exist
    filePath = path.join(__dirname, '..', 'data', 'credit-voucher.md');
  }

  console.log(`\n======================================================`);
  console.log(`🚀 CREDIT VOUCHERS IMPORT & SETTLEMENT PIPELINE`);
  console.log(`======================================================`);
  console.log(`📄 Target Data File: ${filePath}`);
  if (isDryRun) {
    console.log(`⚠️ DRY RUN MODE: No changes will be written.`);
  }
  if (wipeExisting) {
    console.log(`⚠️ WIPE MODE ACTIVE: Existing credit vouchers will be cleared before import.`);
  } else {
    console.log(`🛡️ SAFE INCREMENTAL MODE: Preserving all existing vouchers in database.`);
  }
  if (deleteOnly) {
    console.log(`🗑️ DELETE-ONLY MODE: Existing credit vouchers will be deleted.`);
  }

  const rows = deleteOnly ? [] : readAndParseCreditVouchers(filePath);
  if (!deleteOnly) {
    console.log(`📄 Successfully parsed ${rows.length.toLocaleString()} credit vouchers from data file.`);
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
            const encUser = encodeURIComponent(company.dbUser || '');
            connectionString = `postgresql://${encUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch (e: any) {
            console.warn(`⚠️ Could not decrypt password for company ${company.name}, using dbUrl directly.`);
          }
        }

        const tenantPool = new Pool({ connectionString });
        const tenantAdapter = new PrismaPg(tenantPool);
        const prisma = new PrismaClient({ adapter: tenantAdapter } as any);

        try {
          await processTenantCreditVouchers(prisma, company.name, rows, isDryRun, wipeExisting, deleteOnly);
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

  // Direct connection fallback
  const directUrl =
    process.env.TENANT_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi?schema=public';

  console.log(`\n⚙️ Connecting directly via database URL...`);
  const directPool = new Pool({ connectionString: directUrl });
  const directAdapter = new PrismaPg(directPool);
  const prisma = new PrismaClient({ adapter: directAdapter } as any);

  try {
    await processTenantCreditVouchers(prisma, 'Direct Database', rows, isDryRun, wipeExisting, deleteOnly);
  } finally {
    await prisma.$disconnect();
    await directPool.end();
  }
}

main().catch((err) => {
  console.error('❌ Fatal error in credit vouchers script:', err);
  process.exit(1);
});
