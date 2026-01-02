// import { PrismaClient } from '@prisma/client';
// import { PrismaPg } from '@prisma/adapter-pg';
// import { Pool } from 'pg';
// import { seedAllocations, seedDepartments, seedSubDepartments } from './prisma/seeds/master-data.js';

// const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// const adapter = new PrismaPg(pool);
// const prisma = new PrismaClient({ adapter });

// async function main() {
//     try {
//         await seedAllocations(prisma);
//         await seedDepartments(prisma);
//         await seedSubDepartments(prisma);
//         console.log('Test seed completed successfully');
//     } catch (error) {
//         console.error('Test seed failed:', error);
//     } finally {
//         await prisma.$disconnect();
//     }
// }

// main();
