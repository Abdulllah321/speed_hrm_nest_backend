const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Checking alliance orders...');
  const count = await prisma.salesOrder.count({
    where: {
      OR: [
        { allianceId: { not: null } },
        { manualDiscountNote: { contains: '[Manual Alliance]', mode: 'insensitive' } }
      ]
    }
  });
  console.log(`Total Alliance Orders in DB: ${count}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
