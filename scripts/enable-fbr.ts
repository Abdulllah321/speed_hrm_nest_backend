import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';
import * as XLSX from 'xlsx';
import * as path from 'path';

interface Row {
  'POS ID'?: number | string;
  'Identification No'?: number | string;
  'Token'?: string;
  'Branch Name'?: string;
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

async function updateFBR(prisma: PrismaClient, rows: Row[]) {
  let updatedCount = 0;
  let notFoundCount = 0;

  for (const row of rows) {
    if (!row['Identification No'] || !row['POS ID'] || !row['Token']) {
      continue;
    }

    const centerId = row['Identification No']?.toString().trim();
    const posId = row['POS ID']?.toString().trim();
    const token = row['Token']?.toString().trim();
    const branchName = row['Branch Name']?.toString().trim();
    const codeStr = row['Code']?.toString().trim();

    if (!posId || !token) continue;

    // Find the location by centerId
    let locations = centerId ? await prisma.location.findMany({
      where: {
        centerId: centerId,
        isDeleted: false,
      },
    }) : [];

    // Fallback to name match
    if (locations.length === 0 && branchName) {
      locations = await prisma.location.findMany({
        where: {
          name: { equals: branchName, mode: 'insensitive' },
          isDeleted: false,
        },
      });
    }

    // Fallback to code match
    if (locations.length === 0 && codeStr) {
      locations = await prisma.location.findMany({
        where: {
          code: { equals: codeStr, mode: 'insensitive' },
          isDeleted: false,
        },
      });
    }

    // Still not found
    if (locations.length === 0) {
      console.log(`  ⚠️ Location not found for Center ID: ${centerId} / Name: ${branchName} / Code: ${codeStr}`);
      notFoundCount++;
      continue;
    }

    for (const loc of locations) {
      await prisma.location.update({
        where: { id: loc.id },
        data: {
          fbrNtn: "1208373-9",
          fbrSellerName: "Speed (Private) Limited",
          fbrBposId: posId,
          fbrBearerToken: token,
          fbrEnabled: true,
        },
      });
      console.log(`  ✅ Updated location: ${loc.name} (Center ID: ${centerId})`);
      updatedCount++;
    }
  }

  console.log(`  📊 Summary: ${updatedCount} locations updated, ${notFoundCount} Center IDs not found.`);
}

async function main() {
  console.log('🚀 Starting FBR Locations Update...');

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (!managementUrl || !masterKey) {
    console.error('❌ DATABASE_URL_MANAGEMENT and MASTER_ENCRYPTION_KEY required in .env');
    process.exit(1);
  }

  // 1. Read Excel rows
  const filePath = 'f:/HRM-abdullah/speed-limit/fbrkeys.xlsx';
  console.log('Reading Excel file from:', filePath);
  
  let workbook;
  try {
    workbook = XLSX.readFile(filePath);
  } catch (e) {
    console.error('❌ Could not read Excel file:', e);
    process.exit(1);
  }
  
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Row>(sheet);
  
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
            console.warn(`  ⚠️  Decryption failed, using stored dbUrl`);
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
          await updateFBR(tenantPrisma, rows);
        } finally {
          await tenantPrisma.$disconnect();
          await tenantPool.end();
        }
      } catch (err: any) {
        console.error(`  ❌ Failed processing company ${company.name}: ${err.message}`);
      }
    }

    console.log('\n✨ All done.');
  } finally {
    await management.$disconnect();
    await pool.end();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
