import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

const masterKey = process.env.MASTER_ENCRYPTION_KEY || '';
const managementUrl = process.env.DATABASE_URL || 'postgresql://speedlimit:speedlimit123@localhost:5433/speedlimit_management';

function decrypt(encryptedText: string, masterKeyString: string): string {
  const masterKeyBuf = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const parts = encryptedText.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted text format');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKeyBuf, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(parts[2], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function parseNumber(val: any): number {
  if (val === null || val === undefined) return 0;
  const num = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
  return isNaN(num) ? 0 : num;
}

function cleanString(val: any): string | null {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  if (['n/a', 'n / a', 'null', 'none', '-', '', '–', '—'].includes(str.toLowerCase())) return null;
  return str;
}

async function seedCustomersForTenant(prisma: PrismaClient, customersToSeed: any[]) {
  let createdCount = 0;
  let updatedCount = 0;

  for (const customer of customersToSeed) {
    if (customer.traderId) {
      const existing = await (prisma.customer as any).findFirst({
        where: {
          OR: [
            { traderId: customer.traderId },
            ...(customer.subCode ? [{ subCode: customer.subCode }] : []),
          ]
        }
      });

      if (existing) {
        await (prisma.customer as any).update({
          where: { id: existing.id },
          data: customer,
        });
        updatedCount++;
      } else {
        await (prisma.customer as any).create({
          data: customer,
        });
        createdCount++;
      }
    } else {
      await (prisma.customer as any).create({
        data: customer,
      });
      createdCount++;
    }
  }

  console.log(`  ✅ Complete: ${createdCount} created, ${updatedCount} updated`);
}

async function main() {
  console.log('🌱 Seeding customers dataset...');

  // 1. Prepare data from Excel or defaults
  const excelPath = path.join(__dirname, '..', 'Traders List-23-07-26-with Sub codes.xlsx');
  let customersToSeed: any[] = [];

  if (fs.existsSync(excelPath)) {
    console.log(`📁 Loading Excel file: ${excelPath}`);
    const workbook = XLSX.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const records: any[] = XLSX.utils.sheet_to_json(sheet);

    console.log(`📊 Found ${records.length} raw records in Excel.`);

    let autoIncrementTraderId = 10001;

    for (const row of records) {
      const rawTraderId = cleanString(row['Trader ID'] || row['TraderID'] || row['traderId']);
      const company = cleanString(row['Company'] || row['company']);
      const subCode = cleanString(row['Sub Code'] || row['SubCode'] || row['subCode']);
      const brands = cleanString(row['Brands'] || row['brands']);
      const baseMargin = parseNumber(row['Base Margin'] || row['BaseMargin'] || row['baseMargin']);
      const cashMargin = parseNumber(row['Cash Margin'] || row['CashMargin'] || row['cashMargin']);
      const remarks = cleanString(row['Rematks'] || row['Remarks'] || row['remarks']);
      const address = cleanString(row['Address'] || row['address']);
      const deliveryAddress = cleanString(row['Delivery Address'] || row['DeliveryAddress'] || row['deliveryAddress']);
      const cnicNo = cleanString(row['CNIC'] || row['cnic']);
      const ntn = cleanString(row['NationalTaxNumber'] || row['NTN'] || row['ntn']);
      const strn = cleanString(row['GeneralSalesTaxNumber'] || row['STRN'] || row['strn']);

      const name = company || (subCode ? `Trader ${subCode}` : 'Unnamed Trader');
      const traderId = rawTraderId || String(autoIncrementTraderId++);

      customersToSeed.push({
        traderId,
        name,
        company,
        subCode,
        brands,
        baseMargin,
        cashMargin,
        remarks,
        address,
        deliveryAddress,
        cnicNo,
        ntn,
        strn,
        customerType: 'ERP',
        balance: 0,
      });
    }
  } else {
    console.log(`⚠️ Excel file not found at ${excelPath}. Seeding sample default customers.`);
    customersToSeed = [
      {
        traderId: '10001',
        name: 'ZAHID ASSOCIATES',
        company: 'ZAHID ASSOCIATES',
        subCode: '310001',
        address: 'OFFICE NO 4, 109-WEST, SARDAR BEGUM PLAZA, BLUE AREA, Islamabad Urban',
        contactNo: '03005527662',
        baseMargin: 35,
        cashMargin: 3,
        customerType: 'ERP',
        balance: 0,
      },
      {
        traderId: '10002',
        name: 'NIZAM WATCH HOUSE',
        company: 'NIZAM WATCH HOUSE',
        subCode: '310003',
        address: '43-A BANK ROAD, SADDAR, RAWALPINDI',
        contactNo: '051-5563912',
        baseMargin: 35,
        cashMargin: 3,
        customerType: 'ERP',
        balance: 0,
      },
    ];
  }

  // 2. Connect to Management DB and iterate over active tenant companies
  const pool = new Pool({ connectionString: managementUrl });
  const adapter = new PrismaPg(pool);
  const management = new ManagementClient({ adapter } as any);

  try {
    const tenantArgIdx = process.argv.indexOf('--tenant');
    const specificTenant = tenantArgIdx !== -1 ? process.argv[tenantArgIdx + 1] : null;

    let companies: any[] = [];
    try {
      companies = await management.company.findMany({
        where: { status: 'active', ...(specificTenant ? { dbName: specificTenant } : {}) },
      });
    } catch (e: any) {
      console.warn(`  ⚠️ Could not fetch companies from management DB: ${e.message}`);
    }

    if (companies.length === 0) {
      console.log('ℹ️ No active tenant companies found in management DB. Seeding default DATABASE_URL target directly...');
      const directPool = new Pool({ connectionString: managementUrl });
      const directAdapter = new PrismaPg(directPool);
      const directPrisma = new PrismaClient({ adapter: directAdapter });
      try {
        await directPrisma.$connect();
        await seedCustomersForTenant(directPrisma, customersToSeed);
      } finally {
        await directPrisma.$disconnect();
        await directPool.end();
      }
      return;
    }

    for (const company of companies) {
      console.log(`\n👉 Processing company: ${company.name} (${company.code})`);
      try {
        let connectionString = company.dbUrl;
        if (company.dbPassword && masterKey) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch {
            console.warn(`  ⚠️ Decryption failed, using stored dbUrl`);
          }
        }
        if (!connectionString) {
          connectionString = managementUrl;
        }

        const tenantPool = new Pool({ connectionString });
        const tenantAdapter = new PrismaPg(tenantPool);
        const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

        try {
          await tenantPrisma.$connect();
          await seedCustomersForTenant(tenantPrisma, customersToSeed);
        } finally {
          await tenantPrisma.$disconnect();
          await tenantPool.end();
        }
      } catch (err: any) {
        console.error(`  ❌ Failed processing company ${company.name}: ${err.message}`);
      }
    }

    console.log('\n🎉 Customer seeding complete across all target databases!');
  } finally {
    await management.$disconnect();
    await pool.end();
  }
}

main().catch(e => {
  console.error('❌ Error during customer seed execution:', e);
  process.exit(1);
});