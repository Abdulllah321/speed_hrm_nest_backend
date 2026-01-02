
// require('dotenv').config({ path: 'f:\\HRM\\speed_hrm_nest_backend\\.env' });
// import { PrismaClient } from '@prisma/client';

// const prisma = new PrismaClient();

// async function main() {
//     console.log('--- Checking Tax Slabs ---');
//     const taxSlabs = await prisma.taxSlab.findMany({
//         orderBy: { minAmount: 'asc' },
//     });

//     if (taxSlabs.length === 0) {
//         console.log('NO TAX SLABS FOUND!');
//     } else {
//         console.table(taxSlabs.map(slab => ({
//             min: slab.minAmount,
//             max: slab.maxAmount,
//             rate: slab.rate,
//             status: slab.status
//         })));
//     }

//     console.log('\n--- Checking Salary Breakups (Taxability) ---');
//     const salaryBreakups = await prisma.salaryBreakup.findMany();
//     if (salaryBreakups.length === 0) {
//         console.log('NO SALARY BREAKUPS FOUND!');
//     } else {
//         // Parse details to verify isTaxable flag
//         const parsed = salaryBreakups.map(sb => {
//             let isTaxable = false;
//             try {
//                 if (sb.details) {
//                     const details = typeof sb.details === 'string' ? JSON.parse(sb.details) : sb.details;
//                     if (Array.isArray(details) && details.length > 0) {
//                         // logic as per service
//                         const matchingEntry = details.find((entry: any) => entry.typeName === sb.name);
//                         if (matchingEntry && matchingEntry.isTaxable) {
//                             isTaxable = true;
//                         }
//                     } else if (typeof details === 'object' && details.isTaxable) {
//                         isTaxable = details.isTaxable === true;
//                     }
//                 }
//             } catch (e) { isTaxable = false; }

//             return {
//                 id: sb.id,
//                 name: sb.name,
//                 percentage: sb.percentage,
//                 isTaxable,
//                 rawDetails: typeof sb.details === 'string' ? sb.details.substring(0, 50) + '...' : JSON.stringify(sb.details).substring(0, 50) + '...'
//             };
//         });
//         console.table(parsed);
//     }

//     console.log('\n--- Checking Active Employees Salary Details ---');
//     // Fetch one employee to check their salary
//     const employee = await prisma.employee.findFirst({
//         include: {
//             workingHoursPolicy: true
//         }
//     });

//     if (employee) {
//         console.log(`Employee: ${employee.employeeName} (${employee.employeeId})`);
//         console.log(`Base Salary: ${employee.employeeSalary}`);
//     } else {
//         console.log("No employees found.");
//     }
// }

// main()
//     .catch((e) => {
//         console.error(e);
//         process.exit(1);
//     })
//     .finally(async () => {
//         await prisma.$disconnect();
//     });
