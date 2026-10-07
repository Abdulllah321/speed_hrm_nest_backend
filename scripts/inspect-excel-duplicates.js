const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '..', 'promotion_increment_import_template_2026-08-25.xlsx');
const workbook = XLSX.readFile(filePath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

console.log('Total rows read from Excel:', rows.length);

const empCounts = new Map();
const empRowsMap = new Map();

rows.forEach((row, idx) => {
  const rowNum = idx + 2;
  // find employee id key
  const keys = Object.keys(row);
  const empKey = keys.find(k => k.toLowerCase().replace(/[\s_\-\/\.]/g, '') === 'employeeid' || k.toLowerCase().includes('empid') || k.toLowerCase().includes('id'));
  const nameKey = keys.find(k => k.toLowerCase().includes('name'));
  const amountKey = keys.find(k => k.toLowerCase().includes('value') || k.toLowerCase().includes('amount'));

  const empId = empKey ? String(row[empKey]).trim() : '';
  const empName = nameKey ? String(row[nameKey]).trim() : '';
  const val = amountKey ? String(row[amountKey]).trim() : '';

  if (empId) {
    empCounts.set(empId, (empCounts.get(empId) || 0) + 1);
    if (!empRowsMap.has(empId)) empRowsMap.set(empId, []);
    empRowsMap.get(empId).push({ rowNum, empName, val, rawRow: row });
  }
});

console.log('Unique Employee IDs in Excel file:', empCounts.size);

const duplicates = [];
for (const [empId, count] of empCounts.entries()) {
  if (count > 1) {
    duplicates.push({
      empId,
      count,
      occurrences: empRowsMap.get(empId)
    });
  }
}

console.log('\n===== DUPLICATE EMPLOYEE ENTRIES FOUND IN EXCEL =====');
console.log(JSON.stringify(duplicates, null, 2));
