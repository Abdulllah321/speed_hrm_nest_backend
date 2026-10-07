const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const items = await prisma.item.findMany({
    where: { sku: { contains: 'IF7374', mode: 'insensitive' } },
    take: 10
  });
  console.log('Items found for IF7374:', items);

  const barcodeItems = await prisma.item.findMany({
    where: { sku: { contains: 'CK1-60580328', mode: 'insensitive' } },
    take: 10
  });
  console.log('Items found for CK1-60580328:', barcodeItems);
}
main().finally(() => prisma.$disconnect());
