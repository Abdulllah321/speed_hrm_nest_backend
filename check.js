const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const count = await prisma.posReturn.count();
  console.log('Total PosReturn count:', count);
}
run().catch(console.error).finally(() => prisma.$disconnect());
