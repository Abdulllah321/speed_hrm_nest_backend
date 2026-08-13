import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const masterUrl = process.env.DATABASE_URL!;
const urlObj = new URL(masterUrl);
const user = urlObj.username;
const password = urlObj.password;
const host = urlObj.hostname;
const port = urlObj.port || '5432';

const targetDbs = ['tenant_speed_main_mox1gfsi'];

async function cleanupTenantDb(dbName: string) {
  const connStr = `postgresql://${user}:${password}@${host}:${port}/${dbName}?schema=public`;
  console.log(`\n======================================================`);
  console.log(
    `🧹 Starting Stock Sync Cleanup & Instant Bulk Inventory Rebalance for DB: ${dbName}`,
  );
  console.log(`======================================================\n`);

  const pool = new Pool({ connectionString: connStr });

  try {
    // 1. Delete AUTO_OPENING_BAL entries
    const delAutoOpening = await pool.query(`
      DELETE FROM stock_ledgers
      WHERE "reference_id" = 'AUTO_OPENING_BAL'
    `);
    console.log(
      `[${dbName}] Deleted ${delAutoOpening.rowCount} AUTO_OPENING_BAL ledger entries.`,
    );

    // 2. Delete backfilled POS_SALE and POS_VOID entries created by sync script
    const delPosSaleVoid = await pool.query(`
      DELETE FROM stock_ledgers
      WHERE "reference_type" IN ('POS_SALE', 'POS_VOID')
    `);
    console.log(
      `[${dbName}] Deleted ${delPosSaleVoid.rowCount} POS_SALE / POS_VOID backfilled ledger entries.`,
    );

    // 3. Inspect remaining stock ledger types
    const remainingSummary = await pool.query(`
      SELECT "reference_type", COUNT(*), SUM("qty") as total_qty
      FROM stock_ledgers
      GROUP BY "reference_type"
    `);
    console.log(`\n[${dbName}] Remaining Stock Ledger Summary:`);
    console.table(remainingSummary.rows);

    // 4. Instant bulk SQL rebalance for InventoryItem table
    console.log(
      `\n[${dbName}] Performing instant SQL bulk rebalance of InventoryItem table...`,
    );

    // Step A: Reset all InventoryItem quantities to 0
    await pool.query(
      `UPDATE "InventoryItem" SET quantity = 0, "updatedAt" = NOW()`,
    );

    // Step B: Bulk update InventoryItem from stock_ledgers sum directly in PostgreSQL engine
    const bulkUpdateRes = await pool.query(`
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

    console.log(
      `[${dbName}] Bulk updated ${bulkUpdateRes.rowCount} InventoryItem records directly in DB.`,
    );

    const totalInv = await pool.query(
      `SELECT COUNT(*), SUM(quantity) FROM "InventoryItem"`,
    );
    console.log(`\n======================================================`);
    console.log(`✅ Cleanup & Instant Rebalance Complete for DB "${dbName}"!`);
    console.log(`  - Deleted AUTO_OPENING_BAL: ${delAutoOpening.rowCount}`);
    console.log(`  - Deleted POS_SALE/VOID: ${delPosSaleVoid.rowCount}`);
    console.log(
      `  - Rebalanced InventoryItem Records: ${bulkUpdateRes.rowCount}`,
    );
    console.log(
      `  - Final InventoryItems Count: ${totalInv.rows[0].count}, Total Net Qty: ${totalInv.rows[0].sum}`,
    );
    console.log(`======================================================\n`);
  } catch (err: any) {
    console.error(`❌ Error cleaning DB "${dbName}":`, err.message);
  } finally {
    await pool.end();
  }
}

async function runCleanup() {
  for (const dbName of targetDbs) {
    await cleanupTenantDb(dbName);
  }
}

runCleanup();
