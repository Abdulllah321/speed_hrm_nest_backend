import { Pool } from 'pg';

async function main() {
  const masterPool = new Pool({ connectionString: 'postgresql://postgres:root@localhost:5432/spl_core_db?schema=public' });

  // Let's find who currently has haider@spl.com.pk
  const user = await masterPool.query(`SELECT id, email, "firstName", "lastName", "employeeId" FROM "User" WHERE email = 'haider@spl.com.pk'`);
  console.log('User with haider@:', user.rows);

  // If someone has it, we change theirs to a dummy, then give it to EMP056
  if (user.rows.length > 0 && user.rows[0].id !== 'f38a8173-3626-44ad-8a9f-c57177b237d6') {
    console.log(`Giving ${user.rows[0].id} a dummy email...`);
    await masterPool.query(`UPDATE "User" SET email = 'dummy_${Date.now()}@spl.com.pk' WHERE id = $1`, [user.rows[0].id]);
    
    console.log("Fixing EMP056...");
    await masterPool.query(`UPDATE "User" SET email = 'haider@spl.com.pk' WHERE id = 'f38a8173-3626-44ad-8a9f-c57177b237d6'`);
  } else {
    // maybe it was successfully given to EMP056 before it crashed?
    console.log("Fixing EMP056...");
    try {
      await masterPool.query(`UPDATE "User" SET email = 'haider@spl.com.pk' WHERE id = 'f38a8173-3626-44ad-8a9f-c57177b237d6'`);
    } catch (e: any) {
      console.log(e.message);
    }
  }

  await masterPool.end();
}

main();
