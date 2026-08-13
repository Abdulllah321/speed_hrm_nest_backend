import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const masterUrl = process.env.DATABASE_URL!;
const urlObj = new URL(masterUrl);
const user = urlObj.username;
const password = urlObj.password;
const host = urlObj.hostname;
const port = urlObj.port || '5432';

const dbNames = ['tenant_speed_main_mox1gfsi'];

async function inspectStock() {
  for (const dbName of dbNames) {
    const connStr = `postgresql://${user}:${password}@${host}:${port}/${dbName}?schema=public`;
    console.log(`\n======================================================`);
    console.log(`Checking Stock Ledger in DB: ${dbName}`);
    console.log(`======================================================`);
    const p = new Pool({ connectionString: connStr });
    try {
      const ledgerCount = await p
        .query(`SELECT count(*) FROM stock_ledgers`)
        .catch(() => null);
      if (ledgerCount) {
        console.log(
          `Total stock_ledgers records: ${ledgerCount.rows[0].count}`,
        );

        const summaryRefType = await p.query(`
          SELECT "reference_type", COUNT(*), MIN("created_at"), MAX("created_at")
          FROM stock_ledgers
          GROUP BY "reference_type"
        `);
        console.log(`\nStock Ledger Summary by reference_type:`);
        console.table(summaryRefType.rows);

        const autoOpening = await p.query(`
          SELECT COUNT(*), MIN("created_at"), MAX("created_at")
          FROM stock_ledgers
          WHERE "reference_id" = 'AUTO_OPENING_BAL'
        `);
        console.log(`\nAUTO_OPENING_BAL count:`, autoOpening.rows[0]);

        const invCount = await p
          .query(`SELECT count(*), sum(quantity) FROM "InventoryItem"`)
          .catch(() => null);
        if (invCount) {
          console.log(
            `InventoryItem count: ${invCount.rows[0].count}, Total Quantity: ${invCount.rows[0].sum}`,
          );
        }
      } else {
        console.log(`stock_ledgers table not found in ${dbName}`);
      }
    } catch (e: any) {
      console.log(`Error inspecting ${dbName}:`, e.message);
    } finally {
      await p.end();
    }
  }
}

inspectStock();
