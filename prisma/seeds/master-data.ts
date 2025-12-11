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
      if (existing) { skipped++; continue; }
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
  const departmentMap = new Map(departments.map(d => [d.name.toLowerCase(), d.id]));
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
      if (!departmentId) { console.warn(`⚠️  Department "${subDept.department}" not found, skipping sub-department "${subDept.name}"`); continue; }
      const existing = await prisma.subDepartment.findFirst({ where: { name: subDept.name, departmentId } });
      if (existing) { skipped++; continue; }
      await prisma.subDepartment.create({ data: { name: subDept.name, departmentId } });
      created++;
    } catch (error: any) {
      console.error(`Error seeding sub-department "${subDept.name}":`, error.message);
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
      if (existing) { skipped++; continue; }
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
  const jobTypes = ['Full Time', 'Part Time', 'Contract', 'Temporary', 'Internship', 'Freelance', 'Consultant', 'Volunteer'];
  let created = 0;
  let skipped = 0;
  for (const name of jobTypes) {
    try {
      const existing = await prisma.jobType.findFirst({ where: { name } });
      if (existing) { skipped++; continue; }
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
  const maritalStatuses = ['Single', 'Married', 'Divorced', 'Widowed', 'Separated'];
  let created = 0;
  let skipped = 0;
  for (const name of maritalStatuses) {
    try {
      const existing = await prisma.maritalStatus.findFirst({ where: { name } });
      if (existing) { skipped++; continue; }
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
  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;
  
  const createDate = (year: number, month: number, day: number): Date => {
    const date = new Date(year, month - 1, day);
    date.setHours(0, 0, 0, 0);
    return date;
  };

  const holidays = [
    { name: `New Year's Day ${currentYear}`, dateFrom: createDate(currentYear, 1, 1), dateTo: createDate(currentYear, 1, 1) },
    { name: `New Year's Day ${nextYear}`, dateFrom: createDate(nextYear, 1, 1), dateTo: createDate(nextYear, 1, 1) },
    { name: `Pakistan Day ${currentYear}`, dateFrom: createDate(currentYear, 3, 23), dateTo: createDate(currentYear, 3, 23) },
    { name: `Pakistan Day ${nextYear}`, dateFrom: createDate(nextYear, 3, 23), dateTo: createDate(nextYear, 3, 23) },
    { name: `Labour Day ${currentYear}`, dateFrom: createDate(currentYear, 5, 1), dateTo: createDate(currentYear, 5, 1) },
    { name: `Labour Day ${nextYear}`, dateFrom: createDate(nextYear, 5, 1), dateTo: createDate(nextYear, 5, 1) },
    { name: `Independence Day ${currentYear}`, dateFrom: createDate(currentYear, 8, 14), dateTo: createDate(currentYear, 8, 14) },
    { name: `Independence Day ${nextYear}`, dateFrom: createDate(nextYear, 8, 14), dateTo: createDate(nextYear, 8, 14) },
    { name: `Defence Day ${currentYear}`, dateFrom: createDate(currentYear, 9, 6), dateTo: createDate(currentYear, 9, 6) },
    { name: `Defence Day ${nextYear}`, dateFrom: createDate(nextYear, 9, 6), dateTo: createDate(nextYear, 9, 6) },
    { name: `Iqbal Day ${currentYear}`, dateFrom: createDate(currentYear, 11, 9), dateTo: createDate(currentYear, 11, 9) },
    { name: `Iqbal Day ${nextYear}`, dateFrom: createDate(nextYear, 11, 9), dateTo: createDate(nextYear, 11, 9) },
    { name: `Quaid-e-Azam Day ${currentYear}`, dateFrom: createDate(currentYear, 12, 25), dateTo: createDate(currentYear, 12, 25) },
    { name: `Quaid-e-Azam Day ${nextYear}`, dateFrom: createDate(nextYear, 12, 25), dateTo: createDate(nextYear, 12, 25) },
    { name: `Eid-ul-Fitr ${currentYear}`, dateFrom: createDate(currentYear, 4, 1), dateTo: createDate(currentYear, 4, 3) },
    { name: `Eid-ul-Fitr ${nextYear}`, dateFrom: createDate(nextYear, 3, 21), dateTo: createDate(nextYear, 3, 23) },
    { name: `Eid-ul-Adha ${currentYear}`, dateFrom: createDate(currentYear, 6, 7), dateTo: createDate(currentYear, 6, 9) },
    { name: `Eid-ul-Adha ${nextYear}`, dateFrom: createDate(nextYear, 5, 27), dateTo: createDate(nextYear, 5, 29) },
  ];

  let created = 0;
  let skipped = 0;
  for (const holiday of holidays) {
    try {
      const existing = await prisma.holiday.findFirst({ where: { name: holiday.name } });
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

