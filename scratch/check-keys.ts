import * as fs from 'fs';
import * as path from 'path';

const content = fs.readFileSync(path.join(__dirname, '../data/claim-register.md'), 'utf8');
const lines = content.split('\n').filter(l => l.trim().startsWith('|') && !l.includes('---') && !l.includes('CostCentre'));
const rows = lines.map((l, idx) => {
  const p = l.split('|').map(s => s.trim());
  return { idx: idx + 1, locId: p[2], docNo: p[4] };
});

const keys = new Set<string>();
const dups: any[] = [];
for (const r of rows) {
  const k = r.locId + '::' + r.docNo;
  if (keys.has(k)) dups.push(r);
  keys.add(k);
}

console.log('Total rows:', rows.length, 'Unique (locId, docNo):', keys.size, 'Duplicates:', dups);
