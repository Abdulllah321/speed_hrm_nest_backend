import 'dotenv/config';
import { PrismaClient, Permission } from '@prisma/client';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { seedCountries } from './seeds/countries.js';
import { seedCities } from './seeds/cities.js';
import { seedInstitutes } from './seeds/institutes.js';
import {
  seedDepartments,
  seedSubDepartments,
  seedDesignations,
  seedJobTypes,
  seedMaritalStatuses,
  seedHolidays,
  seedBranches,
  seedLeavesPolicies,
  seedWorkingHoursPolicies,
  seedEquipments,
  seedAllowanceHeads,
  seedDeductionHeads,
  seedBonusTypes,
  seedBanks,
  seedSalaryBreakups,
  seedProvidentFunds,
  seedLoanTypes,
  seedTaxSlabs,
  seedEmployees,
  seedFixedRebateNatures,
} from './seeds/master-data.js';
import { seedQualifications } from './seeds/qualifications.js';
import { seedRebateNatures } from './seeds/rebate-natures.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

interface PermissionInput {
  name: string;
  module: string;
  action: string;
  description: string;
}

async function main() {
  console.log('🌱 Seeding database...');

  const permissionsList: PermissionInput[] = [
    // Users & Roles
    {
      name: 'users.view',
      module: 'users',
      action: 'view',
      description: 'View users',
    },
    {
      name: 'users.create',
      module: 'users',
      action: 'create',
      description: 'Create users',
    },
    {
      name: 'users.update',
      module: 'users',
      action: 'update',
      description: 'Update users',
    },
    {
      name: 'users.delete',
      module: 'users',
      action: 'delete',
      description: 'Delete users',
    },
    {
      name: 'roles.view',
      module: 'roles',
      action: 'view',
      description: 'View roles',
    },
    {
      name: 'roles.create',
      module: 'roles',
      action: 'create',
      description: 'Create roles',
    },
    {
      name: 'roles.update',
      module: 'roles',
      action: 'update',
      description: 'Update roles',
    },
    {
      name: 'roles.delete',
      module: 'roles',
      action: 'delete',
      description: 'Delete roles',
    },

    // Employees
    {
      name: 'employees.view',
      module: 'employees',
      action: 'view',
      description: 'View employees',
    },
    {
      name: 'employees.create',
      module: 'employees',
      action: 'create',
      description: 'Create employees',
    },
    {
      name: 'employees.update',
      module: 'employees',
      action: 'update',
      description: 'Update employees',
    },
    {
      name: 'employees.delete',
      module: 'employees',
      action: 'delete',
      description: 'Delete employees',
    },

    // Departments
    {
      name: 'departments.view',
      module: 'departments',
      action: 'view',
      description: 'View departments',
    },
    {
      name: 'departments.create',
      module: 'departments',
      action: 'create',
      description: 'Create departments',
    },
    {
      name: 'departments.update',
      module: 'departments',
      action: 'update',
      description: 'Update departments',
    },
    {
      name: 'departments.delete',
      module: 'departments',
      action: 'delete',
      description: 'Delete departments',
    },
    {
      name: 'sub_departments.view',
      module: 'sub_departments',
      action: 'view',
      description: 'View sub-departments',
    },
    {
      name: 'sub_departments.create',
      module: 'sub_departments',
      action: 'create',
      description: 'Create sub-departments',
    },
    {
      name: 'sub_departments.update',
      module: 'sub_departments',
      action: 'update',
      description: 'Update sub-departments',
    },
    {
      name: 'sub_departments.delete',
      module: 'sub_departments',
      action: 'delete',
      description: 'Delete sub-departments',
    },

    // Designations
    {
      name: 'designations.view',
      module: 'designations',
      action: 'view',
      description: 'View designations',
    },
    {
      name: 'designations.create',
      module: 'designations',
      action: 'create',
      description: 'Create designations',
    },
    {
      name: 'designations.update',
      module: 'designations',
      action: 'update',
      description: 'Update designations',
    },
    {
      name: 'designations.delete',
      module: 'designations',
      action: 'delete',
      description: 'Delete designations',
    },

    // Job Types
    {
      name: 'job_types.view',
      module: 'job_types',
      action: 'view',
      description: 'View job types',
    },
    {
      name: 'job_types.create',
      module: 'job_types',
      action: 'create',
      description: 'Create job types',
    },
    {
      name: 'job_types.update',
      module: 'job_types',
      action: 'update',
      description: 'Update job types',
    },
    {
      name: 'job_types.delete',
      module: 'job_types',
      action: 'delete',
      description: 'Delete job types',
    },

    // Employee Grades & Statuses
    {
      name: 'employee_grades.view',
      module: 'employee_grades',
      action: 'view',
      description: 'View employee grades',
    },
    {
      name: 'employee_grades.create',
      module: 'employee_grades',
      action: 'create',
      description: 'Create employee grades',
    },
    {
      name: 'employee_grades.update',
      module: 'employee_grades',
      action: 'update',
      description: 'Update employee grades',
    },
    {
      name: 'employee_grades.delete',
      module: 'employee_grades',
      action: 'delete',
      description: 'Delete employee grades',
    },
    {
      name: 'employee_statuses.view',
      module: 'employee_statuses',
      action: 'view',
      description: 'View employee statuses',
    },
    {
      name: 'employee_statuses.create',
      module: 'employee_statuses',
      action: 'create',
      description: 'Create employee statuses',
    },
    {
      name: 'employee_statuses.update',
      module: 'employee_statuses',
      action: 'update',
      description: 'Update employee statuses',
    },
    {
      name: 'employee_statuses.delete',
      module: 'employee_statuses',
      action: 'delete',
      description: 'Delete employee statuses',
    },

    // Marital Status
    {
      name: 'marital_statuses.view',
      module: 'marital_statuses',
      action: 'view',
      description: 'View marital statuses',
    },
    {
      name: 'marital_statuses.create',
      module: 'marital_statuses',
      action: 'create',
      description: 'Create marital statuses',
    },
    {
      name: 'marital_statuses.update',
      module: 'marital_statuses',
      action: 'update',
      description: 'Update marital statuses',
    },
    {
      name: 'marital_statuses.delete',
      module: 'marital_statuses',
      action: 'delete',
      description: 'Delete marital statuses',
    },

    // Institutes & Qualifications
    {
      name: 'institutes.view',
      module: 'institutes',
      action: 'view',
      description: 'View institutes',
    },
    {
      name: 'institutes.create',
      module: 'institutes',
      action: 'create',
      description: 'Create institutes',
    },
    {
      name: 'institutes.update',
      module: 'institutes',
      action: 'update',
      description: 'Update institutes',
    },
    {
      name: 'institutes.delete',
      module: 'institutes',
      action: 'delete',
      description: 'Delete institutes',
    },
    {
      name: 'qualifications.view',
      module: 'qualifications',
      action: 'view',
      description: 'View qualifications',
    },
    {
      name: 'qualifications.create',
      module: 'qualifications',
      action: 'create',
      description: 'Create qualifications',
    },
    {
      name: 'qualifications.update',
      module: 'qualifications',
      action: 'update',
      description: 'Update qualifications',
    },
    {
      name: 'qualifications.delete',
      module: 'qualifications',
      action: 'delete',
      description: 'Delete qualifications',
    },

    // Locations (Countries, States, Cities)
    {
      name: 'countries.view',
      module: 'countries',
      action: 'view',
      description: 'View countries',
    },
    {
      name: 'states.view',
      module: 'states',
      action: 'view',
      description: 'View states',
    },
    {
      name: 'states.create',
      module: 'states',
      action: 'create',
      description: 'Create states',
    },
    {
      name: 'states.update',
      module: 'states',
      action: 'update',
      description: 'Update states',
    },
    {
      name: 'states.delete',
      module: 'states',
      action: 'delete',
      description: 'Delete states',
    },
    {
      name: 'cities.view',
      module: 'cities',
      action: 'view',
      description: 'View cities',
    },
    {
      name: 'cities.create',
      module: 'cities',
      action: 'create',
      description: 'Create cities',
    },
    {
      name: 'cities.update',
      module: 'cities',
      action: 'update',
      description: 'Update cities',
    },
    {
      name: 'cities.delete',
      module: 'cities',
      action: 'delete',
      description: 'Delete cities',
    },

    // Branches
    {
      name: 'branches.view',
      module: 'branches',
      action: 'view',
      description: 'View branches',
    },
    {
      name: 'branches.create',
      module: 'branches',
      action: 'create',
      description: 'Create branches',
    },
    {
      name: 'branches.update',
      module: 'branches',
      action: 'update',
      description: 'Update branches',
    },
    {
      name: 'branches.delete',
      module: 'branches',
      action: 'delete',
      description: 'Delete branches',
    },

    // Leave Management
    {
      name: 'leave_types.view',
      module: 'leave_types',
      action: 'view',
      description: 'View leave types',
    },
    {
      name: 'leave_types.create',
      module: 'leave_types',
      action: 'create',
      description: 'Create leave types',
    },
    {
      name: 'leave_types.update',
      module: 'leave_types',
      action: 'update',
      description: 'Update leave types',
    },
    {
      name: 'leave_types.delete',
      module: 'leave_types',
      action: 'delete',
      description: 'Delete leave types',
    },
    {
      name: 'leaves_policies.view',
      module: 'leaves_policies',
      action: 'view',
      description: 'View leaves policies',
    },
    {
      name: 'leaves_policies.create',
      module: 'leaves_policies',
      action: 'create',
      description: 'Create leaves policies',
    },
    {
      name: 'leaves_policies.update',
      module: 'leaves_policies',
      action: 'update',
      description: 'Update leaves policies',
    },
    {
      name: 'leaves_policies.delete',
      module: 'leaves_policies',
      action: 'delete',
      description: 'Delete leaves policies',
    },
    {
      name: 'leaves.view',
      module: 'leaves',
      action: 'view',
      description: 'View leaves',
    },
    {
      name: 'leaves.create',
      module: 'leaves',
      action: 'create',
      description: 'Create leaves',
    },
    {
      name: 'leaves.update',
      module: 'leaves',
      action: 'update',
      description: 'Update leaves',
    },
    {
      name: 'leaves.delete',
      module: 'leaves',
      action: 'delete',
      description: 'Delete leaves',
    },
    {
      name: 'leaves.approve',
      module: 'leaves',
      action: 'approve',
      description: 'Approve leaves',
    },

    // Working Hours & Holidays
    {
      name: 'working_hours_policies.view',
      module: 'working_hours_policies',
      action: 'view',
      description: 'View working hours policies',
    },
    {
      name: 'working_hours_policies.create',
      module: 'working_hours_policies',
      action: 'create',
      description: 'Create working hours policies',
    },
    {
      name: 'working_hours_policies.update',
      module: 'working_hours_policies',
      action: 'update',
      description: 'Update working hours policies',
    },
    {
      name: 'working_hours_policies.delete',
      module: 'working_hours_policies',
      action: 'delete',
      description: 'Delete working hours policies',
    },
    {
      name: 'holidays.view',
      module: 'holidays',
      action: 'view',
      description: 'View holidays',
    },
    {
      name: 'holidays.create',
      module: 'holidays',
      action: 'create',
      description: 'Create holidays',
    },
    {
      name: 'holidays.update',
      module: 'holidays',
      action: 'update',
      description: 'Update holidays',
    },
    {
      name: 'holidays.delete',
      module: 'holidays',
      action: 'delete',
      description: 'Delete holidays',
    },

    // Attendance
    {
      name: 'attendance.view',
      module: 'attendance',
      action: 'view',
      description: 'View attendance',
    },
    {
      name: 'attendance.create',
      module: 'attendance',
      action: 'create',
      description: 'Create attendance',
    },
    {
      name: 'attendance.update',
      module: 'attendance',
      action: 'update',
      description: 'Update attendance',
    },
    {
      name: 'attendance.delete',
      module: 'attendance',
      action: 'delete',
      description: 'Delete attendance',
    },

    // Payroll & Financial
    {
      name: 'payroll.view',
      module: 'payroll',
      action: 'view',
      description: 'View payroll',
    },
    {
      name: 'payroll.create',
      module: 'payroll',
      action: 'create',
      description: 'Create payroll',
    },
    {
      name: 'payroll.update',
      module: 'payroll',
      action: 'update',
      description: 'Update payroll',
    },
    {
      name: 'payroll.delete',
      module: 'payroll',
      action: 'delete',
      description: 'Delete payroll',
    },
    {
      name: 'payroll.process',
      module: 'payroll',
      action: 'process',
      description: 'Process payroll',
    },
    {
      name: 'provident_funds.view',
      module: 'provident_funds',
      action: 'view',
      description: 'View provident funds',
    },
    {
      name: 'provident_funds.create',
      module: 'provident_funds',
      action: 'create',
      description: 'Create provident funds',
    },
    {
      name: 'provident_funds.update',
      module: 'provident_funds',
      action: 'update',
      description: 'Update provident funds',
    },
    {
      name: 'provident_funds.delete',
      module: 'provident_funds',
      action: 'delete',
      description: 'Delete provident funds',
    },
    {
      name: 'eobi.view',
      module: 'eobi',
      action: 'view',
      description: 'View EOBI',
    },
    {
      name: 'eobi.create',
      module: 'eobi',
      action: 'create',
      description: 'Create EOBI',
    },
    {
      name: 'eobi.update',
      module: 'eobi',
      action: 'update',
      description: 'Update EOBI',
    },
    {
      name: 'eobi.delete',
      module: 'eobi',
      action: 'delete',
      description: 'Delete EOBI',
    },
    {
      name: 'tax_slabs.view',
      module: 'tax_slabs',
      action: 'view',
      description: 'View tax slabs',
    },
    {
      name: 'tax_slabs.create',
      module: 'tax_slabs',
      action: 'create',
      description: 'Create tax slabs',
    },
    {
      name: 'tax_slabs.update',
      module: 'tax_slabs',
      action: 'update',
      description: 'Update tax slabs',
    },
    {
      name: 'tax_slabs.delete',
      module: 'tax_slabs',
      action: 'delete',
      description: 'Delete tax slabs',
    },
    {
      name: 'salary_breakups.view',
      module: 'salary_breakups',
      action: 'view',
      description: 'View salary breakups',
    },
    {
      name: 'salary_breakups.create',
      module: 'salary_breakups',
      action: 'create',
      description: 'Create salary breakups',
    },
    {
      name: 'salary_breakups.update',
      module: 'salary_breakups',
      action: 'update',
      description: 'Update salary breakups',
    },
    {
      name: 'salary_breakups.delete',
      module: 'salary_breakups',
      action: 'delete',
      description: 'Delete salary breakups',
    },
    {
      name: 'bonus_types.view',
      module: 'bonus_types',
      action: 'view',
      description: 'View bonus types',
    },
    {
      name: 'bonus_types.create',
      module: 'bonus_types',
      action: 'create',
      description: 'Create bonus types',
    },
    {
      name: 'bonus_types.update',
      module: 'bonus_types',
      action: 'update',
      description: 'Update bonus types',
    },
    {
      name: 'bonus_types.delete',
      module: 'bonus_types',
      action: 'delete',
      description: 'Delete bonus types',
    },
    {
      name: 'loan_types.view',
      module: 'loan_types',
      action: 'view',
      description: 'View loan types',
    },
    {
      name: 'loan_types.create',
      module: 'loan_types',
      action: 'create',
      description: 'Create loan types',
    },
    {
      name: 'loan_types.update',
      module: 'loan_types',
      action: 'update',
      description: 'Update loan types',
    },
    {
      name: 'loan_types.delete',
      module: 'loan_types',
      action: 'delete',
      description: 'Delete loan types',
    },

    // Equipment
    {
      name: 'equipment.view',
      module: 'equipment',
      action: 'view',
      description: 'View equipment',
    },
    {
      name: 'equipment.create',
      module: 'equipment',
      action: 'create',
      description: 'Create equipment',
    },
    {
      name: 'equipment.update',
      module: 'equipment',
      action: 'update',
      description: 'Update equipment',
    },
    {
      name: 'equipment.delete',
      module: 'equipment',
      action: 'delete',
      description: 'Delete equipment',
    },

    // File Uploads
    {
      name: 'uploads.view',
      module: 'uploads',
      action: 'view',
      description: 'View uploads',
    },
    {
      name: 'uploads.create',
      module: 'uploads',
      action: 'create',
      description: 'Create uploads',
    },
    {
      name: 'uploads.delete',
      module: 'uploads',
      action: 'delete',
      description: 'Delete uploads',
    },

    // Activity Logs
    {
      name: 'activity_logs.view',
      module: 'activity_logs',
      action: 'view',
      description: 'View activity logs',
    },

    // Settings & Reports
    {
      name: 'settings.view',
      module: 'settings',
      action: 'view',
      description: 'View settings',
    },
    {
      name: 'settings.update',
      module: 'settings',
      action: 'update',
      description: 'Update settings',
    },
    {
      name: 'reports.view',
      module: 'reports',
      action: 'view',
      description: 'View reports',
    },
    {
      name: 'reports.export',
      module: 'reports',
      action: 'export',
      description: 'Export reports',
    },
  ];

  console.log('📝 Creating permissions...');
  const permissions: Permission[] = [];
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
      where: {
        roleId_permissionId: {
          roleId: adminRole.id,
          permissionId: permission.id,
        },
      },
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

  // HR permissions: employees, departments, sub_departments, designations, job_types, employee_grades, employee_statuses,
  // marital_statuses, institutes, qualifications, branches, leave_types, leaves_policies, leaves, working_hours_policies,
  // holidays, attendance, equipment, activity_logs (view only)
  const hrPermissionModules = [
    'employees',
    'departments',
    'sub_departments',
    'designations',
    'job_types',
    'employee_grades',
    'employee_statuses',
    'marital_statuses',
    'institutes',
    'qualifications',
    'branches',
    'leave_types',
    'leaves_policies',
    'leaves',
    'working_hours_policies',
    'holidays',
    'attendance',
    'equipment',
  ];
  const hrPermissions = permissions.filter(
    (p) =>
      hrPermissionModules.includes(p.module) ||
      (p.module === 'activity_logs' && p.action === 'view'),
  );
  for (const permission of hrPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: hrRole.id, permissionId: permission.id },
      },
      update: {},
      create: { roleId: hrRole.id, permissionId: permission.id },
    });
  }

  console.log('👤 Creating employee role...');
  const employeeRole = await prisma.role.upsert({
    where: { name: 'employee' },
    update: {},
    create: {
      name: 'employee',
      description: 'Regular Employee',
      isSystem: true,
    },
  });

  // Employee permissions: view own attendance, view/create/update own leaves
  const employeePermissions = permissions.filter(
    (p) =>
      p.name === 'attendance.view' ||
      p.name === 'leaves.view' ||
      p.name === 'leaves.create' ||
      p.name === 'leaves.update' ||
      p.name === 'holidays.view',
  );
  for (const permission of employeePermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: employeeRole.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: { roleId: employeeRole.id, permissionId: permission.id },
    });
  }

  console.log('👤 Creating admin user...');
  const hashedPassword = await bcrypt.hash('admin123', 12);

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@speedlimit.com' },
    update: { password: hashedPassword, roleId: adminRole.id },
    create: {
      email: 'admin@speedlimit.com',
      password: hashedPassword,
      firstName: 'System',
      lastName: 'Admin',
      phone: '0300-0000000',
      status: 'active',
      roleId: adminRole.id,
    },
  });

  // Seed Master Data
  await seedCountries(prisma);
  await seedCities(prisma);
  await seedInstitutes(prisma);
  await seedDepartments(prisma);
  await seedSubDepartments(prisma);
  await seedDesignations(prisma);
  await seedJobTypes(prisma);
  await seedMaritalStatuses(prisma);
  await seedQualifications(prisma);
  await seedHolidays(prisma, adminUser.id);
  await seedEmployeeGrades(prisma, adminUser.id);
  await seedEmployeeStatuses(prisma, adminUser.id);

  // Seed Branches (needs Cities)
  await seedBranches(prisma, adminUser.id);

  // Seed Leave Types and Leaves Policies
  await seedLeavesPolicies(prisma, adminUser.id);

  // Seed Working Hours Policies
  await seedWorkingHoursPolicies(prisma, adminUser.id);

  // Seed Equipments
  await seedEquipments(prisma, adminUser.id);

  // Seed Allowance Heads
  await seedAllowanceHeads(prisma, adminUser.id);

  // Seed Deduction Heads
  await seedDeductionHeads(prisma, adminUser.id);

  // Seed Bonus Types
  await seedBonusTypes(prisma, adminUser.id);

  // Seed Banks
  await seedBanks(prisma, adminUser.id);

  // Seed Salary Breakups
  await seedSalaryBreakups(prisma, adminUser.id);

  // Seed Provident Funds
  await seedProvidentFunds(prisma, adminUser.id);

  // Seed Loan Types
  await seedLoanTypes(prisma, adminUser.id);

  // Seed Tax Slabs
  await seedTaxSlabs(prisma, adminUser.id);

  // Seed Rebate Natures
  await seedRebateNatures(prisma, adminUser.id);

  // Seed Fixed Rebate Natures
  await seedFixedRebateNatures(prisma, adminUser.id);

  // Seed Employees (needs all master data)
  await seedEmployees(prisma, adminUser.id);

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

async function seedEmployeeGrades(prisma: PrismaClient, createdById: string) {
  console.log('📊 Seeding employee grades...');
  const grades = [
    'Grade 1',
    'Grade 2',
    'Grade 3',
    'Grade 4',
    'Grade 5',
    'Grade 6',
    'Grade 7',
    'Grade 8',
    'Grade 9',
    'Grade 10',
    'Grade 11',
    'Grade 12',
    'Grade 13',
    'Grade 14',
    'Grade 15',
    'Grade 16',
    'Grade 17',
    'Grade 18',
    'Grade 19',
    'Grade 20',
    'Grade 21',
    'Grade 22',
  ];

  let created = 0;
  let skipped = 0;
  for (const grade of grades) {
    try {
      const existing = await prisma.employeeGrade.findFirst({
        where: { grade },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.employeeGrade.create({
        data: {
          grade,
          status: 'active',
          createdById,
        },
      });
      created++;
    } catch (error: any) {
      console.error(`Error seeding employee grade "${grade}":`, error.message);
    }
  }
  console.log(`✓ Employee Grades: ${created} created, ${skipped} skipped`);
  return { created, skipped };
}

async function seedEmployeeStatuses(prisma: PrismaClient, createdById: string) {
  console.log('📋 Seeding employee statuses...');
  const statuses = [
    { status: 'Active', statusType: 'active' },
    { status: 'Inactive', statusType: 'inactive' },
    { status: 'On Leave', statusType: 'active' },
    { status: 'Suspended', statusType: 'inactive' },
    { status: 'Terminated', statusType: 'inactive' },
    { status: 'Resigned', statusType: 'inactive' },
    { status: 'Retired', statusType: 'inactive' },
    { status: 'Probation', statusType: 'active' },
    { status: 'Contract', statusType: 'active' },
  ];

  let created = 0;
  let skipped = 0;
  for (const statusData of statuses) {
    try {
      const existing = await prisma.employeeStatus.findFirst({
        where: { status: statusData.status },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.employeeStatus.create({
        data: {
          status: statusData.status,
          statusType: statusData.statusType,
          createdById,
        },
      });
      created++;
    } catch (error: any) {
      console.error(
        `Error seeding employee status "${statusData.status}":`,
        error.message,
      );
    }
  }
  console.log(`✓ Employee Statuses: ${created} created, ${skipped} skipped`);
  return { created, skipped };
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
