import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';

function decrypt(encryptedText: string, masterKeyString: string): string {
  if (!masterKeyString || masterKeyString.length < 32) {
    throw new Error('MASTER_ENCRYPTION_KEY must be at least 32 characters');
  }
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const parts = encryptedText.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted text format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, Buffer.from(parts[0], 'hex'));
  decipher.setAuthTag(Buffer.from(parts[1], 'hex'));
  let decrypted = decipher.update(parts[2], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function migrateTenant(pool: Pool, tenantLabel: string) {
  console.log(`\n======================================================================`);
  console.log(`🚀 Starting Full Migration for: ${tenantLabel}`);
  console.log(`======================================================================`);

  // Step 1: Discover PLM Warehouse and Location
  const whRes = await pool.query(`SELECT id, code, name FROM "Warehouse" WHERE code = 'C20001' LIMIT 1`);
  const locRes = await pool.query(`SELECT id, code, name, warehouse_id, is_stock_location FROM "Location" WHERE code = 'C20001' LIMIT 1`);

  if (whRes.rowCount === 0 || locRes.rowCount === 0) {
    console.log(`⚠️  Skipping: Could not find either Warehouse C20001 or Location C20001 in this database.`);
    return;
  }

  const whId = whRes.rows[0].id;
  const whName = whRes.rows[0].name;
  const locId = locRes.rows[0].id;
  const locName = locRes.rows[0].name;

  console.log(`📍 Found Warehouse: "${whName}" (${whRes.rows[0].code}) -> ID: ${whId}`);
  console.log(`📍 Found Location:  "${locName}" (${locRes.rows[0].code}) -> ID: ${locId}`);

  // Ensure Location is configured as a stock location and unlinked from parent warehouse ID
  await pool.query(`
    UPDATE "Location"
    SET is_stock_location = true, warehouse_id = NULL
    WHERE id = $1
  `, [locId]);
  console.log(`✅ Ensured Location "${locName}" has is_stock_location = true and warehouse_id = NULL`);

  // Step 2: Audit Before Migration
  const beforeTransferRes = await pool.query(`
    SELECT COUNT(*) as count 
    FROM "TransferRequest" 
    WHERE "fromWarehouseId" = $1 OR "toWarehouseId" = $1
  `, [whId]);
  const beforeLedgerWhRes = await pool.query(`
    SELECT COUNT(*) as count, COALESCE(SUM(qty), 0) as net_qty
    FROM stock_ledgers
    WHERE warehouse_id = $1 AND (location_id IS NULL OR location_id = $1)
  `, [whId]);
  const beforeLedgerLocRes = await pool.query(`
    SELECT COUNT(*) as count, COALESCE(SUM(qty), 0) as net_qty
    FROM stock_ledgers
    WHERE location_id = $1
  `, [locId]);

  console.log(`\n📊 Current State Before Migration:`);
  console.log(`   - Transfer Requests referencing PLM Warehouse: ${beforeTransferRes.rows[0].count}`);
  console.log(`   - PLM Warehouse Ledger Entries: ${beforeLedgerWhRes.rows[0].count} (Net Qty: ${beforeLedgerWhRes.rows[0].net_qty})`);
  console.log(`   - PLM Location Ledger Entries:  ${beforeLedgerLocRes.rows[0].count} (Net Qty: ${beforeLedgerLocRes.rows[0].net_qty})`);

  // Step 3: Migrate TransferRequests
  console.log(`\n🔄 Step 3: Migrating Transfer Requests...`);

  // 3a. Transfers where destination is PLM Warehouse
  // If coming from another location -> OUTLET_TO_OUTLET
  const trDestLoc = await pool.query(`
    UPDATE "TransferRequest"
    SET 
      "toLocationId" = $1,
      "toWarehouseId" = NULL,
      transfer_type = 'OUTLET_TO_OUTLET'
    WHERE "toWarehouseId" = $2 AND "fromLocationId" IS NOT NULL
  `, [locId, whId]);
  console.log(`   ✓ Updated ${trDestLoc.rowCount} transfers from Outlets to PLM -> transfer_type: OUTLET_TO_OUTLET`);

  // If coming from another warehouse -> WAREHOUSE_TO_OUTLET
  const trDestWh = await pool.query(`
    UPDATE "TransferRequest"
    SET 
      "toLocationId" = $1,
      "toWarehouseId" = NULL,
      transfer_type = 'WAREHOUSE_TO_OUTLET'
    WHERE "toWarehouseId" = $2 AND "fromWarehouseId" IS NOT NULL AND "fromWarehouseId" != $2
  `, [locId, whId]);
  console.log(`   ✓ Updated ${trDestWh.rowCount} transfers from other Warehouses to PLM -> transfer_type: WAREHOUSE_TO_OUTLET`);

  // If internal transfer (from PLM to PLM) -> OUTLET_TO_OUTLET
  const trInternal = await pool.query(`
    UPDATE "TransferRequest"
    SET 
      "fromLocationId" = $1,
      "fromWarehouseId" = NULL,
      "toLocationId" = $1,
      "toWarehouseId" = NULL,
      transfer_type = 'OUTLET_TO_OUTLET'
    WHERE "toWarehouseId" = $2 AND "fromWarehouseId" = $2
  `, [locId, whId]);
  console.log(`   ✓ Updated ${trInternal.rowCount} internal PLM-to-PLM transfers -> transfer_type: OUTLET_TO_OUTLET`);

  // 3b. Transfers where source is PLM Warehouse
  // If destination is an outlet -> OUTLET_TO_OUTLET
  const trSrcLoc = await pool.query(`
    UPDATE "TransferRequest"
    SET 
      "fromLocationId" = $1,
      "fromWarehouseId" = NULL,
      transfer_type = 'OUTLET_TO_OUTLET'
    WHERE "fromWarehouseId" = $2 AND "toLocationId" IS NOT NULL
  `, [locId, whId]);
  console.log(`   ✓ Updated ${trSrcLoc.rowCount} transfers from PLM to Outlets -> transfer_type: OUTLET_TO_OUTLET`);

  // If destination is a warehouse -> OUTLET_TO_WAREHOUSE
  const trSrcWh = await pool.query(`
    UPDATE "TransferRequest"
    SET 
      "fromLocationId" = $1,
      "fromWarehouseId" = NULL,
      transfer_type = 'OUTLET_TO_WAREHOUSE'
    WHERE "fromWarehouseId" = $2 AND "toWarehouseId" IS NOT NULL AND "toWarehouseId" != $2
  `, [locId, whId]);
  console.log(`   ✓ Updated ${trSrcWh.rowCount} transfers from PLM to other Warehouses -> transfer_type: OUTLET_TO_WAREHOUSE`);

  // 3c. Catch-all for any remaining PLM warehouse references
  const trCatchAll = await pool.query(`
    UPDATE "TransferRequest"
    SET 
      "fromLocationId" = CASE WHEN "fromWarehouseId" = $2 THEN $1 ELSE "fromLocationId" END,
      "fromWarehouseId" = CASE WHEN "fromWarehouseId" = $2 THEN NULL ELSE "fromWarehouseId" END,
      "toLocationId" = CASE WHEN "toWarehouseId" = $2 THEN $1 ELSE "toLocationId" END,
      "toWarehouseId" = CASE WHEN "toWarehouseId" = $2 THEN NULL ELSE "toWarehouseId" END
    WHERE "fromWarehouseId" = $2 OR "toWarehouseId" = $2
  `, [locId, whId]);
  if (trCatchAll.rowCount > 0) {
    console.log(`   ✓ Catch-all updated ${trCatchAll.rowCount} remaining transfer requests.`);
  }

  // Normalize transfer_type for all transfer requests involving PLM Location
  await pool.query(`
    UPDATE "TransferRequest"
    SET transfer_type = 'OUTLET_TO_OUTLET'
    WHERE ("fromLocationId" = $1 OR "toLocationId" = $1)
      AND "fromLocationId" IS NOT NULL 
      AND "toLocationId" IS NOT NULL 
      AND "fromWarehouseId" IS NULL 
      AND "toWarehouseId" IS NULL
      AND transfer_type != 'OUTLET_TO_OUTLET'
  `, [locId]);

  await pool.query(`
    UPDATE "TransferRequest"
    SET transfer_type = 'OUTLET_TO_WAREHOUSE'
    WHERE "fromLocationId" = $1
      AND "toWarehouseId" IS NOT NULL
      AND "toLocationId" IS NULL
      AND transfer_type != 'OUTLET_TO_WAREHOUSE'
  `, [locId]);

  await pool.query(`
    UPDATE "TransferRequest"
    SET transfer_type = 'WAREHOUSE_TO_OUTLET'
    WHERE "toLocationId" = $1
      AND "fromWarehouseId" IS NOT NULL
      AND "fromLocationId" IS NULL
      AND transfer_type != 'WAREHOUSE_TO_OUTLET'
  `, [locId]);
  console.log(`✅ All TransferRequests updated and normalized.`);

  // Step 4: Migrate StockMovements
  console.log(`\n📦 Step 4: Migrating StockMovements...`);
  const smRes1 = await pool.query(`
    UPDATE "StockMovement" SET "fromLocationId" = $1 WHERE "fromLocationId" = $2
  `, [locId, whId]);
  const smRes2 = await pool.query(`
    UPDATE "StockMovement" SET "toLocationId" = $1 WHERE "toLocationId" = $2
  `, [locId, whId]);
  console.log(`✅ StockMovements updated (${smRes1.rowCount + smRes2.rowCount} rows).`);

  // Step 5: Migrate Stock Adjustments & Items
  console.log(`\n⚖️  Step 5: Migrating Stock Adjustments...`);
  const saiRes = await pool.query(`
    UPDATE stock_adjustment_items
    SET location_id = $1
    WHERE (location_id IS NULL OR location_id = $2)
      AND stock_adjustment_id IN (
        SELECT id FROM stock_adjustments WHERE warehouse_id = $2
      )
  `, [locId, whId]);
  console.log(`✅ Updated ${saiRes.rowCount} stock adjustment items to point to PLM Outlet Location.`);

  // Step 6: Migrate Stock Ledgers
  console.log(`\n📒 Step 6: Migrating Stock Ledgers...`);
  const slRes1 = await pool.query(`
    UPDATE stock_ledgers 
    SET location_id = $1
    WHERE warehouse_id = $2 AND (location_id IS NULL OR location_id = $2)
  `, [locId, whId]);
  console.log(`   ✓ Updated ${slRes1.rowCount} warehouse stock ledger rows to location_id = ${locId}.`);

  const slRes2 = await pool.query(`
    UPDATE stock_ledgers 
    SET location_id = $1
    WHERE location_id = $2
  `, [locId, whId]);
  // Clean up any rogue location_id in stock_ledgers that does not exist in Location table (e.g. warehouse IDs mistakenly placed in location_id)
  const rogueLocs = await pool.query(`
    UPDATE stock_ledgers 
    SET location_id = NULL 
    WHERE location_id IS NOT NULL 
      AND location_id NOT IN (SELECT id FROM "Location")
  `);
  if (rogueLocs.rowCount > 0) {
    console.log(`   ✓ Cleaned ${rogueLocs.rowCount} rogue ledger entries where location_id was not in Location table.`);
  }

  // Audit ledgers after migration
  const afterLedgerLocRes = await pool.query(`
    SELECT COUNT(*) as count, COALESCE(SUM(qty), 0) as net_qty
    FROM stock_ledgers
    WHERE location_id = $1
  `, [locId]);
  const afterLedgerWhRes = await pool.query(`
    SELECT COUNT(*) as count, COALESCE(SUM(qty), 0) as net_qty
    FROM stock_ledgers
    WHERE warehouse_id = $1 AND (location_id IS NULL OR location_id = $1)
  `, [whId]);
  console.log(`   📊 PLM Outlet Ledger Now:    ${afterLedgerLocRes.rows[0].count} entries (Net Qty: ${afterLedgerLocRes.rows[0].net_qty})`);
  console.log(`   📊 PLM Warehouse Ledger Now: ${afterLedgerWhRes.rows[0].count} entries (Net Qty: ${afterLedgerWhRes.rows[0].net_qty})`);

  // Step 7: Rebuild InventoryItem Table
  console.log(`\n🔄 Step 7: Rebuilding InventoryItem table...`);
  await pool.query(`DELETE FROM "InventoryItem"`);
  const invInsertRes = await pool.query(`
    INSERT INTO "InventoryItem" (id, "warehouseId", "locationId", "itemId", quantity, status, "createdAt", "updatedAt")
    SELECT 
      gen_random_uuid(),
      sl.warehouse_id,
      loc.id as "locationId",
      sl.item_id,
      SUM(sl.qty) as quantity,
      'AVAILABLE',
      NOW(),
      NOW()
    FROM stock_ledgers sl
    LEFT JOIN "Location" loc ON loc.id = sl.location_id
    GROUP BY sl.warehouse_id, loc.id, sl.item_id
    HAVING SUM(sl.qty) <> 0
  `);
  console.log(`✅ InventoryItem table rebuilt: ${invInsertRes.rowCount} active stock records.`);

  // Step 8: Rebuild Monthly Stock Snapshots
  console.log(`\n📸 Step 8: Recomputing monthly_stock_snapshots...`);
  await pool.query(`TRUNCATE TABLE monthly_stock_snapshots CASCADE;`);
  const snapInsertRes = await pool.query(`
    INSERT INTO monthly_stock_snapshots (id, date, item_id, warehouse_id, location_id, closing_qty, unit_cost)
    SELECT 
      gen_random_uuid(),
      '2026-10-01 00:00:00'::timestamp,
      s.item_id, 
      s.warehouse_id, 
      loc.id as location_id, 
      SUM(s.qty),
      COALESCE(
          (SELECT COALESCE(unit_cost, rate) FROM stock_ledgers l2 
           WHERE l2.item_id = s.item_id 
           AND l2.created_at <= '2026-10-01 00:00:00'::timestamp 
           AND (l2.unit_cost > 0 OR l2.rate > 0)
           ORDER BY l2.created_at DESC LIMIT 1), 
           0
      ) as unit_cost
    FROM stock_ledgers s
    LEFT JOIN "Location" loc ON loc.id = s.location_id
    WHERE s.created_at <= '2026-10-01 00:00:00'::timestamp
    GROUP BY s.item_id, s.warehouse_id, loc.id
    HAVING SUM(s.qty) != 0
  `);
  console.log(`✅ monthly_stock_snapshots rebuilt: ${snapInsertRes.rowCount} records for 2026-10-01.`);

  // Step 9: Deactivate Migrated Warehouses (C20001 & C30001)
  console.log(`\n🛑 Step 9: Deactivating migrated warehouses (C20001 & C30001)...`);
  const deactRes = await pool.query(`
    UPDATE "Warehouse"
    SET "isActive" = false, "isDeleted" = true, "deletedAt" = NOW()
    WHERE code IN ('C20001', 'C30001') OR name IN ('PLM', 'Corporate In-Hand')
  `);
  console.log(`✅ Deactivated ${deactRes.rowCount} warehouses (set isActive = false, isDeleted = true).`);

  // Final Audit
  const finalSnapAudit = await pool.query(`
    SELECT 
      CASE WHEN location_id = $1 THEN 'PLM Outlet Location' ELSE 'Other' END as category,
      COUNT(*) as count,
      SUM(closing_qty) as total_qty
    FROM monthly_stock_snapshots
    WHERE warehouse_id = $2 OR location_id = $1
    GROUP BY CASE WHEN location_id = $1 THEN 'PLM Outlet Location' ELSE 'Other' END
  `, [locId, whId]);
  console.log(`\n🎉 Final Snapshot Audit for PLM:`);
  for (const row of finalSnapAudit.rows) {
    console.log(`   - ${row.category}: ${row.count} items, Total Qty: ${row.total_qty}`);
  }

  const activeWhAudit = await pool.query(`
    SELECT code, name FROM "Warehouse" WHERE "isActive" = true AND "isDeleted" = false ORDER BY code
  `);
  console.log(`\n🏢 Active Warehouses Remaining (${activeWhAudit.rows.length}):`);
  for (const w of activeWhAudit.rows) {
    console.log(`   - [${w.code}] ${w.name}`);
  }

  console.log(`\n✨ Migration completed successfully for ${tenantLabel}!\n`);
}

async function main() {
  console.log('🚀 Starting PLM Warehouse to Outlet Full Migration...');

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (managementUrl && masterKey) {
    const mgmtPool = new Pool({ connectionString: managementUrl });
    const mgmtAdapter = new PrismaPg(mgmtPool);
    const management = new ManagementClient({ adapter: mgmtAdapter } as any);

    try {
      const companies = await management.company.findMany({ where: { status: 'active' } });
      console.log(`📡 Connected to Management DB. Found ${companies.length} active company tenant(s).`);

      for (const company of companies) {
        let connectionString = company.dbUrl;

        if (company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch (e: any) {
            console.warn(`⚠️  Decryption failed for tenant ${company.code}: ${e.message}`);
          }
        }

        if (!connectionString) {
          connectionString = `postgresql://${company.dbUser || 'postgres'}:root@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
        }

        const tenantPool = new Pool({ connectionString });
        try {
          await migrateTenant(tenantPool, `${company.name} (${company.dbName})`);
        } catch (err: any) {
          console.error(`❌ Migration failed for tenant ${company.code}: ${err.message}`);
        } finally {
          await tenantPool.end();
        }
      }
    } finally {
      await management.$disconnect();
      await mgmtPool.end();
    }
  } else {
    console.log('📡 Connecting directly via DATABASE_URL...');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await migrateTenant(pool, 'Direct Database');
    } finally {
      await pool.end();
    }
  }
}

main().catch(console.error);
