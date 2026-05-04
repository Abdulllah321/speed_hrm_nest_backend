import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const holidays = await prisma.holiday.findMany({
    where: { status: 'active' },
  });
  console.log(JSON.stringify(holidays, null, 2));
  await prisma.$disconnect();
}

main();
