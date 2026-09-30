const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("Looking for duplicated items based on barcode...");

  // 1. Find barcodes that have duplicates
  const grouped = await prisma.item.groupBy({
    by: ['barCode'],
    having: {
      barCode: {
        _count: {
          gt: 1,
        },
      },
    },
    where: {
      barCode: {
        not: null,
      },
    },
  });

  console.log(`Found ${grouped.length} barcodes with duplicates.`);

  let totalDuplicatesFound = 0;
  let itemsToDelete = [];

  for (const group of grouped) {
    // 2. Fetch all items for this barcode
    const items = await prisma.item.findMany({
      where: { barCode: group.barCode },
    });
    
    // 3. Check if there is an original item and a duplicate starting with "STN Item ("
    const stnItems = items.filter(i => i.description && i.description.startsWith('STN Item ('));
    const originalItems = items.filter(i => !(i.description && i.description.startsWith('STN Item (')));

    if (stnItems.length > 0 && originalItems.length > 0) {
      totalDuplicatesFound += stnItems.length;
      itemsToDelete.push(...stnItems.map(i => i.id));
    }
  }

  console.log(`Found ${totalDuplicatesFound} 'STN Item (...)' duplicates that have an original counterpart.`);

  if (itemsToDelete.length > 0) {
    console.log(`First few IDs to delete: ${itemsToDelete.slice(0, 3).join(', ')}`);
    // Delete them
    const res = await prisma.item.deleteMany({
      where: {
        id: { in: itemsToDelete }
      }
    });
    console.log(`Deleted ${res.count} items.`);
  }

}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
