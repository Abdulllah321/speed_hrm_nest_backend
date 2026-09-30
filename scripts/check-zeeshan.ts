import { Pool } from 'pg';

async function main() {
  const masterPool = new Pool({ connectionString: 'postgresql://postgres:root@localhost:5432/spl_core_db?schema=public' });

  const user = await masterPool.query(`SELECT id, email, "firstName", "lastName", "employeeId" FROM "User" WHERE id = 'eaed2109-0d8f-49be-9e98-a3db550de031'`);
  console.log('User:', user.rows);

  await masterPool.end();
}

main();
