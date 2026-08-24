// @ts-nocheck
import 'dotenv/config';
import { Pool } from 'pg';

function parseName(fullName: string) {
  if (!fullName) return { firstName: '', lastName: '' };
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ') || '';
  return { firstName, lastName };
}

async function main() {
  const baseConnStr = process.env.DATABASE_URL || 'postgresql://postgres:root@localhost:5432/spl_core_db?schema=public';
  const masterDbName = 'spl_core_db';

  const masterConnStr = baseConnStr.replace(/\/[^/]+(?:\?|$)/, `/${masterDbName}?`);
  console.log(`Connecting to Master database: [${masterDbName}]`);

  const masterPool = new Pool({ connectionString: masterConnStr });
  const masterClient = await masterPool.connect();

  try {
    const usersRes = await masterClient.query(
      `SELECT id, email, "firstName", "lastName", "employeeId", phone FROM "User"`
    );
    const users = usersRes.rows;
    console.log(`Loaded ${users.length} users from Master DB (${masterDbName}).`);

    const tenantDbs = ['tenant_speed_main_mox1gfsi'];

    for (const tenantDb of tenantDbs) {
      const tenantConnStr = baseConnStr.replace(/\/[^/]+(?:\?|$)/, `/${tenantDb}?`);
      let tenantPool;
      let tenantClient;

      try {
        tenantPool = new Pool({ connectionString: tenantConnStr });
        tenantClient = await tenantPool.connect();
      } catch (err: any) {
        console.log(`Could not connect to tenant DB [${tenantDb}]:`, err.message);
        continue;
      }

      try {
        const empCheck = await tenantClient.query(
          `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Employee'`
        );
        if (parseInt(empCheck.rows[0].count, 10) === 0) {
          console.log(`No Employee table in [${tenantDb}]. Skipping.`);
          tenantClient.release();
          await tenantPool.end();
          continue;
        }

        const empsRes = await tenantClient.query(
          `SELECT id, "employeeId", "employeeName", "officialEmail", "personalEmail", "contactNumber", "userId" FROM "Employee"`
        );
        const employees = empsRes.rows;
        console.log(`\n==================================================`);
        console.log(`🔄 Processing Tenant DB [${tenantDb}] with ${employees.length} employees`);
        console.log(`==================================================`);

        let updatedUserCount = 0;
        let linkedEmpCount = 0;

        for (const emp of employees) {
          const empCode = emp.employeeId?.trim();
          const officialEmail = emp.officialEmail?.trim().toLowerCase() || null;
          const personalEmail = emp.personalEmail?.trim().toLowerCase() || null;
          const targetEmail = officialEmail || personalEmail;
          const { firstName, lastName } = parseName(emp.employeeName);

          // Find user in Master DB by:
          // 1. User.id == emp.userId
          // 2. User.employeeId == empCode
          // 3. User.email == targetEmail
          let matchedUser = null;
          if (emp.userId) {
            matchedUser = users.find((u) => u.id === emp.userId);
          }
          if (!matchedUser && empCode) {
            matchedUser = users.find((u) => u.employeeId?.toLowerCase() === empCode.toLowerCase());
          }
          if (!matchedUser && targetEmail) {
            matchedUser = users.find((u) => u.email?.toLowerCase() === targetEmail);
          }

          if (matchedUser) {
            const updates: string[] = [];
            const values: any[] = [];
            let paramIdx = 1;

            if (empCode && matchedUser.employeeId !== empCode) {
              // Check if another user has this employeeId
              const conflict = users.find((u) => u.id !== matchedUser.id && u.employeeId?.toLowerCase() === empCode.toLowerCase());
              if (!conflict) {
                updates.push(`"employeeId" = $${paramIdx++}`);
                values.push(empCode);
                matchedUser.employeeId = empCode;
              }
            }
            if (targetEmail && matchedUser.email?.toLowerCase() !== targetEmail) {
              // Check if another user has this email
              const conflict = users.find((u) => u.id !== matchedUser.id && u.email?.toLowerCase() === targetEmail);
              if (!conflict) {
                updates.push(`"email" = $${paramIdx++}`);
                values.push(targetEmail);
                matchedUser.email = targetEmail;
              }
            }
            if (firstName && matchedUser.firstName !== firstName) {
              updates.push(`"firstName" = $${paramIdx++}`);
              values.push(firstName);
              matchedUser.firstName = firstName;
            }
            if (lastName !== undefined && matchedUser.lastName !== lastName) {
              updates.push(`"lastName" = $${paramIdx++}`);
              values.push(lastName);
              matchedUser.lastName = lastName;
            }
            if (emp.contactNumber && !matchedUser.phone) {
              updates.push(`"phone" = $${paramIdx++}`);
              values.push(emp.contactNumber);
              matchedUser.phone = emp.contactNumber;
            }

            if (updates.length > 0) {
              try {
                values.push(matchedUser.id);
                const updateQuery = `UPDATE "User" SET ${updates.join(', ')}, "updatedAt" = NOW() WHERE id = $${paramIdx}`;
                await masterClient.query(updateQuery, values);
                console.log(`  ✅ Updated User [${matchedUser.id}] (${matchedUser.email || matchedUser.employeeId}): ${updates.join(', ')}`);
                updatedUserCount++;
              } catch (err: any) {
                console.error(`  ❌ Failed to update User [${matchedUser.id}]: ${err.message}`);
              }
            }

            if (emp.userId !== matchedUser.id) {
              try {
                await tenantClient.query(`UPDATE "Employee" SET "userId" = $1 WHERE id = $2`, [matchedUser.id, emp.id]);
                console.log(`  🔗 Linked Employee [${empCode || emp.employeeName}] -> User [${matchedUser.id}]`);
                linkedEmpCount++;
              } catch (err: any) {
                console.error(`  ❌ Failed to link Employee [${emp.id}]: ${err.message}`);
              }
            }
          }
        }

        console.log(`\n✨ Tenant [${tenantDb}] sync complete: Updated ${updatedUserCount} Users, Linked ${linkedEmpCount} Employees.`);

      } finally {
        tenantClient.release();
        await tenantPool.end();
      }
    }

  } finally {
    masterClient.release();
    await masterPool.end();
  }
}

main().catch(console.error);
