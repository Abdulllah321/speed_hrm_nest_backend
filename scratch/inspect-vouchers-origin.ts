import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const pool = new Pool({ connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi' });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const vouchers = await prisma.voucher.findMany({
    where: { voucherType: 'CLAIM' },
    select: {
      id: true,
      code: true,
      faceValue: true,
      isRedeemed: true,
      issuedByLocationId: true,
      description: true,
      sourceOrderId: true,
      createdAt: true
    },
    orderBy: { code: 'asc' }
  });

  console.log(`Total vouchers in DB: ${vouchers.length}`);
  
  // Check where sourceOrderId points
  const orderIds = vouchers.map(v => v.sourceOrderId).filter(Boolean) as string[];
  const orders = await prisma.salesOrder.findMany({
    where: { id: { in: orderIds } },
    select: { id: true, orderNumber: true, returnNumber: true, notes: true, locationId: true }
  });

  console.log(`Total source orders found: ${orders.length}`);
  
  // Also check posReturn
  const posReturns = await prisma.posReturn.findMany({
    where: { voucherId: { in: vouchers.map(v => v.id) } },
    select: { id: true, returnNumber: true, voucherId: true }
  });
  console.log(`Total posReturns linked to vouchers: ${posReturns.length}`);

  // Let's print out the first 20 vouchers and their linked return
  for (let i = 0; i < 20; i++) {
    const v = vouchers[i];
    const ord = orders.find(o => o.id === v.sourceOrderId);
    const ret = posReturns.find(r => r.voucherId === v.id);
    console.log(`${v.code} | Val: ${v.faceValue} | Red: ${v.isRedeemed} | Ret#: ${ret?.returnNumber || ord?.returnNumber || 'NONE'} | Notes: ${ord?.notes || ''}`);
  }

  await pool.end();
}

main().catch(console.error);
