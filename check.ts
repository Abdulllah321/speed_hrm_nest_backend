import { PrismaClient } from '@prisma/client';
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
  console.log(`Total Alliance Orders: ${count}`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
