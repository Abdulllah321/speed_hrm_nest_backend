import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  
  const startDate = new Date('2026-07-01T00:00:00.000Z');
  const endDate = new Date('2026-08-31T23:59:59.999Z');

  const returns = await prisma.posReturn.count({
    where: {
      createdAt: { gte: startDate, lte: endDate }
    }
  });

  const returnItems = await prisma.posReturnItem.findMany({
    where: {
      posReturn: {
        createdAt: { gte: startDate, lte: endDate }
      }
    }
  });

  let totalQty = 0;
  for (const item of returnItems) {
    totalQty += Math.abs(Number(item.quantity || 1));
  }

  console.log('--- RESULTS FOR JUL 1 - AUG 31 ---');
  console.log('Total POS Return Docs: ' + returns);
  console.log('Total POS Return Items Qty: ' + totalQty);
}

main().catch(console.error).finally(() => process.exit(0));
