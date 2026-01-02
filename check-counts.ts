// import { PrismaClient } from '@prisma/client';
// import { PrismaPg } from '@prisma/adapter-pg';
// import { Pool } from 'pg';

// const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// const adapter = new PrismaPg(pool);
// const prisma = new PrismaClient({ adapter });

// async function main() {
//     try {
//         const employeeCount = await prisma.employee.count();
//         const deptCount = await prisma.department.count();
//         const subDeptCount = await prisma.subDepartment.count();
//         const allocationCount = await prisma.allocation.count();

//         console.log(`Employees: ${employeeCount}`);
//         console.log(`Departments: ${deptCount}`);
//         console.log(`SubDepartments: ${subDeptCount}`);
//         console.log(`Allocations: ${allocationCount}`);
//     } catch (error) {
//         console.error('Check failed:', error);
//     } finally {
//         await prisma.$disconnect();
//     }
// }

// main();
