import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';
import * as XLSX from 'xlsx';
import * as path from 'path';

interface Row {
  Category?: string;
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

async function seedCategories(prisma: PrismaClient, rows: Row[]) {
  let categoriesCreated = 0;
  let categoriesSkipped = 0;

  // Extract all unique values from the Category column to seed as top-level categories
  const categoryNames = [...new Set(rows.map(r => r.Category?.trim()).filter(Boolean))] as string[];

  console.log(`  Seeding ${categoryNames.length} unique categories...`);

  for (const catName of categoryNames) {
    const existingCategory = await prisma.category.findFirst({
      where: {
        name: { equals: catName, mode: 'insensitive' },
        parentId: null,
        isDeleted: false
      }
    });

    if (!existingCategory) {
      await prisma.category.create({
        data: {
          name: catName,
          parentId: null
        }
      });
      categoriesCreated++;
    } else {
      categoriesSkipped++;
    }
  }

  console.log(`  ✅ Categories: ${categoriesCreated} created, ${categoriesSkipped} skipped (already exist).`);
}

async function main() {
  console.log('🚀 Starting Categories Seeding from Excel...');

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (!managementUrl || !masterKey) {
    console.error('❌ DATABASE_URL_MANAGEMENT and MASTER_ENCRYPTION_KEY required in .env');
    process.exit(1);
  }

  // 1. Read Excel rows
  const filePath = path.join(__dirname, '../Category update File for INPL.XLSX');
  console.log('Reading Excel file from:', filePath);
  const workbook = XLSX.readFile(filePath);
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
          await seedCategories(tenantPrisma, rows);
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
