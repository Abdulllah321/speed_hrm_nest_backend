import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import { Pool } from 'pg';

async function inspectPosOrders() {
  const masterUrl = process.env.DATABASE_URL!;
  const urlObj = new URL(masterUrl);
  const user = urlObj.username;
  const password = urlObj.password;
  const host = urlObj.hostname;
  const port = urlObj.port || '5432';

  const dbNamesToTry = ['tenant_speed_main_mox1gfsi', 'spl_core_db'];

  for (const dbName of dbNamesToTry) {
    const connStr = `postgresql://${user}:${password}@${host}:${port}/${dbName}?schema=public`;
    console.log(`\n=======================================================`);
    console.log(`Inspecting sales_orders in database: ${dbName}`);
    console.log(`=======================================================`);
    const pool = new Pool({ connectionString: connStr });

    try {
      const res = await pool.query(`
        SELECT 
          so."orderNumber",
          so.location_id,
          loc.code AS loc_code,
          loc.short_code AS loc_short_code,
          COUNT(*) OVER() AS total_so_count
        FROM sales_orders so
        LEFT JOIN "Location" loc ON so.location_id = loc.id
        LIMIT 10;
      `);

      console.log(`Total orders in table: ${res.rows[0]?.total_so_count || 0}`);
      console.table(res.rows);

      const countSS1002 = await pool.query(`
        SELECT COUNT(*) FROM sales_orders so
        JOIN "Location" loc ON so.location_id = loc.id
        WHERE loc.code = 'SS1002' OR loc.short_code = 'SS1002';
      `);
      console.log(`Count for SS1002:`, countSS1002.rows[0].count);

    } catch (e: any) {
      console.log(`Error inspecting ${dbName}:`, e.message);
    } finally {
      await pool.end();
    }
  }
}

inspectPosOrders();
