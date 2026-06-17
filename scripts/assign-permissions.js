"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const management_client_1 = require("@prisma/management-client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const pg_1 = require("pg");
const permissions_1 = require("../src/config/permissions");
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL_MANAGEMENT });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new management_client_1.PrismaClient({ adapter });
async function main() {
    console.log('🔄 Starting Permission Assignment Script...');
    try {
        console.log('Step 1: Syncing Permissions to Database...');
        let created = 0;
        for (const perm of permissions_1.PERMISSIONS) {
            const existing = await prisma.permission.findFirst({
                where: { name: perm.name },
            });
            if (!existing) {
                await prisma.permission.create({
                    data: {
                        name: perm.name,
                        module: perm.module || perm.name.split('.').slice(0, -1).join('.'),
                        action: perm.action || perm.name.split('.').pop() || 'manage',
                        description: perm.description,
                    },
                });
                created++;
            }
        }
        console.log(`✅ Synced ${created} new permissions.`);
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
            }
            else {
                console.log(`✓ Role exists: ${existingRole.name}`);
            }
        }
        const hrRole = await prisma.role.findFirst({ where: { name: 'hr' } });
        if (hrRole) {
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
                const exists = await prisma.rolePermission.findUnique({
                    where: {
                        roleId_permissionId: {
                            roleId: hrRole.id,
                            permissionId: p.id
                        }
                    }
                });
                if (!exists) {
                    await prisma.rolePermission.create({
                        data: { roleId: hrRole.id, permissionId: p.id }
                    });
                    hrCount++;
                }
            }
            console.log(`✅ Assigned ${hrCount} new permissions to HR.`);
        }
        const employeeRole = await prisma.role.findFirst({ where: { name: 'employee' } });
        if (employeeRole) {
            console.log('Step 4: Assigning Self-Service permissions to Employee Role...');
            const employeeAllowedPatterns = [
                'hr.dashboard.view',
                'hr.attendance.view', 'hr.attendance.request', 'hr.attendance.summary', 'hr.attendance.request-list',
                'hr.leave.create', 'hr.leave.read',
                'hr.loan-request.create', 'hr.loan-request.read',
                'hr.advance-salary.create', 'hr.advance-salary.read',
                'hr.leave-encashment.create', 'hr.leave-encashment.read',
                'hr.holiday.read',
                'hr.working-hour-policy.read',
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
                if (!exists) {
                    await prisma.rolePermission.create({
                        data: { roleId: employeeRole.id, permissionId: p.id }
                    });
                    empCount++;
                }
            }
            console.log(`✅ Assigned ${empCount} new permissions to Employee.`);
        }
        console.log('🎉 Script completed successfully!');
    }
    catch (error) {
        console.error('❌ Error executing script:', error);
    }
    finally {
        await prisma.$disconnect();
    }
}
main();
//# sourceMappingURL=assign-permissions.js.map