import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

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

/**
 * Flexible date parser supporting:
 * - Excel date serial numbers (e.g. 44026 -> 2020-07-14, 45129.52916666667)
 * - DD/MM/YYYY or MM/DD/YYYY or YYYY-MM-DD
 * - ISO date strings
 */
export function parseFlexibleDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;

  // Handle Excel numeric serial dates (e.g. 44026)
  if (typeof val === 'number' || (!isNaN(Number(val)) && !String(val).includes('/') && !String(val).includes('-'))) {
    const num = Number(val);
    if (num > 20000 && num < 70000) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      return new Date(excelEpoch.getTime() + num * 86400000);
    }
  }

  const str = String(val).trim();
  if (!str || str === 'null' || str === '-') return null;

  if (str.includes('/')) {
    const [datePart, timePart] = str.split(/\s+/);
    const parts = datePart.split('/').map(Number);
    if (parts.length === 3) {
      const [d, m, y] = parts;
      const [hh, mm, ss] = (timePart || '00:00:00').split(':').map(Number);
      const year = y < 100 ? 2000 + y : y;
      const parsed = new Date(Date.UTC(year, m - 1, d, hh || 0, mm || 0, ss || 0));
      if (!isNaN(parsed.getTime())) return parsed;
    }
  }

  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export interface ParsedCorporateVoucherRow {
  rowNum: number;
  costCentre: string;
  locationCode: string;
  companyName: string;
  companyAddress: string;
  documentNumber: string;
  documentDateStr: string;
  documentDate: Date;
  voucherNumber: number;
  voucherCode: string;
  voucherValue: number;
  dateValidStr: string;
  dateValid: Date | null;
  documentNumberSettled: string;
  dateSettledStr: string;
  dateSettled: Date | null;
  traderName: string;
  abbr: string;
  description: string;
  remarks: string;
  isSettled: boolean;
}

/**
 * Parses markdown table data from file handling escaped pipes and structure.
 */
export function readAndParseCorporateVouchers(filePath: string, limit?: number): ParsedCorporateVoucherRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Corporate vouchers data file not found at: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('| CostCentre |') || lines[i].includes('| CostCentre|')) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    throw new Error(`Could not find header row "| CostCentre |" in ${filePath}`);
  }

  const rawHeaders = lines[headerIndex].split('|').map((h) => h.trim()).filter(Boolean);

  const colIdx = {
    costCentre: rawHeaders.findIndex((h) => h.toLowerCase().includes('costcentre')),
    locationCode: rawHeaders.findIndex((h) => h.toLowerCase().includes('location code')),
    companyName: rawHeaders.findIndex((h) => h.toLowerCase().includes('companyname')),
    companyAddress: rawHeaders.findIndex((h) => h.toLowerCase().includes('companyaddress')),
    documentNumber: rawHeaders.findIndex((h) => h.toLowerCase() === 'documentnumber'),
    documentDate: rawHeaders.findIndex((h) => h.toLowerCase() === 'documentdate'),
    voucherNumber: rawHeaders.findIndex((h) => h.toLowerCase() === 'vouchernumber'),
    voucherValue: rawHeaders.findIndex((h) => h.toLowerCase() === 'vouchervalue'),
    dateValid: rawHeaders.findIndex((h) => h.toLowerCase() === 'date_valid'),
    documentNumberSettled: rawHeaders.findIndex((h) => h.toLowerCase() === 'documentnumber_setteled'),
    dateSettled: rawHeaders.findIndex((h) => h.toLowerCase() === 'date_setteled'),
    traderName: rawHeaders.findIndex((h) => h.toLowerCase() === 'tradername'),
    abbr: rawHeaders.findIndex((h) => h.toLowerCase() === 'abbr'),
    description: rawHeaders.findIndex((h) => h.toLowerCase() === 'description'),
    remarks: rawHeaders.findIndex((h) => h.toLowerCase() === 'remarks'),
  };

  const parsedRows: ParsedCorporateVoucherRow[] = [];
  const placeholder = '__PIPE_ESC__';

  for (let i = headerIndex + 2; i < lines.length; i++) {
    if (limit && parsedRows.length >= limit) break;

    const line = lines[i].trim();
    if (!line || !line.startsWith('|')) continue;

    const sanitizedLine = line.replace(/\\\|/g, placeholder);
    const cols = sanitizedLine.split('|').map((c) => c.replace(new RegExp(placeholder, 'g'), '|').trim());
    if (cols.length > 1 && cols[0] === '') cols.shift();
    if (cols.length > 0 && cols[cols.length - 1] === '') cols.pop();

    if (cols.length < 8) continue;

    const vNumRaw = cols[colIdx.voucherNumber] || '';
    const vNum = parseInt(vNumRaw, 10);
    if (isNaN(vNum)) continue;

    const vVal = parseFloat(cols[colIdx.voucherValue] || '0') || 0;
    const docDateStr = cols[colIdx.documentDate] || '';
    const docDate = parseFlexibleDate(docDateStr) || new Date('2026-07-01');

    const validTillStr = cols[colIdx.dateValid] || '';
    const dateValid = parseFlexibleDate(validTillStr);

    const docSettled = (cols[colIdx.documentNumberSettled] || '').trim();
    const isSettled = Boolean(docSettled && docSettled !== '' && docSettled !== 'null' && docSettled !== '-');

    const dateSettledStr = cols[colIdx.dateSettled] || '';
    const dateSettled = parseFlexibleDate(dateSettledStr);

    // Standardized unique corporate voucher code format: CRP-00001 ... CRP-10009
    const voucherCode = `CRP-${String(vNum).padStart(5, '0')}`;

    parsedRows.push({
      rowNum: parsedRows.length + 1,
      costCentre: cols[colIdx.costCentre] || '',
      locationCode: cols[colIdx.locationCode] || '',
      companyName: cols[colIdx.companyName] || 'Speed Pvt. Ltd.',
      companyAddress: cols[colIdx.companyAddress] || '',
      documentNumber: cols[colIdx.documentNumber] || '',
      documentDateStr: docDateStr,
      documentDate: docDate,
      voucherNumber: vNum,
      voucherCode,
      voucherValue: vVal,
      dateValidStr: validTillStr,
      dateValid,
      documentNumberSettled: docSettled,
      dateSettledStr,
      dateSettled,
      traderName: cols[colIdx.traderName] || '',
      abbr: cols[colIdx.abbr] || '',
      description: cols[colIdx.description] || '',
      remarks: cols[colIdx.remarks] || '',
      isSettled,
    });
  }

  return parsedRows;
}

/**
 * Cleans all existing corporate vouchers and their related transactions, redemptions, and locations.
 */
export async function cleanExistingCorporateVouchers(prisma: PrismaClient) {
  console.log(`🧹 Checking existing corporate vouchers in database...`);

  const existingCount = await prisma.voucher.count({
    where: { voucherType: 'CORPORATE' },
  });

  if (existingCount === 0) {
    console.log(`ℹ️ No existing corporate vouchers found in database.`);
    return;
  }

  console.log(`🗑️ Removing ${existingCount.toLocaleString()} existing corporate vouchers and dependent records...`);

  // 1. Unlink PosClaim and PosReturn if any point to corporate vouchers
  await prisma.posClaim.updateMany({
    where: { voucher: { voucherType: 'CORPORATE' } },
    data: { voucherId: null },
  });

  await prisma.posReturn.updateMany({
    where: { voucher: { voucherType: 'CORPORATE' } },
    data: { voucherId: null },
  });

  // 2. Delete VoucherRedemption records for CORPORATE vouchers
  const deletedRedemptions = await prisma.voucherRedemption.deleteMany({
    where: { voucher: { voucherType: 'CORPORATE' } },
  });

  // 3. Delete VoucherTransaction records for CORPORATE vouchers
  const deletedTransactions = await prisma.voucherTransaction.deleteMany({
    where: { voucher: { voucherType: 'CORPORATE' } },
  });

  // 4. Delete VoucherLocation records for CORPORATE vouchers
  const deletedLocations = await prisma.voucherLocation.deleteMany({
    where: { voucher: { voucherType: 'CORPORATE' } },
  });

  // 5. Delete Voucher records of type CORPORATE
  const deletedVouchers = await prisma.voucher.deleteMany({
    where: { voucherType: 'CORPORATE' },
  });

/**
 * Synchronizes and verifies SalesOrder tender amounts and notes for all redeemed vouchers.
 */
export async function syncOrderTendersWithRedemptions(prisma: PrismaClient) {
  console.log(`\n🔗 Synchronizing and verifying SalesOrder tender amounts for redeemed vouchers...`);

  // 1. Fetch all redemptions with their voucher details
  const allRedemptions = await prisma.voucherRedemption.findMany({
    include: {
      voucher: {
        select: { code: true, voucherType: true, faceValue: true },
      },
      order: {
        select: {
          id: true,
          orderNumber: true,
          grandTotal: true,
          voucherAmount: true,
          cashAmount: true,
          cardAmount: true,
          tenderType: true,
          paymentMethod: true,
          notes: true,
        },
      },
    },
  });

  if (allRedemptions.length === 0) {
    console.log(`ℹ️ No voucher redemptions found to synchronize.`);
    return;
  }

  // 2. Group by order
  const orderMap = new Map<
    string,
    {
      order: typeof allRedemptions[0]['order'];
      totalRedeemed: number;
      vouchers: Array<{ code: string; amount: number; type: string }>;
    }
  >();

  for (const r of allRedemptions) {
    if (!r.order) continue;
    const existing = orderMap.get(r.orderId);
    const amt = Number(r.amountUsed);
    if (!existing) {
      orderMap.set(r.orderId, {
        order: r.order,
        totalRedeemed: amt,
        vouchers: [{ code: r.voucher.code, amount: amt, type: r.voucher.voucherType }],
      });
    } else {
      existing.totalRedeemed += amt;
      existing.vouchers.push({ code: r.voucher.code, amount: amt, type: r.voucher.voucherType });
    }
  }

  console.log(`🔍 Found ${orderMap.size.toLocaleString()} unique SalesOrders linked to voucher redemptions.`);

  let updatedCount = 0;
  const updates: any[] = [];

  for (const [orderId, { order, totalRedeemed, vouchers }] of orderMap.entries()) {
    const grandTotal = Number(order.grandTotal || 0);
    const voucherAmount = totalRedeemed;
    const remainingToPay = Math.max(0, grandTotal - voucherAmount);

    let cashAmount = Number(order.cashAmount || 0);
    let cardAmount = Number(order.cardAmount || 0);
    let tenderType = order.tenderType || 'CASH';
    let paymentMethod = order.paymentMethod || 'cash';

    if (remainingToPay === 0) {
      cashAmount = 0;
      cardAmount = 0;
      tenderType = 'VOUCHER';
      paymentMethod = 'voucher';
    } else {
      paymentMethod = 'split';
      if (cardAmount > 0) {
        cardAmount = remainingToPay;
        cashAmount = 0;
        if (!tenderType.includes('VOUCHER')) {
          tenderType = `${tenderType} + VOUCHER`;
        }
      } else if (cashAmount > 0) {
        cashAmount = remainingToPay;
        cardAmount = 0;
        if (!tenderType.includes('VOUCHER')) {
          tenderType = 'CASH + VOUCHER';
        }
      } else {
        cashAmount = remainingToPay;
        tenderType = 'CASH + VOUCHER';
      }
    }

    const vCodeStr = vouchers.map((v) => `${v.code} (PKR ${v.amount.toLocaleString()})`).join(', ');
    const noteTag = `[Voucher Redeemed: ${vCodeStr}]`;
    let newNotes = order.notes || '';
    if (!newNotes.includes(noteTag)) {
      newNotes = newNotes ? `${newNotes} | ${noteTag}` : noteTag;
    }

    updates.push({
      id: orderId,
      voucherAmount: new Prisma.Decimal(voucherAmount),
      cashAmount: cashAmount > 0 ? new Prisma.Decimal(cashAmount) : new Prisma.Decimal(0),
      cardAmount: cardAmount > 0 ? new Prisma.Decimal(cardAmount) : new Prisma.Decimal(0),
      tenderType,
      paymentMethod,
      paymentStatus: 'paid',
      notes: newNotes,
    });
  }

  // Execute in batches of 250
  const BATCH_SIZE = 250;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const chunk = updates.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      chunk.map((u) =>
        prisma.salesOrder.update({
          where: { id: u.id },
          data: {
            voucherAmount: u.voucherAmount,
            cashAmount: u.cashAmount,
            cardAmount: u.cardAmount,
            tenderType: u.tenderType,
            paymentMethod: u.paymentMethod,
            paymentStatus: u.paymentStatus,
            notes: u.notes,
          },
        }),
      ),
    );
    updatedCount += chunk.length;
  }

  console.log(`✅ Successfully verified and synchronized tender amounts on ${updatedCount.toLocaleString()} SalesOrders.`);
}

/**
 * Imports corporate vouchers and links settlements/redemptions for a single tenant.
 */
async function processTenantCorporateVouchers(
  prisma: PrismaClient,
  companyName: string,
  rows: ParsedCorporateVoucherRow[],
  isDryRun: boolean,
  deleteOnly: boolean = false,
  keepExisting: boolean = false,
) {
  console.log(`\n======================================================`);
  console.log(`🏢 Processing Tenant: [${companyName}]`);
  console.log(`======================================================`);

  if (!keepExisting) {
    if (isDryRun) {
      const existingCount = await prisma.voucher.count({
        where: { voucherType: 'CORPORATE' },
      });
      console.log(`⚠️ [DRY-RUN] Would remove ${existingCount.toLocaleString()} existing corporate vouchers.`);
    } else {
      await cleanExistingCorporateVouchers(prisma);
    }
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

  const locByCode = new Map(locations.map((l) => [l.code.toUpperCase(), l]));
  const locByShortCode = new Map(
    locations.filter((l) => l.shortCode).map((l) => [l.shortCode!.toUpperCase(), l]),
  );
  const locByName = new Map(locations.map((l) => [l.name.toLowerCase().trim(), l]));

  function resolveLocation(row: ParsedCorporateVoucherRow) {
    if (row.locationCode) {
      const codeKey = row.locationCode.trim().toUpperCase();
      const byCode = locByCode.get(codeKey);
      if (byCode) return byCode;
      const byShort = locByShortCode.get(codeKey);
      if (byShort) return byShort;
    }

    if (row.costCentre) {
      const nameKey = row.costCentre.trim().toLowerCase();
      const byName = locByName.get(nameKey);
      if (byName) return byName;

      // Fuzzy matching for known outlet names
      const norm = nameKey.replace(/[^a-z0-9]/g, '');
      for (const loc of locations) {
        const locNorm = loc.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (locNorm && norm && (locNorm.includes(norm) || norm.includes(locNorm))) {
          return loc;
        }
      }
    }

    return null;
  }

  // 2. Fetch and Index SalesOrders for Redemption Linking
  console.log(`🔍 Loading SalesOrders to map voucher settlements...`);
  const orders = await prisma.salesOrder.findMany({
    select: {
      id: true,
      orderNumber: true,
      locationId: true,
      notes: true,
      voucherAmount: true,
      grandTotal: true,
      createdAt: true,
    },
  });
  console.log(`🧾 Indexed ${orders.length} SalesOrders from DB.`);

  // Lookup maps:
  // 1) "locationId:originalDocNo" -> SalesOrder
  // 2) "originalDocNo" -> SalesOrder[] (fallback if unique)
  // 3) "orderNumber" -> SalesOrder
  const orderByLocAndOrigDoc = new Map<string, typeof orders[0]>();
  const orderByOrigDocOnly = new Map<string, typeof orders[0][]>();
  const orderByOrderNumber = new Map<string, typeof orders[0]>();

  for (const o of orders) {
    orderByOrderNumber.set(o.orderNumber.toUpperCase(), o);

    if (o.notes) {
      const match = o.notes.match(/Original DocNo:\s*([^\s\|]+)/i);
      if (match && match[1]) {
        const origDoc = match[1].trim();
        const key = `${o.locationId}:${origDoc}`;
        orderByLocAndOrigDoc.set(key, o);

        const list = orderByOrigDocOnly.get(origDoc) || [];
        list.push(o);
        orderByOrigDocOnly.set(origDoc, list);
      }
    }
  }

  // 3. Process & prepare corporate vouchers in memory
  let totalFaceValue = 0;
  let settledCount = 0;
  let settledValue = 0;
  let unsettledCount = 0;
  let unsettledValue = 0;
  let dbOrderMatches = 0;
  let legacySettledMatches = 0;

  const tradersSet = new Set<string>();
  const voucherDataList: any[] = [];
  const locationDataList: any[] = [];
  const redemptionDataList: any[] = [];
  const transactionDataList: any[] = [];

  for (const row of rows) {
    totalFaceValue += row.voucherValue;
    if (row.traderName) tradersSet.add(row.traderName);

    const loc = resolveLocation(row);
    const compName = row.traderName || row.companyName || 'Corporate Account';
    const compGl = row.abbr || null;
    const desc = row.description || row.remarks || `Corporate Voucher #${row.voucherNumber} (${compName})`;

    const isRedeemed = row.isSettled;
    const isActive = !isRedeemed && (!row.dateValid || row.dateValid > new Date());

    let matchedOrder: typeof orders[0] | null = null;
    if (isRedeemed) {
      settledCount++;
      settledValue += row.voucherValue;

      if (loc) {
        matchedOrder = orderByLocAndOrigDoc.get(`${loc.id}:${row.documentNumberSettled}`) || null;
      }
      if (!matchedOrder) {
        const list = orderByOrigDocOnly.get(row.documentNumberSettled);
        if (list && list.length === 1) {
          matchedOrder = list[0];
        } else {
          matchedOrder = orderByOrderNumber.get(row.documentNumberSettled.toUpperCase()) || null;
        }
      }

      if (matchedOrder) {
        dbOrderMatches++;
      } else {
        legacySettledMatches++;
      }
    } else {
      unsettledCount++;
      unsettledValue += row.voucherValue;
    }

    const voucherId = crypto.randomUUID();

    voucherDataList.push({
      id: voucherId,
      code: row.voucherCode,
      voucherType: 'CORPORATE',
      faceValue: new Prisma.Decimal(row.voucherValue),
      companyName: compName,
      companyGlCode: compGl,
      description: desc,
      issuedByLocationId: loc?.id || null,
      isActive,
      isRedeemed,
      expiresAt: row.dateValid,
      createdAt: row.documentDate,
      updatedAt: row.dateSettled || row.documentDate,
    });

    if (loc?.id) {
      locationDataList.push({
        id: crypto.randomUUID(),
        voucherId,
        locationId: loc.id,
      });
    }

    if (isRedeemed) {
      if (matchedOrder) {
        redemptionDataList.push({
          id: crypto.randomUUID(),
          voucherId,
          orderId: matchedOrder.id,
          amountUsed: new Prisma.Decimal(row.voucherValue),
          createdAt: row.dateSettled || matchedOrder.createdAt,
        });

        transactionDataList.push({
          id: crypto.randomUUID(),
          voucherId,
          orderId: matchedOrder.id,
          locationId: matchedOrder.locationId,
          action: 'REDEEMED',
          amountUsed: new Prisma.Decimal(row.voucherValue),
          notes: `Redeemed in POS Order ${matchedOrder.orderNumber} (Cash Memo #${row.documentNumberSettled})`,
          createdAt: row.dateSettled || matchedOrder.createdAt,
        });
      } else {
        transactionDataList.push({
          id: crypto.randomUUID(),
          voucherId,
          orderId: null,
          locationId: loc?.id || null,
          action: 'REDEEMED',
          amountUsed: new Prisma.Decimal(row.voucherValue),
          notes: `Historically settled against legacy Doc #${row.documentNumberSettled}${row.dateSettled ? ` on ${row.dateSettled.toISOString().slice(0, 10)}` : ''}`,
          createdAt: row.dateSettled || row.documentDate,
        });
      }
    } else {
      transactionDataList.push({
        id: crypto.randomUUID(),
        voucherId,
        locationId: loc?.id || null,
        action: 'ISSUED',
        amountUsed: new Prisma.Decimal(row.voucherValue),
        notes: `Corporate voucher issued to ${compName} (Legacy Doc #${row.documentNumber})`,
        createdAt: row.documentDate,
      });
    }
  }

  if (isDryRun) {
    console.log(`\n⚠️ [DRY-RUN] Simulated preparation for ${voucherDataList.length.toLocaleString()} vouchers.`);
  } else {
    // Fast batch insertion in chunks of 1000 records
    const CHUNK_SIZE = 1000;
    const totalBatches = Math.ceil(voucherDataList.length / CHUNK_SIZE);

    console.log(`\n📥 Inserting ${voucherDataList.length.toLocaleString()} corporate vouchers in ${totalBatches} batch transactions...`);

    for (let b = 0; b < totalBatches; b++) {
      const vChunk = voucherDataList.slice(b * CHUNK_SIZE, (b + 1) * CHUNK_SIZE);
      const chunkVoucherIds = new Set(vChunk.map((v) => v.id));

      const locChunk = locationDataList.filter((l) => chunkVoucherIds.has(l.voucherId));
      const redChunk = redemptionDataList.filter((r) => chunkVoucherIds.has(r.voucherId));
      const txChunk = transactionDataList.filter((t) => chunkVoucherIds.has(t.voucherId));

      await prisma.$transaction(
        async (tx) => {
          await tx.voucher.createMany({ data: vChunk });
          if (locChunk.length > 0) {
            await tx.voucherLocation.createMany({ data: locChunk });
          }
          if (redChunk.length > 0) {
            await tx.voucherRedemption.createMany({ data: redChunk });
          }
          if (txChunk.length > 0) {
            await tx.voucherTransaction.createMany({ data: txChunk });
          }
        },
        { timeout: 60000 },
      );

      const progressPct = (((b + 1) / totalBatches) * 100).toFixed(1);
      process.stdout.write(`\r   ⚡ [IMPORTING] Batch ${b + 1}/${totalBatches} (${Math.min((b + 1) * CHUNK_SIZE, voucherDataList.length).toLocaleString()}/${voucherDataList.length.toLocaleString()} vouchers - ${progressPct}%)`);
    }
    console.log('\n');

    // Synchronize SalesOrder tender amounts with voucher redemptions
    await syncOrderTendersWithRedemptions(prisma);
  }

  console.log(`======================================================`);
  console.log(`✨ ${isDryRun ? '[DRY RUN SUMMARY]' : '[IMPORT COMPLETE SUMMARY]'}`);
  console.log(`======================================================`);
  console.log(`   - Total Corporate Vouchers  : ${rows.length.toLocaleString()}`);
  console.log(`   - Total Face Value (PKR)    : PKR ${totalFaceValue.toLocaleString()}`);
  console.log(`   - Distinct Corporate Clients: ${tradersSet.size}`);
  console.log(`   - Unsettled / Active Vouchers: ${unsettledCount.toLocaleString()} (PKR ${unsettledValue.toLocaleString()})`);
  console.log(`   - Settled / Redeemed Vouchers: ${settledCount.toLocaleString()} (PKR ${settledValue.toLocaleString()})`);
  console.log(`     ├── Linked to Active DB Orders: ${dbOrderMatches.toLocaleString()}`);
  console.log(`     └── Historical Settlements     : ${legacySettledMatches.toLocaleString()}`);
  console.log(`======================================================\n`);
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('-d');
  const deleteOnly = process.argv.includes('--delete-only') || process.argv.includes('--wipe-only');
  const keepExisting = process.argv.includes('--keep-existing');

  let limit: number | undefined = undefined;
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  if (limitArg) {
    limit = parseInt(limitArg.split('=')[1], 10);
  }

  const tenantFilter = process.argv.find((arg) => arg.startsWith('--tenant='))?.split('=')[1];

  let filePath = path.join(__dirname, '..', 'data', 'corportate_vouchers.md');
  const fileArg = process.argv.find((arg) => arg.startsWith('--file=') || arg.startsWith('--path='));
  if (fileArg) {
    const customPath = fileArg.split('=')[1];
    filePath = path.isAbsolute(customPath) ? customPath : path.join(process.cwd(), customPath);
  }

  console.log(`\n======================================================`);
  console.log(`🚀 Corporate Vouchers Import & Settlement Script`);
  console.log(`======================================================`);
  console.log(`📄 Target Data File: ${filePath}`);
  if (isDryRun) {
    console.log(`⚠️ DRY RUN MODE: No database changes will be committed.`);
  }
  if (deleteOnly) {
    console.log(`🗑️ DELETE-ONLY MODE: All corporate vouchers will be wiped without importing.`);
  }

  const rows = deleteOnly ? [] : readAndParseCorporateVouchers(filePath, limit);
  if (!deleteOnly) {
    console.log(`📄 Successfully parsed ${rows.length.toLocaleString()} corporate voucher rows from file.`);

    if (rows.length > 0) {
      console.log(`\n🔍 First Sample Voucher (#${rows[0].voucherNumber}):`);
      console.log(`   - Code        : ${rows[0].voucherCode}`);
      console.log(`   - Trader      : ${rows[0].traderName} (${rows[0].abbr})`);
      console.log(`   - Value       : PKR ${rows[0].voucherValue.toLocaleString()}`);
      console.log(`   - Doc Date    : ${rows[0].documentDate.toISOString().slice(0, 10)}`);
      console.log(`   - Valid Till  : ${rows[0].dateValid ? rows[0].dateValid.toISOString().slice(0, 10) : 'No Expiry'}`);
      console.log(`   - Settled Doc : ${rows[0].documentNumberSettled || 'Unsettled / Active'}`);
    }
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
          await processTenantCorporateVouchers(prisma, company.name, rows, isDryRun, deleteOnly, keepExisting);
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

  // Fallback to direct DATABASE_URL
  console.log(`\n⚙️ Connecting directly via DATABASE_URL...`);
  const directPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const directAdapter = new PrismaPg(directPool);
  const prisma = new PrismaClient({ adapter: directAdapter } as any);

  try {
    await processTenantCorporateVouchers(prisma, 'Direct Database', rows, isDryRun, deleteOnly, keepExisting);
  } finally {
    await prisma.$disconnect();
    await directPool.end();
  }
}

main().catch((err) => {
  console.error('❌ Fatal error in corporate vouchers script:', err);
  process.exit(1);
});

