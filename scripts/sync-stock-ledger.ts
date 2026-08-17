import { PrismaClient, MovementType } from '@prisma/client';
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
const dbFromEnv = urlObj.pathname.slice(1);
const defaultTenantDb = (!dbFromEnv || dbFromEnv === 'spl_core_db')
  ? 'tenant_speed_main_mox1gfsi'
  : dbFromEnv;

const targetDbs = process.argv[2]
  ? [process.argv[2]]
  : [defaultTenantDb];

// Default Previous Fiscal Year Date Boundaries (1 July 2025 - 30 June 2026)
const PREV_FY_START = process.env.PREV_FY_START
  ? new Date(process.env.PREV_FY_START)
  : new Date('2025-07-01T00:00:00.000Z');

const PREV_FY_END = process.env.PREV_FY_END
  ? new Date(process.env.PREV_FY_END)
  : new Date('2026-06-30T23:59:59.999Z');

async function bulkInsertLedgerEntries(pool: Pool, entries: any[]) {
  if (entries.length === 0) return 0;
  const CHUNK = 1000;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK);
    const valueStrings: string[] = [];
    const params: any[] = [];
    let idx = 1;

    for (const item of chunk) {
      valueStrings.push(
        `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7})`
      );
      params.push(
        item.itemId,
        item.warehouseId,
        item.locationId || null,
        item.qty,
        item.movementType,
        item.referenceType,
        item.referenceId,
        item.createdAt
      );
      idx += 8;
    }

    const query = `
      INSERT INTO stock_ledgers (
        item_id, warehouse_id, location_id, qty, movement_type, reference_type, reference_id, created_at
      ) VALUES ${valueStrings.join(', ')}
    `;
    await pool.query(query, params);
  }
  return entries.length;
}

async function syncTenantDb(dbName: string) {
  const dbUrl = `postgresql://${user}:${password}@${host}:${port}/${dbName}?schema=public`;
  console.log(`\n======================================================`);
  console.log(
    `🚀 Starting Previous Fiscal Year Stock Ledger Sync for DB: ${dbName}`,
  );
  console.log(`Target Date Range: ${PREV_FY_START.toISOString()} -> ${PREV_FY_END.toISOString()}`);
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

    // 2. Fetch Sales Orders strictly within the previous fiscal year date range
    const previousYearSalesOrders = await prisma.salesOrder.findMany({
      where: {
        createdAt: {
          gte: PREV_FY_START,
          lte: PREV_FY_END,
        },
      },
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
      `Found ${previousYearSalesOrders.length} SalesOrders in previous fiscal year (${PREV_FY_START.toISOString().slice(0,10)} to ${PREV_FY_END.toISOString().slice(0,10)}) for "${dbName}".`,
    );
    if (previousYearSalesOrders.length === 0) {
      console.log(`No previous year sales orders found in "${dbName}", skipping...`);
      return;
    }

    // 3. Batch check existing StockLedger entries for previous year
    const existingLedgers = await prisma.stockLedger.findMany({
      where: {
        createdAt: {
          gte: PREV_FY_START,
          lte: PREV_FY_END,
        },
        referenceType: {
          in: [
            'POS_SALE',
            'POS_RETURN',
            'POS_VOID',
            'OPENING_BALANCE',
            'PREV_FY_OPENING',
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
    const existingReturnSet = new Set<string>(); // `${orderId}_${itemId}`

    for (const entry of existingLedgers) {
      if (entry.referenceType === 'POS_SALE') {
        existingSalesLedgerSet.add(`${entry.referenceId}_${entry.itemId}`);
      } else if (
        entry.referenceType === 'POS_RETURN' ||
        entry.referenceType === 'POS_VOID'
      ) {
        existingReturnSet.add(`${entry.referenceId}_${entry.itemId}`);
      }
    }

    // 4. Generate paired AUTO_OPENING_BAL (UP) and POS_SALE (DOWN) entries per cash memo transaction timestamp
    const openingLedgerBatch: any[] = [];
    const salesLedgerBatch: any[] = [];
    const returnLedgerBatch: any[] = [];

    for (const order of previousYearSalesOrders) {
      const locId = order.locationId;
      if (!locId) continue;
      const whId = locationWarehouseMap.get(locId) || defaultWarehouse?.id;
      if (!whId) continue;

      for (const item of order.items) {
        if (order.status === 'voided') {
          const key = `${order.id}_${item.itemId}`;
          if (!existingReturnSet.has(key)) {
            returnLedgerBatch.push({
              itemId: item.itemId,
              warehouseId: whId,
              locationId: locId,
              qty: Number(item.quantity),
              movementType: MovementType.INBOUND,
              referenceType: 'POS_VOID',
              referenceId: order.id,
              createdAt: order.updatedAt || order.createdAt,
            });
            existingReturnSet.add(key);
          }
        } else {
          const key = `${order.id}_${item.itemId}`;
          if (!existingSalesLedgerSet.has(key)) {
            // 1. UP Entry: AUTO_OPENING_BAL on the exact cash memo timestamp
            openingLedgerBatch.push({
              itemId: item.itemId,
              warehouseId: whId,
              locationId: locId,
              qty: Number(item.quantity),
              movementType: MovementType.OPENING_BALANCE,
              referenceType: 'AUTO_OPENING_BAL',
              referenceId: 'AUTO_OPENING_BAL',
              createdAt: order.createdAt,
            });

            // 2. DOWN Entry: POS_SALE on the exact cash memo timestamp
            salesLedgerBatch.push({
              itemId: item.itemId,
              warehouseId: whId,
              locationId: locId,
              qty: -Number(item.quantity),
              movementType: MovementType.OUTBOUND,
              referenceType: 'POS_SALE',
              referenceId: order.id,
              createdAt: order.createdAt,
            });

            existingSalesLedgerSet.add(key);
          }
        }
      }
    }

    let openingCreated = 0;
    if (openingLedgerBatch.length > 0) {
      const batchItemIds = [...new Set(openingLedgerBatch.map(b => b.itemId))];
      const validItems = await prisma.item.findMany({
        where: { id: { in: batchItemIds } },
        select: { id: true },
      });
      const validItemIdSet = new Set(validItems.map(i => i.id));
      const validOpeningBatch = openingLedgerBatch.filter(b => validItemIdSet.has(b.itemId));

      console.log(`Inserting ${validOpeningBatch.length} AUTO_OPENING_BAL entries paired with cash memo timestamps...`);
      openingCreated = await bulkInsertLedgerEntries(pool, validOpeningBatch);
    }

    let salesCreated = 0;
    if (salesLedgerBatch.length > 0) {
      const salesItemIds = [...new Set(salesLedgerBatch.map(b => b.itemId))];
      const validItems = await prisma.item.findMany({
        where: { id: { in: salesItemIds } },
        select: { id: true },
      });
      const validSet = new Set(validItems.map(i => i.id));
      const validSalesBatch = salesLedgerBatch.filter(b => validSet.has(b.itemId));

      console.log(`Inserting ${validSalesBatch.length} POS_SALE OUTBOUND ledger entries...`);
      salesCreated = await bulkInsertLedgerEntries(pool, validSalesBatch);
    }

    let returnsCreated = 0;
    if (returnLedgerBatch.length > 0) {
      const returnItemIds = [...new Set(returnLedgerBatch.map(b => b.itemId))];
      const validItems = await prisma.item.findMany({
        where: { id: { in: returnItemIds } },
        select: { id: true },
      });
      const validSet = new Set(validItems.map(i => i.id));
      const validReturnsBatch = returnLedgerBatch.filter(b => validSet.has(b.itemId));

      console.log(`Inserting ${validReturnsBatch.length} POS_VOID INBOUND ledger entries...`);
      returnsCreated = await bulkInsertLedgerEntries(pool, validReturnsBatch);
    }

    console.log('\n======================================================');
    console.log(`✅ Previous Fiscal Year Sync Completed for DB "${dbName}"!`);
    console.log(`  - PREV_FY_OPENING Entries (Self-balancing): ${openingCreated}`);
    console.log(`  - POS_SALE Outbound Entries: ${salesCreated}`);
    console.log(`  - POS_VOID Inbound Entries: ${returnsCreated}`);
    console.log(`  - Previous Fiscal Year Net Stock Impact on Current Year: 0`);
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
