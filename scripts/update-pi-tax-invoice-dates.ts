import 'dotenv/config';
import * as crypto from 'crypto';
import { Pool } from 'pg';

/**
 * Decrypt password using AES-256-GCM
 */
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

const piDatesData = [
  { invoiceNumber: 'PI-2026-0001', staxEInvoiceDate: '2026-07-07T00:00:00.000Z' },
  { invoiceNumber: 'PI-2026-0002', staxEInvoiceDate: '2026-07-07T00:00:00.000Z' },
  { invoiceNumber: 'PI-2026-0003', staxEInvoiceDate: '2026-07-07T00:00:00.000Z' },
  { invoiceNumber: 'PI-2026-0004', staxEInvoiceDate: '2026-07-07T00:00:00.000Z' },
  { invoiceNumber: 'PI-2026-0005', staxEInvoiceDate: '2026-07-07T00:00:00.000Z' },
  { invoiceNumber: 'PI-2026-0006', staxEInvoiceDate: '2026-07-07T00:00:00.000Z' },
  { invoiceNumber: 'PI-2026-0007', staxEInvoiceDate: '2026-07-07T00:00:00.000Z' },
  { invoiceNumber: 'PI-2026-0008', staxEInvoiceDate: '2026-07-07T00:00:00.000Z' },
  { invoiceNumber: 'PI-2026-0009', staxEInvoiceDate: '2026-07-07T00:00:00.000Z' },
  { invoiceNumber: 'PI-2026-0010', staxEInvoiceDate: '2026-07-07T00:00:00.000Z' },
  { invoiceNumber: 'PI-2026-0011', staxEInvoiceDate: '2026-07-07T00:00:00.000Z' },
  { invoiceNumber: 'PI-2026-0012', staxEInvoiceDate: '2026-07-27T00:00:00.000Z' },
  { invoiceNumber: 'PI-2026-0013', staxEInvoiceDate: '2026-07-27T00:00:00.000Z' },
  { invoiceNumber: 'PI-2026-0014', staxEInvoiceDate: '2026-07-27T00:00:00.000Z' },
  { invoiceNumber: 'PI-2026-0015', staxEInvoiceDate: '2026-08-03T00:00:00.000Z' },
  { invoiceNumber: 'PI-2026-0016', staxEInvoiceDate: '2026-08-03T00:00:00.000Z' },
  { invoiceNumber: 'PI-2026-0017', staxEInvoiceDate: '2026-08-03T00:00:00.000Z' },
  { invoiceNumber: 'PI-2026-0018', staxEInvoiceDate: '2026-08-03T00:00:00.000Z' },
  { invoiceNumber: 'PI-2026-0019', staxEInvoiceDate: '2026-08-05T00:00:00.000Z' },
  { invoiceNumber: 'PI-2026-0020', staxEInvoiceDate: '2026-08-05T00:00:00.000Z' },
  { invoiceNumber: 'PI-2026-0021', staxEInvoiceDate: '2026-08-05T00:00:00.000Z' },
];

async function updatePiTaxInvoiceDates() {
  console.log('🚀 Starting Purchase Invoice Sales Tax Date update process...');

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  let tenantPools: { name: string; pool: Pool }[] = [];

  if (managementUrl && masterKey) {
    const mgmtPool = new Pool({ connectionString: managementUrl });

    try {
      const res = await mgmtPool.query(`
        SELECT name, code, "dbUrl", "dbPassword", "dbUser", "dbHost", "dbPort", "dbName" 
        FROM "Company" 
        WHERE status = 'active'
      `);

      for (const company of res.rows) {
        let connectionString = company.dbUrl;
        if (company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5433}/${company.dbName}?schema=public`;
          } catch (e) {
            // fallback
          }
        }
        if (connectionString) {
          tenantPools.push({
            name: company.name,
            pool: new Pool({ connectionString }),
          });
        }
      }
    } catch (err: any) {
      console.warn(`Could not load tenants from management DB: ${err.message}`);
    } finally {
      await mgmtPool.end().catch(() => {});
    }
  }

  // Fallback direct local DB if no tenants found from management
  if (tenantPools.length === 0) {
    const defaultUrl = 'postgresql://speedlimit:speedlimit123@localhost:5433/tenant_speed_main_mox1gfsi?schema=public';
    tenantPools.push({
      name: 'Default Tenant',
      pool: new Pool({ connectionString: defaultUrl }),
    });
  }

  for (const tenant of tenantPools) {
    console.log(`\n📦 Processing Tenant: ${tenant.name}`);
    const client = await tenant.pool.connect();
    try {
      // 1. Ensure column exists
      await client.query(`
        ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS stax_e_invoice_date TIMESTAMP WITH TIME ZONE;
        ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS stax_e_invoice_date TIMESTAMP WITH TIME ZONE;
      `);

      // 2. Update each PI
      for (const item of piDatesData) {
        const res = await client.query(
          `UPDATE purchase_invoices 
           SET stax_e_invoice_date = $1, updated_at = NOW() 
           WHERE invoice_number = $2 
           RETURNING id, invoice_number, stax_e_invoice_date`,
          [item.staxEInvoiceDate, item.invoiceNumber]
        );

        if (res.rowCount && res.rowCount > 0) {
          console.log(`✅ Updated ${item.invoiceNumber} -> Sales Tax Inv Date = ${item.staxEInvoiceDate.split('T')[0]}`);
        } else {
          console.log(`⚠️ ${item.invoiceNumber} not found in this tenant DB`);
        }
      }
    } catch (err: any) {
      console.error(`❌ Error on tenant ${tenant.name}:`, err.message);
    } finally {
      client.release();
      await tenant.pool.end().catch(() => {});
    }
  }

  console.log('\n✨ Purchase Invoice Sales Tax Dates update completed!');
}

updatePiTaxInvoiceDates().catch((e) => {
  console.error(e);
  process.exit(1);
});
