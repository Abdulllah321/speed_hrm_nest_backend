import { PrismaClient } from '@prisma/client';

export async function seedDepartments(prisma: PrismaClient) {
  console.log('🏢 Seeding departments...');
  const departments = [
    'Human Resources',
    'Information Technology',
    'Finance',
    'Operations',
    'Sales',
    'Marketing',
    'Customer Service',
    'Administration',
    'Research and Development',
    'Quality Assurance',
    'Legal',
    'Procurement',
  ];
  let created = 0;
  let skipped = 0;
  for (const name of departments) {
    try {
      const existing = await prisma.department.findFirst({ where: { name } });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.department.create({ data: { name } });
      created++;
    } catch (error: any) {
      console.error(`Error seeding department "${name}":`, error.message);
    }
  }
  console.log(`✓ Departments: ${created} created, ${skipped} skipped`);
  return { created, skipped };
}

export async function seedSubDepartments(prisma: PrismaClient) {
  console.log('📁 Seeding sub-departments...');
  const departments = await prisma.department.findMany();
  const departmentMap = new Map(
    departments.map((d) => [d.name.toLowerCase(), d.id]),
  );
  const subDepartments = [
    { department: 'Human Resources', name: 'Recruitment' },
    { department: 'Human Resources', name: 'Training & Development' },
    { department: 'Human Resources', name: 'Payroll' },
    { department: 'Human Resources', name: 'Employee Relations' },
    { department: 'Information Technology', name: 'Software Development' },
    { department: 'Information Technology', name: 'Network & Infrastructure' },
    { department: 'Information Technology', name: 'IT Support' },
    { department: 'Information Technology', name: 'Database Administration' },
    { department: 'Information Technology', name: 'Cybersecurity' },
    { department: 'Finance', name: 'Accounting' },
    { department: 'Finance', name: 'Financial Planning' },
    { department: 'Finance', name: 'Audit' },
    { department: 'Finance', name: 'Tax' },
    { department: 'Operations', name: 'Production' },
    { department: 'Operations', name: 'Logistics' },
    { department: 'Operations', name: 'Supply Chain' },
    { department: 'Operations', name: 'Facilities Management' },
    { department: 'Sales', name: 'Inside Sales' },
    { department: 'Sales', name: 'Field Sales' },
    { department: 'Sales', name: 'Account Management' },
    { department: 'Sales', name: 'Business Development' },
    { department: 'Marketing', name: 'Digital Marketing' },
    { department: 'Marketing', name: 'Content Marketing' },
    { department: 'Marketing', name: 'Brand Management' },
    { department: 'Marketing', name: 'Market Research' },
    { department: 'Customer Service', name: 'Customer Support' },
    { department: 'Customer Service', name: 'Technical Support' },
    { department: 'Customer Service', name: 'Customer Success' },
    { department: 'Administration', name: 'Office Management' },
    { department: 'Administration', name: 'Documentation' },
    { department: 'Research and Development', name: 'Product Development' },
    { department: 'Research and Development', name: 'Innovation Lab' },
    { department: 'Quality Assurance', name: 'Testing' },
    { department: 'Quality Assurance', name: 'Quality Control' },
    { department: 'Legal', name: 'Compliance' },
    { department: 'Legal', name: 'Contracts' },
    { department: 'Procurement', name: 'Vendor Management' },
    { department: 'Procurement', name: 'Purchasing' },
  ];
  let created = 0;
  let skipped = 0;
  for (const subDept of subDepartments) {
    try {
      const departmentId = departmentMap.get(subDept.department.toLowerCase());
      if (!departmentId) {
        console.warn(
          `⚠️  Department "${subDept.department}" not found, skipping sub-department "${subDept.name}"`,
        );
        continue;
      }
      const existing = await prisma.subDepartment.findFirst({
        where: { name: subDept.name, departmentId },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.subDepartment.create({
        data: { name: subDept.name, departmentId },
      });
      created++;
    } catch (error: any) {
      console.error(
        `Error seeding sub-department "${subDept.name}":`,
        error.message,
      );
    }
  }
  console.log(`✓ Sub-Departments: ${created} created, ${skipped} skipped`);
  return { created, skipped };
}

export async function seedDesignations(prisma: PrismaClient) {
  console.log('👔 Seeding designations...');
  const designations = [
    'Chief Executive Officer',
    'Chief Technology Officer',
    'Chief Financial Officer',
    'Chief Operating Officer',
    'Vice President',
    'Director',
    'Senior Manager',
    'Manager',
    'Assistant Manager',
    'Team Lead',
    'Senior Developer',
    'Developer',
    'Junior Developer',
    'Senior Analyst',
    'Analyst',
    'Junior Analyst',
    'Senior Engineer',
    'Engineer',
    'Junior Engineer',
    'Senior Designer',
    'Designer',
    'Junior Designer',
    'Senior Accountant',
    'Accountant',
    'Junior Accountant',
    'HR Manager',
    'HR Executive',
    'HR Assistant',
    'Sales Manager',
    'Sales Executive',
    'Sales Representative',
    'Marketing Manager',
    'Marketing Executive',
    'Marketing Coordinator',
    'Customer Service Representative',
    'Customer Support Specialist',
    'Administrative Assistant',
    'Office Administrator',
    'Receptionist',
    'Data Entry Operator',
    'Quality Assurance Engineer',
    'Quality Control Inspector',
    'Project Manager',
    'Project Coordinator',
    'Business Analyst',
    'Operations Manager',
    'Operations Executive',
    'Procurement Officer',
    'Legal Advisor',
    'Compliance Officer',
    'Security Officer',
    'Facilities Manager',
    'Maintenance Technician',
    'Driver',
    'Cleaner',
    'Intern',
    'Trainee',
  ];
  let created = 0;
  let skipped = 0;
  for (const name of designations) {
    try {
      const existing = await prisma.designation.findFirst({ where: { name } });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.designation.create({ data: { name, status: 'active' } });
      created++;
    } catch (error: any) {
      console.error(`Error seeding designation "${name}":`, error.message);
    }
  }
  console.log(`✓ Designations: ${created} created, ${skipped} skipped`);
  return { created, skipped };
}

export async function seedJobTypes(prisma: PrismaClient) {
  console.log('💼 Seeding job types...');
  const jobTypes = [
    'Full Time',
    'Part Time',
    'Contract',
    'Temporary',
    'Internship',
    'Freelance',
    'Consultant',
    'Volunteer',
  ];
  let created = 0;
  let skipped = 0;
  for (const name of jobTypes) {
    try {
      const existing = await prisma.jobType.findFirst({ where: { name } });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.jobType.create({ data: { name, status: 'active' } });
      created++;
    } catch (error: any) {
      console.error(`Error seeding job type "${name}":`, error.message);
    }
  }
  console.log(`✓ Job Types: ${created} created, ${skipped} skipped`);
  return { created, skipped };
}

export async function seedMaritalStatuses(prisma: PrismaClient) {
  console.log('💑 Seeding marital statuses...');
  const maritalStatuses = [
    'Single',
    'Married',
    'Divorced',
    'Widowed',
    'Separated',
  ];
  let created = 0;
  let skipped = 0;
  for (const name of maritalStatuses) {
    try {
      const existing = await prisma.maritalStatus.findFirst({
        where: { name },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.maritalStatus.create({ data: { name, status: 'active' } });
      created++;
    } catch (error: any) {
      console.error(`Error seeding marital status "${name}":`, error.message);
    }
  }
  console.log(`✓ Marital Statuses: ${created} created, ${skipped} skipped`);
  return { created, skipped };
}

export async function seedHolidays(prisma: PrismaClient, createdById: string) {
  console.log('🎉 Seeding holidays...');
  // Holidays are recurring annually, so we normalize dates to base year 2000
  const baseYear = 2000;

  const createDate = (month: number, day: number): Date => {
    const date = new Date(baseYear, month - 1, day);
    date.setHours(0, 0, 0, 0);
    return date;
  };

  const holidays = [
    {
      name: "New Year's Day",
      dateFrom: createDate(1, 1),
      dateTo: createDate(1, 1),
    },
    {
      name: 'Pakistan Day',
      dateFrom: createDate(3, 23),
      dateTo: createDate(3, 23),
    },
    {
      name: 'Labour Day',
      dateFrom: createDate(5, 1),
      dateTo: createDate(5, 1),
    },
    {
      name: 'Independence Day',
      dateFrom: createDate(8, 14),
      dateTo: createDate(8, 14),
    },
    {
      name: 'Defence Day',
      dateFrom: createDate(9, 6),
      dateTo: createDate(9, 6),
    },
    {
      name: 'Iqbal Day',
      dateFrom: createDate(11, 9),
      dateTo: createDate(11, 9),
    },
    {
      name: 'Quaid-e-Azam Day',
      dateFrom: createDate(12, 25),
      dateTo: createDate(12, 25),
    },
    {
      name: 'Eid-ul-Fitr',
      dateFrom: createDate(4, 1),
      dateTo: createDate(4, 3),
    },
    {
      name: 'Eid-ul-Adha',
      dateFrom: createDate(6, 7),
      dateTo: createDate(6, 9),
    },
  ];

  let created = 0;
  let skipped = 0;
  for (const holiday of holidays) {
    try {
      const existing = await prisma.holiday.findFirst({
        where: { name: holiday.name },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.holiday.create({
        data: {
          name: holiday.name,
          dateFrom: holiday.dateFrom,
          dateTo: holiday.dateTo,
          status: 'active',
          createdById,
        },
      });
      created++;
    } catch (error: any) {
      console.error(`Error seeding holiday "${holiday.name}":`, error.message);
    }
  }
  console.log(`✓ Holidays: ${created} created, ${skipped} skipped`);
  return { created, skipped };
}

export async function seedBranches(prisma: PrismaClient, createdById: string) {
  console.log('🏢 Seeding branches...');

  // Get Pakistan and Lahore city for branches
  const pakistan = await prisma.country.findFirst({ where: { iso: 'PK' } });
  if (!pakistan) {
    console.warn('⚠️  Pakistan not found, skipping branches');
    return { created: 0, skipped: 0 };
  }

  const lahore = await prisma.city.findFirst({
    where: {
      name: 'Lahore',
      countryId: pakistan.id,
    },
  });

  const karachi = await prisma.city.findFirst({
    where: {
      name: 'Karachi',
      countryId: pakistan.id,
    },
  });

  const islamabad = await prisma.city.findFirst({
    where: {
      name: 'Islamabad',
      countryId: pakistan.id,
    },
  });

  const branches = [
    { name: 'Head Office', address: 'Main Street, Lahore', cityId: lahore?.id },
    {
      name: 'Karachi Branch',
      address: 'Business District, Karachi',
      cityId: karachi?.id,
    },
    {
      name: 'Islamabad Branch',
      address: 'Blue Area, Islamabad',
      cityId: islamabad?.id,
    },
    {
      name: 'Faisalabad Branch',
      address: 'City Center, Faisalabad',
      cityId: null,
    },
    { name: 'Multan Branch', address: 'Cantonment Area, Multan', cityId: null },
  ];

  let created = 0;
  let skipped = 0;
  for (const branch of branches) {
    try {
      const existing = await prisma.branch.findFirst({
        where: { name: branch.name },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.branch.create({
        data: {
          name: branch.name,
          address: branch.address,
          cityId: branch.cityId || undefined,
          status: 'active',
          createdById,
        },
      });
      created++;
    } catch (error: any) {
      console.error(`Error seeding branch "${branch.name}":`, error.message);
    }
  }
  console.log(`✓ Branches: ${created} created, ${skipped} skipped`);
  return { created, skipped };
}

export async function seedLeaveTypes(
  prisma: PrismaClient,
  createdById: string,
) {
  console.log('📋 Seeding leave types...');
  const leaveTypes = [
    'Annual Leave',
    'Sick Leave',
    'Casual Leave',
    'Emergency Leave',
    'Maternity Leave',
    'Paternity Leave',
    'Compensatory Leave',
    'Unpaid Leave',
    'Half Day Leave',
    'Short Leave',
  ];

  let created = 0;
  let skipped = 0;
  const leaveTypeMap = new Map<string, string>();

  for (const name of leaveTypes) {
    try {
      const existing = await prisma.leaveType.findFirst({ where: { name } });
      if (existing) {
        skipped++;
        leaveTypeMap.set(name, existing.id);
        continue;
      }
      const leaveType = await prisma.leaveType.create({
        data: {
          name,
          status: 'active',
          createdById,
        },
      });
      leaveTypeMap.set(name, leaveType.id);
      created++;
    } catch (error: any) {
      console.error(`Error seeding leave type "${name}":`, error.message);
    }
  }
  console.log(`✓ Leave Types: ${created} created, ${skipped} skipped`);
  return { created, skipped, leaveTypeMap };
}

export async function seedLeavesPolicies(
  prisma: PrismaClient,
  createdById: string,
) {
  console.log('📜 Seeding leaves policies...');

  // First seed leave types if not already seeded
  const leaveTypesResult = await seedLeaveTypes(prisma, createdById);
  const leaveTypes = await prisma.leaveType.findMany();
  const leaveTypeMap = new Map(leaveTypes.map((lt) => [lt.name, lt.id]));

  const policies = [
    {
      name: 'Standard Leave Policy',
      details: 'Standard leave policy for all employees',
      fullDayDeductionRate: 1.0,
      halfDayDeductionRate: 0.5,
      shortLeaveDeductionRate: 0.25,
      isDefault: true,
      leaveTypes: [
        { name: 'Annual Leave', numberOfLeaves: 14 },
        { name: 'Sick Leave', numberOfLeaves: 10 },
        { name: 'Casual Leave', numberOfLeaves: 5 },
        { name: 'Emergency Leave', numberOfLeaves: 3 },
      ],
    },
    {
      name: 'Executive Leave Policy',
      details: 'Enhanced leave policy for executives',
      fullDayDeductionRate: 1.0,
      halfDayDeductionRate: 0.5,
      shortLeaveDeductionRate: 0.25,
      isDefault: false,
      leaveTypes: [
        { name: 'Annual Leave', numberOfLeaves: 20 },
        { name: 'Sick Leave', numberOfLeaves: 15 },
        { name: 'Casual Leave', numberOfLeaves: 7 },
        { name: 'Emergency Leave', numberOfLeaves: 5 },
        { name: 'Compensatory Leave', numberOfLeaves: 5 },
      ],
    },
    {
      name: 'Probation Leave Policy',
      details: 'Limited leave policy for probationary employees',
      fullDayDeductionRate: 1.0,
      halfDayDeductionRate: 0.5,
      shortLeaveDeductionRate: 0.25,
      isDefault: false,
      leaveTypes: [
        { name: 'Sick Leave', numberOfLeaves: 5 },
        { name: 'Emergency Leave', numberOfLeaves: 2 },
      ],
    },
  ];

  let created = 0;
  let skipped = 0;

  for (const policy of policies) {
    try {
      const existing = await prisma.leavesPolicy.findFirst({
        where: { name: policy.name },
      });
      if (existing) {
        skipped++;
        continue;
      }

      const leavesPolicy = await prisma.leavesPolicy.create({
        data: {
          name: policy.name,
          details: policy.details,
          fullDayDeductionRate: policy.fullDayDeductionRate,
          halfDayDeductionRate: policy.halfDayDeductionRate,
          shortLeaveDeductionRate: policy.shortLeaveDeductionRate,
          status: 'active',
          isDefault: policy.isDefault,
          createdById,
        },
      });

      // Create leave type associations
      for (const leaveTypeData of policy.leaveTypes) {
        const leaveTypeId = leaveTypeMap.get(leaveTypeData.name);
        if (leaveTypeId) {
          await prisma.leavesPolicyLeaveType.create({
            data: {
              leavesPolicyId: leavesPolicy.id,
              leaveTypeId,
              numberOfLeaves: leaveTypeData.numberOfLeaves,
            },
          });
        }
      }

      created++;
    } catch (error: any) {
      console.error(
        `Error seeding leaves policy "${policy.name}":`,
        error.message,
      );
    }
  }
  console.log(`✓ Leaves Policies: ${created} created, ${skipped} skipped`);
  return { created, skipped };
}

export async function seedWorkingHoursPolicies(
  prisma: PrismaClient,
  createdById: string,
) {
  console.log('⏰ Seeding working hours policies...');

  const policies = [
    {
      name: 'Standard Working Hours',
      startWorkingHours: '09:00',
      endWorkingHours: '18:00',
      shortDayMins: 240, // 4 hours
      startBreakTime: '13:00',
      endBreakTime: '14:00',
      halfDayStartTime: '13:00',
      lateStartTime: '09:15',
      lateDeductionType: 'percentage',
      applyDeductionAfterLates: 3,
      lateDeductionPercent: 0.5,
      halfDayDeductionType: 'amount',
      applyDeductionAfterHalfDays: 2,
      halfDayDeductionAmount: 500,
      shortDayDeductionType: 'amount',
      applyDeductionAfterShortDays: 1,
      shortDayDeductionAmount: 1000,
      overtimeRate: 1.5,
      gazzetedOvertimeRate: 2.0,
      isDefault: true,
    },
    {
      name: 'Flexible Working Hours',
      startWorkingHours: '08:00',
      endWorkingHours: '17:00',
      shortDayMins: 240,
      startBreakTime: '12:30',
      endBreakTime: '13:30',
      halfDayStartTime: '12:30',
      lateStartTime: '08:15',
      lateDeductionType: 'percentage',
      applyDeductionAfterLates: 5,
      lateDeductionPercent: 0.3,
      halfDayDeductionType: 'amount',
      applyDeductionAfterHalfDays: 3,
      halfDayDeductionAmount: 400,
      shortDayDeductionType: 'amount',
      applyDeductionAfterShortDays: 2,
      shortDayDeductionAmount: 800,
      overtimeRate: 1.5,
      gazzetedOvertimeRate: 2.0,
      isDefault: false,
    },
    {
      name: 'Shift Working Hours',
      startWorkingHours: '18:00',
      endWorkingHours: '02:00',
      shortDayMins: 240,
      startBreakTime: '22:00',
      endBreakTime: '22:30',
      halfDayStartTime: '22:00',
      lateStartTime: '18:15',
      lateDeductionType: 'percentage',
      applyDeductionAfterLates: 3,
      lateDeductionPercent: 0.5,
      halfDayDeductionType: 'amount',
      applyDeductionAfterHalfDays: 2,
      halfDayDeductionAmount: 600,
      shortDayDeductionType: 'amount',
      applyDeductionAfterShortDays: 1,
      shortDayDeductionAmount: 1200,
      overtimeRate: 2.0,
      gazzetedOvertimeRate: 2.5,
      isDefault: false,
    },
  ];

  let created = 0;
  let skipped = 0;

  for (const policy of policies) {
    try {
      const existing = await prisma.workingHoursPolicy.findFirst({
        where: { name: policy.name },
      });
      if (existing) {
        skipped++;
        continue;
      }

      await prisma.workingHoursPolicy.create({
        data: {
          name: policy.name,
          startWorkingHours: policy.startWorkingHours,
          endWorkingHours: policy.endWorkingHours,
          shortDayMins: policy.shortDayMins,
          startBreakTime: policy.startBreakTime,
          endBreakTime: policy.endBreakTime,
          halfDayStartTime: policy.halfDayStartTime,
          lateStartTime: policy.lateStartTime,
          lateDeductionType: policy.lateDeductionType,
          applyDeductionAfterLates: policy.applyDeductionAfterLates,
          lateDeductionPercent: policy.lateDeductionPercent,
          halfDayDeductionType: policy.halfDayDeductionType,
          applyDeductionAfterHalfDays: policy.applyDeductionAfterHalfDays,
          halfDayDeductionAmount: policy.halfDayDeductionAmount,
          shortDayDeductionType: policy.shortDayDeductionType,
          applyDeductionAfterShortDays: policy.applyDeductionAfterShortDays,
          shortDayDeductionAmount: policy.shortDayDeductionAmount,
          overtimeRate: policy.overtimeRate,
          gazzetedOvertimeRate: policy.gazzetedOvertimeRate,
          status: 'active',
          isDefault: policy.isDefault,
          createdById,
        },
      });
      created++;
    } catch (error: any) {
      console.error(
        `Error seeding working hours policy "${policy.name}":`,
        error.message,
      );
    }
  }
  console.log(
    `✓ Working Hours Policies: ${created} created, ${skipped} skipped`,
  );
  return { created, skipped };
}

export async function seedEquipments(
  prisma: PrismaClient,
  createdById: string,
) {
  console.log('🖥️  Seeding equipments...');
  const equipments = [
    'Laptop',
    'Desktop Computer',
    'Monitor',
    'Keyboard',
    'Mouse',
    'Headset',
    'Mobile Phone',
    'SIM Card',
    'Access Card',
    'Office Keys',
    'Tools',
    'Printer',
    'Scanner',
    'Tablet',
    'USB Drive',
  ];

  let created = 0;
  let skipped = 0;
  for (const name of equipments) {
    try {
      const existing = await prisma.equipment.findFirst({ where: { name } });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.equipment.create({
        data: {
          name,
          status: 'active',
          createdById,
        },
      });
      created++;
    } catch (error: any) {
      console.error(`Error seeding equipment "${name}":`, error.message);
    }
  }
  console.log(`✓ Equipments: ${created} created, ${skipped} skipped`);
  return { created, skipped };
}

export async function seedAllowanceHeads(
  prisma: PrismaClient,
  createdById: string,
) {
  console.log('💰 Seeding allowance heads...');
  const allowanceHeads = [
    'Basic Salary',
    'House Rent Allowance',
    'Transport Allowance',
    'Medical Allowance',
    'Food Allowance',
    'Fuel Allowance',
    'Communication Allowance',
    'Entertainment Allowance',
    'Special Allowance',
    'Overtime Allowance',
    'Performance Bonus',
    'Annual Bonus',
    'Project Allowance',
    'Travel Allowance',
    'Uniform Allowance',
    'Education Allowance',
    'Child Care Allowance',
    'Utility Allowance',
    'Conveyance Allowance',
    'City Compensatory Allowance',
  ];

  let created = 0;
  let skipped = 0;
  for (const name of allowanceHeads) {
    try {
      const existing = await prisma.allowanceHead.findFirst({
        where: { name },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.allowanceHead.create({
        data: {
          name,
          status: 'active',
          createdById,
        },
      });
      created++;
    } catch (error: any) {
      console.error(`Error seeding allowance head "${name}":`, error.message);
    }
  }
  console.log(`✓ Allowance Heads: ${created} created, ${skipped} skipped`);
  return { created, skipped };
}

export async function seedDeductionHeads(
  prisma: PrismaClient,
  createdById: string,
) {
  console.log('📉 Seeding deduction heads...');
  const deductionHeads = [
    'Income Tax',
    'Provident Fund',
    'EOBI',
    'Social Security',
    'Late Coming Deduction',
    'Absent Deduction',
    'Half Day Deduction',
    'Short Day Deduction',
    'Leave Without Pay (LWP)',
    'Advance Salary Deduction',
    'Loan Deduction',
    'Insurance Deduction',
    'Penalty',
    'Fine',
    'Overpayment Recovery',
    'Equipment Damage',
    'Uniform Deduction',
    'Training Cost Recovery',
    'Notice Period Deduction',
    'Other Deductions',
  ];

  let created = 0;
  let skipped = 0;
  for (const name of deductionHeads) {
    try {
      const existing = await prisma.deductionHead.findFirst({
        where: { name },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.deductionHead.create({
        data: {
          name,
          status: 'active',
          createdById,
        },
      });
      created++;
    } catch (error: any) {
      console.error(`Error seeding deduction head "${name}":`, error.message);
    }
  }
  console.log(`✓ Deduction Heads: ${created} created, ${skipped} skipped`);
  return { created, skipped };
}

export async function seedBonusTypes(
  prisma: PrismaClient,
  createdById: string,
) {
  console.log('🎁 Seeding bonus types...');
  const bonusTypes = [
    { name: 'Annual Bonus', calculationType: 'Percentage', percentage: 10 },
    { name: 'Performance Bonus', calculationType: 'Percentage', percentage: 5 },
    { name: 'Eid Bonus', calculationType: 'Amount', amount: 5000 },
    { name: 'Year End Bonus', calculationType: 'Percentage', percentage: 15 },
    {
      name: 'Project Completion Bonus',
      calculationType: 'Amount',
      amount: 10000,
    },
    { name: 'Sales Incentive', calculationType: 'Percentage', percentage: 8 },
    { name: 'Retention Bonus', calculationType: 'Amount', amount: 20000 },
    { name: 'Referral Bonus', calculationType: 'Amount', amount: 5000 },
    { name: 'Attendance Bonus', calculationType: 'Amount', amount: 2000 },
    {
      name: 'Special Achievement Bonus',
      calculationType: 'Amount',
      amount: 15000,
    },
  ];

  let created = 0;
  let skipped = 0;
  for (const bonusType of bonusTypes) {
    try {
      const existing = await prisma.bonusType.findFirst({
        where: { name: bonusType.name },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.bonusType.create({
        data: {
          name: bonusType.name,
          calculationType: bonusType.calculationType,
          amount: bonusType.amount ? bonusType.amount : null,
          percentage: bonusType.percentage ? bonusType.percentage : null,
          status: 'active',
          createdById,
        },
      });
      created++;
    } catch (error: any) {
      console.error(
        `Error seeding bonus type "${bonusType.name}":`,
        error.message,
      );
    }
  }
  console.log(`✓ Bonus Types: ${created} created, ${skipped} skipped`);
  return { created, skipped };
}

export async function seedBanks(
  prisma: PrismaClient,
  createdById: string,
) {
  console.log('🏦 Seeding banks...');
  const banks = [
    { name: 'Meezan Bank', code: 'MEZAN', accountNumberPrefix: 'MEZ' },
    { name: 'HBL (Habib Bank Limited)', code: 'HBL', accountNumberPrefix: 'HBL' },
    { name: 'Allied Bank Limited', code: 'ABL', accountNumberPrefix: 'ABL' },
    { name: 'Habib Metro Bank', code: 'HMB', accountNumberPrefix: 'HMB' },
    { name: 'MCB Bank', code: 'MCB', accountNumberPrefix: 'MCB' },
    { name: 'UBL (United Bank Limited)', code: 'UBL', accountNumberPrefix: 'UBL' },
    { name: 'Bank Alfalah', code: 'BAFL', accountNumberPrefix: 'BAFL' },
    { name: 'Standard Chartered Bank', code: 'SCB', accountNumberPrefix: 'SCB' },
    { name: 'Faysal Bank', code: 'FBL', accountNumberPrefix: 'FBL' },
    { name: 'Bank of Punjab', code: 'BOP', accountNumberPrefix: 'BOP' },
    { name: 'Askari Bank', code: 'AKBL', accountNumberPrefix: 'AKBL' },
    { name: 'JS Bank', code: 'JSBL', accountNumberPrefix: 'JSBL' },
    { name: 'Soneri Bank', code: 'SNBL', accountNumberPrefix: 'SNBL' },
    { name: 'Bank Islami', code: 'BIPL', accountNumberPrefix: 'BIPL' },
    { name: 'Al Baraka Bank', code: 'ABPL', accountNumberPrefix: 'ABPL' },
  ];

  let created = 0;
  let skipped = 0;
  for (const bank of banks) {
    try {
      const existing = await prisma.bank.findFirst({
        where: { name: bank.name },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.bank.create({
        data: {
          name: bank.name,
          code: bank.code,
          accountNumberPrefix: bank.accountNumberPrefix,
          status: 'active',
          createdById,
        },
      });
      created++;
    } catch (error: any) {
      console.error(
        `Error seeding bank "${bank.name}":`,
        error.message,
      );
    }
  }
  console.log(`✓ Banks: ${created} created, ${skipped} skipped`);
  return { created, skipped };
}

export async function seedSalaryBreakups(
  prisma: PrismaClient,
  createdById: string,
) {
  console.log('💵 Seeding salary breakups...');
  const salaryBreakups = [
    { name: 'Basic Salary', details: 'Base salary component',percentage: 50 },
    { name: 'Gross Salary', details: 'Total salary before deductions',percentage: 10 },
    { name: 'Net Salary', details: 'Salary after all deductions',percentage: 10 },
    { name: 'Cost to Company (CTC)', details: 'Total cost of employment',percentage: 10 },
    { name: 'Take Home Salary', details: 'Net amount received by employee',percentage: 10 },
  ];

  let created = 0;
  let skipped = 0;
  for (const breakup of salaryBreakups) {
    try {
      const existing = await prisma.salaryBreakup.findFirst({
        where: { name: breakup.name },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.salaryBreakup.create({
        data: {
          name: breakup.name,
          details: breakup.details,
          status: 'active',
          createdById,
          percentage: breakup.percentage,
        },
      });
      created++;
    } catch (error: any) {
      console.error(
        `Error seeding salary breakup "${breakup.name}":`,
        error.message,
      );
    }
  }
  console.log(`✓ Salary Breakups: ${created} created, ${skipped} skipped`);
  return { created, skipped };
}

export async function seedProvidentFunds(
  prisma: PrismaClient,
  createdById: string,
) {
  console.log('🏦 Seeding provident funds...');
  const providentFunds = [
    { name: 'Employee Provident Fund (EPF)', percentage: 8 },
    { name: 'Employer Provident Fund', percentage: 8 },
    { name: 'Voluntary Provident Fund (VPF)', percentage: 10 },
    { name: 'Company Provident Fund', percentage: 5 },
  ];

  let created = 0;
  let skipped = 0;
  for (const pf of providentFunds) {
    try {
      const existing = await prisma.providentFund.findFirst({
        where: { name: pf.name },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.providentFund.create({
        data: {
          name: pf.name,
          percentage: pf.percentage,
          status: 'active',
          createdById,
        },
      });
      created++;
    } catch (error: any) {
      console.error(
        `Error seeding provident fund "${pf.name}":`,
        error.message,
      );
    }
  }
  console.log(`✓ Provident Funds: ${created} created, ${skipped} skipped`);
  return { created, skipped };
}

export async function seedLoanTypes(prisma: PrismaClient, createdById: string) {
  console.log('💳 Seeding loan types...');
  const loanTypes = [
    'Personal Loan',
    'Emergency Loan',
    'Medical Loan',
    'Education Loan',
    'Housing Loan',
    'Vehicle Loan',
    'Advance Salary',
    'Festival Loan',
    'Marriage Loan',
    'Home Renovation Loan',
  ];

  let created = 0;
  let skipped = 0;
  for (const name of loanTypes) {
    try {
      const existing = await prisma.loanType.findFirst({ where: { name } });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.loanType.create({
        data: {
          name,
          status: 'active',
          createdById,
        },
      });
      created++;
    } catch (error: any) {
      console.error(`Error seeding loan type "${name}":`, error.message);
    }
  }
  console.log(`✓ Loan Types: ${created} created, ${skipped} skipped`);
  return { created, skipped };
}

export async function seedTaxSlabs(prisma: PrismaClient, createdById: string) {
  console.log('📊 Seeding tax slabs...');
  // Pakistan Income Tax Slabs for FY 2024-2025
  const taxSlabs = [
    {
      name: 'Where taxable income does not exceed Rs. 600,000/-',
      minAmount: 0,
      maxAmount: 600000,
      rate: 0,
    },
    {
      name: 'Where taxable income exceeds Rs. 600,000/- but does not exceed Rs. 1,200,000/-',
      minAmount: 600000,
      maxAmount: 1200000,
      rate: 1, // 1% of the amount exceeding Rs. 600,000/-
    },
    {
      name: 'Where taxable income exceeds Rs. 1,200,000/- but does not exceed Rs. 2,200,000/-',
      minAmount: 1200000,
      maxAmount: 2200000,
      rate: 11, // Rs. 6,000/- + 11% of the amount exceeding Rs. 1,200,000/-
    },
    {
      name: 'Where taxable income exceeds Rs. 2,200,000/- but does not exceed Rs. 3,200,000/-',
      minAmount: 2200000,
      maxAmount: 3200000,
      rate: 23, // Rs. 116,000/- + 23% of the amount exceeding Rs. 2,200,000/-
    },
    {
      name: 'Where taxable income exceeds Rs. 3,200,000/- but does not exceed Rs. 4,100,000/-',
      minAmount: 3200000,
      maxAmount: 4100000,
      rate: 30, // Rs. 346,000/- + 30% of the amount exceeding Rs. 3,200,000/-
    },
    {
      name: 'Where taxable income exceeds Rs. 4,100,000/-',
      minAmount: 4100000,
      maxAmount: 999999999, // Very large number for the last slab
      rate: 35, // Rs. 616,000/- + 35% of the amount exceeding Rs. 4,100,000/-
    },
  ];

  let created = 0;
  let skipped = 0;
  for (const slab of taxSlabs) {
    try {
      const existing = await prisma.taxSlab.findFirst({
        where: {
          name: slab.name,
          minAmount: slab.minAmount,
          maxAmount: slab.maxAmount,
        },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.taxSlab.create({
        data: {
          name: slab.name,
          minAmount: slab.minAmount,
          maxAmount: slab.maxAmount,
          rate: slab.rate,
          status: 'active',
          createdById,
        },
      });
      created++;
    } catch (error: any) {
      console.error(`Error seeding tax slab "${slab.name}":`, error.message);
    }
  }
  console.log(`✓ Tax Slabs: ${created} created, ${skipped} skipped`);
  return { created, skipped };
}

export async function seedEmployees(prisma: PrismaClient, adminUserId: string) {
  console.log('👥 Seeding employees...');

  // Get required master data
  const departments = await prisma.department.findMany({
    include: { subDepartments: true },
  });
  const designations = await prisma.designation.findMany();
  const employeeGrades = await prisma.employeeGrade.findMany();
  const employeeStatuses = await prisma.employeeStatus.findMany();
  const maritalStatuses = await prisma.maritalStatus.findMany();
  const branches = await prisma.branch.findMany();
  const workingHoursPolicies = await prisma.workingHoursPolicy.findMany();
  const leavesPolicies = await prisma.leavesPolicy.findMany();
  const equipments = await prisma.equipment.findMany();
  const pakistan = await prisma.country.findFirst({ where: { iso: 'PK' } });

  // Map equipment names to IDs
  const equipmentMap = new Map(
    equipments.map((eq) => [eq.name.toLowerCase(), eq.id]),
  );
  const getEquipmentId = (name: string) => equipmentMap.get(name.toLowerCase());

  // Get states and cities
  const punjab = pakistan
    ? await prisma.state.findFirst({
        where: { name: 'Punjab', countryId: pakistan.id },
      })
    : null;
  const sindh = pakistan
    ? await prisma.state.findFirst({
        where: { name: 'Sindh', countryId: pakistan.id },
      })
    : null;
  const lahoreCity = punjab
    ? await prisma.city.findFirst({
        where: { name: 'Lahore', stateId: punjab.id },
      })
    : null;
  const karachiCity = sindh
    ? await prisma.city.findFirst({
        where: { name: 'Karachi', stateId: sindh.id },
      })
    : null;
  const islamabadCity = punjab
    ? await prisma.city.findFirst({
        where: { name: 'Islamabad', stateId: punjab.id },
      })
    : null;

  // Get first city from state if specific city not found
  const punjabFirstCity = punjab
    ? await prisma.city.findFirst({ where: { stateId: punjab.id } })
    : null;
  const sindhFirstCity = sindh
    ? await prisma.city.findFirst({ where: { stateId: sindh.id } })
    : null;

  if (
    !departments.length ||
    !designations.length ||
    !employeeGrades.length ||
    !pakistan ||
    !punjab ||
    !sindh
  ) {
    console.warn(
      '⚠️  Required master data not found, skipping employee seeding',
    );
    if (!punjab) console.warn('   Missing: Punjab state');
    if (!sindh) console.warn('   Missing: Sindh state');
    return { created: 0, skipped: 0 };
  }

  if (
    !branches.length ||
    !workingHoursPolicies.length ||
    !leavesPolicies.length
  ) {
    console.warn(
      '⚠️  Required master data not found, skipping employee seeding',
    );
    if (!branches.length) console.warn('   Missing: Branches');
    if (!workingHoursPolicies.length)
      console.warn('   Missing: Working Hours Policies');
    if (!leavesPolicies.length) console.warn('   Missing: Leaves Policies');
    return { created: 0, skipped: 0 };
  }

  // Ensure we have at least one city in each state
  if (!punjabFirstCity || !sindhFirstCity) {
    console.warn('⚠️  Required cities not found, skipping employee seeding');
    if (!punjabFirstCity) console.warn('   Missing: Cities in Punjab state');
    if (!sindhFirstCity) console.warn('   Missing: Cities in Sindh state');
    return { created: 0, skipped: 0 };
  }

  const defaultDeptId = departments[0].id;
  const defaultSubDeptId = departments[0].subDepartments?.[0]?.id || null;
  const defaultDesignationId = (
    designations.find((d) => d.name.includes('Manager')) || designations[0]
  ).id;
  const defaultGradeId = (
    employeeGrades.find((g) => g.grade === 'Grade 5') || employeeGrades[0]
  ).id;
  const defaultStatusId = (
    employeeStatuses.find((s) => s.status === 'Active') || employeeStatuses[0]
  ).id;
  const defaultMaritalStatusId = maritalStatuses[0].id;
  const defaultBranchId = branches[0].id;
  const defaultWorkingHoursId = (
    workingHoursPolicies.find((p) => p.isDefault) || workingHoursPolicies[0]
  ).id;
  const defaultLeavesPolicyId = (
    leavesPolicies.find((p) => p.isDefault) || leavesPolicies[0]
  ).id;

  const employees = [
    {
      employeeId: 'EMP001',
      employeeName: 'Ahmed Ali',
      fatherHusbandName: 'Muhammad Ali',
      departmentId: defaultDeptId,
      subDepartmentId: defaultSubDeptId,
      designationId: defaultDesignationId,
      employeeGradeId: defaultGradeId,
      attendanceId: 'ATT001',
      maritalStatusId: defaultMaritalStatusId,
      employmentStatusId: defaultStatusId,
      cnicNumber: '35202-1234567-1',
      joiningDate: new Date('2023-01-15'),
      dateOfBirth: new Date('1990-05-20'),
      nationality: 'Pakistani',
      gender: 'Male',
      contactNumber: '0300-1234567',
      emergencyContactNumber: '0300-7654321',
      emergencyContactPerson: 'Fatima Ali',
      personalEmail: 'ahmed.ali@email.com',
      officialEmail: 'ahmed.ali@speedlimit.com',
      countryId: pakistan.id,
      stateId: punjab.id,
      cityId: lahoreCity?.id || punjabFirstCity.id,
      employeeSalary: 50000,
      reportingManager: 'Admin',
      workingHoursPolicyId: defaultWorkingHoursId,
      branchId: defaultBranchId,
      leavesPolicyId: defaultLeavesPolicyId,
      currentAddress: '123 Main Street, Model Town, Lahore',
      permanentAddress: '123 Main Street, Model Town, Lahore',
      bankName: 'Allied Bank',
      accountNumber: '1234567890123',
      accountTitle: 'Ahmed Ali',
      equipmentIds: [
        getEquipmentId('Laptop'),
        getEquipmentId('Access Card'),
        getEquipmentId('SIM Card'),
      ].filter(Boolean) as string[],
    },
    {
      employeeId: 'EMP002',
      employeeName: 'Fatima Khan',
      fatherHusbandName: 'Hassan Khan',
      departmentId: defaultDeptId,
      subDepartmentId: defaultSubDeptId,
      designationId: (
        designations.find((d) => d.name.includes('Developer')) ||
        designations[0]
      ).id,
      employeeGradeId: (
        employeeGrades.find((g) => g.grade === 'Grade 4') || employeeGrades[0]
      ).id,
      attendanceId: 'ATT002',
      maritalStatusId: defaultMaritalStatusId,
      employmentStatusId: defaultStatusId,
      cnicNumber: '35202-2345678-2',
      joiningDate: new Date('2023-03-10'),
      dateOfBirth: new Date('1992-08-15'),
      nationality: 'Pakistani',
      gender: 'Female',
      contactNumber: '0300-2345678',
      emergencyContactNumber: '0300-8765432',
      emergencyContactPerson: 'Hassan Khan',
      personalEmail: 'fatima.khan@email.com',
      officialEmail: 'fatima.khan@speedlimit.com',
      countryId: pakistan.id,
      stateId: sindh.id,
      cityId: karachiCity?.id || sindhFirstCity.id,
      employeeSalary: 45000,
      reportingManager: 'Ahmed Ali',
      workingHoursPolicyId: defaultWorkingHoursId,
      branchId: defaultBranchId,
      leavesPolicyId: defaultLeavesPolicyId,
      currentAddress: '456 Commercial Area, Clifton, Karachi',
      permanentAddress: '789 Residential Block, Gulshan-e-Iqbal, Karachi',
      bankName: 'Meezan Bank',
      accountNumber: '2345678901234',
      accountTitle: 'Fatima Khan',
      equipmentIds: [
        getEquipmentId('Laptop'),
        getEquipmentId('Access Card'),
      ].filter(Boolean) as string[],
    },
    {
      employeeId: 'EMP003',
      employeeName: 'Hassan Raza',
      fatherHusbandName: 'Raza Ahmed',
      departmentId: (
        departments.find((d) => d.name.includes('IT')) || departments[0]
      ).id,
      subDepartmentId:
        (departments.find((d) => d.name.includes('IT')) || departments[0])
          .subDepartments?.[0]?.id || null,
      designationId: (
        designations.find((d) => d.name.includes('Senior')) || designations[0]
      ).id,
      employeeGradeId: (
        employeeGrades.find((g) => g.grade === 'Grade 6') || employeeGrades[0]
      ).id,
      attendanceId: 'ATT003',
      maritalStatusId: defaultMaritalStatusId,
      employmentStatusId: defaultStatusId,
      cnicNumber: '35202-3456789-3',
      joiningDate: new Date('2022-11-20'),
      dateOfBirth: new Date('1988-12-10'),
      nationality: 'Pakistani',
      gender: 'Male',
      contactNumber: '0300-3456789',
      emergencyContactNumber: '0300-9876543',
      emergencyContactPerson: 'Sara Raza',
      personalEmail: 'hassan.raza@email.com',
      officialEmail: 'hassan.raza@speedlimit.com',
      countryId: pakistan.id,
      stateId: punjab.id,
      cityId: islamabadCity?.id || punjabFirstCity.id,
      employeeSalary: 60000,
      reportingManager: 'Admin',
      workingHoursPolicyId: defaultWorkingHoursId,
      branchId: branches[1]?.id || defaultBranchId,
      leavesPolicyId: defaultLeavesPolicyId,
      currentAddress: '321 Sector F-7, Islamabad',
      permanentAddress: '321 Sector F-7, Islamabad',
      bankName: 'HBL',
      accountNumber: '3456789012345',
      accountTitle: 'Hassan Raza',
      equipmentIds: [
        getEquipmentId('Laptop'),
        getEquipmentId('Access Card'),
        getEquipmentId('SIM Card'),
        getEquipmentId('Office Keys'),
      ].filter(Boolean) as string[],
    },
    {
      employeeId: 'EMP004',
      employeeName: 'Sara Ahmed',
      fatherHusbandName: 'Ahmed Khan',
      departmentId: (
        departments.find((d) => d.name.includes('HR')) || departments[0]
      ).id,
      subDepartmentId:
        (departments.find((d) => d.name.includes('HR')) || departments[0])
          .subDepartments?.[0]?.id || null,
      designationId: (
        designations.find((d) => d.name.includes('HR')) || designations[0]
      ).id,
      employeeGradeId: (
        employeeGrades.find((g) => g.grade === 'Grade 5') || employeeGrades[0]
      ).id,
      attendanceId: 'ATT004',
      maritalStatusId: (
        maritalStatuses.find((m) => m.name === 'Married') || maritalStatuses[0]
      ).id,
      employmentStatusId: defaultStatusId,
      cnicNumber: '35202-4567890-4',
      joiningDate: new Date('2023-06-01'),
      dateOfBirth: new Date('1991-03-25'),
      nationality: 'Pakistani',
      gender: 'Female',
      contactNumber: '0300-4567890',
      emergencyContactNumber: '0300-0987654',
      emergencyContactPerson: 'Ahmed Khan',
      personalEmail: 'sara.ahmed@email.com',
      officialEmail: 'sara.ahmed@speedlimit.com',
      countryId: pakistan.id,
      stateId: punjab.id,
      cityId: lahoreCity?.id || punjabFirstCity.id,
      employeeSalary: 48000,
      reportingManager: 'Admin',
      workingHoursPolicyId: defaultWorkingHoursId,
      branchId: defaultBranchId,
      leavesPolicyId: defaultLeavesPolicyId,
      currentAddress: '654 Garden Town, Lahore',
      permanentAddress: '654 Garden Town, Lahore',
      bankName: 'UBL',
      accountNumber: '4567890123456',
      accountTitle: 'Sara Ahmed',
      equipmentIds: [
        getEquipmentId('Laptop'),
        getEquipmentId('Access Card'),
      ].filter(Boolean) as string[],
    },
    {
      employeeId: 'EMP005',
      employeeName: 'Muhammad Usman',
      fatherHusbandName: 'Usman Ali',
      departmentId: (
        departments.find((d) => d.name.includes('Finance')) || departments[0]
      ).id,
      subDepartmentId:
        (departments.find((d) => d.name.includes('Finance')) || departments[0])
          .subDepartments?.[0]?.id || null,
      designationId: (
        designations.find((d) => d.name.includes('Accountant')) ||
        designations[0]
      ).id,
      employeeGradeId: (
        employeeGrades.find((g) => g.grade === 'Grade 4') || employeeGrades[0]
      ).id,
      attendanceId: 'ATT005',
      maritalStatusId: defaultMaritalStatusId,
      employmentStatusId: defaultStatusId,
      cnicNumber: '35202-5678901-5',
      joiningDate: new Date('2023-09-15'),
      dateOfBirth: new Date('1993-07-30'),
      nationality: 'Pakistani',
      gender: 'Male',
      contactNumber: '0300-5678901',
      emergencyContactNumber: '0300-1098765',
      emergencyContactPerson: 'Ayesha Usman',
      personalEmail: 'm.usman@email.com',
      officialEmail: 'm.usman@speedlimit.com',
      countryId: pakistan.id,
      stateId: sindh.id,
      cityId: karachiCity?.id || sindhFirstCity.id,
      employeeSalary: 42000,
      reportingManager: 'Admin',
      workingHoursPolicyId: defaultWorkingHoursId,
      branchId: branches[1]?.id || defaultBranchId,
      leavesPolicyId: defaultLeavesPolicyId,
      currentAddress: '987 PECHS Block 6, Karachi',
      permanentAddress: '987 PECHS Block 6, Karachi',
      bankName: 'MCB Bank',
      accountNumber: '5678901234567',
      accountTitle: 'Muhammad Usman',
      equipmentIds: [
        getEquipmentId('Laptop'),
        getEquipmentId('Access Card'),
        getEquipmentId('Tools'),
      ].filter(Boolean) as string[],
    },
  ];

  let created = 0;
  let skipped = 0;

  for (const emp of employees) {
    try {
      // Validate required fields
      if (
        !emp.stateId ||
        !emp.cityId ||
        !emp.workingHoursPolicyId ||
        !emp.branchId ||
        !emp.leavesPolicyId
      ) {
        console.error(
          `Error seeding employee "${emp.employeeName}": Missing required fields`,
          {
            stateId: emp.stateId,
            cityId: emp.cityId,
            workingHoursPolicyId: emp.workingHoursPolicyId,
            branchId: emp.branchId,
            leavesPolicyId: emp.leavesPolicyId,
          },
        );
        continue;
      }

      const existing = await prisma.employee.findFirst({
        where: {
          OR: [
            { employeeId: emp.employeeId },
            { officialEmail: emp.officialEmail },
            { cnicNumber: emp.cnicNumber },
          ],
        },
      });
      if (existing) {
        skipped++;
        continue;
      }

      await prisma.employee.create({
        data: {
          employeeId: emp.employeeId,
          employeeName: emp.employeeName,
          fatherHusbandName: emp.fatherHusbandName,
          departmentId: emp.departmentId,
          employeeGradeId: emp.employeeGradeId,
          attendanceId: emp.attendanceId,
          designationId: emp.designationId,
          maritalStatusId: emp.maritalStatusId,
          employmentStatusId: emp.employmentStatusId,
          cnicNumber: emp.cnicNumber,
          joiningDate: emp.joiningDate,
          dateOfBirth: emp.dateOfBirth,
          nationality: emp.nationality,
          gender: emp.gender,
          contactNumber: emp.contactNumber,
          emergencyContactNumber: emp.emergencyContactNumber,
          emergencyContactPerson: emp.emergencyContactPerson,
          personalEmail: emp.personalEmail,
          officialEmail: emp.officialEmail,
          countryId: emp.countryId,
          stateId: emp.stateId,
          cityId: emp.cityId,
          employeeSalary: emp.employeeSalary,
          reportingManager: emp.reportingManager,
          workingHoursPolicyId: emp.workingHoursPolicyId,
          branchId: emp.branchId,
          leavesPolicyId: emp.leavesPolicyId,
          currentAddress: emp.currentAddress,
          permanentAddress: emp.permanentAddress,
          subDepartmentId: emp.subDepartmentId,
          bankName: emp.bankName,
          accountNumber: emp.accountNumber,
          accountTitle: emp.accountTitle,
          status: 'active',
          equipmentAssignments:
            emp.equipmentIds && emp.equipmentIds.length > 0
              ? {
                  create: emp.equipmentIds.map((equipmentId: string) => ({
                    equipmentId,
                    assignedById: adminUserId,
                    status: 'assigned',
                  })),
                }
              : undefined,
        },
      });
      created++;
    } catch (error: any) {
      console.error(
        `Error seeding employee "${emp.employeeName}":`,
        error.message,
      );
    }
  }
  console.log(`✓ Employees: ${created} created, ${skipped} skipped`);
  return { created, skipped };
}
