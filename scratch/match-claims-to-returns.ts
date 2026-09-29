import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';

const pool = new Pool({ connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi' });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function check() {
  const content = fs.readFileSync(path.join(__dirname, '../data/claim-register.md'), 'utf8');
  const lines = content.split('\n').filter(l => l.trim().startsWith('|') && !l.includes('---') && !l.includes('CostCentre'));
  const rows = lines.map((l, idx) => {
    const p = l.split('|').map(s => s.trim());
    return {
      idx: idx + 1,
      costCentre: p[1],
      locId: p[2],
      docDate: p[3],
      docNo: p[4],
      saleDocNo: p[5],
      redeemDocNo: p[7] || '',
      redeemDocDate: p[8] || '',
      amount: parseFloat(p[9]) || 0,
      customer: p[10],
      mobile: p[11],
      email: p[12],
      address: p[13],
      remarks: p[14],
      settlement: p[15]
    };
  });

  const locations = await prisma.location.findMany({ select: { id: true, code: true, shortCode: true, name: true } });
  const locMap = new Map(locations.map(l => [l.code?.toUpperCase(), l]));

  const returns = await prisma.posReturn.findMany({
    where: {
      OR: [
        { voucher: { voucherType: 'CLAIM' } },
        { returnNumber: { in: ['REF-SSONLINE27-00521', 'REF-SSONLINE27-00522'] } }
      ]
    },
    include: { voucher: true, salesOrder: true }
  });

  console.log(`Rows: ${rows.length}, PosReturns: ${returns.length}`);

  // Let's inspect returns by location
  const retByLoc: Record<string, typeof returns> = {};
  for (const ret of returns) {
    const loc = locations.find(l => l.id === ret.locationId);
    const code = loc?.code || 'UNKNOWN';
    if (!retByLoc[code]) retByLoc[code] = [];
    retByLoc[code].push(ret);
  }

  const rowsByLoc: Record<string, typeof rows> = {};
  for (const r of rows) {
    const code = r.locId.toUpperCase();
    if (!rowsByLoc[code]) rowsByLoc[code] = [];
    rowsByLoc[code].push(r);
  }

  const allLocs = Array.from(new Set([...Object.keys(retByLoc), ...Object.keys(rowsByLoc)])).sort();
  for (const loc of allLocs) {
    const rCount = rowsByLoc[loc]?.length || 0;
    const retCount = retByLoc[loc]?.length || 0;
    if (rCount !== retCount) {
      console.log(`Diff at ${loc}: MD rows=${rCount}, PosReturns=${retCount}`);
    }
  }

  await pool.end();
}
check();
