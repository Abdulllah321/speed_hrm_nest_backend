const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.salesOrder.count({
    where: {
      OR: [
        { allianceId: { not: null } },
        { manualDiscountNote: { contains: '[Manual Alliance]', mode: 'insensitive' } }
      ]
    }
  });
  console.log(`Total Alliance Orders across all locations: ${count}`);
  
  if (count > 0) {
    const sample = await prisma.salesOrder.findFirst({
      where: {
        OR: [
          { allianceId: { not: null } },
          { manualDiscountNote: { contains: '[Manual Alliance]', mode: 'insensitive' } }
        ]
      },
      include: { customer: true }
    });
    console.log(`Sample locationId: ${sample.locationId}`);
    console.log(`Sample createdAt: ${sample.createdAt}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
