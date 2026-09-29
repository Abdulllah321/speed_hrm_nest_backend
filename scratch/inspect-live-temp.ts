import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';

function decrypt(encryptedText: string, masterKeyString: string): string {
  if (!encryptedText || !masterKeyString || masterKeyString.length < 32) return '';
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const parts = encryptedText.split(':');
  if (parts.length !== 3) return '';
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function main() {
  const managementUrl = process.env.DATABASE_URL_MANAGEMENT!;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY!;

  const pool = new Pool({ connectionString: managementUrl });
  const adapter = new PrismaPg(pool);
  const management = new ManagementClient({ adapter } as any);

  const company = await management.company.findFirst({ where: { status: 'active' } });
  await management.$disconnect();
  await pool.end();

  if (!company) {
    console.error('No company found');
    return;
  }

  let localTenantConn = company.dbUrl;
  if (company.dbPassword) {
    try {
      const dec = decrypt(company.dbPassword, masterKey);
      if (dec) {
        localTenantConn = `postgresql://${company.dbUser}:${encodeURIComponent(dec)}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
      }
    } catch {}
  }

  console.log(`🏢 Local Active Tenant: ${company.name} (${company.dbName})`);

  const localPool = new Pool({ connectionString: localTenantConn });
  const tempPool = new Pool({ connectionString: 'postgresql://postgres:root@localhost:5432/spl_live_temp' });

  try {
    const tempTables = await tempPool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    const tempTableNames = new Set(tempTables.rows.map(r => r.table_name));

    // Check PO, GRN, LC, PI, Finance counts in both
    const tablesToCheck = [
      'purchase_orders',
      'purchase_order_items',
      'goods_receipt_notes',
      'goods_receipt_note_items',
      'landed_costs',
      'landed_cost_items',
      'purchase_invoices',
      'purchase_invoice_items',
      'purchase_returns',
      'purchase_return_items',
      'JournalVoucher',
      'JournalVoucherDetail',
      'PaymentVoucher',
      'PaymentVoucherDetail',
      'ReceiptVoucher',
      'ReceiptVoucherDetail',
      'AccountTransaction',
    ];

    console.log(`\n======================================================================`);
    console.log(`📊 LIVE TEMP VS LOCAL DB COMPARISON (PROCUREMENT & FINANCE)`);
    console.log(`======================================================================`);

    for (const tbl of tablesToCheck) {
      if (tempTableNames.has(tbl) || tempTableNames.has(tbl.toLowerCase())) {
        const actualName = tempTableNames.has(tbl) ? tbl : tbl.toLowerCase();
        try {
          const localCountRes = await localPool.query(`SELECT count(*) FROM "${actualName}"`);
          const tempCountRes = await tempPool.query(`SELECT count(*) FROM "${actualName}"`);
          const diff = Number(tempCountRes.rows[0].count) - Number(localCountRes.rows[0].count);
          const diffStr = diff > 0 ? `(+${diff} new in Live)` : diff === 0 ? `(Equal)` : `(${diff})`;
          console.log(`📦 ${actualName.padEnd(28)}: Local = ${localCountRes.rows[0].count.padStart(5)} | Live = ${tempCountRes.rows[0].count.padStart(5)}  ${diffStr}`);
        } catch (e: any) {
          console.log(`⚠️ ${actualName.padEnd(28)}: Error querying table - ${e.message}`);
        }
      } else {
        console.log(`❌ ${tbl.padEnd(28)}: Table not found`);
      }
    }
    console.log(`======================================================================\n`);
  } catch (err: any) {
    console.error('❌ Error inspecting:', err.message);
  } finally {
    await localPool.end();
    await tempPool.end();
  }
}

main();
