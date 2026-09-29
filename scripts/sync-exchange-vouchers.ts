import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';

function cleanLocCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function parseExcelDate(val: string | number): Date {
  const num = typeof val === 'number' ? val : parseFloat(String(val));
  if (isNaN(num) || num <= 0) return new Date();
  return new Date(new Date(Date.UTC(1899, 11, 30)).getTime() + num * 86400000);
}

function isValidDoc(val: string): boolean {
  return Boolean(val && val.trim() && val !== '0' && val !== '-' && val !== 'null' && val !== '');
}

const CHUNK_SIZE = 300;

async function main() {
  const connectionString =
    process.argv.find((a) => a.startsWith('--db='))?.split('=')[1] ||
    process.env.DATABASE_URL_TENANT ||
    'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi';

  console.log(`\n======================================================`);
  console.log(`🔄 Synchronizing Exchange Vouchers from exchange_voucher.md`);
  console.log(`======================================================`);

  const pool = new Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const filePath = path.join(__dirname, '../data/exchange_voucher.md');
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  console.log(`📖 Reading ${filePath}...`);
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content
    .split('\n')
    .filter((l) => l.trim().startsWith('|') && !l.includes('---') && !l.includes('CostCentre'));

  const rows = lines.map((line) => {
    const parts = line.split('|').map((s) => s.trim());
    return {
      costCentre:     parts[1],
      locId:          parts[2],
      docNo:          parts[3],
      docDateRaw:     parts[4],
      fkSaleDoc:      parts[5],
      docDateSaleRaw: parts[6],
      fkExchangeDoc:  parts[7],   // new exchange order / redemption invoice
      docDateExchangeRaw: parts[8],
      totalNet:       parseFloat(parts[9]) || 0,
      remarks:        parts[10] && parts[10] !== '-' ? parts[10] : '',
    };
  });

  console.log(`📦 Loaded ${rows.length} total item rows.`);

  // Group by (locId, docNo)
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.locId.toUpperCase()}::${r.docNo}`;
    const list = groups.get(key) || [];
    list.push(r);
    groups.set(key, list);
  }
  console.log(`📑 Identified ${groups.size} unique Exchange voucher memos.`);

  // Load locations
  const locations = await prisma.location.findMany({
    select: { id: true, code: true, shortCode: true, name: true },
  });
  const locByCode = new Map<string, typeof locations[0]>();
  for (const l of locations) {
    if (l.code) locByCode.set(l.code.toUpperCase(), l);
    if (l.shortCode) locByCode.set(cleanLocCode(l.shortCode), l);
  }

  // Load all SalesOrders for redemption matching
  console.log(`🔍 Loading SalesOrders for redemption matching...`);
  const orders = await prisma.salesOrder.findMany({
    select: { id: true, orderNumber: true, locationId: true, notes: true, voucherAmount: true, grandTotal: true, createdAt: true },
  });
  const orderByLocAndPad = new Map<string, typeof orders[0]>();
  const orderByOrderNum = new Map<string, typeof orders[0]>();
  const orderByOrigDoc = new Map<string, typeof orders[0][]>();

  for (const o of orders) {
    orderByOrderNum.set(o.orderNumber.toUpperCase(), o);
    if (o.notes) {
      const m = o.notes.match(/Original DocNo:\s*([^\s|]+)/i);
      if (m) {
        const origDoc = m[1].trim();
        const key = `${o.locationId}::${origDoc}`;
        orderByLocAndPad.set(key, o);
        const list = orderByOrigDoc.get(origDoc) || [];
        list.push(o);
        orderByOrigDoc.set(origDoc, list);
      }
    }
  }
  console.log(`🧾 Indexed ${orders.length} SalesOrders.`);

  // Load existing EXCHANGE vouchers
  const existingVouchers = await prisma.voucher.findMany({
    where: { voucherType: 'EXCHANGE' },
    select: { id: true, code: true, faceValue: true, isRedeemed: true },
  });
  const voucherByCode = new Map(existingVouchers.map((v) => [v.code, v]));
  console.log(`💳 Found ${existingVouchers.length} existing EXCHANGE vouchers in DB.`);

  // Load existing redemptions to avoid duplicates
  const existingRedemptions = await prisma.voucherRedemption.findMany({
    where: { voucher: { voucherType: 'EXCHANGE' } },
    select: { id: true, voucherId: true, orderId: true },
  });
  const redemptionByVoucher = new Map(existingRedemptions.map((r) => [r.voucherId, r]));

  function resolveLocation(locId: string, costCentre?: string) {
    const loc = locByCode.get(locId.toUpperCase());
    if (loc) return loc;
    if (costCentre) {
      const norm = costCentre.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const l of locations) {
        const lnorm = l.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (lnorm && norm && (lnorm.includes(norm) || norm.includes(lnorm))) return l;
      }
    }
    return null;
  }

  function findOrder(exchangeDoc: string, loc: typeof locations[0] | null): typeof orders[0] | null {
    if (!isValidDoc(exchangeDoc)) return null;
    const pad5 = String(exchangeDoc).padStart(5, '0');

    // 1. By location + origDoc from notes
    if (loc) {
      const o = orderByLocAndPad.get(`${loc.id}::${exchangeDoc}`) ||
                orderByLocAndPad.get(`${loc.id}::${pad5}`);
      if (o) return o;
    }

    // 2. By order number suffix
    if (loc) {
      const shortCode = loc.shortCode ? cleanLocCode(loc.shortCode) : cleanLocCode(loc.code);
      const candidate27 = `SI-${shortCode}27-${pad5}`;
      const candidate26 = `SI-${shortCode}26-${pad5}`;
      const o = orderByOrderNum.get(candidate27.toUpperCase()) || orderByOrderNum.get(candidate26.toUpperCase());
      if (o) return o;
    }

    // 3. By origDoc from notes only
    const list = orderByOrigDoc.get(exchangeDoc) || orderByOrigDoc.get(pad5);
    if (list && list.length === 1) return list[0];

    return null;
  }

  // Prepare batches for upsert
  let created = 0;
  let updated = 0;
  let settledLinked = 0;
  let settledLegacy = 0;
  let unsettledCount = 0;
  let totalFaceValue = 0;

  const toCreate: any[] = [];
  const toUpdateFace: { id: string; faceValue: number; isRedeemed: boolean; description: string; createdAt: Date; issuedByLocationId: string | null }[] = [];
  const toCreateLocations: any[] = [];
  const toCreateRedemptions: any[] = [];
  const toCreateIssuedTx: any[] = [];
  const toCreateRedeemedTx: any[] = [];
  const toUpsertRedemptionTx: any[] = [];

  for (const [key, groupRows] of groups.entries()) {
    const sample = groupRows[0];
    const loc = resolveLocation(sample.locId, sample.costCentre);

    const shortCode = loc?.shortCode ? cleanLocCode(loc.shortCode) : cleanLocCode(loc?.code || sample.locId);
    const pad5 = String(sample.docNo).padStart(5, '0');
    const voucherCode = `EXC-${shortCode}27-${pad5}`;
    const returnNumber = `SR-${shortCode}27-${pad5}`;

    const groupNet = Math.round(groupRows.reduce((s, r) => s + r.totalNet, 0) * 100) / 100;
    totalFaceValue += groupNet;

    const docDate = parseExcelDate(sample.docDateRaw);
    const isSettled = isValidDoc(sample.fkExchangeDoc);
    const exchangeDate = isSettled ? parseExcelDate(sample.docDateExchangeRaw) : null;

    // Locate exchange (redemption) order
    let matchedOrder: typeof orders[0] | null = null;
    if (isSettled) {
      matchedOrder = findOrder(sample.fkExchangeDoc, loc);
    }

    const description = [
      `EXCHANGE Voucher for Return #${returnNumber} (Sale #${sample.fkSaleDoc || 'N/A'})`,
      sample.remarks ? `- ${sample.remarks}` : '',
    ].filter(Boolean).join(' ');

    const existing = voucherByCode.get(voucherCode);
    let voucherId: string;

    if (existing) {
      voucherId = existing.id;
      toUpdateFace.push({
        id: voucherId,
        faceValue: groupNet,
        isRedeemed: isSettled,
        description,
        createdAt: docDate,
        issuedByLocationId: loc?.id || null,
      });
      updated++;
    } else {
      voucherId = crypto.randomUUID();
      toCreate.push({
        id: voucherId,
        code: voucherCode,
        voucherType: 'EXCHANGE',
        faceValue: new Prisma.Decimal(groupNet),
        description,
        issuedByLocationId: loc?.id || null,
        isRedeemed: isSettled,
        isActive: true,
        createdAt: docDate,
        updatedAt: exchangeDate || docDate,
      });
      if (loc?.id) {
        toCreateLocations.push({ id: crypto.randomUUID(), voucherId, locationId: loc.id });
      }
      created++;
    }

    // ISSUED transaction (always)
    toCreateIssuedTx.push({
      id: crypto.randomUUID(),
      voucherId,
      locationId: loc?.id || null,
      action: 'ISSUED',
      amountUsed: new Prisma.Decimal(groupNet),
      notes: description,
      createdAt: docDate,
    });

    // REDEEMED transaction + redemption record
    if (isSettled) {
      if (matchedOrder && !redemptionByVoucher.has(voucherId)) {
        toCreateRedemptions.push({
          id: crypto.randomUUID(),
          voucherId,
          orderId: matchedOrder.id,
          amountUsed: new Prisma.Decimal(groupNet),
          createdAt: exchangeDate || matchedOrder.createdAt,
        });
        toCreateRedeemedTx.push({
          id: crypto.randomUUID(),
          voucherId,
          orderId: matchedOrder.id,
          locationId: matchedOrder.locationId,
          action: 'REDEEMED',
          amountUsed: new Prisma.Decimal(groupNet),
          notes: `Redeemed in Order ${matchedOrder.orderNumber} (Exchange Doc #${sample.fkExchangeDoc})`,
          createdAt: exchangeDate || matchedOrder.createdAt,
        });
        settledLinked++;
      } else if (!matchedOrder) {
        // Legacy settlement: no matching order found
        toUpsertRedemptionTx.push({
          id: crypto.randomUUID(),
          voucherId,
          orderId: null,
          locationId: loc?.id || null,
          action: 'REDEEMED',
          amountUsed: new Prisma.Decimal(groupNet),
          notes: `Exchanged — Invoice #${sample.fkExchangeDoc} at ${sample.costCentre}${sample.remarks ? ` (${sample.remarks})` : ''}`,
          createdAt: exchangeDate || docDate,
        });
        settledLegacy++;
      } else {
        settledLinked++; // already had redemption
      }
    } else {
      unsettledCount++;
    }
  }

  console.log(`\n⚡ Applying changes to database...`);

  // 1. Create new vouchers
  if (toCreate.length > 0) {
    await prisma.voucher.createMany({ data: toCreate, skipDuplicates: true });
    if (toCreateLocations.length > 0) {
      await prisma.voucherLocation.createMany({ data: toCreateLocations, skipDuplicates: true });
    }
    console.log(`  ✅ Created ${toCreate.length} new EXCHANGE vouchers.`);
  }

  // 2. Update existing vouchers (in chunks)
  let updateChunkCount = 0;
  for (let i = 0; i < toUpdateFace.length; i += CHUNK_SIZE) {
    const chunk = toUpdateFace.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map((u) =>
        prisma.voucher.update({
          where: { id: u.id },
          data: {
            faceValue: u.faceValue,
            isRedeemed: u.isRedeemed,
            description: u.description,
            createdAt: u.createdAt,
            issuedByLocationId: u.issuedByLocationId,
          },
        }),
      ),
    );
    updateChunkCount += chunk.length;
    process.stdout.write(`\r  ⚡ Updating vouchers... ${updateChunkCount}/${toUpdateFace.length}`);
  }
  if (toUpdateFace.length > 0) console.log(`\n  ✅ Updated ${toUpdateFace.length} existing EXCHANGE vouchers.`);

  // 3. Wipe old ISSUED transactions and rewrite (clean state)
  await prisma.voucherTransaction.deleteMany({
    where: { voucher: { voucherType: 'EXCHANGE' }, action: 'ISSUED' },
  });
  for (let i = 0; i < toCreateIssuedTx.length; i += CHUNK_SIZE) {
    await prisma.voucherTransaction.createMany({
      data: toCreateIssuedTx.slice(i, i + CHUNK_SIZE),
      skipDuplicates: true,
    });
  }
  console.log(`  ✅ Wrote ${toCreateIssuedTx.length} ISSUED transactions.`);

  // 4. Create new redemption records (skip duplicates)
  if (toCreateRedemptions.length > 0) {
    await prisma.voucherRedemption.createMany({ data: toCreateRedemptions, skipDuplicates: true });
    await prisma.voucherTransaction.createMany({ data: toCreateRedeemedTx, skipDuplicates: true });
    console.log(`  ✅ Linked ${toCreateRedemptions.length} new redemptions to POS orders.`);
  }

  // 5. Create legacy redeemed transactions (no order match)
  if (toUpsertRedemptionTx.length > 0) {
    // Remove existing REDEEMED transactions for vouchers without order match, then rewrite
    const legacyVoucherIds = toUpsertRedemptionTx.map((t) => t.voucherId);
    await prisma.voucherTransaction.deleteMany({
      where: { voucherId: { in: legacyVoucherIds }, action: 'REDEEMED', orderId: null },
    });
    await prisma.voucherTransaction.createMany({ data: toUpsertRedemptionTx, skipDuplicates: true });
    console.log(`  ✅ Wrote ${toUpsertRedemptionTx.length} legacy REDEEMED transactions (no order match).`);
  }

  // Verification
  const finalCount = await prisma.voucher.count({ where: { voucherType: 'EXCHANGE' } });
  const finalSum = await prisma.voucher.aggregate({ where: { voucherType: 'EXCHANGE' }, _sum: { faceValue: true } });
  const finalRedeemed = await prisma.voucher.count({ where: { voucherType: 'EXCHANGE', isRedeemed: true } });
  const finalUnredeemed = await prisma.voucher.count({ where: { voucherType: 'EXCHANGE', isRedeemed: false } });
  const finalRedemptions = await prisma.voucherRedemption.count({ where: { voucher: { voucherType: 'EXCHANGE' } } });

  console.log(`\n======================================================`);
  console.log(`✨ [EXCHANGE VOUCHERS SYNC SUMMARY]`);
  console.log(`======================================================`);
  console.log(`1. TOTAL UNIQUE MEMOS IN FILE   : ${groups.size}`);
  console.log(`2. CREATED NEW VOUCHERS          : ${created}`);
  console.log(`3. UPDATED EXISTING VOUCHERS     : ${updated}`);
  console.log(`4. SETTLED — Linked to Orders    : ${settledLinked}`);
  console.log(`5. SETTLED — Legacy (no match)   : ${settledLegacy}`);
  console.log(`6. UNSETTLED / OPEN              : ${unsettledCount}`);
  console.log(`7. TOTAL FACE VALUE (PKR)        : PKR ${totalFaceValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`\n--- DB Verification ---`);
  console.log(`   Total EXCHANGE in DB          : ${finalCount}`);
  console.log(`   Total Face Value in DB        : PKR ${Number(finalSum._sum.faceValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   Redeemed / Settled            : ${finalRedeemed}`);
  console.log(`   Unredeemed / Open             : ${finalUnredeemed}`);
  console.log(`   VoucherRedemptions in DB      : ${finalRedemptions}`);
  console.log(`======================================================\n`);

  await pool.end();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
