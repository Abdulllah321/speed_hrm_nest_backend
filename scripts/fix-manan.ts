import { Pool } from 'pg';

async function main() {
  const masterPool = new Pool({ connectionString: 'postgresql://postgres:root@localhost:5432/spl_core_db?schema=public' });
  await masterPool.query(`UPDATE "User" SET email = 'EMP271@spl.com.pk' WHERE id = '061675aa-a7ef-4e6d-8018-d764811c02ea'`);
  console.log('Fixed EMP271');
  await masterPool.end();
}

main();
