import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';

const pool = new Pool({ connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi' });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function cleanLocCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

async function check() {
  const filePath = path.join(__dirname, '../data/refund register.md');
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim().startsWith('|') && !l.includes('---') && !l.includes('CostCentre'));

  const rows = lines.map((l, idx) => {
    const parts = l.split('|').map(s => s.trim());
    return {
      line: idx + 1,
      costCentre: parts[1],
      locId: parts[2],
      docNo: parts[3],
      emptyCode: parts[4],
      docDate: parts[5],
      fkSaleDoc: parts[6],
      docDateSale: parts[7],
      totalNet: parseFloat(parts[8]) || 0,
      remarks: parts[9]
    };
  });

  // Group rows by (locId, docNo)
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.locId}::${r.docNo}`;
    const list = groups.get(key) || [];
    list.push(r);
    groups.set(key, list);
  }

  const locations = await prisma.location.findMany({ select: { id: true, code: true, shortCode: true, name: true } });
  const locMap = new Map(locations.map(l => [l.code?.toUpperCase(), l]));

  const dbRefundVouchers = await prisma.voucher.findMany({
    where: { voucherType: 'REFUND' },
    select: { id: true, code: true, faceValue: true, issuedByLocationId: true, isRedeemed: true, isActive: true, description: true }
  });

  console.log(`Unique refund groups in file: ${groups.size}`);
  console.log(`DB REFUND vouchers: ${dbRefundVouchers.length}`);

  const dbCodeSet = new Set(dbRefundVouchers.map(v => v.code));

  let matched = 0;
  const missingInDb: any[] = [];
  const diffAmounts: any[] = [];

  for (const [key, groupRows] of groups.entries()) {
    const sample = groupRows[0];
    const loc = locMap.get(sample.locId.toUpperCase());
    const shortCode = loc?.shortCode ? cleanLocCode(loc.shortCode) : cleanLocCode(sample.locId);
    const pad5 = String(sample.docNo).padStart(5, '0');
    const groupTotal = groupRows.reduce((s, r) => s + r.totalNet, 0);

    // Expected code format: REF-${shortCode}27-${pad5} or REF-${shortCode}26-${pad5}
    const expectedCode27 = `REF-${shortCode}27-${pad5}`;
    const expectedCode26 = `REF-${shortCode}26-${pad5}`;

    let dbVoucher = dbRefundVouchers.find(v => v.code === expectedCode27 || v.code === expectedCode26);
    if (!dbVoucher) {
      dbVoucher = dbRefundVouchers.find(v => v.code.startsWith(`REF-${shortCode}`) && v.code.endsWith(`-${pad5}`));
    }

    if (dbVoucher) {
      matched++;
      const dbVal = Number(dbVoucher.faceValue);
      if (Math.abs(dbVal - groupTotal) > 0.05) {
        diffAmounts.push({
          key,
          code: dbVoucher.code,
          fileTotal: groupTotal,
          dbFaceValue: dbVal,
          diff: groupTotal - dbVal
        });
      }
    } else {
      missingInDb.push({
        key,
        locId: sample.locId,
        docNo: sample.docNo,
        expectedCode: expectedCode27,
        totalNet: groupTotal,
        saleDoc: sample.fkSaleDoc,
        remarks: sample.remarks
      });
    }
  }

  console.log(`\nMatched with DB vouchers: ${matched} / ${groups.size}`);
  console.log(`Missing in DB: ${missingInDb.length}`);
  if (missingInDb.length > 0) {
    console.log('Missing items in DB:', missingInDb);
  }
  console.log(`Amount differences: ${diffAmounts.length}`);
  if (diffAmounts.length > 0) {
    console.log('First 10 amount diffs:', diffAmounts.slice(0, 10));
  }

  const fileKeys = new Set(Array.from(groups.keys()).map(k => {
    const [locId, docNo] = k.split('::');
    const loc = locMap.get(locId.toUpperCase());
    const shortCode = loc?.shortCode ? cleanLocCode(loc.shortCode) : cleanLocCode(locId);
    return `REF-${shortCode}27-${String(docNo).padStart(5, '0')}`;
  }));

  const extraInDb = dbRefundVouchers.filter(v => !fileKeys.has(v.code));
  console.log(`Extra in DB not in file keys: ${extraInDb.length}`);
  if (extraInDb.length > 0) {
    console.log('Extra in DB sample:', extraInDb.slice(0, 10));
  }

  await pool.end();
}

check();
