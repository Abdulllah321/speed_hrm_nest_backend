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

  const locations = await prisma.location.findMany({ select: { id: true, code: true, shortCode: true, name: true } });
  const allVouchers = await prisma.voucher.findMany({
    where: { OR: [{ voucherType: 'CLAIM' }, { code: { in: ['REF-SSONLINE27-00521', 'REF-SSONLINE27-00522'] } }] },
    include: { posReturn: { include: { salesOrder: true } } }
  });

  console.log(`Total rows: ${rows.length}, Total DB candidate vouchers: ${allVouchers.length}`);

  let matched = 0;
  const usedVoucherIds = new Set<string>();
  const unmatchedRows: any[] = [];

  for (const r of rows) {
    const loc = locations.find(l => l.code?.toUpperCase() === r.locId?.toUpperCase() || l.shortCode?.toUpperCase() === r.locId?.toUpperCase());
    const locId = loc?.id;
    const cleanShort = loc?.shortCode ? cleanLocCode(loc.shortCode) : cleanLocCode(loc?.code || '');
    const cleanCodeVal = cleanLocCode(loc?.code || '');
    const pad5 = String(r.docNo).padStart(5, '0');

    // 1. Try exact code matches:
    // CLM-<cleanShort>27-<pad5> or CLM-<cleanShort>26-<pad5>
    let v = allVouchers.find(v => {
      if (usedVoucherIds.has(v.id)) return false;
      const c = v.code.toUpperCase();
      return (
        c === `CLM-${cleanShort}27-${pad5}` ||
        c === `CLM-${cleanShort}26-${pad5}` ||
        c === `CLM-${cleanCodeVal}27-${pad5}` ||
        c === `CLM-${cleanCodeVal}26-${pad5}` ||
        c.startsWith(`CLM-${cleanShort}27-${pad5}-`) ||
        c.startsWith(`CLM-${cleanShort}26-${pad5}-`)
      );
    });

    // 2. Try posReturn returnNumber match or description match
    if (!v) {
      v = allVouchers.find(v => {
        if (usedVoucherIds.has(v.id)) return false;
        if (v.issuedByLocationId !== locId) return false;
        return (
          v.description?.includes(`Return #${v.code} (Sale #${r.saleDocNo}`) ||
          (r.saleDocNo && r.saleDocNo !== '0' && v.posReturn?.reason?.includes(r.saleDocNo))
        );
      });
    }

    // 3. Try Leopard missing claims (SS1011)
    if (!v && (r.locId === 'SS1011' || r.costCentre.includes('Online'))) {
      if (r.remarks.toUpperCase().includes('LEOPARD') || r.remarks.toUpperCase().includes('MISSING')) {
        v = allVouchers.find(v => !usedVoucherIds.has(v.id) && v.code.startsWith('REF-SSONLINE'));
      }
    }

    // 4. Try amount match in the same location if unique candidate
    if (!v) {
      const candidates = allVouchers.filter(v => {
        if (usedVoucherIds.has(v.id)) return false;
        if (v.issuedByLocationId !== locId) return false;
        return Math.abs(Number(v.faceValue) - r.amount) < 0.05;
      });
      if (candidates.length === 1) {
        v = candidates[0];
      }
    }

    if (v) {
      usedVoucherIds.add(v.id);
      matched++;
    } else {
      unmatchedRows.push({
        rowIdx: r.rowIdx,
        costCentre: r.costCentre,
        locId: r.locId,
        cleanShort,
        docNo: r.docNo,
        saleDocNo: r.saleDocNo,
        amount: r.amount,
        customer: r.customerName,
        remarks: r.remarks
      });
    }
  }

  console.log(`Matched: ${matched} / ${rows.length}`);
  console.log(`Unmatched rows: ${unmatchedRows.length}`);
  if (unmatchedRows.length > 0) {
    console.log('Unmatched rows details:', JSON.stringify(unmatchedRows, null, 2));
  }

  const unassigned = allVouchers.filter(v => !usedVoucherIds.has(v.id)).map(v => ({
    code: v.code,
    locId: v.issuedByLocationId,
    amount: Number(v.faceValue),
    desc: v.description,
    reason: v.posReturn?.reason
  }));
  console.log(`Unassigned DB vouchers: ${unassigned.length}`);
  if (unassigned.length > 0) {
    console.log('Unassigned DB vouchers:', JSON.stringify(unassigned, null, 2));
  }

  await pool.end();
}
check();
