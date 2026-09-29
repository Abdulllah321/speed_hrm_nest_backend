import * as fs from 'fs';
import * as path from 'path';

function inspect() {
  const filePath = path.join(__dirname, '../data/exchange_voucher.md');
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim().startsWith('|') && !l.includes('---') && !l.includes('CostCentre'));

  console.log(`Total item rows: ${lines.length}`);

  const rows = lines.map((l) => {
    const parts = l.split('|').map(s => s.trim());
    return {
      costCentre: parts[1],
      locId: parts[2],
      docNo: parts[3],
      docDate: parts[4],
      fkSaleDoc: parts[5],   // original sale
      docDateSale: parts[6],
      fkExchangeDoc: parts[7],  // new exchange/redemption doc
      docDateExchange: parts[8],
      totalNet: parseFloat(parts[9]) || 0,
      remarks: parts[10]
    };
  });

  // Group by (locId, docNo)
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.locId}::${r.docNo}`;
    const list = groups.get(key) || [];
    list.push(r);
    groups.set(key, list);
  }

  console.log(`Unique (locId, docNo) groups: ${groups.size}`);

  const totalAmount = rows.reduce((s, r) => s + r.totalNet, 0);
  console.log(`Total Net Amount: PKR ${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

  // Check how many have exchange doc (settled)
  let settledGroups = 0;
  let unsettledGroups = 0;
  let totalSettledAmt = 0;
  let totalUnsettledAmt = 0;
  const locIds = new Set<string>();

  for (const [key, groupRows] of groups.entries()) {
    const sample = groupRows[0];
    locIds.add(sample.locId);
    const groupTotal = groupRows.reduce((s, r) => s + r.totalNet, 0);
    if (sample.fkExchangeDoc && sample.fkExchangeDoc !== '0' && sample.fkExchangeDoc !== '-') {
      settledGroups++;
      totalSettledAmt += groupTotal;
    } else {
      unsettledGroups++;
      totalUnsettledAmt += groupTotal;
    }
  }

  console.log(`Settled (has FKInvoiceNumber_Exchange): ${settledGroups} groups, PKR ${totalSettledAmt.toFixed(2)}`);
  console.log(`Unsettled (no exchange doc): ${unsettledGroups} groups, PKR ${totalUnsettledAmt.toFixed(2)}`);
  console.log(`Unique location IDs in file: ${Array.from(locIds).join(', ')}`);

  // Sample first few groups
  const sampleKeys = Array.from(groups.keys()).slice(0, 3);
  for (const k of sampleKeys) {
    console.log(`\nSample [${k}]:`, groups.get(k));
  }
}

inspect();
