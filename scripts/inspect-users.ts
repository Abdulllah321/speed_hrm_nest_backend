// @ts-nocheck
import 'dotenv/config';
import { Pool } from 'pg';

async function main() {
  const connStr = process.env.DATABASE_URL || 'postgresql://postgres:root@localhost:5432/postgres';
  // Strip database name from connection string to connect to postgres server root
  const serverConnStr = connStr.replace(/\/[^/]+(?:\?|$)/, '/postgres?');
  console.log('Connecting to server:', serverConnStr);

  const pool = new Pool({ connectionString: serverConnStr });
  const client = await pool.connect();
  try {
    const dbsRes = await client.query(`SELECT datname FROM pg_database WHERE datistemplate = false;`);
    console.log('Databases on server:', dbsRes.rows.map((r) => r.datname));

    for (const row of dbsRes.rows) {
      const dbName = row.datname;
      if (dbName === 'postgres' || dbName === 'template1') continue;

      try {
        const dbPool = new Pool({ connectionString: connStr.replace(/\/[^/]+(?:\?|$)/, `/${dbName}?`) });
        const dbClient = await dbPool.connect();
        const tablesRes = await dbClient.query(`
          SELECT table_name FROM information_schema.tables 
          WHERE table_schema = 'public' AND (table_name ILIKE '%user%' OR table_name ILIKE '%employee%');
        `);
        console.log(`\nDatabase [${dbName}] tables:`, tablesRes.rows.map((r) => r.table_name));

        const userCount = await dbClient.query(`
          SELECT count(*) FROM information_schema.tables 
          WHERE table_schema = 'public' AND (table_name = 'User' OR table_name = 'users');
        `);
        if (parseInt(userCount.rows[0].count, 10) > 0) {
          const sampleUsers = await dbClient.query(`SELECT id, email, "firstName", "lastName", "employeeId" FROM "User" LIMIT 5;`);
          console.log(`Database [${dbName}] User sample:`, sampleUsers.rows);
        }
        dbClient.release();
        await dbPool.end();
      } catch (err: any) {
        console.log(`Database [${dbName}] query error:`, err.message);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
