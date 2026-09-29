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

  const locations = await prisma.location.findMany({
    select: { id: true, code: true, shortCode: true, name: true }
  });

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
      redemptions: {
        select: {
          id: true,
          orderId: true,
          amountUsed: true
        }
      }
    }
  });

  console.log(`Total DB CLAIM vouchers: ${vouchers.length}`);

  // Fetch all sales orders to match redemptions and source orders
  const allSalesOrders = await prisma.salesOrder.findMany({
    select: {
      id: true,
      orderNumber: true,
      returnNumber: true,
      locationId: true,
      grandTotal: true,
      voucherAmount: true,
      notes: true,
      createdAt: true
    }
  });
  console.log(`Total SalesOrders in DB: ${allSalesOrders.length}`);

  // Inspect matching
  let matchedCount = 0;
  let unredeemedInMd = 0;
  let redeemedInMd = 0;
  let redeemOrderFound = 0;
  let redeemOrderNotFound = 0;
  const missingVouchers: any[] = [];

  for (const r of rows) {
    const loc = locations.find(l => l.code?.toUpperCase() === r.locId?.toUpperCase() || l.shortCode?.toUpperCase() === r.locId?.toUpperCase());
    const locId = loc?.id;

    // Search voucher by location and docNo
    const paddedDocNo = String(r.docNo).padStart(5, '0');
    let v = vouchers.find(v => {
      const isLoc = v.issuedByLocationId === locId;
      return isLoc && (v.code.endsWith(paddedDocNo) || v.description?.includes(`Doc #${r.docNo}`) || v.description?.includes(`Return #CLM-`) && v.description?.includes(paddedDocNo));
    });

    if (!v) {
      // Fallback search by amount & location
      v = vouchers.find(v => v.issuedByLocationId === locId && Math.abs(Number(v.faceValue) - r.amount) < 0.01 && !rows.some(other => other !== r && other.locId === r.locId && other.amount === r.amount));
    }

    if (v) {
      matchedCount++;
    } else {
      missingVouchers.push({ row: r, locName: loc?.name });
    }

    if (r.redeemDocNo) {
      redeemedInMd++;
      // Search for the redemption sales order
      const padRedeem = String(r.redeemDocNo).padStart(5, '0');
      const targetOrder = allSalesOrders.find(o => {
        const isLoc = o.locationId === locId;
        return isLoc && (o.orderNumber.endsWith(padRedeem) || o.orderNumber.includes(r.redeemDocNo) || o.notes?.includes(`Sale #${r.redeemDocNo}`));
      });
      if (targetOrder) {
        redeemOrderFound++;
      } else {
        redeemOrderNotFound++;
        // console.log(`   Redeem order not found for ${r.costCentre} (${r.locId}) doc#${r.docNo} redeemDoc#${r.redeemDocNo}`);
      }
    } else {
      unredeemedInMd++;
    }
  }

  console.log(`\nResults:`);
  console.log(`Matched to existing vouchers: ${matchedCount} / ${rows.length}`);
  console.log(`Missing vouchers in DB: ${missingVouchers.length}`);
  console.log(`MD rows with redeemDocNo: ${redeemedInMd}, unredeemed: ${unredeemedInMd}`);
  console.log(`Redemption orders found in DB: ${redeemOrderFound} / ${redeemedInMd} (not found: ${redeemOrderNotFound})`);

  if (missingVouchers.length > 0) {
    console.log(`\nMissing Vouchers Details:`);
    console.log(JSON.stringify(missingVouchers, null, 2));
  }

  await pool.end();
}

main().catch(console.error);
