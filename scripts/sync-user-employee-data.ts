import { Pool } from 'pg';
import 'dotenv/config';

async function main() {
  const masterPool = new Pool({
    connectionString: process.env.DATABASE_URL_MANAGEMENT || 'postgresql://postgres:root@localhost:5432/spl_core_db?schema=public'
  });
  
  const tenantPool = new Pool({
    connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi?schema=public'
  });

  try {
    // 1. Get all employees that have a userId associated (Tenant data)
    console.log('Fetching employees...');
    const employeesRes = await tenantPool.query(`SELECT id, "employeeId", "employeeName", "officialEmail", "userId" FROM "Employee" WHERE "userId" IS NOT NULL`);
    const employees = employeesRes.rows;
    console.log(`Found ${employees.length} employees with associated userIds.`);

    for (const emp of employees) {
      if (!emp.userId) continue;

      // 2. Get the associated User (Master data)
      const userRes = await masterPool.query(`SELECT id, email, "firstName", "lastName", "employeeId" FROM "User" WHERE id = $1`, [emp.userId]);
      const user = userRes.rows[0];

      if (user) {
        let shouldUpdate = false;
        let queryUpdates = [];
        let queryValues = [];
        let index = 1;

        // Check employeeId mismatch
        if (emp.employeeId && user.employeeId !== emp.employeeId) {
          console.log(`[User ${user.id} / ${user.firstName}] Updating employeeId from ${user.employeeId} to ${emp.employeeId}`);
          queryUpdates.push(`"employeeId" = $${index++}`);
          queryValues.push(emp.employeeId);
          shouldUpdate = true;
        }

        // Check email mismatch
        if (emp.officialEmail && user.email !== emp.officialEmail) {
          console.log(`[User ${user.id} / ${user.firstName}] Updating email from ${user.email} to ${emp.officialEmail}`);
          queryUpdates.push(`email = $${index++}`);
          queryValues.push(emp.officialEmail);
          shouldUpdate = true;
        }

        // Check name mismatch
        if (emp.employeeName) {
          const parts = emp.employeeName.split(' ');
          const expectedFirstName = parts[0];
          const expectedLastName = parts.slice(1).join(' ') || ' ';
          
          if (user.firstName !== expectedFirstName) {
            console.log(`[User ${user.id}] Updating firstName from ${user.firstName} to ${expectedFirstName}`);
            queryUpdates.push(`"firstName" = $${index++}`);
            queryValues.push(expectedFirstName);
            shouldUpdate = true;
          }
          if (user.lastName !== expectedLastName) {
            console.log(`[User ${user.id}] Updating lastName from ${user.lastName} to ${expectedLastName}`);
            queryUpdates.push(`"lastName" = $${index++}`);
            queryValues.push(expectedLastName);
            shouldUpdate = true;
          }
        }

        if (shouldUpdate) {
          try {
            queryValues.push(user.id);
            const queryStr = `UPDATE "User" SET ${queryUpdates.join(', ')} WHERE id = $${index}`;
            await masterPool.query(queryStr, queryValues);
            console.log(`[User ${user.id}] Updated successfully.`);
          } catch (e) {
            console.error(`[User ${user.id}] Failed to update. Error:`, e);
          }
        }
      } else {
        console.log(`No user found for employee ${emp.employeeName} (userId: ${emp.userId})`);
      }
    }

    console.log("Sync complete.");
  } catch (error) {
    console.error("Error running sync script:", error);
  } finally {
    await masterPool.end();
    await tenantPool.end();
  }
}

main();
