// @ts-nocheck
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as XLSX from 'xlsx';
import * as path from 'path';

function decrypt(encryptedText: string, masterKeyString: string): string {
  if (!masterKeyString || masterKeyString.length < 32) {
    throw new Error('MASTER_ENCRYPTION_KEY must be at least 32 characters');
  }
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const algorithm = 'aes-256-gcm';

  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(algorithm, masterKey, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

async function updateEmployeeLocations(prisma: PrismaClient) {
  const filePath = path.join(__dirname, '..', 'Employee List location.xlsx');
  const workbook = XLSX.readFile(filePath);
  
  // Find Sheet2
  const sheetName = workbook.SheetNames.find(name => name.toLowerCase().includes('sheet2')) || workbook.SheetNames[0];
  console.log(`📖 Reading sheet: "${sheetName}"`);
  
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    console.error(`❌ Sheet "${sheetName}" not found in Excel file!`);
    return;
  }
  
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  console.log(`📊 Found ${rows.length} rows in the excel sheet.`);

  let updatedCount = 0;
  let employeeNotFound = 0;
  let locationNotFound = 0;
  let skippedRows = 0;

  // Header ends at index 2, data starts from row 3 (index 3)
  for (let i = 3; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const employeeName = row[0]?.toString().trim();
    const employeeCode = row[1]?.toString().trim();
    const locationName = row[2]?.toString().trim();
    const subCode = row[3]?.toString().trim();

    if (!employeeCode && !subCode) {
      continue;
    }

    if (!employeeCode || !subCode) {
      console.warn(`⚠️ Row ${i + 1}: Missing employee code ("${employeeCode}") or location sub code ("${subCode}") for "${employeeName || 'Unknown'}". Skipping.`);
      skippedRows++;
      continue;
    }

    // Find location in tenant DB
    const location = await prisma.location.findFirst({
      where: { code: subCode, isDeleted: false }
    });

    if (!location) {
      console.warn(`⚠️ Row ${i + 1}: Location code "${subCode}" ("${locationName}") not found in database for employee "${employeeName}" (${employeeCode})`);
      locationNotFound++;
      continue;
    }

    // Find employee by employeeId
    const employee = await prisma.employee.findUnique({
      where: { employeeId: employeeCode }
    });

    if (!employee) {
      console.warn(`⚠️ Row ${i + 1}: Employee "${employeeName}" with code "${employeeCode}" not found in database`);
      employeeNotFound++;
      continue;
    }

    // Update locationId
    await prisma.employee.update({
      where: { id: employee.id },
      data: { locationId: location.id }
    });

    console.log(`✅ Row ${i + 1}: Updated location for "${employee.employeeName}" (${employeeCode}) to "${location.name}" (${subCode})`);
    updatedCount++;
  }

  console.log(`\n🎉 Tenant Location Update Summary:`);
  console.log(`   - Total Updated: ${updatedCount}`);
  console.log(`   - Employee Not Found: ${employeeNotFound}`);
  console.log(`   - Location Not Found: ${locationNotFound}`);
  console.log(`   - Skipped Rows (incomplete info): ${skippedRows}`);
}

async function main() {
  console.log('🚀 Starting Employee Location Update Script...');

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (!managementUrl) {
    console.error('❌ DATABASE_URL_MANAGEMENT not found in .env');
    process.exit(1);
  }

  if (!masterKey) {
    console.error('❌ MASTER_ENCRYPTION_KEY not found in .env');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: managementUrl });
  const adapter = new PrismaPg(pool);
  const management = new ManagementClient({ adapter } as any);

  try {
    const companies = await management.company.findMany({
      where: { status: 'active' },
    });

    if (companies.length === 0) {
      console.log('ℹ️ No active companies found in Master DB.');
      return;
    }

    console.log(`📡 Found ${companies.length} active companies.`);

    for (const company of companies) {
      console.log(`\n👉 Processing tenant: ${company.name} (${company.code})`);

      try {
        let connectionString = company.dbUrl;

        if (company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch (e) {
            console.warn(
              `   ⚠️  Decryption failed for ${company.code}, using stored dbUrl...`,
            );
          }
        }

        if (!connectionString) {
          console.error(`   ❌ No connection details for ${company.code}`);
          continue;
        }

        const tenantPool = new Pool({ connectionString });
        const tenantAdapter = new PrismaPg(tenantPool);
        const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

        try {
          await tenantPrisma.$connect();
          await updateEmployeeLocations(tenantPrisma);
          console.log(`   ✅ Tenant ${company.code} update completed successfully.`);
        } finally {
          await tenantPrisma.$disconnect();
          await tenantPool.end();
        }
      } catch (err: any) {
        console.error(`   ❌ Failed to update employee locations for ${company.code}: ${err.message}`);
      }
    }

    console.log('\n✨ All tenants processed.');
  } catch (error: any) {
    console.error(`\n❌ Error querying Master DB: ${error.message}`);
  } finally {
    await management.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
