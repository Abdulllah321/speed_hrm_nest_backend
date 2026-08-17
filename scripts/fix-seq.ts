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
const dbName = process.argv[2] || 'tenant_speed_main_mox1gfsi';

async function checkTable() {
  const connStr = `postgresql://${user}:${password}@${host}:${port}/${dbName}?schema=public`;
  console.log(`Inspecting stock_ledgers table for DB: ${dbName}`);
  const pool = new Pool({ connectionString: connStr });

  try {
    const cols = await pool.query(`
      SELECT column_name, data_type, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'stock_ledgers'
    `);
    console.table(cols.rows);
  } catch (err: any) {
    console.error(`❌ Table check error:`, err.message);
  } finally {
    await pool.end();
  }
}

checkTable();
