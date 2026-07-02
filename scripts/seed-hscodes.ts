import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';

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

const defaultHsCodes = [
  { hsCode: '6117.1020', customsDutyCd: 0, regulatoryDutyRd: 0, additionalCustomsDutyAcd: 0, salesTax: 18, additionalSalesTax: 3, incomeTax: 0, exciseCharges: 0 },
  { hsCode: '6105.9000', customsDutyCd: 0, regulatoryDutyRd: 0, additionalCustomsDutyAcd: 0, salesTax: 18, additionalSalesTax: 3, incomeTax: 0, exciseCharges: 0 },
  { hsCode: '6103.4900', customsDutyCd: 0, regulatoryDutyRd: 0, additionalCustomsDutyAcd: 0, salesTax: 18, additionalSalesTax: 3, incomeTax: 0, exciseCharges: 0 },
  { hsCode: '6505.0000', customsDutyCd: 0, regulatoryDutyRd: 0, additionalCustomsDutyAcd: 0, salesTax: 18, additionalSalesTax: 3, incomeTax: 0, exciseCharges: 0 },
  { hsCode: '3923.3010', customsDutyCd: 0, regulatoryDutyRd: 0, additionalCustomsDutyAcd: 0, salesTax: 18, additionalSalesTax: 3, incomeTax: 0, exciseCharges: 0 },
  { hsCode: '6103.3900', customsDutyCd: 0, regulatoryDutyRd: 0, additionalCustomsDutyAcd: 0, salesTax: 18, additionalSalesTax: 3, incomeTax: 0, exciseCharges: 0 },
  { hsCode: '4202.9200', customsDutyCd: 0, regulatoryDutyRd: 0, additionalCustomsDutyAcd: 0, salesTax: 18, additionalSalesTax: 3, incomeTax: 0, exciseCharges: 0 },
  { hsCode: '6115.3010', customsDutyCd: 0, regulatoryDutyRd: 0, additionalCustomsDutyAcd: 0, salesTax: 18, additionalSalesTax: 3, incomeTax: 0, exciseCharges: 0 },
  { hsCode: '6103.4300', customsDutyCd: 0, regulatoryDutyRd: 0, additionalCustomsDutyAcd: 0, salesTax: 18, additionalSalesTax: 3, incomeTax: 0, exciseCharges: 0 },
  { hsCode: '6104.6200', customsDutyCd: 0, regulatoryDutyRd: 0, additionalCustomsDutyAcd: 0, salesTax: 18, additionalSalesTax: 3, incomeTax: 0, exciseCharges: 0 },
  { hsCode: '4203.3000', customsDutyCd: 0, regulatoryDutyRd: 0, additionalCustomsDutyAcd: 0, salesTax: 18, additionalSalesTax: 3, incomeTax: 0, exciseCharges: 0 },
  { hsCode: '6115.9900', customsDutyCd: 0, regulatoryDutyRd: 0, additionalCustomsDutyAcd: 0, salesTax: 18, additionalSalesTax: 3, incomeTax: 0, exciseCharges: 0 }
];

async function seedHsCodes(prisma: PrismaClient) {
  // 1. Fetch all existing HS Codes and update in a loop
  console.log('🔄 Fetching all existing HS Codes to update via loop...');
  const allCodes = await prisma.hsCode.findMany({
    where: { isDeleted: false }
  });

  console.log(`🔄 Updating ${allCodes.length} HS Codes to 3% additional sales tax via loop...`);
  let loopUpdatedCount = 0;
  for (const item of allCodes) {
    await prisma.hsCode.update({
      where: { id: item.id },
      data: {
        additionalSalesTax: 3,
      },
    });
    loopUpdatedCount++;
  }
  console.log(`✅ Loop completed: Updated ${loopUpdatedCount} existing HS Codes.`);

  // 2. Seed missing default HS Codes
  console.log('🌱 Seeding default HS Codes...');
  let created = 0;
  let updated = 0;

  for (const item of defaultHsCodes) {
    const existing = await prisma.hsCode.findFirst({
      where: { hsCode: item.hsCode, isDeleted: false }
    });

    if (!existing) {
      await prisma.hsCode.create({
        data: {
          ...item,
          status: 'active'
        }
      });
      console.log(`➕ Created default HS Code: ${item.hsCode} with 3% Additional Sales Tax`);
      created++;
    } else {
      await prisma.hsCode.update({
        where: { id: existing.id },
        data: {
          additionalSalesTax: 3
        }
      });
      updated++;
    }
  }

  console.log(`🎉 Seeding completed: ${created} created, ${updated} updated.`);
}

async function main() {
  console.log('🚀 Starting HS Code Seeding Script...');

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (!managementUrl || !masterKey) {
    console.error('❌ DATABASE_URL_MANAGEMENT and MASTER_ENCRYPTION_KEY required in .env');
    process.exit(1);
  }

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
      console.log(`\n👉 Processing Company: ${company.name} (${company.code}) [DB: ${company.dbName}]`);
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
          console.error(`  ❌ No connection details found for company: ${company.name}`);
          continue;
        }

        const tenantPool = new Pool({ connectionString });
        const tenantAdapter = new PrismaPg(tenantPool);
        const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

        try {
          await tenantPrisma.$connect();
          await seedHsCodes(tenantPrisma);
        } finally {
          await tenantPrisma.$disconnect();
          await tenantPool.end();
        }
      } catch (err: any) {
        console.error(`  ❌ Failed processing company ${company.name}: ${err.message}`);
      }
    }

    console.log('\n✨ All operations done.');
  } finally {
    await management.$disconnect();
    await pool.end();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
