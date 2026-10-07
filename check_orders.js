const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const orders = await prisma.salesOrder.findMany({
    orderBy: { orderNumber: 'desc' },
    take: 10,
    select: { orderNumber: true }
  });
  console.log("Top 10 orderNumbers:", orders.map(o => o.orderNumber));
  
  // also check how many orders exist
  const count = await prisma.salesOrder.count();
  console.log("Total orders:", count);

  process.exit(0);
}
run();
