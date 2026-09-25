import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const tenantDbUrl =
  process.env.TENANT_DATABASE_URL ||
  'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi?schema=public';

const pool = new Pool({
  connectionString: tenantDbUrl,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter: adapter as any });

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
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function getFiscalYearSuffix(d: Date): string {
  // Fiscal year runs July 1 to June 30
  // If month is >= July (month index 6), FY ends next year (e.g. July 2026 -> FY 2026-2027 -> '27')
  // If month is < July, FY ends this year (e.g. Jan 2027 -> FY 2026-2027 -> '27')
  const month = d.getMonth(); // 0-indexed
  const year = d.getFullYear();
  const fyEndingYear = month >= 6 ? year + 1 : year;
  return String(fyEndingYear).slice(-2);
}

interface ParsedRow {
  storeName: string;
  locCode: string;
  serialDate: number;
  crNo: string;
  creditAmt: number;
  rawNarration: string;
  date: Date;
  fySuffix: string;
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  console.log(`\n======================================================`);
  console.log(`🚀 IMPORTING CREDIT VOUCHERS ${isDryRun ? '[DRY RUN]' : '[LIVE]'}`);
  console.log(`======================================================`);

  const mdPath = path.join(__dirname, '../data/credit-voucher.md');
  if (!fs.existsSync(mdPath)) {
    console.error(`❌ Data file not found at: ${mdPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(mdPath, 'utf8');
  const lines = content.split('\n');

  const rows: ParsedRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|') || line.includes('---') || line.includes('__EMPTY') || line.includes('Store')) {
      continue;
    }
    const cols = line.split('|').map((c) => c.trim()).filter(Boolean);
    if (cols.length >= 5) {
      const storeName = cols[0];
      const locCode = cols[1];
      const serialDate = parseFloat(cols[2]);
      const crNo = String(cols[3]).trim();
      const creditAmt = parseFloat(cols[4]);
      const rawNarration = cols.length >= 6 ? cols[5].replace(/\\/g, '').trim() : '';

      if (!isNaN(serialDate) && !isNaN(creditAmt) && creditAmt > 0) {
        const date = excelDateToJSDate(serialDate);
        const fySuffix = getFiscalYearSuffix(date);
        rows.push({
          storeName,
          locCode,
          serialDate,
          crNo,
          creditAmt,
          rawNarration,
          date,
          fySuffix,
        });
      }
    }
  }

  console.log(`📄 Parsed ${rows.length} valid credit voucher records from markdown.`);
  const totalAmount = rows.reduce((s, r) => s + r.creditAmt, 0);
  console.log(`💰 Total credit amount: Rs. ${totalAmount.toLocaleString()}`);

  // Fetch all locations
  const locations = await prisma.location.findMany({
    select: { id: true, code: true, name: true, shortCode: true },
  });
  const locMap = new Map<string, typeof locations[0]>();
  for (const l of locations) {
    locMap.set(l.code.toUpperCase(), l);
    if (l.shortCode) {
      locMap.set(l.shortCode.toUpperCase(), l);
    }
  }

  // Pre-load all sales orders and returns for smart invoice matching
  console.log('🔍 Pre-loading sales orders & pos returns for invoice matching...');
  const allOrders = await prisma.salesOrder.findMany({
    select: {
      id: true,
      orderNumber: true,
      locationId: true,
      grandTotal: true,
      voucherAmount: true,
      tenderType: true,
      createdAt: true,
      customerId: true,
      items: {
        select: {
          lineTotal: true,
          unitPrice: true,
        },
      },
    },
  });

  const allReturns = await prisma.posReturn.findMany({
    select: {
      id: true,
      returnNumber: true,
      salesOrderId: true,
      salesOrder: { select: { id: true, orderNumber: true, grandTotal: true, customerId: true } },
      totalRefundAmount: true,
      locationId: true,
      customerId: true,
      createdAt: true,
    },
  });

  // Index orders and returns for lightning-fast O(1) matching
  const returnsByLocAndAmt = new Map<string, typeof allReturns>();
  for (const r of allReturns) {
    const amtKey = `${r.locationId}_${Math.round(Number(r.totalRefundAmount))}`;
    if (!returnsByLocAndAmt.has(amtKey)) returnsByLocAndAmt.set(amtKey, []);
    returnsByLocAndAmt.get(amtKey)!.push(r);
  }

  const ordersByLocAndGrandTotal = new Map<string, typeof allOrders>();
  const ordersByLocAndVoucherAmt = new Map<string, typeof allOrders>();
  const ordersByLocAndItemAmt = new Map<string, typeof allOrders>();

  for (const o of allOrders) {
    const gtKey = `${o.locationId}_${Math.round(Number(o.grandTotal))}`;
    if (!ordersByLocAndGrandTotal.has(gtKey)) ordersByLocAndGrandTotal.set(gtKey, []);
    ordersByLocAndGrandTotal.get(gtKey)!.push(o);

    const vAmt = Math.round(Number(o.voucherAmount || 0));
    if (vAmt > 0) {
      const vKey = `${o.locationId}_${vAmt}`;
      if (!ordersByLocAndVoucherAmt.has(vKey)) ordersByLocAndVoucherAmt.set(vKey, []);
      ordersByLocAndVoucherAmt.get(vKey)!.push(o);
    }

    const seenItemPrices = new Set<number>();
    for (const it of o.items) {
      const p1 = Math.round(Number(it.lineTotal));
      const p2 = Math.round(Number(it.unitPrice));
      for (const p of [p1, p2]) {
        if (p > 0 && !seenItemPrices.has(p)) {
          seenItemPrices.add(p);
          const itKey = `${o.locationId}_${p}`;
          if (!ordersByLocAndItemAmt.has(itKey)) ordersByLocAndItemAmt.set(itKey, []);
          ordersByLocAndItemAmt.get(itKey)!.push(o);
        }
      }
    }
  }

  console.log(`✅ Loaded & indexed ${allOrders.length} sales orders and ${allReturns.length} returns across ${locations.length} locations.`);

  // Generate unique codes and find matching original invoice
  const generatedCodes = new Set<string>();
  let matchedOrdersCount = 0;
  let insertedCount = 0;

  // Track matched sales order IDs to avoid duplicate mapping where possible
  const usedOrderIds = new Set<string>();

  const vouchersToCreate: any[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const loc = locMap.get(r.locCode.toUpperCase());
    if (!loc) {
      console.warn(`⚠️ Unknown location code: ${r.locCode} (${r.storeName})`);
      continue;
    }

    const cleanShortCode = (loc.shortCode || loc.code)
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase();

    // Auto-formatted voucher code: CRD-{LOC_SHORT}{FY}-{SEQ5}
    let code = `CRD-${cleanShortCode}${r.fySuffix}-${r.crNo.padStart(5, '0')}`;
    if (generatedCodes.has(code)) {
      // Fallback if duplicate voucher number in same location
      let suffix = 2;
      while (generatedCodes.has(`${code}-${suffix}`)) {
        suffix++;
      }
      code = `${code}-${suffix}`;
    }
    generatedCodes.add(code);

    // Search for original invoice / sales order / return
    let matchedOrderId: string | null = null;
    let matchedOrderNum: string | null = null;
    let matchedCustomerId: string | null = null;

    const roundedAmt = Math.round(r.creditAmt);
    const lookupKey = `${loc.id}_${roundedAmt}`;
    const rTime = r.date.getTime();

    // 1. Search in PosReturns for matching refund amount at this store
    const candidateReturns = returnsByLocAndAmt.get(lookupKey) || [];
    const retMatch = candidateReturns.find(
      (ret) => !ret.salesOrderId || !usedOrderIds.has(ret.salesOrderId),
    );
    if (retMatch && retMatch.salesOrder) {
      matchedOrderId = retMatch.salesOrder.id;
      matchedOrderNum = retMatch.salesOrder.orderNumber;
      matchedCustomerId = retMatch.salesOrder.customerId || retMatch.customerId;
      usedOrderIds.add(retMatch.salesOrder.id);
    }

    // 2. Search in SalesOrders: exact voucher tender match
    if (!matchedOrderId) {
      const candidateVOrders = ordersByLocAndVoucherAmt.get(lookupKey) || [];
      const vOrder = candidateVOrders.find((o) => !usedOrderIds.has(o.id));
      if (vOrder) {
        matchedOrderId = vOrder.id;
        matchedOrderNum = vOrder.orderNumber;
        matchedCustomerId = vOrder.customerId;
        usedOrderIds.add(vOrder.id);
      }
    }

    // 3. Search in SalesOrders: grandTotal on closest date
    if (!matchedOrderId) {
      const candidateGTOrders = ordersByLocAndGrandTotal.get(lookupKey) || [];
      // Sort by closest date
      let bestOrder: typeof allOrders[0] | null = null;
      let minDiffDays = Infinity;
      for (const o of candidateGTOrders) {
        if (usedOrderIds.has(o.id)) continue;
        const diffDays = Math.abs(o.createdAt.getTime() - rTime) / 86400000;
        if (diffDays < minDiffDays) {
          minDiffDays = diffDays;
          bestOrder = o;
        }
      }
      if (bestOrder) {
        matchedOrderId = bestOrder.id;
        matchedOrderNum = bestOrder.orderNumber;
        matchedCustomerId = bestOrder.customerId;
        usedOrderIds.add(bestOrder.id);
      }
    }

    // 4. Search in SalesOrders: matching item lineTotal / unitPrice on closest date
    if (!matchedOrderId) {
      const candidateItemOrders = ordersByLocAndItemAmt.get(lookupKey) || [];
      let bestOrder: typeof allOrders[0] | null = null;
      let minDiffDays = Infinity;
      for (const o of candidateItemOrders) {
        if (usedOrderIds.has(o.id)) continue;
        const diffDays = Math.abs(o.createdAt.getTime() - rTime) / 86400000;
        if (diffDays < minDiffDays) {
          minDiffDays = diffDays;
          bestOrder = o;
        }
      }
      if (bestOrder) {
        matchedOrderId = bestOrder.id;
        matchedOrderNum = bestOrder.orderNumber;
        matchedCustomerId = bestOrder.customerId;
        usedOrderIds.add(bestOrder.id);
      }
    }

    if (matchedOrderId) {
      matchedOrdersCount++;
    }

    // Format narration / description
    let description = r.rawNarration
      ? r.rawNarration
      : `Credit Voucher Issued | CrV#: ${r.crNo} | ${formatDate(r.date)}`;
    
    if (matchedOrderNum) {
      description += ` (Linked Order: ${matchedOrderNum})`;
    }

    vouchersToCreate.push({
      code,
      voucherType: 'CREDIT',
      faceValue: r.creditAmt,
      discount: 0,
      description,
      issuedByLocationId: loc.id,
      sourceOrderId: matchedOrderId,
      customerId: matchedCustomerId,
      createdAt: r.date,
      isActive: true,
      isRedeemed: false,
      locationId: loc.id,
      locName: loc.name,
      crNo: r.crNo,
      matchedOrderNum,
    });
  }

  console.log(`\n📊 Preparation Complete:`);
  console.log(`- Total Credit Vouchers to Import: ${vouchersToCreate.length}`);
  console.log(`- Successfully Linked to Sales Orders / Invoices: ${matchedOrdersCount}`);
  console.log(`- Standalone Credit Vouchers: ${vouchersToCreate.length - matchedOrdersCount}`);
  console.log(`- Sample Auto-formatted Codes:`, vouchersToCreate.slice(0, 5).map((v) => `${v.code} -> Rs.${v.faceValue} (${v.description})`));

  if (isDryRun) {
    console.log(`\n🏁 Dry run finished successfully. Run without --dry-run to commit.`);
    return;
  }

  // Insert in batches
  console.log(`\n💾 Inserting credit vouchers into database in batches...`);
  const BATCH_SIZE = 50;
  for (let i = 0; i < vouchersToCreate.length; i += BATCH_SIZE) {
    const batch = vouchersToCreate.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      batch.map((v) =>
        prisma.voucher.create({
          data: {
            code: v.code,
            voucherType: 'CREDIT',
            faceValue: v.faceValue,
            discount: 0,
            description: v.description,
            issuedByLocationId: v.issuedByLocationId,
            sourceOrderId: v.sourceOrderId,
            customerId: v.customerId,
            createdAt: v.createdAt,
            isActive: true,
            isRedeemed: false,
            locations: {
              create: [{ locationId: v.locationId }],
            },
            transactions: {
              create: {
                action: 'ISSUED',
                amountUsed: 0,
                locationId: v.locationId,
                notes: `Credit Voucher CrV# ${v.crNo} issued at ${v.locName}${v.matchedOrderNum ? ` (Linked Invoice: ${v.matchedOrderNum})` : ''}`,
                createdAt: v.createdAt,
              },
            },
          },
        }),
      ),
    );
    insertedCount += batch.length;
    process.stdout.write(`\r  Progress: ${insertedCount} / ${vouchersToCreate.length} vouchers created...`);
  }

  console.log(`\n\n🎉 Successfully imported ${insertedCount} Credit Vouchers into the system!`);
  
  // Verify final count in DB
  const creditVoucherCount = await prisma.voucher.count({
    where: { voucherType: 'CREDIT', isDeleted: false },
  });
  const creditVoucherSum = await prisma.voucher.aggregate({
    where: { voucherType: 'CREDIT', isDeleted: false },
    _sum: { faceValue: true },
  });

  console.log(`\n✅ Database Verification:`);
  console.log(`- Active CREDIT Vouchers in DB: ${creditVoucherCount}`);
  console.log(`- Total Face Value in DB: Rs. ${Number(creditVoucherSum._sum.faceValue || 0).toLocaleString()}`);
}

main()
  .catch((e) => {
    console.error('❌ Import Failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
