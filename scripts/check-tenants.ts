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

const dbNames = ['tenant_speed_main_mox1gfsi', 'tenant_ivar_msojjrqs', 'speedlimit'];

async function testDbs() {
  for (const dbName of dbNames) {
    const connStr = `postgresql://${user}:${password}@${host}:${port}/${dbName}?schema=public`;
    console.log(`\n--- Checking DB: ${dbName} ---`);
    const p = new Pool({ connectionString: connStr });
    try {
      const tables = await p.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`);
      console.log(`Tables count: ${tables.rows.length}`);
      const salesOrders = await p.query(`SELECT COUNT(*) FROM sales_orders`).catch(() => null);
      if (salesOrders) {
        console.log(`SalesOrders count in ${dbName}: ${salesOrders.rows[0].count}`);
      } else {
        console.log(`sales_orders table not in ${dbName}`);
      }
    } catch (e: any) {
      console.log(`Error connecting to ${dbName}:`, e.message);
    } finally {
      await p.end();
    }
  }
}

testDbs();
