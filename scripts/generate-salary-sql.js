const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'Book4.xlsx');
const wb = xlsx.readFile(filePath);
const ws = wb.Sheets[wb.SheetNames[0]];
const raw = xlsx.utils.sheet_to_json(ws);

const records = [];
for (const r of raw) {
  const keys = Object.keys(r);
  const empIdKey = keys.find(k => k.toLowerCase().includes('emp id') || k.toLowerCase().includes('empid'));
  const salaryKey = keys.find(k => k.toLowerCase().includes('salary'));
  const nameKey = keys.find(k => k.toLowerCase().includes('name'));

  const empId = (r[empIdKey] || '').toString().trim();
  const salary = Number(r[salaryKey]);
  const name = (r[nameKey] || '').toString().trim();

  if (empId && !isNaN(salary)) {
    records.push({ empId, name, salary });
  }
}

console.log(`Loaded ${records.length} records.`);

// 1. PostgreSQL Batch Update Query
let batchSql = `-- =========================================================================\n`;
batchSql += `-- BATCH UPDATE QUERY (PostgreSQL / Prisma "Employee" Table)\n`;
batchSql += `-- Total Records: ${records.length}\n`;
batchSql += `-- =========================================================================\n\n`;
batchSql += `UPDATE "Employee" AS e\n`;
batchSql += `SET \n`;
batchSql += `    "employeeSalary" = v.salary,\n`;
batchSql += `    "updatedAt" = CURRENT_TIMESTAMP\n`;
batchSql += `FROM (VALUES\n`;

const rows = records.map((r, i) => {
  const comma = i === records.length - 1 ? '' : ',';
  return `    ('${r.empId}', ${r.salary}::numeric)${comma} -- ${r.name}`;
});

batchSql += rows.join('\n');
batchSql += `\n) AS v("employeeId", salary)\n`;
batchSql += `WHERE UPPER(TRIM(e."employeeId")) = UPPER(TRIM(v."employeeId"));\n\n`;

// 2. Individual Updates with Transaction (Safe fallback)
let individualSql = `-- =========================================================================\n`;
individualSql += `-- INDIVIDUAL UPDATE STATEMENTS (Safe Transaction Block)\n`;
individualSql += `-- =========================================================================\n\n`;
individualSql += `BEGIN;\n\n`;

for (const r of records) {
  individualSql += `UPDATE "Employee" SET "employeeSalary" = ${r.salary}, "updatedAt" = CURRENT_TIMESTAMP WHERE UPPER(TRIM("employeeId")) = '${r.empId.toUpperCase()}'; -- ${r.name}\n`;
}

individualSql += `\nCOMMIT;\n`;

const fullSql = batchSql + '\n\n' + individualSql;
const outPath = path.join(__dirname, '..', 'update_employee_salaries.sql');
fs.writeFileSync(outPath, fullSql, 'utf8');
console.log(`Generated: ${outPath}`);
