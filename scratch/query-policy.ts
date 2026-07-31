import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const policies = await prisma.workingHoursPolicy.findMany();
    console.log('--- Working Hours Policies ---');
    console.log(JSON.stringify(policies, null, 2));
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
