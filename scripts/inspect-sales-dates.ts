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

async function inspectSalesDates() {
  for (const dbName of dbNames) {
    const connStr = `postgresql://${user}:${password}@${host}:${port}/${dbName}?schema=public`;
    console.log(`\n======================================================`);
    console.log(`Checking Sales Orders Date Range in DB: ${dbName}`);
    console.log(`======================================================`);
    const p = new Pool({ connectionString: connStr });
    try {
      const stats = await p
        .query(
          `
        SELECT COUNT(*) as total_orders,
               MIN(created_at) as earliest_sale,
               MAX(created_at) as latest_sale
        FROM sales_orders
      `,
        )
        .catch(() => null);

      if (stats) {
        console.log(`Total Sales Orders: ${stats.rows[0].total_orders}`);
        console.log(`Earliest Sale Date: ${stats.rows[0].earliest_sale}`);
        console.log(`Latest Sale Date:   ${stats.rows[0].latest_sale}`);

        const itemsCount = await p
          .query(
            `
          SELECT COUNT(*) FROM sales_order_items
        `,
          )
          .catch(() => null);
        if (itemsCount) {
          console.log(
            `Total Sales Order Line Items: ${itemsCount.rows[0].count}`,
          );
        }
      } else {
        console.log(`sales_orders table not found in ${dbName}`);
      }
    } catch (e: any) {
      console.log(`Error inspecting sales dates in ${dbName}:`, e.message);
    } finally {
      await p.end();
    }
  }
}

inspectSalesDates();
