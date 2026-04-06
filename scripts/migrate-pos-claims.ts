import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

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

const sql = fs.readFileSync(path.join(__dirname, 'create-pos-claims-tables.sql'), 'utf-8');

async function runMigration(connectionString: string, name: string) {
  const pool = new Pool({ connectionString });
  try {
    await pool.query(sql);
    console.log(`  ✅ ${name}: pos_claims tables created/verified`);
  } catch (err: any) {
    console.error(`  ❌ ${name}: ${err.message}`);
  } finally {
    await pool.end();
  }
}

async function main() {
  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  if (!managementUrl || !masterKey) {
    console.error('❌ DATABASE_URL_MANAGEMENT and MASTER_ENCRYPTION_KEY required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: managementUrl });
  const adapter = new PrismaPg(pool);
  const management = new ManagementClient({ adapter } as any);

  try {
    const tenantArg = process.argv.indexOf('--tenant');
    const specificTenant = tenantArg !== -1 ? process.argv[tenantArg + 1] : null;

    const companies = await management.company.findMany({
      where: { status: 'active', ...(specificTenant ? { dbName: specificTenant } : {}) },
    });

    console.log(`🚀 Running pos-claims migration on ${companies.length} tenant(s)...`);

    for (const company of companies) {
      console.log(`\n👉 ${company.name} (${company.code})`);
      try {
        let connectionString = company.dbUrl;
        if (company.dbPassword) {
          const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
          connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
        }
        if (!connectionString) { console.error('  ❌ No connection details'); continue; }
        await runMigration(connectionString, company.name);
      } catch (err: any) {
        console.error(`  ❌ Failed: ${err.message}`);
      }
    }

    console.log('\n✨ Done.');
  } finally {
    await management.$disconnect();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
