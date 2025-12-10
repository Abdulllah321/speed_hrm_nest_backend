import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { seedCountries } from './seeds/countries.js';
import { seedInstitutes } from './seeds/institutes.js';
import { seedDepartments, seedSubDepartments, seedDesignations, seedJobTypes, seedMaritalStatuses } from './seeds/master-data.js';
import { seedCities } from './seeds/cities.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Seeding database...');

  const permissionsList = [
    { name: 'users.view', module: 'users', action: 'view', description: 'View users' },
    { name: 'users.create', module: 'users', action: 'create', description: 'Create users' },
    { name: 'users.update', module: 'users', action: 'update', description: 'Update users' },
    { name: 'users.delete', module: 'users', action: 'delete', description: 'Delete users' },
    { name: 'roles.view', module: 'roles', action: 'view', description: 'View roles' },
    { name: 'roles.create', module: 'roles', action: 'create', description: 'Create roles' },
    { name: 'roles.update', module: 'roles', action: 'update', description: 'Update roles' },
    { name: 'roles.delete', module: 'roles', action: 'delete', description: 'Delete roles' },
    { name: 'employees.view', module: 'employees', action: 'view', description: 'View employees' },
    { name: 'employees.create', module: 'employees', action: 'create', description: 'Create employees' },
    { name: 'employees.update', module: 'employees', action: 'update', description: 'Update employees' },
    { name: 'employees.delete', module: 'employees', action: 'delete', description: 'Delete employees' },
    { name: 'departments.view', module: 'departments', action: 'view', description: 'View departments' },
    { name: 'departments.create', module: 'departments', action: 'create', description: 'Create departments' },
    { name: 'departments.update', module: 'departments', action: 'update', description: 'Update departments' },
    { name: 'departments.delete', module: 'departments', action: 'delete', description: 'Delete departments' },
    { name: 'attendance.view', module: 'attendance', action: 'view', description: 'View attendance' },
    { name: 'attendance.create', module: 'attendance', action: 'create', description: 'Create attendance' },
    { name: 'attendance.update', module: 'attendance', action: 'update', description: 'Update attendance' },
    { name: 'attendance.delete', module: 'attendance', action: 'delete', description: 'Delete attendance' },
    { name: 'leaves.view', module: 'leaves', action: 'view', description: 'View leaves' },
    { name: 'leaves.create', module: 'leaves', action: 'create', description: 'Create leaves' },
    { name: 'leaves.update', module: 'leaves', action: 'update', description: 'Update leaves' },
    { name: 'leaves.delete', module: 'leaves', action: 'delete', description: 'Delete leaves' },
    { name: 'leaves.approve', module: 'leaves', action: 'approve', description: 'Approve leaves' },
    { name: 'payroll.view', module: 'payroll', action: 'view', description: 'View payroll' },
    { name: 'payroll.create', module: 'payroll', action: 'create', description: 'Create payroll' },
    { name: 'payroll.update', module: 'payroll', action: 'update', description: 'Update payroll' },
    { name: 'payroll.delete', module: 'payroll', action: 'delete', description: 'Delete payroll' },
    { name: 'payroll.process', module: 'payroll', action: 'process', description: 'Process payroll' },
    { name: 'master.view', module: 'master', action: 'view', description: 'View master data' },
    { name: 'master.create', module: 'master', action: 'create', description: 'Create master data' },
    { name: 'master.update', module: 'master', action: 'update', description: 'Update master data' },
    { name: 'master.delete', module: 'master', action: 'delete', description: 'Delete master data' },
    { name: 'activity_logs.view', module: 'activity_logs', action: 'view', description: 'View activity logs' },
    { name: 'settings.view', module: 'settings', action: 'view', description: 'View settings' },
    { name: 'settings.update', module: 'settings', action: 'update', description: 'Update settings' },
    { name: 'reports.view', module: 'reports', action: 'view', description: 'View reports' },
    { name: 'reports.export', module: 'reports', action: 'export', description: 'Export reports' },
  ];

  console.log('📝 Creating permissions...');
  const permissions = [];
  for (const perm of permissionsList) {
    const permission = await prisma.permission.upsert({
      where: { name: perm.name },
      update: {},
      create: perm,
    });
    permissions.push(permission);
  }
  console.log(`✅ Created ${permissions.length} permissions`);

  console.log('👑 Creating admin role...');
  const adminRole = await prisma.role.upsert({
    where: { name: 'admin' },
    update: {},
    create: {
      name: 'admin',
      description: 'Administrator with full access',
      isSystem: true,
    },
  });

  console.log('🔗 Assigning permissions to admin role...');
  for (const permission of permissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId: permission.id } },
      update: {},
      create: { roleId: adminRole.id, permissionId: permission.id },
    });
  }

  console.log('👤 Creating HR role...');
  const hrRole = await prisma.role.upsert({
    where: { name: 'hr' },
    update: {},
    create: { name: 'hr', description: 'HR Manager', isSystem: true },
  });

  const hrPermissions = permissions.filter(p => ['employees', 'departments', 'attendance', 'leaves'].includes(p.module));
  for (const permission of hrPermissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: hrRole.id, permissionId: permission.id } },
      update: {},
      create: { roleId: hrRole.id, permissionId: permission.id },
    });
  }

  console.log('👤 Creating employee role...');
  const employeeRole = await prisma.role.upsert({
    where: { name: 'employee' },
    update: {},
    create: { name: 'employee', description: 'Regular Employee', isSystem: true },
  });

  const employeePermissions = permissions.filter(p => p.name === 'attendance.view' || p.name === 'leaves.view' || p.name === 'leaves.create');
  for (const permission of employeePermissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: employeeRole.id, permissionId: permission.id } },
      update: {},
      create: { roleId: employeeRole.id, permissionId: permission.id },
    });
  }

  console.log('👤 Creating admin user...');
  const hashedPassword = await bcrypt.hash('admin123', 12);

  await prisma.user.upsert({
    where: { email: 'admin@speedlimit.com' },
    update: { password: hashedPassword, roleId: adminRole.id },
    create: { email: 'admin@speedlimit.com', password: hashedPassword, firstName: 'System', lastName: 'Admin', phone: '0300-0000000', status: 'active', roleId: adminRole.id },
  });

  await seedCountries(prisma);
  await seedCities(prisma);
  await seedInstitutes(prisma);
  await seedDepartments(prisma);
  await seedSubDepartments(prisma);
  await seedDesignations(prisma);
  await seedJobTypes(prisma);
  await seedMaritalStatuses(prisma);

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('✅ Database seeded successfully!');
  console.log('═══════════════════════════════════════════');
  console.log('');
  console.log('🔐 Admin Login Credentials:');
  console.log('   Email:    admin@speedlimit.com');
  console.log('   Password: admin123');
  console.log('');
  console.log('⚠️  Please change the password after first login!');
  console.log('═══════════════════════════════════════════');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
