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

  const locations = await prisma.location.findMany({ select: { id: true, code: true, shortCode: true } });
  const vouchers = await prisma.voucher.findMany({
    where: { OR: [{ voucherType: 'CLAIM' }, { code: { in: ['REF-SSONLINE27-00521', 'REF-SSONLINE27-00522'] } }] },
    include: {
      posReturn: {
        include: {
          salesOrder: true
        }
      }
    }
  });

  console.log(`Total rows in MD: ${rows.length}, Total candidate vouchers in DB: ${vouchers.length}`);

  const usedVoucherIds = new Set<string>();
  let matchedCount = 0;
  const matches: any[] = [];
  const unmatchedRows: any[] = [];

  for (const r of rows) {
    const loc = locations.find(l => l.code?.toUpperCase() === r.locId?.toUpperCase() || l.shortCode?.toUpperCase() === r.locId?.toUpperCase());
    const locId = loc?.id;

    // Strategies to match row to voucher:
    // 1. By posReturn.reason containing original saleDocNo or saleOrder.orderNumber ending with saleDocNo
    // 2. By amount and location
    // 3. By customer phone/name if already attached
    // 4. By refund voucher codes for the leopard claims
    let v = vouchers.find(v => {
      if (usedVoucherIds.has(v.id)) return false;
      if (v.issuedByLocationId !== locId) return false;

      // Check if original sale doc matches
      if (r.saleDocNo && r.saleDocNo !== '0') {
        const padSale = String(r.saleDocNo).padStart(5, '0');
        const reasonMatch = v.posReturn?.reason?.includes(r.saleDocNo) || v.posReturn?.reason?.includes(padSale);
        const orderNumMatch = v.posReturn?.salesOrder?.orderNumber?.endsWith(padSale) || v.posReturn?.salesOrder?.notes?.includes(r.saleDocNo);
        if (reasonMatch || orderNumMatch) {
          if (Math.abs(Number(v.faceValue) - r.amount) < 0.05) return true;
        }
      }
      return false;
    });

    if (!v) {
      // Strategy 2: Match by exact amount and location if unique among remaining
      const candidates = vouchers.filter(v => {
        if (usedVoucherIds.has(v.id)) return false;
        if (v.issuedByLocationId !== locId) return false;
        return Math.abs(Number(v.faceValue) - r.amount) < 0.05;
      });
      if (candidates.length === 1) {
        v = candidates[0];
      }
    }

    if (!v && (r.locId === 'SS1011' || r.costCentre.includes('Online'))) {
      // Check leopard claims
      if (r.remarks.toUpperCase().includes('LEOPARD') || r.remarks.toUpperCase().includes('MISSING')) {
        v = vouchers.find(v => !usedVoucherIds.has(v.id) && v.code.startsWith('REF-SSONLINE'));
      }
    }

    if (v) {
      usedVoucherIds.add(v.id);
      matchedCount++;
      matches.push({ rowIdx: r.rowIdx, voucherId: v.id, voucherCode: v.code, amount: r.amount, redeemDoc: r.redeemDocNo });
    } else {
      unmatchedRows.push(r);
    }
  }

  console.log(`Matched: ${matchedCount} / ${rows.length}`);
  console.log(`Unmatched: ${unmatchedRows.length}`);
  if (unmatchedRows.length > 0) {
    console.log('Unmatched rows:', unmatchedRows);
  }

  // Also check remaining unassigned vouchers
  const unassignedVouchers = vouchers.filter(v => !usedVoucherIds.has(v.id)).map(v => ({
    code: v.code,
    locId: v.issuedByLocationId,
    amount: Number(v.faceValue),
    reason: v.posReturn?.reason
  }));
  console.log('Unassigned vouchers count:', unassignedVouchers.length);
  if (unassignedVouchers.length > 0) {
    console.log('Unassigned vouchers:', unassignedVouchers);
  }

  await pool.end();
}
check();
