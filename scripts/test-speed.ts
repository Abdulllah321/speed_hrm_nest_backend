import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ datasources: { db: { url: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi?schema=public' } } });

async function run() {
  const t0 = Date.now();
  
  const endDate = new Date();
  
  // 1. Get snapshot
  const latestSnapshot = await prisma.monthlyStockSnapshot.findFirst({
      where: { date: { lte: endDate } },
      orderBy: { date: 'desc' },
      select: { date: true }
  });
  
  const snapshotDate = latestSnapshot?.date;
  const startDate = snapshotDate && snapshotDate < endDate ? snapshotDate : new Date('2026-07-01');
  const queryStartDate = snapshotDate;
  console.log(`Snapshot Date: ${snapshotDate} | Time: ${Date.now() - t0}ms`);
  
  const t1 = Date.now();
  const [inventoryItems, ledgerItems, snapshotResults] = await Promise.all([
      prisma.$queryRawUnsafe<any[]>(`SELECT "itemId", "locationId", "warehouseId" FROM "InventoryItem"`),
      prisma.$queryRawUnsafe<any[]>(`
        SELECT DISTINCT item_id as "itemId", location_id as "locationId", warehouse_id as "warehouseId" 
        FROM stock_ledgers WHERE created_at <= '${endDate.toISOString()}'
        ${queryStartDate ? `AND created_at >= '${queryStartDate.toISOString()}'` : ''}
      `),
      snapshotDate ? prisma.$queryRawUnsafe<any[]>(`
            SELECT item_id as "itemId", location_id as "locationId", warehouse_id as "warehouseId", closing_qty as "closingQty" 
            FROM monthly_stock_snapshots WHERE date = '${snapshotDate.toISOString()}'
          `) : []
  ]);
  console.log(`Raw Queries Done | Inv: ${inventoryItems.length}, Ledger: ${ledgerItems.length}, Snap: ${snapshotResults.length} | Time: ${Date.now() - t1}ms`);
  
  const t2 = Date.now();
  let uniqueItemIds = [...new Set([
        ...inventoryItems.map((i) => i.itemId),
        ...ledgerItems.map((l) => l.itemId),
        ...snapshotResults.map((s) => s.itemId),
  ])];
  console.log(`Unique Items: ${uniqueItemIds.length} | Time: ${Date.now() - t2}ms`);
  
  const t3 = Date.now();
  const BATCH_SIZE = 5000;
  const itemsMap = new Map<string, any>();
  for (let i = 0; i < uniqueItemIds.length; i += BATCH_SIZE) {
      const batchIds = uniqueItemIds.slice(i, i + BATCH_SIZE);
      const batchItems = await prisma.item.findMany({
        where: { id: { in: batchIds } },
        select: { id: true, name: true, code: true } // simple select
      });
      for (const item of batchItems) itemsMap.set(item.id, item);
  }
  console.log(`Fetched Items from DB | Time: ${Date.now() - t3}ms`);
  
  const t4 = Date.now();
  const [bf, op, le, tr, rs] = await Promise.all([
      snapshotDate ? Promise.resolve([]) : prisma.stockLedger.groupBy({
        by: ['itemId', 'locationId', 'warehouseId'],
        where: { createdAt: { lt: startDate } },
        _sum: { qty: true },
      }),
      prisma.stockLedger.groupBy({
        by: ['itemId', 'locationId', 'warehouseId'],
        where: { createdAt: { gte: startDate, lte: endDate }, referenceType: 'OPENING_BALANCE' },
        _sum: { qty: true },
      }),
      prisma.stockLedger.findMany({
        where: { createdAt: { gte: startDate, lte: endDate }, NOT: { referenceType: 'OPENING_BALANCE' } },
        select: { itemId: true, qty: true, locationId: true, warehouseId: true }
      }),
      prisma.transferRequestItem.findMany({ select: { itemId: true, quantity: true, transferRequest: { select: { toLocationId: true } } } }),
      prisma.stockReserve.groupBy({ by: ['itemId', 'warehouseId'], _sum: { quantity: true } })
  ]);
  console.log(`Second Queries Done | Time: ${Date.now() - t4}ms`);
  
  const t5 = Date.now();
  // Simulate mapping
  let count = 0;
  for (const item of itemsMap.values()) {
      for (let locId = 0; locId < 44; locId++) {
         count++;
      }
  }
  console.log(`Mapping Done | Count: ${count} | Time: ${Date.now() - t5}ms`);
  console.log(`Total Time: ${Date.now() - t0}ms`);
}

run().finally(() => prisma.$disconnect());
