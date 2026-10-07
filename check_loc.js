const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const loc = await prisma.location.findUnique({
    where: { id: "d9a7a02d-7aab-4c3b-86a2-79698b4be074" },
    select: { fbrBposId: true, fbrBearerToken: true, name: true }
  });
  console.log("Location from speed-limit DB:", loc);
}
main().finally(() => prisma.$disconnect());
