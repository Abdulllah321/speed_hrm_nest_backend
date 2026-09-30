import { Pool } from 'pg';

async function main() {
  const masterPool = new Pool({ connectionString: 'postgresql://postgres:root@localhost:5432/spl_core_db?schema=public' });
  const tenantPool = new Pool({ connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi?schema=public' });

  // Fetch all employees
  const employeesRes = await tenantPool.query(`SELECT id, "employeeId", "employeeName", "officialEmail", "userId" FROM "Employee"`);
  const employees = employeesRes.rows;

  // Fetch all users
  const usersRes = await masterPool.query(`SELECT id, email, "employeeId" FROM "User"`);
  const users = usersRes.rows;

  const userMap = new Map(users.map(u => [u.id, u]));
  const emailToEmployees = new Map<string, any[]>();

  for (const emp of employees) {
    const matchedUser = emp.userId ? userMap.get(emp.userId) : null;
    const resolvedEmail = matchedUser?.email || emp.officialEmail;
    if (resolvedEmail) {
      const lower = resolvedEmail.toLowerCase();
      if (!emailToEmployees.has(lower)) {
        emailToEmployees.set(lower, []);
      }
      emailToEmployees.get(lower)!.push(emp);
    }
  }

  for (const [email, emps] of emailToEmployees.entries()) {
    if (emps.length > 1) {
      console.log(`Duplicate Email: ${email}`);
      for (const emp of emps) {
        console.log(`  - Employee: ${emp.employeeId} - ${emp.employeeName} (officialEmail: ${emp.officialEmail}, userId: ${emp.userId})`);
      }
    }
  }

  await masterPool.end();
  await tenantPool.end();
}

main();
