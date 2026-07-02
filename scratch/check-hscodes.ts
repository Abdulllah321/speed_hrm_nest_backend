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

async function main() {
  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (!managementUrl || !masterKey) {
    console.error('❌ DATABASE_URL_MANAGEMENT and MASTER_ENCRYPTION_KEY required in .env');
    return;
  }

  const pool = new Pool({ connectionString: managementUrl });
  const adapter = new PrismaPg(pool);
  const management = new ManagementClient({ adapter } as any);

  try {
    const companies = await management.company.findMany({
      where: { status: 'active' },
    });

    if (companies.length === 0) {
      console.log('ℹ️ No active companies found.');
      return;
    }

    for (const company of companies) {
      console.log(`\n👉 Company: ${company.name} (${company.code})`);
      let connectionString = company.dbUrl;
      if (company.dbPassword) {
        try {
          const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
          connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
        } catch {
          // ignore
        }
      }
      if (!connectionString) continue;

      const tenantPool = new Pool({ connectionString });
      const tenantAdapter = new PrismaPg(tenantPool);
      const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

      try {
        await tenantPrisma.$connect();
        const count = await tenantPrisma.hsCode.count();
        console.log(`  Total HS Codes: ${count}`);
        if (count > 0) {
          const samples = await tenantPrisma.hsCode.findMany({ take: 5 });
          console.log('  Samples:', JSON.stringify(samples, null, 2));
        }
      } finally {
        await tenantPrisma.$disconnect();
        await tenantPool.end();
      }
    }
  } finally {
    await management.$disconnect();
    await pool.end();
  }
}

main().catch(console.error);
