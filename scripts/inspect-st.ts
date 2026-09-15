import { readAndParseReturnData, getFySuffix } from './import-madison-returns';

const rows = readAndParseReturnData('data/ST_july_aug.md');

const returnGroups = new Map<string, any[]>();
for (const row of rows) {
  const groupKey = `${row.locationCode || row.costCentre}_${row.docNo}_${row.docDateStr}_${row.subType}`;
  if (!returnGroups.has(groupKey)) {
    returnGroups.set(groupKey, []);
  }
  returnGroups.get(groupKey)!.push(row);
}

const usedVoucherCodes = new Set<string>();
for (const [key, groupRows] of returnGroups.entries()) {
  const sample = groupRows[0];
  const rawCode = sample.locationCode || 'LOC';
  const cleanCode = rawCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const fySuffix = getFySuffix(sample.docDate);
  const padDocNo = String(sample.docNo).padStart(5, '0');
  const subTypeUpper = sample.subType.toUpperCase();
  const subTypePrefix = subTypeUpper === 'CLAIM' ? 'CLM' : subTypeUpper === 'REFUND' ? 'REF' : 'EXC';

  const baseVoucherCode = `${subTypePrefix}-${cleanCode}${fySuffix}-${padDocNo}`;
  let voucherCode = baseVoucherCode;
  let dupSuffix = 1;
  while (usedVoucherCodes.has(voucherCode)) {
    dupSuffix++;
    voucherCode = `${baseVoucherCode}-${dupSuffix}`;
  }
  usedVoucherCodes.add(voucherCode);
}

console.log('Total groups:', returnGroups.size, 'Total unique voucher codes:', usedVoucherCodes.size);
