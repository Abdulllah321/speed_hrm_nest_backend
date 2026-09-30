import { Pool } from 'pg';

async function main() {
  const masterPool = new Pool({ connectionString: 'postgresql://postgres:root@localhost:5432/spl_core_db?schema=public' });
  const tenantPool = new Pool({ connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi?schema=public' });

  const emp = await tenantPool.query(`SELECT * FROM "Employee" WHERE "employeeName" ILIKE '%Khurram%'`);
  console.log('Employee in Tenant:', emp.rows);

  const user = await masterPool.query(`SELECT id, email, "firstName", "lastName", "employeeId" FROM "User" WHERE "firstName" ILIKE '%Khurram%' OR "employeeId" = 'EMP051'`);
  console.log('User in Master:', user.rows);

  await masterPool.end();
  await tenantPool.end();
}

main();
