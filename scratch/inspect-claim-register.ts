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

  console.log(`Total rows in claim-register.md: ${rows.length}`);

  // Let's check amounts sum
  const totalAmount = rows.reduce((acc, r) => acc + r.amount, 0);
  const rowsWithRedeem = rows.filter(r => r.redeemDocNo !== '');
  const totalRedeemAmount = rowsWithRedeem.reduce((acc, r) => acc + r.amount, 0);
  console.log(`Total Amount in claim-register.md: PKR ${totalAmount.toLocaleString()}`);
  console.log(`Total rows with Redeem Doc: ${rowsWithRedeem.length}, Amount: PKR ${totalRedeemAmount.toLocaleString()}`);
  console.log(`Total unredeemed rows: ${rows.length - rowsWithRedeem.length}`);

  // Check how many DB vouchers match
  const dbVouchers = await prisma.voucher.findMany({
    where: { voucherType: 'CLAIM' },
    include: { redemptions: true }
  });
  console.log(`Total DB CLAIM vouchers: ${dbVouchers.length}`);
  const dbTotalVal = dbVouchers.reduce((acc, v) => acc + Number(v.faceValue), 0);
  console.log(`Total faceValue in DB CLAIM vouchers: PKR ${dbTotalVal.toLocaleString()}`);
  console.log(`Total DB CLAIM vouchers redeemed: ${dbVouchers.filter(v => v.isRedeemed).length}`);

  await pool.end();
}

main().catch(console.error);
