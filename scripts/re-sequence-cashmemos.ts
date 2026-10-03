import 'dotenv/config';
// No PrismaClient needed
import * as crypto from 'crypto';
import { Pool } from 'pg';

function decrypt(encryptedText: string, masterKeyString: string): string {
    const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
    const parts = encryptedText.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, Buffer.from(parts[0], 'hex'));
    decipher.setAuthTag(Buffer.from(parts[1], 'hex'));
    let decrypted = decipher.update(parts[2], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

async function processField(
    tenantPool: Pool, 
    locId: string, 
    cleanCode: string, 
    tableName: string,
    fieldName: string, 
    prefix: string,
    dateThreshold: string
) {
    const matchPrefix27 = `${prefix}-${cleanCode}27-`;

    // Get max sequence of 27 across ALL records in this tenant
    const all27 = await tenantPool.query(`SELECT "${fieldName}" as field_val FROM "${tableName}" WHERE "${fieldName}" LIKE $1`, [matchPrefix27 + '%']);
    let maxSeq27 = 0;
    for (const row of all27.rows) {
        if (!row.field_val) continue;
        const parts = row.field_val.split('-');
        const lastPart = parts[parts.length - 1];
        if (/^\d+$/.test(lastPart)) {
            const parsed = parseInt(lastPart, 10);
            if (parsed > maxSeq27) maxSeq27 = parsed;
        }
    }

    // Find all wrong 26 records created on or after threshold
    const wrongRecordsRes = await tenantPool.query(`
        SELECT id, "${fieldName}" as field_val 
        FROM "${tableName}" 
        WHERE "created_at" >= $1 
          AND "location_id" = $2
          AND "${fieldName}" LIKE '%26-%'
        ORDER BY "created_at" ASC
    `, [dateThreshold, locId]);

    const wrongRecords = wrongRecordsRes.rows;
    if (wrongRecords.length > 0) {
        console.log(`   [${prefix}] Location ${cleanCode}: Found ${wrongRecords.length} wrong '26-' ${fieldName}s. Starting sequence from ${maxSeq27 + 1}`);
        
        // Update them
        for (let i = 0; i < wrongRecords.length; i++) {
            const record = wrongRecords[i];
            maxSeq27++;
            const newNumber = `${matchPrefix27}${String(maxSeq27).padStart(5, '0')}`;
            
            await tenantPool.query(`UPDATE "${tableName}" SET "${fieldName}" = $1 WHERE id = $2`, [newNumber, record.id]);
            if (i < 3 || i === wrongRecords.length - 1) {
                console.log(`      Updated ${record.field_val} -> ${newNumber}`);
            }
        }
        console.log(`      ... total ${wrongRecords.length} updated for ${prefix}.`);
    }
}

async function main() {
  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (!managementUrl || !masterKey) {
      console.error('❌ DATABASE_URL_MANAGEMENT or MASTER_ENCRYPTION_KEY not found in .env');
      process.exit(1);
  }

  const mPool = new Pool({ connectionString: managementUrl });
  const companiesRes = await mPool.query(`SELECT name, code, "dbUrl", "dbPassword", "dbHost", "dbPort", "dbUser", "dbName" FROM "Company" WHERE status = 'active'`);
  const companies = companiesRes.rows;
  console.log(`Found ${companies.length} active tenants.`);

  const dateThreshold = '2026-10-01 00:00:00';

  for (const company of companies) {
    console.log(`\n--- Inspecting Tenant: ${company.name} ---`);
    
    let connectionString = company.dbUrl;
    if (company.dbPassword) {
        try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
        } catch (e) {
            console.warn(`   ⚠️  Decryption failed for ${company.code}`);
        }
    }

    if (!connectionString) {
        console.warn('DB url missing, skipping.');
        continue;
    }
    const tenantPool = new Pool({ connectionString });
    
    try {
        const locationsRes = await tenantPool.query(`SELECT id, name, short_code as "shortCode" FROM "Location"`);
        const locations = locationsRes.rows;

        for (const loc of locations) {
            const rawCode = (loc.shortCode || loc.name).trim();
            const cleanCode = rawCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'LOC';

            // 1. SalesOrder - orderNumber (SI)
            await processField(tenantPool, loc.id, cleanCode, 'sales_orders', 'orderNumber', 'SI', dateThreshold);
            
            // 2. SalesOrder - return_number (SR)
            await processField(tenantPool, loc.id, cleanCode, 'sales_orders', 'return_number', 'SR', dateThreshold);
            
            // 3. SalesOrder - refund_number (RF)
            await processField(tenantPool, loc.id, cleanCode, 'sales_orders', 'refund_number', 'RF', dateThreshold);

            try {
                await processField(tenantPool, loc.id, cleanCode, 'pos_returns', 'return_number', 'SR', dateThreshold);
            } catch (err: any) {
                if (!err.message.includes('relation "pos_returns" does not exist')) {
                    throw err;
                }
            }
        }

    } catch (e) {
      console.error('Error on tenant:', e);
    } finally {
      await tenantPool.end();
    }
  }
  await mPool.end();
}

main().catch(console.error);
