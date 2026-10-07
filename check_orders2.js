const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const orders = await prisma.salesOrder.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
    select: { orderNumber: true }
  });
  console.log("Latest orders:", orders);

  // Check how many orders exist
  const count = await prisma.salesOrder.count();
  console.log("Total orders:", count);

  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
