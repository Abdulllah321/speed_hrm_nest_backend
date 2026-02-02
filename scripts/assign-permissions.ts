// @ts-nocheck
import 'dotenv/config';
import { PrismaClient } from '@prisma/management-client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PERMISSIONS } from '../src/config/permissions';


const pool = new Pool({ connectionString: process.env.DATABASE_URL_MANAGEMENT });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });


async function main() {
  console.log('🔄 Starting Permission Assignment Script...');

  try {
    // 1. Sync All Permissions from Config to DB
    console.log('Step 1: Syncing Permissions to Database...');
    let created = 0;
    for (const perm of PERMISSIONS) {
      const existing = await prisma.permission.findFirst({
        where: { name: perm.name },
      });

      if (!existing) {
        await prisma.permission.create({
          data: {
            name: perm.name,
            module: perm.module || perm.name.split('.').slice(0, -1).join('.'), // fallback
            action: perm.action || perm.name.split('.').pop() || 'manage',
            description: perm.description,
          },
        });
        created++;
      }
    }
    console.log(`✅ Synced ${created} new permissions.`);

    // 2. Ensure Roles Exist
    console.log('Step 2: verifying Roles...');
    const roles = [
      { name: 'hr', description: 'Human Resource Manager with access to HR and Master modules.' },
      { name: 'employee', description: 'Standard employee with self-service access.' },
    ];

    for (const r of roles) {
      const existingRole = await prisma.role.findFirst({
        where: { name: { equals: r.name, mode: 'insensitive' } },
      });
      if (!existingRole) {
        await prisma.role.create({ data: r });
        console.log(`➕ Created Role: ${r.name}`);
      } else {
        console.log(`✓ Role exists: ${existingRole.name}`);
      }
    }

    // 3. Assign Permissions to HR
    // HR gets ALL 'hr.*' and 'master.*' permissions
    const hrRole = await prisma.role.findFirst({ where: { name: 'hr' } });
    if (hrRole) {
        // Fetch all relevant permissions
        const hrPerms = await prisma.permission.findMany({
            where: {
            OR: [
                { name: { startsWith: 'hr.' } },
                { name: { startsWith: 'master.' } },
            ],
            },
        });

        console.log(`Step 3: Assigning ${hrPerms.length} permissions to HR Role...`);
        
        let hrCount = 0;
        for (const p of hrPerms) {
            // Check if already assigned to avoid unique constraint errors if not using upsert correctly
            const exists = await prisma.rolePermission.findUnique({
                where: {
                    roleId_permissionId: {
                        roleId: hrRole.id,
                        permissionId: p.id
                    }
                }
            });

            if(!exists) {
                await prisma.rolePermission.create({
                    data: { roleId: hrRole.id, permissionId: p.id }
                });
                hrCount++;
            }
        }
        console.log(`✅ Assigned ${hrCount} new permissions to HR.`);
    }

    // 4. Assign Permissions to Employee
    // Employee gets specific self-service permissions
    const employeeRole = await prisma.role.findFirst({ where: { name: 'employee' } });
    if (employeeRole) {
        console.log('Step 4: Assigning Self-Service permissions to Employee Role...');
        
        // Define patterns for Employee access
        const employeeAllowedPatterns = [
            'hr.dashboard.view',
            // Attendance
            'hr.attendance.view', 'hr.attendance.request', 'hr.attendance.summary', 'hr.attendance.request-list',
            // Leave
            'hr.leave.create', 'hr.leave.read',
            // Loan / Advance
            'hr.loan-request.create', 'hr.loan-request.read',
            'hr.advance-salary.create', 'hr.advance-salary.read',
            'hr.leave-encashment.create', 'hr.leave-encashment.read',
            // General Info
            'hr.holiday.read',
            'hr.working-hour-policy.read',
            // Profile
            'hr.employee.read',
            'hr.employee.user-account',
        ];

        const employeePerms = await prisma.permission.findMany({
            where: {
            name: { in: employeeAllowedPatterns }
            },
        });

        let empCount = 0;
        for (const p of employeePerms) {
             const exists = await prisma.rolePermission.findUnique({
                where: {
                    roleId_permissionId: {
                        roleId: employeeRole.id,
                        permissionId: p.id
                    }
                }
            });

            if(!exists) {
                await prisma.rolePermission.create({
                    data: { roleId: employeeRole.id, permissionId: p.id }
                });
                empCount++;
            }
        }
        console.log(`✅ Assigned ${empCount} new permissions to Employee.`);
    }

    console.log('🎉 Script completed successfully!');

  } catch (error) {
    console.error('❌ Error executing script:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
