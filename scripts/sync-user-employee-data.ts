import { Pool } from 'pg';
import 'dotenv/config';

async function main() {
  const masterPool = new Pool({
    connectionString:
      process.env.DATABASE_URL_MANAGEMENT ||
      process.env.DATABASE_URL ||
      'postgresql://postgres:root@localhost:5432/spl_core_db?schema=public',
  });

  const tenantPool = new Pool({
    connectionString:
      process.env.TENANT_DATABASE_URL ||
      'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi?schema=public',
  });

  try {
    console.log('--- SYNCING TENANT EMPLOYEES BY MASTER USER EMPLOYEE_ID ---');

    // 1. Fetch all users from Master DB (Master DB employeeId is the source of truth)
    console.log('Fetching users from Master DB...');
    const usersRes = await masterPool.query(
      `SELECT id, email, "firstName", "lastName", "employeeId" FROM "User"`,
    );
    const allUsers = usersRes.rows;
    const usersWithEmpId = allUsers.filter((u) => u.employeeId && u.employeeId.trim().length > 0);
    console.log(
      `Loaded ${allUsers.length} total users (${usersWithEmpId.length} have employeeId).`,
    );

    // 2. Fetch all employees from Tenant DB
    console.log('Fetching employees from Tenant DB...');
    const employeesRes = await tenantPool.query(
      `SELECT id, "employeeId", "employeeName", "officialEmail", "personalEmail", "userId" FROM "Employee"`,
    );
    const employees = employeesRes.rows;
    console.log(`Loaded ${employees.length} employees from Tenant DB.\n`);

    // Index employees by normalized employeeId
    const empByCode = new Map<string, any>();
    for (const emp of employees) {
      if (emp.employeeId) {
        empByCode.set(emp.employeeId.trim().toLowerCase(), emp);
      }
    }

    let alreadyLinkedCount = 0;
    let newlyLinkedCount = 0;
    let notFoundCount = 0;
    let conflictClearedCount = 0;

    // 3. Update Employee table in Tenant DB using User.employeeId as source of truth
    for (const user of usersWithEmpId) {
      const code = user.employeeId.trim().toLowerCase();
      const matchedEmp = empByCode.get(code);

      if (!matchedEmp) {
        console.warn(
          `⚠️ [NOT FOUND] No Employee in Tenant DB with employeeId "${user.employeeId}" (User ID: ${user.id}, Name: ${user.firstName} ${user.lastName}, Email: ${user.email})`,
        );
        notFoundCount++;
        continue;
      }

      if (matchedEmp.userId === user.id) {
        console.log(
          `✓ [ALREADY LINKED] Employee "${matchedEmp.employeeId}" (${matchedEmp.employeeName}) already has userId: ${user.id}`,
        );
        alreadyLinkedCount++;
        continue;
      }

      // Check if another employee in Tenant DB is holding this userId
      const previousHolder = employees.find(
        (e) => e.userId === user.id && e.id !== matchedEmp.id,
      );

      if (previousHolder) {
        console.log(
          `🔄 [CLEAR CONFLICT] Unlinking wrong employee "${previousHolder.employeeId}" (${previousHolder.employeeName}) who held userId ${user.id}`,
        );
        await tenantPool.query(
          `UPDATE "Employee" SET "userId" = NULL WHERE id = $1`,
          [previousHolder.id],
        );
        previousHolder.userId = null;
        conflictClearedCount++;
      }

      // Update the actual Employee with the proper user.id
      await tenantPool.query(
        `UPDATE "Employee" SET "userId" = $1 WHERE id = $2`,
        [user.id, matchedEmp.id],
      );

      console.log(
        `✅ [LINKED] Employee "${matchedEmp.employeeId}" (${matchedEmp.employeeName}) -> Set userId to ${user.id} (User: ${user.firstName} ${user.lastName} / ${user.email})`,
      );

      matchedEmp.userId = user.id;
      newlyLinkedCount++;
    }

    // 4. Optional: Match remaining users without employeeId by email if possible
    const usersWithoutEmpId = allUsers.filter(
      (u) => (!u.employeeId || u.employeeId.trim().length === 0) && u.email,
    );

    let emailLinkedCount = 0;
    if (usersWithoutEmpId.length > 0) {
      console.log(`\nChecking ${usersWithoutEmpId.length} users without employeeId for email match...`);
      for (const user of usersWithoutEmpId) {
        const userEmail = user.email.trim().toLowerCase();
        const empByEmail = employees.find(
          (e) =>
            !e.userId &&
            ((e.officialEmail && e.officialEmail.trim().toLowerCase() === userEmail) ||
             (e.personalEmail && e.personalEmail.trim().toLowerCase() === userEmail)),
        );

        if (empByEmail) {
          await tenantPool.query(
            `UPDATE "Employee" SET "userId" = $1 WHERE id = $2`,
            [user.id, empByEmail.id],
          );
          console.log(
            `📧 [EMAIL LINKED] Employee "${empByEmail.employeeId}" (${empByEmail.employeeName}) -> Set userId to ${user.id} by email ${user.email}`,
          );
          empByEmail.userId = user.id;
          emailLinkedCount++;
        }
      }
    }

    console.log('\n==================================================');
    console.log('SUMMARY OF SYNC:');
    console.log(`- Total Users in Master DB: ${allUsers.length}`);
    console.log(`- Users with employeeId: ${usersWithEmpId.length}`);
    console.log(`- Employees in Tenant DB: ${employees.length}`);
    console.log(`- Already properly linked: ${alreadyLinkedCount}`);
    console.log(`- Newly linked by employeeId: ${newlyLinkedCount}`);
    console.log(`- Conflicting wrong links cleared: ${conflictClearedCount}`);
    if (emailLinkedCount > 0) {
      console.log(`- Newly linked by email fallback: ${emailLinkedCount}`);
    }
    console.log(`- Users with employeeId not found in Tenant: ${notFoundCount}`);
    console.log('==================================================');
  } catch (error) {
    console.error('Error running sync script:', error);
  } finally {
    await masterPool.end();
    await tenantPool.end();
  }
}

main();
