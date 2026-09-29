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

  const allOrders = await prisma.salesOrder.findMany({
    select: {
      id: true,
      orderNumber: true,
      locationId: true,
      grandTotal: true,
      notes: true,
      createdAt: true
    }
  });

  console.log(`Total orders in DB: ${allOrders.length}`);

  let matchedOrders = 0;
  let missingOrders = 0;
  const missingList: any[] = [];

  for (const r of rows) {
    if (!r.redeemDocNo) continue;

    const loc = locations.find(l => l.code?.toUpperCase() === r.locId?.toUpperCase() || l.shortCode?.toUpperCase() === r.locId?.toUpperCase());
    const locId = loc?.id;

    const pad5 = String(r.redeemDocNo).padStart(5, '0');
    const targetOrder = allOrders.find(o => {
      // Must match location if possible
      const isLoc = locId ? o.locationId === locId : true;
      if (!isLoc) return false;

      // Check orderNumber patterns:
      // SI-<PREFIX>-00494, or endsWith('-' + pad5), or notes contains `Sale #${r.redeemDocNo}` or `DocNo: ${r.redeemDocNo}`
      return o.orderNumber.endsWith(`-${pad5}`) ||
             o.orderNumber.endsWith(`-${r.redeemDocNo}`) ||
             o.notes?.includes(`Sale #${r.redeemDocNo}`) ||
             o.notes?.includes(`DocNo: ${r.redeemDocNo}`) ||
             o.notes?.includes(`Doc #${r.redeemDocNo}`);
    });

    if (targetOrder) {
      matchedOrders++;
    } else {
      // Try cross-location search just in case customer redeemed at another store
      const crossOrder = allOrders.find(o => o.orderNumber.endsWith(`-${pad5}`) || o.notes?.includes(`DocNo: ${r.redeemDocNo}`));
      if (crossOrder) {
        matchedOrders++;
        // console.log(`Cross-location matched: Store ${r.locId} redeemed at ${crossOrder.orderNumber}`);
      } else {
        missingOrders++;
        missingList.push(r);
      }
    }
  }

  console.log(`Redemption orders matched: ${matchedOrders} / 138`);
  console.log(`Redemption orders missing: ${missingOrders}`);
  if (missingList.length > 0) {
    console.log('Sample missing redemption orders (first 5):', missingList.slice(0, 5));
  }

  await pool.end();
}

main().catch(console.error);
