const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkStock() {
  const warehouseCode = 'C40001';
  const barcode = '4067984174390';
  
  const wh = await prisma.warehouse.findFirst({
    where: { code: warehouseCode }
  });
  
  const locs = await prisma.location.findMany({
    where: { OR: [{ warehouseId: wh.id }, { id: wh.id }, { code: wh.code }, { code: `WH-${wh.code}` }] }
  });
  const locIds = locs.map(l => l.id);

  const items = await prisma.item.findMany({
    where: { OR: [{ barCode: barcode }, { sku: barcode }] }
  });
  
  console.log('Items found:', items.map(i => ({ id: i.id, sku: i.sku, barcode: i.barCode })));

  for (const item of items) {
    const stockAgg = await prisma.stockLedger.aggregate({
      where: {
        itemId: item.id,
        OR: [
          { warehouseId: wh.id },
          ...(locIds.length > 0 ? [{ locationId: { in: locIds } }] : [])
        ]
      },
      _sum: { qty: true }
    });
    console.log(`StockLedger _sum.qty for ${item.id}:`, stockAgg._sum.qty);

    const inv = await prisma.inventoryItem.aggregate({
      where: {
        itemId: item.id,
        status: 'AVAILABLE',
        OR: [
          { warehouseId: wh.id },
          ...(locIds.length > 0 ? [{ locationId: { in: locIds } }] : [])
        ]
      },
      _sum: { quantity: true }
    });
    console.log(`InventoryItem _sum.quantity for ${item.id}:`, inv._sum.quantity);
  }
}

checkStock().catch(console.error).finally(() => prisma.$disconnect());
