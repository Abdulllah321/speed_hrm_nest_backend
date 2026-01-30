import { PrismaClient } from '@prisma/client';

// Master module permissions that match the controllers
const masterPermissions = [
  // Department
  { name: 'master.department.create', description: 'Create Department' },
  { name: 'master.department.read', description: 'Read Department' },
  { name: 'master.department.update', description: 'Update Department' },
  { name: 'master.department.delete', description: 'Delete Department' },
  // Sub Department
  { name: 'master.sub-department.create', description: 'Create Sub Department' },
  { name: 'master.sub-department.read', description: 'Read Sub Department' },
  { name: 'master.sub-department.update', description: 'Update Sub Department' },
  { name: 'master.sub-department.delete', description: 'Delete Sub Department' },
  // City
  { name: 'master.city.create', description: 'Create City' },
  { name: 'master.city.read', description: 'Read City' },
  { name: 'master.city.update', description: 'Update City' },
  { name: 'master.city.delete', description: 'Delete City' },
  // Designation
  { name: 'master.designation.create', description: 'Create Designation' },
  { name: 'master.designation.read', description: 'Read Designation' },
  { name: 'master.designation.update', description: 'Update Designation' },
  { name: 'master.designation.delete', description: 'Delete Designation' },
  // Employee Grade
  { name: 'master.employee-grade.create', description: 'Create Employee Grade' },
  { name: 'master.employee-grade.read', description: 'Read Employee Grade' },
  { name: 'master.employee-grade.update', description: 'Update Employee Grade' },
  { name: 'master.employee-grade.delete', description: 'Delete Employee Grade' },
  // Marital Status
  { name: 'master.marital-status.create', description: 'Create Marital Status' },
  { name: 'master.marital-status.read', description: 'Read Marital Status' },
  { name: 'master.marital-status.update', description: 'Update Marital Status' },
  { name: 'master.marital-status.delete', description: 'Delete Marital Status' },
  // Institute
  { name: 'master.institute.create', description: 'Create Institute' },
  { name: 'master.institute.read', description: 'Read Institute' },
  { name: 'master.institute.update', description: 'Update Institute' },
  { name: 'master.institute.delete', description: 'Delete Institute' },
  // Qualification
  { name: 'master.qualification.create', description: 'Create Qualification' },
  { name: 'master.qualification.read', description: 'Read Qualification' },
  { name: 'master.qualification.update', description: 'Update Qualification' },
  { name: 'master.qualification.delete', description: 'Delete Qualification' },
  // Job Type
  { name: 'master.job-type.create', description: 'Create Job Type' },
  { name: 'master.job-type.read', description: 'Read Job Type' },
  { name: 'master.job-type.update', description: 'Update Job Type' },
  { name: 'master.job-type.delete', description: 'Delete Job Type' },
  // Employee Status
  { name: 'master.employee-status.create', description: 'Create Employee Status' },
  { name: 'master.employee-status.read', description: 'Read Employee Status' },
  { name: 'master.employee-status.update', description: 'Update Employee Status' },
  { name: 'master.employee-status.delete', description: 'Delete Employee Status' },
  // Allocation
  { name: 'master.allocation.create', description: 'Create Allocation' },
  { name: 'master.allocation.read', description: 'Read Allocation' },
  { name: 'master.allocation.update', description: 'Update Allocation' },
  { name: 'master.allocation.delete', description: 'Delete Allocation' },
  // Allowance Head
  { name: 'master.allowance-head.create', description: 'Create Allowance Head' },
  { name: 'master.allowance-head.read', description: 'Read Allowance Head' },
  { name: 'master.allowance-head.update', description: 'Update Allowance Head' },
  { name: 'master.allowance-head.delete', description: 'Delete Allowance Head' },
  // Deduction Head
  { name: 'master.deduction-head.create', description: 'Create Deduction Head' },
  { name: 'master.deduction-head.read', description: 'Read Deduction Head' },
  { name: 'master.deduction-head.update', description: 'Update Deduction Head' },
  { name: 'master.deduction-head.delete', description: 'Delete Deduction Head' },
  // Bank
  { name: 'master.bank.create', description: 'Create Bank' },
  { name: 'master.bank.read', description: 'Read Bank' },
  { name: 'master.bank.update', description: 'Update Bank' },
  { name: 'master.bank.delete', description: 'Delete Bank' },
  // Bonus Type
  { name: 'master.bonus-type.create', description: 'Create Bonus Type' },
  { name: 'master.bonus-type.read', description: 'Read Bonus Type' },
  { name: 'master.bonus-type.update', description: 'Update Bonus Type' },
  { name: 'master.bonus-type.delete', description: 'Delete Bonus Type' },
  // Leave Type
  { name: 'master.leave-type.create', description: 'Create Leave Type' },
  { name: 'master.leave-type.read', description: 'Read Leave Type' },
  { name: 'master.leave-type.update', description: 'Update Leave Type' },
  { name: 'master.leave-type.delete', description: 'Delete Leave Type' },
  // Leaves Policy
  { name: 'master.leaves-policy.create', description: 'Create Leaves Policy' },
  { name: 'master.leaves-policy.read', description: 'Read Leaves Policy' },
  { name: 'master.leaves-policy.update', description: 'Update Leaves Policy' },
  { name: 'master.leaves-policy.delete', description: 'Delete Leaves Policy' },
  // Loan Type
  { name: 'master.loan-type.create', description: 'Create Loan Type' },
  { name: 'master.loan-type.read', description: 'Read Loan Type' },
  { name: 'master.loan-type.update', description: 'Update Loan Type' },
  { name: 'master.loan-type.delete', description: 'Delete Loan Type' },
  // Location
  { name: 'master.location.create', description: 'Create Location' },
  { name: 'master.location.read', description: 'Read Location' },
  { name: 'master.location.update', description: 'Update Location' },
  { name: 'master.location.delete', description: 'Delete Location' },
  // Provident Fund
  { name: 'master.provident-fund.create', description: 'Create Provident Fund' },
  { name: 'master.provident-fund.read', description: 'Read Provident Fund' },
  { name: 'master.provident-fund.update', description: 'Update Provident Fund' },
  { name: 'master.provident-fund.delete', description: 'Delete Provident Fund' },
  // Salary Breakup
  { name: 'master.salary-breakup.create', description: 'Create Salary Breakup' },
  { name: 'master.salary-breakup.read', description: 'Read Salary Breakup' },
  { name: 'master.salary-breakup.update', description: 'Update Salary Breakup' },
  { name: 'master.salary-breakup.delete', description: 'Delete Salary Breakup' },
  // Social Security
  { name: 'master.social-security.create', description: 'Create Social Security' },
  { name: 'master.social-security.read', description: 'Read Social Security' },
  { name: 'master.social-security.update', description: 'Update Social Security' },
  { name: 'master.social-security.delete', description: 'Delete Social Security' },
  // Tax Slab
  { name: 'master.tax-slab.create', description: 'Create Tax Slab' },
  { name: 'master.tax-slab.read', description: 'Read Tax Slab' },
  { name: 'master.tax-slab.update', description: 'Update Tax Slab' },
  { name: 'master.tax-slab.delete', description: 'Delete Tax Slab' },
  // EOBI
  { name: 'master.eobi.create', description: 'Create EOBI' },
  { name: 'master.eobi.read', description: 'Read EOBI' },
  { name: 'master.eobi.update', description: 'Update EOBI' },
  { name: 'master.eobi.delete', description: 'Delete EOBI' },
  // Equipment
  { name: 'master.equipment.create', description: 'Create Equipment' },
  { name: 'master.equipment.read', description: 'Read Equipment' },
  { name: 'master.equipment.update', description: 'Update Equipment' },
  { name: 'master.equipment.delete', description: 'Delete Equipment' },
  
  // Attendance
  { name: 'hr.attendance.view', description: 'View Attendance' },
  { name: 'hr.attendance.create', description: 'Create Attendance' },
  { name: 'hr.attendance.update', description: 'Update Attendance' },
  { name: 'hr.attendance.delete', description: 'Delete Attendance' },
  { name: 'hr.attendance.summary', description: 'Attendance Summary' },
  { name: 'hr.attendance.request', description: 'Attendance Request' },
  { name: 'hr.attendance.request-list', description: 'Attendance Request List' },
  { name: 'hr.attendance.exemptions', description: 'Attendance Exemptions' },
  { name: 'hr.attendance.exemptions-list', description: 'Attendance Exemptions List' },
  
  // Working Hour Policy
  { name: 'hr.working-hour-policy.create', description: 'Create Working Hour Policy' },
  { name: 'hr.working-hour-policy.read', description: 'Read Working Hour Policy' },
  { name: 'hr.working-hour-policy.update', description: 'Update Working Hour Policy' },
  { name: 'hr.working-hour-policy.delete', description: 'Delete Working Hour Policy' },
  { name: 'hr.working-hour-policy.assign', description: 'Assign Working Hour Policy' },
  { name: 'hr.working-hour-policy.assign-list', description: 'Assign Working Hour Policy List' },

  // Holiday
  { name: 'hr.holiday.create', description: 'Create Holiday' },
  { name: 'hr.holiday.read', description: 'Read Holiday' },
  { name: 'hr.holiday.update', description: 'Update Holiday' },
  { name: 'hr.holiday.delete', description: 'Delete Holiday' },

  // Leave
  { name: 'hr.leave.create', description: 'Create Leave' },
  { name: 'hr.leave.read', description: 'Read Leave' },
  { name: 'hr.leave.update', description: 'Update Leave' },
  { name: 'hr.leave.delete', description: 'Delete Leave' },

  // Exit Clearance
  { name: 'hr.exit-clearance.create', description: 'Exit Clearance' },
  { name: 'hr.exit-clearance.read', description: 'Read Exit Clearance' },
  { name: 'hr.exit-clearance.update', description: 'Update Exit Clearance' },
  { name: 'hr.exit-clearance.delete', description: 'Delete Exit Clearance' },
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
      // Dynamic parsing if module or action are missing
      let { name, description } = perm;
      let module = (perm as any).module;
      let action = (perm as any).action;

      if (!module || !action) {
        const parts = name.split('.');
        if (parts.length >= 2) {
          action = parts.pop()!; // last part is action
          module = parts.join('.'); // rest is module
        } else {
           // Fallback or error? For now assuming standard format
           action = 'manage';
           module = name;
        }
      }

      await prisma.permission.create({
        data: {
            name,
            module,
            action,
            description
        },
      });
      created++;
    
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
      where: { 
        OR: [
          { name: { startsWith: 'master.' } },
          { name: { startsWith: 'hr.' } }
        ]
      },
    });

    for (const perm of allMasterPerms) {
      const exists = await prisma.rolePermission.findFirst({
        where: { roleId: adminRole.id, permissionId: perm.id },
      });

      if (!exists) {
        await prisma.rolePermission.create({
          data: { roleId: adminRole.id, permissionId: perm.id },
        });
      
      }
    }
  }

  console.log('✅ Master permissions sync complete!');
}
