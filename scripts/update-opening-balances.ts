import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Pool, PoolClient } from 'pg';

/**
 * Decrypt password for tenant DB connection using master key
 */
function decrypt(encryptedText: string, masterKeyString: string): string {
  if (!masterKeyString || masterKeyString.length < 32) {
    throw new Error('MASTER_ENCRYPTION_KEY must be at least 32 characters');
  }
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

interface OpeningRecord {
  Location: string;
  Barcode: string;
  Opening: string | number;
}

interface ProcessedLocationSummary {
  locationCode: string;
  locationName: string;
  warehouseCode: string;
  totalJsonItems: number;
  positiveQtyItems: number;
  zeroQtyItems: number;
  totalOpeningQty: number;
  matchedItems: number;
  unmatchedItems: number;
  previousLedgerRows: number;
  newLedgerRowsInserted: number;
  inventoryItemsUpdated: number;
  inventoryItemsInserted: number;
  inventoryItemsZeroed: number;
}

/**
 * Helper to split array into chunks
 */
function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Main function to process opening balances for a tenant DB
 */
async function processOpeningsForTenant(
  connectionString: string,
  records: OpeningRecord[],
  options: {
    isDryRun: boolean;
    locationFilter?: string | null;
    warehouseCodeOverride?: string | null;
    openingDateStr?: string;
  },
) {
  const pool = new Pool({ connectionString });
  const client: PoolClient = await pool.connect();

  try {
    const { isDryRun, locationFilter, warehouseCodeOverride } = options;
    const isFy2526 = filePath.includes('25-26') || filePath.includes('2526');
    const defaultDateStr = isFy2526 ? '2025-06-30T19:00:00.000Z' : '2026-06-30T19:00:00.000Z';
    const openingDate = options.openingDateStr ? new Date(options.openingDateStr) : new Date(defaultDateStr);

    // Group rows by Location code (normalized uppercase)
    const byLocation = new Map<string, Array<{ barcode: string; qty: number }>>();
    for (const r of records) {
      if (!r.Location || !r.Barcode) continue;
      const loc = String(r.Location).trim().toUpperCase();
      if (locationFilter && loc !== locationFilter.toUpperCase()) continue;

      const bc = String(r.Barcode).trim();
      const qty = parseFloat(String(r.Opening)) || 0;

      if (!byLocation.has(loc)) {
        byLocation.set(loc, []);
      }
      byLocation.get(loc)!.push({ barcode: bc, qty });
    }

    if (byLocation.size === 0) {
      console.log('⚠️ No records found matching location filter.');
      return;
    }

    console.log(`\nFound ${byLocation.size} location(s) to process: ${Array.from(byLocation.keys()).join(', ')}`);

    for (const [locCode, locRecords] of byLocation.entries()) {
      console.log(`\n========================================================================`);
      console.log(`🏢 Processing Location: ${locCode} (${locRecords.length} records in file)`);
      console.log(`========================================================================`);

      // 1. Resolve Location record
      const locRes = await client.query(
        `SELECT id, code, name, "short_code", "warehouse_id" FROM "Location" WHERE UPPER(code) = $1 OR UPPER(name) = $1 OR UPPER("short_code") = $1 LIMIT 1`,
        [locCode],
      );

      if (locRes.rows.length === 0) {
        console.error(`❌ Location "${locCode}" not found in database! Skipping this location.`);
        continue;
      }

      const location = locRes.rows[0];
      console.log(`✔ Found Location: ${location.name} [ID: ${location.id}, Code: ${location.code}]`);

      // 2. Resolve Warehouse record (from location.warehouse_id, or override, or default C40001)
      let targetWarehouseId = location.warehouse_id;
      let targetWarehouseCode = warehouseCodeOverride || 'C40001';

      if (!targetWarehouseId || warehouseCodeOverride) {
        const whRes = await client.query(
          `SELECT id, code, name FROM "Warehouse" WHERE UPPER(code) = $1 OR UPPER(name) = $1 LIMIT 1`,
          [targetWarehouseCode.toUpperCase()],
        );
        if (whRes.rows.length > 0) {
          targetWarehouseId = whRes.rows[0].id;
          targetWarehouseCode = whRes.rows[0].code;
          console.log(`✔ Using Warehouse: ${whRes.rows[0].name} (${targetWarehouseCode}) [ID: ${targetWarehouseId}]`);
        } else {
          // Fallback to first warehouse if C40001 not found
          const anyWh = await client.query(`SELECT id, code, name FROM "Warehouse" LIMIT 1`);
          if (anyWh.rows.length === 0) {
            console.error(`❌ No warehouses found in database! Cannot link stock entries.`);
            continue;
          }
          targetWarehouseId = anyWh.rows[0].id;
          targetWarehouseCode = anyWh.rows[0].code;
          console.log(`✔ Fallback Warehouse: ${anyWh.rows[0].name} (${targetWarehouseCode})`);
        }
      }

      // 3. Deduplicate / aggregate quantities per barcode in case file has duplicates
      const qtyMap = new Map<string, number>();
      for (const r of locRecords) {
        qtyMap.set(r.barcode, (qtyMap.get(r.barcode) || 0) + r.qty);
      }

      const uniqueBarcodes = Array.from(qtyMap.keys());
      const totalPositiveItems = Array.from(qtyMap.values()).filter((q) => q > 0).length;
      const totalZeroItems = Array.from(qtyMap.values()).filter((q) => q <= 0).length;
      const totalSumQty = Array.from(qtyMap.values()).reduce((sum, q) => sum + q, 0);

      console.log(`📊 Statistics for ${locCode}:`);
      console.log(`   - Unique Barcodes: ${uniqueBarcodes.length.toLocaleString()}`);
      console.log(`   - Items with Opening Qty > 0: ${totalPositiveItems.toLocaleString()}`);
      console.log(`   - Items with Opening Qty = 0: ${totalZeroItems.toLocaleString()}`);
      console.log(`   - Total Opening Units: ${totalSumQty.toLocaleString()}`);

      // 4. Batch lookup Item records (barCode and itemId)
      console.log(`\n🔍 Matching barcodes against Item master...`);
      const itemLookup = new Map<string, { id: string; barCode: string; itemId: string; unitCost: number }>();

      const barcodeChunks = chunkArray(uniqueBarcodes, 1000);
      for (const chunk of barcodeChunks) {
        const itemRes = await client.query(
          `SELECT id, "barCode", "itemId", unit_cost 
           FROM "Item" 
           WHERE "barCode" = ANY($1) OR "itemId" = ANY($1)`,
          [chunk],
        );

        for (const item of itemRes.rows) {
          const cost = parseFloat(item.unit_cost) || 0;
          const entry = { id: item.id, barCode: item.barCode, itemId: item.itemId, unitCost: cost };
          if (item.barCode) itemLookup.set(item.barCode, entry);
          if (item.itemId) itemLookup.set(item.itemId, entry);
        }
      }

      const matchedBarcodes: Array<{ barcode: string; itemId: string; qty: number; unitCost: number }> = [];
      const unmatchedBarcodes: string[] = [];

      for (const bc of uniqueBarcodes) {
        const found = itemLookup.get(bc);
        if (found) {
          matchedBarcodes.push({
            barcode: bc,
            itemId: found.id,
            qty: qtyMap.get(bc)!,
            unitCost: found.unitCost,
          });
        } else {
          unmatchedBarcodes.push(bc);
        }
      }

      console.log(`✔ Matched in Item table: ${matchedBarcodes.length.toLocaleString()} / ${uniqueBarcodes.length.toLocaleString()}`);
      if (unmatchedBarcodes.length > 0) {
        console.warn(`⚠️ Unmatched Barcodes (${unmatchedBarcodes.length}):`, unmatchedBarcodes.slice(0, 10));
      }

      // Check current state in database
      const prevLedger = await client.query(
        `SELECT count(*)::int as count, COALESCE(SUM(qty), 0)::numeric as total_qty 
         FROM stock_ledgers 
         WHERE location_id = $1 AND movement_type = 'OPENING_BALANCE'`,
        [location.id],
      );
      const prevLedgerCount = prevLedger.rows[0].count;
      const prevLedgerQty = parseFloat(prevLedger.rows[0].total_qty);

      const prevInv = await client.query(
        `SELECT count(*)::int as count, COALESCE(SUM(quantity), 0)::numeric as total_qty 
         FROM "InventoryItem" 
         WHERE "locationId" = $1`,
        [location.id],
      );
      const prevInvCount = prevInv.rows[0].count;
      const prevInvQty = parseFloat(prevInv.rows[0].total_qty);

      console.log(`\n📋 Current DB State for ${locCode}:`);
      console.log(`   - StockLedger OPENING_BALANCE entries: ${prevLedgerCount.toLocaleString()} (Total Qty: ${prevLedgerQty.toLocaleString()})`);
      console.log(`   - InventoryItem records: ${prevInvCount.toLocaleString()} (Total Qty: ${prevInvQty.toLocaleString()})`);

      if (isDryRun) {
        console.log(`\n🔍 [DRY RUN MODE] No database modifications made.`);
        console.log(`   Would delete ${prevLedgerCount.toLocaleString()} existing opening entries.`);
        console.log(`   Would insert ${matchedBarcodes.filter((m) => m.qty > 0).length.toLocaleString()} positive stock ledger entries.`);
        console.log(`   Would synchronize ${matchedBarcodes.length.toLocaleString()} InventoryItem balances.`);
        continue;
      }

      // 5. Execute DB Transaction
      console.log(`\n💾 Executing database transaction...`);
      await client.query('BEGIN');

      try {
        // A. Delete existing OPENING_BALANCE entries for this location
        const delRes = await client.query(
          `DELETE FROM stock_ledgers 
           WHERE location_id = $1 
             AND movement_type = 'OPENING_BALANCE'`,
          [location.id],
        );
        console.log(`   ✔ Deleted ${delRes.rowCount} previous OPENING_BALANCE entries.`);

        // B. Insert new OPENING_BALANCE entries (only for items with qty > 0)
        const positiveItems = matchedBarcodes.filter((m) => m.qty > 0);
        const refId = `OPENING_25_26_${location.code}`;
        let insertedCount = 0;

        const ledgerChunks = chunkArray(positiveItems, 1000);
        for (const chunk of ledgerChunks) {
          const valueRows: string[] = [];
          const params: any[] = [];
          let paramIdx = 1;

          for (const item of chunk) {
            valueRows.push(
              `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, 'OPENING_BALANCE', 'BULK_STOCK_UPLOAD', $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`,
            );
            params.push(
              item.itemId,
              targetWarehouseId,
              location.id,
              item.qty,
              refId,
              item.unitCost,
              item.unitCost,
              openingDate,
            );
          }

          const insertSql = `
            INSERT INTO stock_ledgers (
              item_id, warehouse_id, location_id, qty, movement_type, reference_type, reference_id, rate, unit_cost, created_at
            ) VALUES ${valueRows.join(', ')}
          `;
          await client.query(insertSql, params);
          insertedCount += chunk.length;
        }

        console.log(`   ✔ Inserted ${insertedCount.toLocaleString()} new OPENING_BALANCE stock ledger entries.`);

        // C. Synchronize InventoryItem quantities for this location
        // 1) Update existing InventoryItem records matching target quantities
        const matchedItemIds = matchedBarcodes.map((m) => m.itemId);
        const invChunks = chunkArray(matchedBarcodes, 1000);

        let invUpdated = 0;
        let invInserted = 0;

        for (const chunk of invChunks) {
          // Use temporary table for fast batch join
          await client.query(`
            CREATE TEMP TABLE temp_inv_sync (
              item_id TEXT,
              target_qty NUMERIC
            ) ON COMMIT DROP;
          `);

          const valueRows: string[] = [];
          const params: any[] = [];
          let pIdx = 1;
          for (const item of chunk) {
            valueRows.push(`($${pIdx++}, $${pIdx++})`);
            params.push(item.itemId, item.qty);
          }

          await client.query(
            `INSERT INTO temp_inv_sync (item_id, target_qty) VALUES ${valueRows.join(', ')}`,
            params,
          );

          // Update existing InventoryItem
          const updateRes = await client.query(`
            UPDATE "InventoryItem" inv
            SET quantity = t.target_qty,
                "updatedAt" = NOW()
            FROM temp_inv_sync t
            WHERE inv."itemId" = t.item_id
              AND inv."locationId" = '${location.id}'
              AND inv."warehouseId" = '${targetWarehouseId}';
          `);
          invUpdated += updateRes.rowCount || 0;

          // Insert missing InventoryItem (only for qty > 0)
          const insertRes = await client.query(`
            INSERT INTO "InventoryItem" (
              id, "warehouseId", "locationId", "itemId", quantity, status, "createdAt", "updatedAt"
            )
            SELECT 
              gen_random_uuid()::text, '${targetWarehouseId}', '${location.id}', t.item_id, t.target_qty, 'AVAILABLE', NOW(), NOW()
            FROM temp_inv_sync t
            WHERE t.target_qty > 0
              AND NOT EXISTS (
                SELECT 1 FROM "InventoryItem" inv
                WHERE inv."itemId" = t.item_id
                  AND inv."locationId" = '${location.id}'
                  AND inv."warehouseId" = '${targetWarehouseId}'
              );
          `);
          invInserted += insertRes.rowCount || 0;

          await client.query(`DROP TABLE IF EXISTS temp_inv_sync;`);
        }

        // 2) Zero out any remaining InventoryItem for this location that had stock before but is not in new opening
        const cleanMatchedItemIds = matchedItemIds.filter(Boolean);
        const zeroRes = await client.query(
          `UPDATE "InventoryItem" 
           SET quantity = 0, "updatedAt" = NOW()
           WHERE "locationId" = $1 
             AND quantity > 0
             AND "itemId" NOT IN (SELECT unnest($2::text[]))`,
          [location.id, cleanMatchedItemIds],
        );
        const invZeroed = zeroRes.rowCount || 0;

        console.log(`   ✔ InventoryItem Updated: ${invUpdated.toLocaleString()}`);
        console.log(`   ✔ InventoryItem Inserted: ${invInserted.toLocaleString()}`);
        console.log(`   ✔ InventoryItem Reset to 0: ${invZeroed.toLocaleString()}`);

        await client.query('COMMIT');
        console.log(`\n✅ Transaction committed successfully for ${locCode}!`);

        // D. Verify Final State
        const finalLedger = await client.query(
          `SELECT count(*)::int as count, COALESCE(SUM(qty), 0)::numeric as total_qty 
           FROM stock_ledgers 
           WHERE location_id = $1 AND movement_type = 'OPENING_BALANCE'`,
          [location.id],
        );
        const finalInv = await client.query(
          `SELECT count(*)::int as count, COALESCE(SUM(quantity), 0)::numeric as total_qty 
           FROM "InventoryItem" 
           WHERE "locationId" = $1`,
          [location.id],
        );

        console.log(`\n🎉 New Verified State for ${locCode}:`);
        console.log(`   - StockLedger OPENING_BALANCE: ${finalLedger.rows[0].count} entries, Total Qty = ${finalLedger.rows[0].total_qty}`);
        console.log(`   - InventoryItem in Location: ${finalInv.rows[0].count} records, Total Qty = ${finalInv.rows[0].total_qty}`);
      } catch (txErr: any) {
        await client.query('ROLLBACK');
        console.error(`❌ Transaction failed and rolled back: ${txErr.message}`, txErr.stack);
        throw txErr;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * CLI Runner
 */
async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');

  let filePath = '';
  const fileArgIdx = args.indexOf('--file');
  if (fileArgIdx !== -1 && args[fileArgIdx + 1]) {
    filePath = path.resolve(process.cwd(), args[fileArgIdx + 1]);
  } else {
    // Default candidate
    const defaultCand = path.resolve(__dirname, '..', 'data', 'SS_LG_25-26_opening.json');
    if (fs.existsSync(defaultCand)) {
      filePath = defaultCand;
    }
  }

  if (!filePath || !fs.existsSync(filePath)) {
    console.error(`❌ File not found at: ${filePath}. Please supply via --file <path>`);
    process.exit(1);
  }

  const locArgIdx = args.indexOf('--location');
  const locationFilter = locArgIdx !== -1 ? args[locArgIdx + 1] : null;

  const whArgIdx = args.indexOf('--warehouse');
  const warehouseOverride = whArgIdx !== -1 ? args[whArgIdx + 1] : null;

  const dateArgIdx = args.indexOf('--date');
  const openingDateStr = dateArgIdx !== -1 ? args[dateArgIdx + 1] : undefined;

  const tenantArgIdx = args.indexOf('--tenant');
  const tenantFilter = tenantArgIdx !== -1 ? args[tenantArgIdx + 1] : null;

  console.log(`========================================================================`);
  console.log(`📦 Speed (pvt.) Limited - Previous Year Opening Balance Uploader`);
  console.log(`========================================================================`);
  console.log(`📂 Source File: ${filePath}`);
  console.log(`⚙️ Options: Dry Run: ${isDryRun} | Location Filter: ${locationFilter || 'All'} | Warehouse: ${warehouseOverride || 'C40001 (auto)'}`);

  const rawJson = fs.readFileSync(filePath, 'utf8');
  const records: OpeningRecord[] = JSON.parse(rawJson);
  console.log(`✔ Loaded ${records.length.toLocaleString()} records from JSON.`);

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  const directDbUrl = process.env.DATABASE_URL;

  // Single direct DB if flag or if no management URL
  if (directDbUrl && (!managementUrl || args.includes('--single-db'))) {
    console.log(`🔗 Connecting directly via DATABASE_URL...`);
    await processOpeningsForTenant(directDbUrl, records, {
      isDryRun,
      locationFilter,
      warehouseCodeOverride: warehouseOverride,
      openingDateStr,
    });
    return;
  }

  if (!managementUrl || !masterKey) {
    if (directDbUrl) {
      console.log(`🔗 Connecting via DATABASE_URL...`);
      await processOpeningsForTenant(directDbUrl, records, {
        isDryRun,
        locationFilter,
        warehouseCodeOverride: warehouseOverride,
        openingDateStr,
      });
      return;
    }
    console.error('❌ Neither DATABASE_URL nor DATABASE_URL_MANAGEMENT + MASTER_ENCRYPTION_KEY found in .env');
    process.exit(1);
  }

  // Iterate active tenant company databases
  console.log(`🏢 Checking active tenant company databases...`);
  const pool = new Pool({ connectionString: managementUrl });

  try {
    const compRes = await pool.query(`
      SELECT id, name, code, "dbName", "dbUser", "dbPassword", "dbHost", "dbPort", "dbUrl"
      FROM "Company"
      WHERE status = 'active'
      ${tenantFilter ? `AND "dbName" = '${tenantFilter}'` : ''}
    `);

    if (compRes.rows.length === 0) {
      console.log(`ℹ️ No matching active tenant companies found.`);
      return;
    }

    for (const company of compRes.rows) {
      console.log(`\n🏢 Tenant Company: ${company.name} (${company.code}) [DB: ${company.dbName}]`);
      let connectionString = company.dbUrl;
      if (company.dbPassword) {
        try {
          const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
          connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
        } catch {
          console.warn(`  ⚠️ Decryption failed, using default dbUrl`);
        }
      }

      if (!connectionString) {
        console.error(`  ❌ Missing connection string for ${company.name}`);
        continue;
      }

      await processOpeningsForTenant(connectionString, records, {
        isDryRun,
        locationFilter,
        warehouseCodeOverride: warehouseOverride,
        openingDateStr,
      });
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Script encountered fatal error:', err);
  process.exit(1);
});
