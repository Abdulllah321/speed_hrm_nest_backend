import { Pool } from 'pg';
import 'dotenv/config';

async function main() {
  const masterUrl = process.env.DATABASE_URL_MANAGEMENT || 'postgresql://postgres:root@localhost:5432/spl_core_db?schema=public';
  // Use a specific tenant URL if provided, otherwise default to local
  const tenantUrl = process.env.TENANT_DATABASE_URL || 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi?schema=public';

  console.log("Connecting to Master DB:", masterUrl.split('@')[1]);
  console.log("Connecting to Tenant DB:", tenantUrl.split('@')[1]);

  const masterPool = new Pool({ connectionString: masterUrl });
  const tenantPool = new Pool({ connectionString: tenantUrl });

  try {
    console.log('Fetching employees from tenant...');
    const employeesRes = await tenantPool.query(`SELECT id, "employeeId", "employeeName", "officialEmail", "userId" FROM "Employee" WHERE "userId" IS NOT NULL`);
    const employees = employeesRes.rows;
    console.log(`Found ${employees.length} employees with associated user accounts.`);

    for (const emp of employees) {
      if (!emp.userId) continue;

      let emailToSet = emp.officialEmail;
      
      // If employee has no officialEmail, we fallback to a generated one based on employeeId so it's unique
      if (!emailToSet) {
        emailToSet = `${emp.employeeId.toLowerCase()}@spl.com.pk`;
      }

      // Check if this email is already taken by ANOTHER user in Master DB
      const existingEmailRes = await masterPool.query(`SELECT id, "employeeId" FROM "User" WHERE email = $1 AND id != $2`, [emailToSet, emp.userId]);
      
      if (existingEmailRes.rows.length > 0) {
        for (const conflictUser of existingEmailRes.rows) {
          console.log(`[CONFLICT] Email ${emailToSet} is taken by User ${conflictUser.id} (${conflictUser.employeeId}). Freeing it...`);
          const dummyEmail = `dummy_${conflictUser.id.substring(0, 8)}@spl.com.pk`;
          await masterPool.query(`UPDATE "User" SET email = $1 WHERE id = $2`, [dummyEmail, conflictUser.id]);
        }
      }

      // Now we can safely update the correct user
      let firstName = emp.employeeName;
      let lastName = '';
      if (emp.employeeName) {
        const parts = emp.employeeName.trim().split(' ');
        if (parts.length > 1) {
          firstName = parts[0];
          lastName = parts.slice(1).join(' ');
        }
      }

      console.log(`[SYNC] Updating User ${emp.userId} (${emp.employeeName}) -> Email: ${emailToSet}`);
      
      try {
        await masterPool.query(
          `UPDATE "User" SET "firstName" = $1, "lastName" = $2, "employeeId" = $3, email = $4 WHERE id = $5`,
          [firstName, lastName, emp.employeeId, emailToSet, emp.userId]
        );
      } catch (err: any) {
        console.error(`Error updating user ${emp.userId}:`, err.message);
      }
    }

    console.log('Production sync complete!');
  } catch (error) {
    console.error('Error during sync:', error);
  } finally {
    await masterPool.end();
    await tenantPool.end();
  }
}

main();
