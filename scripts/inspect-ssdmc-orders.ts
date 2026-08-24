import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import { Pool } from 'pg';

async function inspectSsdmcOrders() {
  const masterUrl = process.env.DATABASE_URL!;
  const urlObj = new URL(masterUrl);
  const user = urlObj.username;
  const password = urlObj.password;
  const host = urlObj.hostname;
  const port = urlObj.port || '5432';

  const dbNamesToTry = ['tenant_speed_main_mox1gfsi', 'spl_core_db'];

  for (const dbName of dbNamesToTry) {
    const connStr = `postgresql://${user}:${password}@${host}:${port}/${dbName}?schema=public`;
    const pool = new Pool({ connectionString: connStr });

    try {
      console.log(`\n=======================================================`);
      console.log(`Searching order numbers in: ${dbName}`);
      console.log(`=======================================================`);

      const res = await pool.query(`
        SELECT 
          so.id,
          so."orderNumber",
          so.created_at,
          loc.code AS loc_code,
          loc.short_code AS loc_short_code
        FROM sales_orders so
        LEFT JOIN "Location" loc ON so.location_id = loc.id
        WHERE so."orderNumber" LIKE '%SSDMC%' 
           OR loc.code = 'SS1002' 
           OR loc.short_code = 'SS1002'
        ORDER BY so.created_at ASC
        LIMIT 20;
      `);

      console.log(`Found ${res.rows.length} rows.`);
      console.table(res.rows);

      // Check min and max orderNumber
      const minMax = await pool.query(`
        SELECT 
          MIN(so."orderNumber") AS min_order_num,
          MAX(so."orderNumber") AS max_order_num,
          COUNT(*)              AS total_orders
        FROM sales_orders so
        LEFT JOIN "Location" loc ON so.location_id = loc.id
        WHERE so."orderNumber" LIKE '%SSDMC%' 
           OR loc.code = 'SS1002' 
           OR loc.short_code = 'SS1002';
      `);
      console.table(minMax.rows);

    } catch (e: any) {
      console.log(`Error in ${dbName}:`, e.message);
    } finally {
      await pool.end();
    }
  }
}

inspectSsdmcOrders();
