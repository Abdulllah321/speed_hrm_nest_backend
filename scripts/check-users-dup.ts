import { Pool } from 'pg';

async function main() {
  const masterPool = new Pool({ connectionString: 'postgresql://postgres:root@localhost:5432/spl_core_db?schema=public' });
  const tenantPool = new Pool({ connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi?schema=public' });

  const emp = await tenantPool.query(`SELECT id, "employeeId", "employeeName", "officialEmail", "userId" FROM "Employee" WHERE "employeeId" IN ('EMP069', 'EMP070')`);
  console.log('Employees:', emp.rows);

  const user = await masterPool.query(`SELECT id, email, "firstName", "lastName", "employeeId" FROM "User" WHERE "employeeId" IN ('EMP069', 'EMP070') OR email = 'shirazi@spl.com.pk'`);
  console.log('Users:', user.rows);

  await masterPool.end();
  await tenantPool.end();
}

main();
