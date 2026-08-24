import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import { Pool } from 'pg';

async function checkItemSales() {
  const masterUrl = process.env.DATABASE_URL!;
  const urlObj = new URL(masterUrl);
  const user = urlObj.username;
  const password = urlObj.password;
  const host = urlObj.hostname;
  const port = urlObj.port || '5432';

  const dbName = 'tenant_speed_main_mox1gfsi';
  const connStr = `postgresql://${user}:${password}@${host}:${port}/${dbName}?schema=public`;
  const pool = new Pool({ connectionString: connStr });

  const barcodesToTest = ['4067984007810', '196884324247', '4063697484610', '4570158186568', '4067892309921'];

  for (const bc of barcodesToTest) {
    const res = await pool.query(`
      SELECT 
        so.id AS order_id,
        so."orderNumber",
        so.notes,
        so.created_at,
        loc.code AS loc_code,
        soi.quantity,
        i."barCode"
      FROM sales_order_items soi
      JOIN sales_orders so ON soi.sales_order_id = so.id
      LEFT JOIN "Location" loc ON so.location_id = loc.id
      JOIN "Item" i ON soi.item_id = i.id
      WHERE i."barCode" = $1;
    `, [bc]);

    console.log(`\n-------------------------------------------------------`);
    console.log(`Sales Order Items in DB for barcode "${bc}" (Count: ${res.rows.length}):`);
    console.table(res.rows);
  }

  await pool.end();
}

checkItemSales();
