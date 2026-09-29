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
  const mdCounts: Record<string, number> = {};
  lines.forEach(l => {
    const loc = l.split('|')[2].trim();
    mdCounts[loc] = (mdCounts[loc] || 0) + 1;
  });

  const locations = await prisma.location.findMany({ select: { id: true, code: true, name: true } });
  const locMap = new Map(locations.map(l => [l.id, l.code]));

  const vouchers = await prisma.voucher.findMany({
    where: { OR: [{ voucherType: 'CLAIM' }, { code: { in: ['REF-SSONLINE27-00521', 'REF-SSONLINE27-00522'] } }] },
    select: { issuedByLocationId: true }
  });

  const dbCounts: Record<string, number> = {};
  vouchers.forEach(v => {
    const code = locMap.get(v.issuedByLocationId || '') || 'UNKNOWN';
    dbCounts[code] = (dbCounts[code] || 0) + 1;
  });

  console.log('Location comparison (claim-register.md vs DB vouchers):');
  const allLocs = Array.from(new Set([...Object.keys(mdCounts), ...Object.keys(dbCounts)])).sort();
  let totalMd = 0;
  let totalDb = 0;
  for (const loc of allLocs) {
    const m = mdCounts[loc] || 0;
    const d = dbCounts[loc] || 0;
    totalMd += m;
    totalDb += d;
    console.log(`Loc ${loc}: MD=${m} | DB=${d}`);
  }
  console.log(`TOTAL: MD=${totalMd} | DB=${totalDb}`);
  await pool.end();
}
check();
