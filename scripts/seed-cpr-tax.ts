import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';
import * as XLSX from 'xlsx';
import * as path from 'path';

interface ExcelRow {
  NTN_TaxPayer_CNIC?: string;
  TaxPayer_Name?: string;
  TaxPayer_City?: string;
  "CPR No"?: string;
  car_amount?: number;
  TaxPayer_NTN?: string;
  Taxable_Amount_annaual?: number;
  Taxable_Amount_gross?: number;
  "Tax_Amount_Monthly Tax"?: number;
  "Tax Period"?: string | number;
  "Payment Date"?: string | number;
}

function decrypt(encryptedText: string, masterKeyString: string): string {
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const parts = encryptedText.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted text format');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(parts[2], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function cleanCnic(cnic: any): string {
  if (cnic === undefined || cnic === null) return '';
  return String(cnic).replace(/[^a-zA-Z0-9]/g, '').trim().toLowerCase();
}

async function seedCprTax(prisma: PrismaClient, rows: ExcelRow[]) {
  console.log(`  Fetching employees for CNIC matching...`);
  const employees = await prisma.employee.findMany({
    select: {
      id: true,
      cnicNumber: true,
      employeeName: true,
      employeeId: true,
    }
  });

  console.log(`  Found ${employees.length} employees in tenant database.`);

  console.log(`  Clearing existing CPR Tax records to prevent duplicate seeding...`);
  await prisma.cprTax.deleteMany({});

  let matchedCount = 0;
  let unmatchedCount = 0;
  let insertedCount = 0;

  console.log(`  Inserting ${rows.length} CPR Tax entries...`);
  for (const row of rows) {
    const rawCnic = row.NTN_TaxPayer_CNIC ? String(row.NTN_TaxPayer_CNIC).trim() : '';
    const rawName = row.TaxPayer_Name ? String(row.TaxPayer_Name).trim() : '';
    const rawCity = row.TaxPayer_City ? String(row.TaxPayer_City).trim() : null;
    const rawCprNo = row["CPR No"] ? String(row["CPR No"]).trim() : '';
    const rawNtn = row.TaxPayer_NTN ? String(row.TaxPayer_NTN).trim() : null;
    
    let rawCarAmount: number | null = null;
    if (row.car_amount !== undefined && row.car_amount !== null) {
      const parsed = parseFloat(String(row.car_amount));
      if (!isNaN(parsed)) {
        rawCarAmount = parsed;
      }
    }

    // New 5 columns
    let taxableAmountAnnual: number | null = null;
    if (row.Taxable_Amount_annaual !== undefined && row.Taxable_Amount_annaual !== null) {
      const parsed = parseFloat(String(row.Taxable_Amount_annaual));
      if (!isNaN(parsed)) taxableAmountAnnual = parsed;
    }

    let taxableAmountGross: number | null = null;
    if (row.Taxable_Amount_gross !== undefined && row.Taxable_Amount_gross !== null) {
      const parsed = parseFloat(String(row.Taxable_Amount_gross));
      if (!isNaN(parsed)) taxableAmountGross = parsed;
    }

    let taxAmountMonthlyTax: number | null = null;
    if (row["Tax_Amount_Monthly Tax"] !== undefined && row["Tax_Amount_Monthly Tax"] !== null) {
      const parsed = parseFloat(String(row["Tax_Amount_Monthly Tax"]));
      if (!isNaN(parsed)) taxAmountMonthlyTax = parsed;
    }

    const taxPeriod = row["Tax Period"] ? String(row["Tax Period"]).trim() : null;
    
    let paymentDate: Date | null = null;
    if (row["Payment Date"] !== undefined && row["Payment Date"] !== null) {
      const val = row["Payment Date"];
      if (typeof val === 'number') {
        // Excel serial date conversion
        paymentDate = new Date(Math.round((val - 25569) * 86400 * 1000));
      } else {
        const parsedDate = new Date(String(val).trim());
        if (!isNaN(parsedDate.getTime())) {
          paymentDate = parsedDate;
        }
      }
    }

    if (!rawCnic || !rawName || !rawCprNo) {
      // Skip the summary or empty rows in the excel sheet
      continue;
    }

    // Match employee
    let employeeId: string | null = null;
    const cleanedExcelCnic = cleanCnic(rawCnic);
    if (cleanedExcelCnic) {
      const matchedEmp = employees.find(emp => cleanCnic(emp.cnicNumber) === cleanedExcelCnic);
      if (matchedEmp) {
        employeeId = matchedEmp.id;
        matchedCount++;
      } else {
        unmatchedCount++;
      }
    } else {
      unmatchedCount++;
    }

    await prisma.cprTax.create({
      data: {
        employeeId,
        cnic: rawCnic,
        name: rawName,
        city: rawCity,
        cprNo: rawCprNo,
        carAmount: rawCarAmount,
        ntn: rawNtn,
        taxableAmountAnnual,
        taxableAmountGross,
        taxAmountMonthlyTax,
        taxPeriod,
        paymentDate,
      }
    });

    insertedCount++;
  }

  console.log(`  ✅ Seeding Complete for this tenant:`);
  console.log(`     Total rows processed: ${insertedCount}`);
  console.log(`     Matched with employees: ${matchedCount}`);
  console.log(`     Unmatched: ${unmatchedCount}`);
}

async function main() {
  console.log('🚀 Starting CPR Tax Seeding from Excel...');

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (!managementUrl || !masterKey) {
    console.error('❌ DATABASE_URL_MANAGEMENT and MASTER_ENCRYPTION_KEY required in .env');
    process.exit(1);
  }

  // 1. Read Excel rows
  const filePath = path.join(__dirname, '../Copy of CPR Detail 25-26.xlsx');
  console.log('Reading Excel file from:', filePath);
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<ExcelRow>(sheet);
  
  if (rows.length === 0) {
    console.error('❌ No rows found in the Excel sheet.');
    process.exit(1);
  }
  console.log(`Successfully parsed ${rows.length} rows from Excel sheet.`);

  // 2. Connect to Master Management DB
  const pool = new Pool({ connectionString: managementUrl });
  const adapter = new PrismaPg(pool);
  const management = new ManagementClient({ adapter } as any);

  try {
    const tenantArgIdx = process.argv.indexOf('--tenant');
    const specificTenant = tenantArgIdx !== -1 ? process.argv[tenantArgIdx + 1] : null;

    const companies = await management.company.findMany({
      where: { status: 'active', ...(specificTenant ? { dbName: specificTenant } : {}) },
    });

    if (companies.length === 0) {
      console.log('ℹ️ No active companies found.');
      return;
    }

    for (const company of companies) {
      console.log(`\n👉 Processing company: ${company.name} (${company.code})`);
      try {
        let connectionString = company.dbUrl;
        if (company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch {
            console.warn(`  ⚠️ Decryption failed, using stored dbUrl`);
          }
        }
        if (!connectionString) {
          console.error(`  ❌ No connection details for ${company.name}`);
          continue;
        }

        const tenantPool = new Pool({ connectionString });
        const tenantAdapter = new PrismaPg(tenantPool);
        const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

        try {
          await tenantPrisma.$connect();
          await seedCprTax(tenantPrisma, rows);
        } finally {
          await tenantPrisma.$disconnect();
          await tenantPool.end();
        }
      } catch (err: any) {
        console.error(`  ❌ Failed processing company ${company.name}: ${err.message}`);
      }
    }

    console.log('\n✨ Seeding process finished.');
  } finally {
    await management.$disconnect();
    await pool.end();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
