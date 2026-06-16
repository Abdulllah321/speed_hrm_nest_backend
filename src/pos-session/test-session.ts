import * as dotenv from 'dotenv';
dotenv.config();
import { Pool } from 'pg';

async function run() {
  const masterPool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  const res = await masterPool.query('SELECT id, name, "dbUser", "dbPassword", "dbHost", "dbPort", "dbName" FROM "Company"');
  const company = res.rows[0];
  const tenantUrl = `postgresql://speedlimit:speedlimit123@localhost:5433/${company.dbName}`;
  const tenantPool = new Pool({
    connectionString: tenantUrl
  });
  
  const sessionId = '884b47af-fd3d-4f3e-90c0-e7251a644f77';
  console.log(`Querying session: ${sessionId}`);
  const sessRes = await tenantPool.query('SELECT * FROM "PosSession" WHERE id = $1', [sessionId]);
  console.log('Session row:', sessRes.rows[0]);
  
  await masterPool.end();
  await tenantPool.end();
}

run().catch(e => console.error(e));
