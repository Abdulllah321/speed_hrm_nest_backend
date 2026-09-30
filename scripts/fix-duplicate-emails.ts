import { Pool } from 'pg';

async function main() {
  const masterPool = new Pool({ connectionString: 'postgresql://postgres:root@localhost:5432/spl_core_db?schema=public' });

  // Fix 1: EMP070 (Ahsan Lodhi) took shirazi@spl.com.pk
  console.log("Fixing EMP070...");
  await masterPool.query(`UPDATE "User" SET email = 'EMP070@spl.com.pk' WHERE id = '6febd6b9-8f9c-4042-bce8-6ab539cbc46e'`);

  // Fix 2: EMP037 (Sheeraz) took zeeshan@spl.com.pk but his officialEmail is sheeraz@spl.com.pk
  console.log("Fixing EMP037...");
  await masterPool.query(`UPDATE "User" SET email = 'sheeraz@spl.com.pk' WHERE id = '922e1de5-1402-4861-965a-61276cdd436f'`);

  // Fix 3: EMP054 (Nazir) took rafia@spl.com.pk
  console.log("Fixing EMP054...");
  await masterPool.query(`UPDATE "User" SET email = 'EMP054@spl.com.pk' WHERE id = '949c684e-70e2-4ade-a35d-28b4f58d554f'`);

  // Fix 4: EMP056 (Haider) took asif@spl.com.pk but his officialEmail is haider@spl.com.pk
  console.log("Fixing EMP056...");
  await masterPool.query(`UPDATE "User" SET email = 'haider@spl.com.pk' WHERE id = 'f38a8173-3626-44ad-8a9f-c57177b237d6'`);

  // Fix 5: EMP271 (Manan) took rashid@spl.com.pk
  console.log("Fixing EMP271...");
  await masterPool.query(`UPDATE "User" SET email = 'EMP271@spl.com.pk' WHERE id = '061675aa-a7ef-4e6d-8018-d764811c02ea'`);

  console.log("Fixes applied successfully.");

  await masterPool.end();
}

main();
