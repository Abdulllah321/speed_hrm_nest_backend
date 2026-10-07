const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const wh = await prisma.warehouse.findFirst({
    where: { name: { contains: 'LOGISTIC' } }
  });
  console.log('Warehouse:', wh);

  if (wh) {
    const items = await prisma.inventoryItem.findMany({
      where: { warehouseId: wh.id },
      take: 5
    });
    console.log('Inventory by warehouseId:', items);
    
    const locs = await prisma.location.findMany({
      where: { OR: [ { warehouseId: wh.id }, { name: { contains: 'LOGISTIC' } } ] }
    });
    console.log('Locations:', locs);
    
    if (locs.length > 0) {
      const locItems = await prisma.inventoryItem.findMany({
        where: { locationId: { in: locs.map(l => l.id) } },
        take: 5
      });
      console.log('Inventory by locationId:', locItems);
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
