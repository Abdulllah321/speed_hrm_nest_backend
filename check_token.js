const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const loc = await prisma.location.findUnique({ where: { id: 'bf4aab95-5b0e-4724-9f78-b543cefb4a7c' } });
  console.log('Token in DB:', loc ? loc.fbrBearerToken : 'Location not found');
}
main().finally(() => prisma.$disconnect());
