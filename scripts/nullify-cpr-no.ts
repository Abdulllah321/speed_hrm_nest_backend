import 'dotenv/config';
import { Pool } from 'pg';
import * as crypto from 'crypto';

/**
 * Decrypt password using AES-256-GCM
 */
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

async function nullifyCprNo() {
  console.log('🚀 Starting script to nullify cprNo in CprTax table...\n');

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (!managementUrl || !masterKey) {
    console.error('❌ DATABASE_URL_MANAGEMENT and MASTER_ENCRYPTION_KEY required in .env');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: managementUrl });

  try {
    const tenantArgIdx = process.argv.indexOf('--tenant');
    const specificTenant = tenantArgIdx !== -1 ? process.argv[tenantArgIdx + 1] : null;

    const res = await pool.query(
      'SELECT name, code, "dbName", "dbUser", "dbPassword", "dbHost", "dbPort", "dbUrl" FROM "Company" WHERE status = \'active\'' +
      (specificTenant ? ` AND "dbName" = '${specificTenant}'` : '')
    );

    const companies = res.rows;
    if (companies.length === 0) {
      console.log('ℹ️ No active companies found.');
      return;
    }

    console.log(`Found ${companies.length} company/tenant(s) to process.`);

    for (const company of companies) {
      console.log(`\n========================================`);
      console.log(`🏢 Processing Tenant: ${company.name} (${company.code}) [${company.dbName}]`);
      console.log(`========================================`);

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

      try {
        // 1. Check if CprTax table exists
        const tableCheck = await tenantPool.query(`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = 'CprTax'
        `);

        if (tableCheck.rows.length === 0) {
          console.log(`  ⚠️ Table 'CprTax' does not exist in ${company.dbName}. Skipping.`);
          continue;
        }

        // 2. Check if cprNo is nullable
        const colCheck = await tenantPool.query(`
          SELECT column_name, is_nullable, data_type 
          FROM information_schema.columns 
          WHERE table_schema = 'public' AND table_name = 'CprTax' AND column_name = 'cprNo'
        `);

        if (colCheck.rows.length === 0) {
          console.log(`  ⚠️ Column 'cprNo' does not exist in 'CprTax'. Skipping.`);
          continue;
        }

        const isNullable = colCheck.rows[0].is_nullable;
        console.log(`  Current 'cprNo' nullability: ${isNullable === 'YES' ? 'Nullable' : 'NOT NULL'}`);

        // 3. Drop NOT NULL constraint if present so column accepts NULL
        if (isNullable === 'NO') {
          console.log(`  Altering column 'cprNo' to DROP NOT NULL...`);
          await tenantPool.query(`ALTER TABLE "CprTax" ALTER COLUMN "cprNo" DROP NOT NULL;`);
          console.log(`  ✅ Successfully dropped NOT NULL constraint.`);
        }

        // 4. Update all rows to NULL
        console.log(`  Updating all rows in 'CprTax' to set cprNo = NULL...`);
        const updateResult = await tenantPool.query(`UPDATE "CprTax" SET "cprNo" = NULL;`);
        console.log(`  ✅ Updated ${updateResult.rowCount} rows to NULL.`);

        // 5. Verification count
        const verifyRes = await tenantPool.query(`
          SELECT 
            COUNT(*) AS total_rows, 
            COUNT("cprNo") AS non_null_cpr_count,
            COUNT(*) - COUNT("cprNo") AS null_cpr_count
          FROM "CprTax";
        `);
        console.log(`  📊 Verification Results:`, verifyRes.rows[0]);

      } catch (err: any) {
        console.error(`  ❌ Error processing ${company.name}:`, err.message);
      } finally {
        await tenantPool.end();
      }
    }

    console.log('\n✨ All tenants processed successfully!');
  } finally {
    await pool.end();
  }
}

nullifyCprNo().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
