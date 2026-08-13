import { PrismaClient, MovementType, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const masterUrl = process.env.DATABASE_URL;
if (!masterUrl) {
  console.error('DATABASE_URL is not defined in .env');
  process.exit(1);
}

const urlObj = new URL(masterUrl);
const user = urlObj.username;
const password = urlObj.password;
const host = urlObj.hostname;
const port = urlObj.port || '5432';

const targetDbs = process.argv[2]
  ? [process.argv[2]]
  : ['tenant_speed_main_mox1gfsi'];

async function syncTenantDb(dbName: string) {
  const dbUrl = `postgresql://${user}:${password}@${host}:${port}/${dbName}?schema=public`;
  console.log(`\n======================================================`);
  console.log(
    `🚀 Starting Full Stock Ledger & Inventory Backfill for DB: ${dbName}`,
  );
  console.log(
    `Connecting to: postgresql://${user}:****@${host}:${port}/${dbName}`,
  );
  console.log(`======================================================\n`);

  const pool = new Pool({ connectionString: dbUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter: adapter as any });

  try {
    // 1. Resolve locations & warehouses
    const locations = await prisma.location.findMany({
      where: { isDeleted: false },
      select: { id: true, name: true, code: true, warehouseId: true },
    });

    const defaultWarehouse = await prisma.warehouse.findFirst({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });

    console.log(
      `Found ${locations.length} locations. Default warehouse: ${defaultWarehouse?.name || 'None'} (${defaultWarehouse?.id})`,
    );

    const locationWarehouseMap = new Map<string, string>();
    for (const loc of locations) {
      const whId = loc.warehouseId || defaultWarehouse?.id;
      if (whId) {
        locationWarehouseMap.set(loc.id, whId);
      }
    }

    // 2. Fetch all sales orders
    const allSalesOrders = await prisma.salesOrder.findMany({
      select: {
        id: true,
        orderNumber: true,
        locationId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        items: {
          select: {
            id: true,
            itemId: true,
            quantity: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    console.log(
      `Found ${allSalesOrders.length} SalesOrders in database "${dbName}".`,
    );
    if (allSalesOrders.length === 0) {
      console.log(`No sales orders found in "${dbName}", skipping...`);
      return;
    }

    // 3. Batch check existing StockLedger entries
    const existingLedgers = await prisma.stockLedger.findMany({
      where: {
        referenceType: {
          in: [
            'POS_SALE',
            'POS_RETURN',
            'POS_VOID',
            'OPENING_BALANCE',
            'BULK_STOCK_UPLOAD',
          ],
        },
      },
      select: {
        id: true,
        itemId: true,
        locationId: true,
        referenceType: true,
        referenceId: true,
        movementType: true,
      },
    });

    const existingSalesLedgerSet = new Set<string>(); // `${orderId}_${itemId}`
    const existingOpeningSet = new Set<string>(); // `${itemId}_${locationId}`
    const existingReturnSet = new Set<string>(); // `${orderId}_${itemId}`

    for (const entry of existingLedgers) {
      if (entry.referenceType === 'POS_SALE') {
        existingSalesLedgerSet.add(`${entry.referenceId}_${entry.itemId}`);
      } else if (
        entry.referenceType === 'OPENING_BALANCE' ||
        entry.referenceType === 'BULK_STOCK_UPLOAD'
      ) {
        if (entry.locationId) {
          existingOpeningSet.add(`${entry.itemId}_${entry.locationId}`);
        }
      } else if (
        entry.referenceType === 'POS_RETURN' ||
        entry.referenceType === 'POS_VOID'
      ) {
        existingReturnSet.add(`${entry.referenceId}_${entry.itemId}`);
      }
    }

    console.log(
      `Existing ledgers found: ${existingSalesLedgerSet.size} POS_SALE, ${existingOpeningSet.size} OPENING_BALANCE, ${existingReturnSet.size} POS_RETURN/VOID.`,
    );

    // 4. Calculate required OPENING_BALANCE per (itemId, locationId)
    const salesQtyMap = new Map<string, number>();
    const returnQtyMap = new Map<string, number>();
    const earliestDateMap = new Map<string, Date>();

    for (const order of allSalesOrders) {
      const locId = order.locationId;
      if (!locId) continue;

      for (const item of order.items) {
        const key = `${item.itemId}_${locId}`;

        const existingEarliest = earliestDateMap.get(key);
        if (!existingEarliest || order.createdAt < existingEarliest) {
          earliestDateMap.set(key, order.createdAt);
        }

        if (order.status === 'voided') {
          returnQtyMap.set(
            key,
            (returnQtyMap.get(key) || 0) + Number(item.quantity),
          );
        } else {
          salesQtyMap.set(
            key,
            (salesQtyMap.get(key) || 0) + Number(item.quantity),
          );
        }
      }
    }

    const allInventoryItems = await prisma.inventoryItem.findMany({
      select: {
        itemId: true,
        locationId: true,
        warehouseId: true,
        quantity: true,
      },
    });

    const inventoryQtyMap = new Map<string, number>();
    for (const inv of allInventoryItems) {
      if (inv.locationId) {
        const key = `${inv.itemId}_${inv.locationId}`;
        inventoryQtyMap.set(
          key,
          (inventoryQtyMap.get(key) || 0) + Number(inv.quantity),
        );
      }
    }

    const allItemLocKeys = new Set<string>([
      ...salesQtyMap.keys(),
      ...inventoryQtyMap.keys(),
    ]);

    // 4. OPENING_BALANCE generation disabled to prevent stock ledger date corruption
    let openingEntriesCreated = 0;

    // 5. Backfill Sales Orders (OUTBOUND POS_SALE)
    const salesLedgerBatch: any[] = [];

    for (const order of allSalesOrders) {
      if (order.status === 'voided') continue;
      const locId = order.locationId;
      if (!locId) continue;
      const whId = locationWarehouseMap.get(locId) || defaultWarehouse?.id;
      if (!whId) continue;

      for (const item of order.items) {
        const key = `${order.id}_${item.itemId}`;
        if (existingSalesLedgerSet.has(key)) continue;

        salesLedgerBatch.push({
          itemId: item.itemId,
          warehouseId: whId,
          locationId: locId,
          qty: new Prisma.Decimal(-item.quantity),
          movementType: MovementType.OUTBOUND,
          referenceType: 'POS_SALE',
          referenceId: order.id,
          createdAt: order.createdAt,
        });

        existingSalesLedgerSet.add(key);
      }
    }

    let salesLedgerEntriesCreated = 0;
    if (salesLedgerBatch.length > 0) {
      console.log(
        `Inserting ${salesLedgerBatch.length} POS_SALE OUTBOUND ledger entries...`,
      );
      const CHUNK = 1000;
      for (let i = 0; i < salesLedgerBatch.length; i += CHUNK) {
        const chunk = salesLedgerBatch.slice(i, i + CHUNK);
        await prisma.stockLedger.createMany({ data: chunk });
      }
      salesLedgerEntriesCreated = salesLedgerBatch.length;
    }

    // 6. Backfill Voided / Returned Orders (INBOUND POS_VOID)
    const returnLedgerBatch: any[] = [];

    for (const order of allSalesOrders) {
      if (order.status !== 'voided') continue;
      const locId = order.locationId;
      if (!locId) continue;
      const whId = locationWarehouseMap.get(locId) || defaultWarehouse?.id;
      if (!whId) continue;

      for (const item of order.items) {
        const key = `${order.id}_${item.itemId}`;
        if (existingReturnSet.has(key)) continue;

        returnLedgerBatch.push({
          itemId: item.itemId,
          warehouseId: whId,
          locationId: locId,
          qty: new Prisma.Decimal(item.quantity),
          movementType: MovementType.INBOUND,
          referenceType: 'POS_VOID',
          referenceId: order.id,
          createdAt: order.updatedAt || order.createdAt,
        });

        existingReturnSet.add(key);
      }
    }

    let returnEntriesCreated = 0;
    if (returnLedgerBatch.length > 0) {
      console.log(
        `Inserting ${returnLedgerBatch.length} POS_VOID INBOUND ledger entries...`,
      );
      await prisma.stockLedger.createMany({ data: returnLedgerBatch });
      returnEntriesCreated = returnLedgerBatch.length;
    }

    // 7. Sync & Rebalance InventoryItem table to match Stock Ledger total sums instantly
    console.log('Rebalancing InventoryItem table from Stock Ledger sums...');
    const rebalanceRes: any = await prisma.$executeRawUnsafe(`
      UPDATE "InventoryItem" inv
      SET quantity = COALESCE(sl.sum_qty, 0),
          "updatedAt" = NOW()
      FROM (
        SELECT item_id, warehouse_id, location_id, SUM(qty) AS sum_qty
        FROM stock_ledgers
        GROUP BY item_id, warehouse_id, location_id
      ) sl
      WHERE inv."itemId" = sl.item_id
        AND inv."warehouseId" = sl.warehouse_id
        AND inv."locationId" = sl.location_id
    `);
    const inventoryItemsSynced = Number(rebalanceRes || 0);

    console.log('\n======================================================');
    console.log(
      `✅ Stock Ledger & Inventory Sync Completed for DB "${dbName}"!`,
    );
    console.log(
      `  - OPENING_BALANCE Entries Created: ${openingEntriesCreated}`,
    );
    console.log(
      `  - POS_SALE Outbound Entries Created: ${salesLedgerEntriesCreated}`,
    );
    console.log(
      `  - POS_VOID/RETURN Inbound Entries Created: ${returnEntriesCreated}`,
    );
    console.log(
      `  - InventoryItem Records Rebalanced: ${inventoryItemsSynced}`,
    );
    console.log('======================================================\n');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

async function runAll() {
  for (const dbName of targetDbs) {
    try {
      await syncTenantDb(dbName);
    } catch (e: any) {
      console.error(`❌ Error syncing DB "${dbName}":`, e);
    }
  }
}

runAll();
