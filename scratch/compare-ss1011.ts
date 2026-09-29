import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const pool = new Pool({ connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi' });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const content = fs.readFileSync(path.join(__dirname, '../data/claim-register.md'), 'utf8');
  const lines = content.split('\n').filter(l => l.trim().startsWith('|') && !l.includes('---') && !l.includes('CostCentre'));

  const rows = lines.map((line, idx) => {
    const parts = line.split('|').map(s => s.trim());
    return {
      rowIdx: idx + 1,
      costCentre: parts[1],
      locId: parts[2],
      docDate: parts[3],
      docNo: parts[4],
      saleDocNo: parts[5],
      saleDocDate: parts[6],
      redeemDocNo: parts[7] || '',
      redeemDocDate: parts[8] || '',
      amount: parseFloat(parts[9]) || 0,
      customerName: parts[10],
      mobile: parts[11],
      email: parts[12],
      address: parts[13],
      remarks: parts[14],
      settlement: parts[15]
    };
  });

  const locations = await prisma.location.findMany({
    select: { id: true, code: true, shortCode: true, name: true }
  });

  // Fetch all 200 vouchers (198 CLAIM + 2 REF with LEOPARD MISSING CLAIM)
  const vouchers = await prisma.voucher.findMany({
    where: {
      OR: [
        { voucherType: 'CLAIM' },
        { code: { in: ['REF-SSONLINE27-00521', 'REF-SSONLINE27-00522'] } }
      ]
    },
    include: {
      posReturn: {
        include: {
          salesOrder: true
        }
      },
      redemptions: true
    }
  });

  console.log(`Total target vouchers in DB: ${vouchers.length}`);

  // Let's inspect how posReturns correspond to claim-register.md
  // For each posReturn, what was the original return document number?
  // Let's check posReturn.returnNumber and salesOrder.notes
  for (const v of vouchers) {
    const ret = v.posReturn;
    const ord = ret?.salesOrder;
    // Check if notes has Doc #...
    // e.g. "Imported Return Doc #6" or "notes: 3328;" or similar
  }

  // Let's see: How was import-madison-returns run previously?
  // Let's inspect the returns in DB for a specific store, e.g. SS1011 (Speed Sports Online)
  const ssOnlineLoc = locations.find(l => l.code === 'SS1011' || l.shortCode === 'SS1011');
  const ssOnlineVouchers = vouchers.filter(v => v.issuedByLocationId === ssOnlineLoc?.id);
  console.log(`\nSS1011 vouchers in DB (${ssOnlineVouchers.length}):`);
  for (const v of ssOnlineVouchers) {
    console.log(`Code: ${v.code} | Val: ${v.faceValue} | RetNum: ${v.posReturn?.returnNumber} | Notes: ${v.posReturn?.salesOrder?.notes}`);
  }

  const ssOnlineRows = rows.filter(r => r.locId === 'SS1011');
  console.log(`\nSS1011 rows in claim-register.md (${ssOnlineRows.length}):`);
  for (const r of ssOnlineRows) {
    console.log(`Doc#${r.docNo} | Amount: ${r.amount} | SaleDoc#${r.saleDocNo} | RedeemDoc#${r.redeemDocNo} | Settlement: ${r.settlement}`);
  }

  await pool.end();
}

main().catch(console.error);
