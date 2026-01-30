import { PrismaClient } from '@prisma/client';

// Master module permissions that match the controllers
const masterPermissions = [
  // Department
  { name: 'master.department.create', module: 'master.department', action: 'create', description: 'Create Department' },
  { name: 'master.department.read', module: 'master.department', action: 'read', description: 'Read Department' },
  { name: 'master.department.update', module: 'master.department', action: 'update', description: 'Update Department' },
  { name: 'master.department.delete', module: 'master.department', action: 'delete', description: 'Delete Department' },
  // Sub Department
  { name: 'master.sub-department.create', module: 'master.sub-department', action: 'create', description: 'Create Sub Department' },
  { name: 'master.sub-department.read', module: 'master.sub-department', action: 'read', description: 'Read Sub Department' },
  { name: 'master.sub-department.update', module: 'master.sub-department', action: 'update', description: 'Update Sub Department' },
  { name: 'master.sub-department.delete', module: 'master.sub-department', action: 'delete', description: 'Delete Sub Department' },
  // City
  { name: 'master.city.create', module: 'master.city', action: 'create', description: 'Create City' },
  { name: 'master.city.read', module: 'master.city', action: 'read', description: 'Read City' },
  { name: 'master.city.update', module: 'master.city', action: 'update', description: 'Update City' },
  { name: 'master.city.delete', module: 'master.city', action: 'delete', description: 'Delete City' },
  // Designation
  { name: 'master.designation.create', module: 'master.designation', action: 'create', description: 'Create Designation' },
  { name: 'master.designation.read', module: 'master.designation', action: 'read', description: 'Read Designation' },
  { name: 'master.designation.update', module: 'master.designation', action: 'update', description: 'Update Designation' },
  { name: 'master.designation.delete', module: 'master.designation', action: 'delete', description: 'Delete Designation' },
  // Employee Grade
  { name: 'master.employee-grade.create', module: 'master.employee-grade', action: 'create', description: 'Create Employee Grade' },
  { name: 'master.employee-grade.read', module: 'master.employee-grade', action: 'read', description: 'Read Employee Grade' },
  { name: 'master.employee-grade.update', module: 'master.employee-grade', action: 'update', description: 'Update Employee Grade' },
  { name: 'master.employee-grade.delete', module: 'master.employee-grade', action: 'delete', description: 'Delete Employee Grade' },
  // Marital Status
  { name: 'master.marital-status.create', module: 'master.marital-status', action: 'create', description: 'Create Marital Status' },
  { name: 'master.marital-status.read', module: 'master.marital-status', action: 'read', description: 'Read Marital Status' },
  { name: 'master.marital-status.update', module: 'master.marital-status', action: 'update', description: 'Update Marital Status' },
  { name: 'master.marital-status.delete', module: 'master.marital-status', action: 'delete', description: 'Delete Marital Status' },
  // Institute
  { name: 'master.institute.create', module: 'master.institute', action: 'create', description: 'Create Institute' },
  { name: 'master.institute.read', module: 'master.institute', action: 'read', description: 'Read Institute' },
  { name: 'master.institute.update', module: 'master.institute', action: 'update', description: 'Update Institute' },
  { name: 'master.institute.delete', module: 'master.institute', action: 'delete', description: 'Delete Institute' },
  // Qualification
  { name: 'master.qualification.create', module: 'master.qualification', action: 'create', description: 'Create Qualification' },
  { name: 'master.qualification.read', module: 'master.qualification', action: 'read', description: 'Read Qualification' },
  { name: 'master.qualification.update', module: 'master.qualification', action: 'update', description: 'Update Qualification' },
  { name: 'master.qualification.delete', module: 'master.qualification', action: 'delete', description: 'Delete Qualification' },
  // Job Type
  { name: 'master.job-type.create', module: 'master.job-type', action: 'create', description: 'Create Job Type' },
  { name: 'master.job-type.read', module: 'master.job-type', action: 'read', description: 'Read Job Type' },
  { name: 'master.job-type.update', module: 'master.job-type', action: 'update', description: 'Update Job Type' },
  { name: 'master.job-type.delete', module: 'master.job-type', action: 'delete', description: 'Delete Job Type' },
  // Employee Status
  { name: 'master.employee-status.create', module: 'master.employee-status', action: 'create', description: 'Create Employee Status' },
  { name: 'master.employee-status.read', module: 'master.employee-status', action: 'read', description: 'Read Employee Status' },
  { name: 'master.employee-status.update', module: 'master.employee-status', action: 'update', description: 'Update Employee Status' },
  { name: 'master.employee-status.delete', module: 'master.employee-status', action: 'delete', description: 'Delete Employee Status' },
  // Allocation
  { name: 'master.allocation.create', module: 'master.allocation', action: 'create', description: 'Create Allocation' },
  { name: 'master.allocation.read', module: 'master.allocation', action: 'read', description: 'Read Allocation' },
  { name: 'master.allocation.update', module: 'master.allocation', action: 'update', description: 'Update Allocation' },
  { name: 'master.allocation.delete', module: 'master.allocation', action: 'delete', description: 'Delete Allocation' },
  // Allowance Head
  { name: 'master.allowance-head.create', module: 'master.allowance-head', action: 'create', description: 'Create Allowance Head' },
  { name: 'master.allowance-head.read', module: 'master.allowance-head', action: 'read', description: 'Read Allowance Head' },
  { name: 'master.allowance-head.update', module: 'master.allowance-head', action: 'update', description: 'Update Allowance Head' },
  { name: 'master.allowance-head.delete', module: 'master.allowance-head', action: 'delete', description: 'Delete Allowance Head' },
  // Deduction Head
  { name: 'master.deduction-head.create', module: 'master.deduction-head', action: 'create', description: 'Create Deduction Head' },
  { name: 'master.deduction-head.read', module: 'master.deduction-head', action: 'read', description: 'Read Deduction Head' },
  { name: 'master.deduction-head.update', module: 'master.deduction-head', action: 'update', description: 'Update Deduction Head' },
  { name: 'master.deduction-head.delete', module: 'master.deduction-head', action: 'delete', description: 'Delete Deduction Head' },
  // Bank
  { name: 'master.bank.create', module: 'master.bank', action: 'create', description: 'Create Bank' },
  { name: 'master.bank.read', module: 'master.bank', action: 'read', description: 'Read Bank' },
  { name: 'master.bank.update', module: 'master.bank', action: 'update', description: 'Update Bank' },
  { name: 'master.bank.delete', module: 'master.bank', action: 'delete', description: 'Delete Bank' },
  // Bonus Type
  { name: 'master.bonus-type.create', module: 'master.bonus-type', action: 'create', description: 'Create Bonus Type' },
  { name: 'master.bonus-type.read', module: 'master.bonus-type', action: 'read', description: 'Read Bonus Type' },
  { name: 'master.bonus-type.update', module: 'master.bonus-type', action: 'update', description: 'Update Bonus Type' },
  { name: 'master.bonus-type.delete', module: 'master.bonus-type', action: 'delete', description: 'Delete Bonus Type' },
  // Leave Type
  { name: 'master.leave-type.create', module: 'master.leave-type', action: 'create', description: 'Create Leave Type' },
  { name: 'master.leave-type.read', module: 'master.leave-type', action: 'read', description: 'Read Leave Type' },
  { name: 'master.leave-type.update', module: 'master.leave-type', action: 'update', description: 'Update Leave Type' },
  { name: 'master.leave-type.delete', module: 'master.leave-type', action: 'delete', description: 'Delete Leave Type' },
  // Leaves Policy
  { name: 'master.leaves-policy.create', module: 'master.leaves-policy', action: 'create', description: 'Create Leaves Policy' },
  { name: 'master.leaves-policy.read', module: 'master.leaves-policy', action: 'read', description: 'Read Leaves Policy' },
  { name: 'master.leaves-policy.update', module: 'master.leaves-policy', action: 'update', description: 'Update Leaves Policy' },
  { name: 'master.leaves-policy.delete', module: 'master.leaves-policy', action: 'delete', description: 'Delete Leaves Policy' },
  // Loan Type
  { name: 'master.loan-type.create', module: 'master.loan-type', action: 'create', description: 'Create Loan Type' },
  { name: 'master.loan-type.read', module: 'master.loan-type', action: 'read', description: 'Read Loan Type' },
  { name: 'master.loan-type.update', module: 'master.loan-type', action: 'update', description: 'Update Loan Type' },
  { name: 'master.loan-type.delete', module: 'master.loan-type', action: 'delete', description: 'Delete Loan Type' },
  // Location
  { name: 'master.location.create', module: 'master.location', action: 'create', description: 'Create Location' },
  { name: 'master.location.read', module: 'master.location', action: 'read', description: 'Read Location' },
  { name: 'master.location.update', module: 'master.location', action: 'update', description: 'Update Location' },
  { name: 'master.location.delete', module: 'master.location', action: 'delete', description: 'Delete Location' },
  // Provident Fund
  { name: 'master.provident-fund.create', module: 'master.provident-fund', action: 'create', description: 'Create Provident Fund' },
  { name: 'master.provident-fund.read', module: 'master.provident-fund', action: 'read', description: 'Read Provident Fund' },
  { name: 'master.provident-fund.update', module: 'master.provident-fund', action: 'update', description: 'Update Provident Fund' },
  { name: 'master.provident-fund.delete', module: 'master.provident-fund', action: 'delete', description: 'Delete Provident Fund' },
  // Salary Breakup
  { name: 'master.salary-breakup.create', module: 'master.salary-breakup', action: 'create', description: 'Create Salary Breakup' },
  { name: 'master.salary-breakup.read', module: 'master.salary-breakup', action: 'read', description: 'Read Salary Breakup' },
  { name: 'master.salary-breakup.update', module: 'master.salary-breakup', action: 'update', description: 'Update Salary Breakup' },
  { name: 'master.salary-breakup.delete', module: 'master.salary-breakup', action: 'delete', description: 'Delete Salary Breakup' },
  // Social Security
  { name: 'master.social-security.create', module: 'master.social-security', action: 'create', description: 'Create Social Security' },
  { name: 'master.social-security.read', module: 'master.social-security', action: 'read', description: 'Read Social Security' },
  { name: 'master.social-security.update', module: 'master.social-security', action: 'update', description: 'Update Social Security' },
  { name: 'master.social-security.delete', module: 'master.social-security', action: 'delete', description: 'Delete Social Security' },
  // Tax Slab
  { name: 'master.tax-slab.create', module: 'master.tax-slab', action: 'create', description: 'Create Tax Slab' },
  { name: 'master.tax-slab.read', module: 'master.tax-slab', action: 'read', description: 'Read Tax Slab' },
  { name: 'master.tax-slab.update', module: 'master.tax-slab', action: 'update', description: 'Update Tax Slab' },
  { name: 'master.tax-slab.delete', module: 'master.tax-slab', action: 'delete', description: 'Delete Tax Slab' },
  // EOBI
  { name: 'master.eobi.create', module: 'master.eobi', action: 'create', description: 'Create EOBI' },
  { name: 'master.eobi.read', module: 'master.eobi', action: 'read', description: 'Read EOBI' },
  { name: 'master.eobi.update', module: 'master.eobi', action: 'update', description: 'Update EOBI' },
  { name: 'master.eobi.delete', module: 'master.eobi', action: 'delete', description: 'Delete EOBI' },
  // Equipment
  { name: 'master.equipment.create', module: 'master.equipment', action: 'create', description: 'Create Equipment' },
  { name: 'master.equipment.read', module: 'master.equipment', action: 'read', description: 'Read Equipment' },
  { name: 'master.equipment.update', module: 'master.equipment', action: 'update', description: 'Update Equipment' },
  { name: 'master.equipment.delete', module: 'master.equipment', action: 'delete', description: 'Delete Equipment' },
];

export async function syncMasterPermissions(prisma: PrismaClient) {
  console.log('🔄 Syncing master permissions...');

  let created = 0;
  let existing = 0;

  for (const perm of masterPermissions) {
    const existingPerm = await prisma.permission.findUnique({
      where: { name: perm.name },
    });

    if (!existingPerm) {
      await prisma.permission.create({
        data: perm,
      });
      created++;
      console.log(`  ✅ Created: ${perm.name}`);
    } else {
      existing++;
    }
  }

  console.log(`📊 Summary: ${created} created, ${existing} already existed`);

  // Find admin role and assign all master permissions
  const adminRole = await prisma.role.findFirst({
    where: { name: { contains: 'Admin', mode: 'insensitive' } },
  });

  if (adminRole) {
    console.log(`🔗 Assigning master permissions to role: ${adminRole.name}`);
    
    const allMasterPerms = await prisma.permission.findMany({
      where: { name: { startsWith: 'master.' } },
    });

    for (const perm of allMasterPerms) {
      const exists = await prisma.rolePermission.findFirst({
        where: { roleId: adminRole.id, permissionId: perm.id },
      });

      if (!exists) {
        await prisma.rolePermission.create({
          data: { roleId: adminRole.id, permissionId: perm.id },
        });
        console.log(`  ✅ Assigned ${perm.name} to ${adminRole.name}`);
      }
    }
  }

  console.log('✅ Master permissions sync complete!');
}
