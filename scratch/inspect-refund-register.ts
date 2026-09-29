import * as fs from 'fs';
import * as path from 'path';

function inspect() {
  const filePath = path.join(__dirname, '../data/refund register.md');
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim().startsWith('|') && !l.includes('---') && !l.includes('CostCentre'));

  console.log(`Total rows in refund register.md: ${lines.length}`);

  const rows = lines.map((l, idx) => {
    const parts = l.split('|').map(s => s.trim());
    return {
      line: idx + 1,
      costCentre: parts[1],
      locId: parts[2],
      docNo: parts[3],
      emptyCode: parts[4], // e.g. SS1011-1
      docDate: parts[5],
      fkSaleDoc: parts[6],
      docDateSale: parts[7],
      totalNet: parseFloat(parts[8]) || 0,
      remarks: parts[9]
    };
  });

  const totalAmount = rows.reduce((s, r) => s + r.totalNet, 0);
  console.log(`Total Net Amount: PKR ${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

  // Group by (locId, docNo)
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.locId}::${r.docNo}`;
    const list = groups.get(key) || [];
    list.push(r);
    groups.set(key, list);
  }

  console.log(`Unique (locId, docNo) groups: ${groups.size}`);

  // Count by location
  const byLoc = new Map<string, { count: number; sum: number }>();
  for (const [key, list] of groups.entries()) {
    const locId = list[0].locId;
    const existing = byLoc.get(locId) || { count: 0, sum: 0 };
    existing.count += 1;
    existing.sum += list.reduce((s, r) => s + r.totalNet, 0);
    byLoc.set(locId, existing);
  }

  console.log('\nBreakdown by Location ID:');
  for (const [loc, stat] of byLoc.entries()) {
    console.log(`- ${loc}: ${stat.count} refund memos, Total PKR ${stat.sum.toLocaleString()}`);
  }

  // Sample group
  const sampleKey = Array.from(groups.keys())[0];
  console.log(`\nSample group (${sampleKey}):`, groups.get(sampleKey));
}

inspect();
