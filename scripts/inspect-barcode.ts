import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import { Pool } from 'pg';

async function inspectBarcode() {
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

  console.log(`\n=======================================================`);
  console.log(`Inspecting barcodes in Item table of ${dbName}`);
  console.log(`=======================================================`);

  for (const bc of barcodesToTest) {
    const res = await pool.query(`
      SELECT 
        id, 
        "barCode", 
        sku, 
        "itemId", 
        description,
        "isActive"
      FROM "Item"
      WHERE "barCode" = $1 OR sku = $1 OR "itemId" = $1
         OR TRIM("barCode") = $1 OR TRIM(sku) = $1 OR TRIM("itemId") = $1;
    `, [bc]);

    console.log(`Barcode: "${bc}" -> Found ${res.rows.length} rows`);
    if (res.rows.length > 0) {
      console.table(res.rows);
    }
  }

  await pool.end();
}

inspectBarcode();
