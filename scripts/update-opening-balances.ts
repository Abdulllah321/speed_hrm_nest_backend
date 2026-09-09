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

interface NormalizedOpeningRecord {
  location: string;
  barcode: string;
  qty: number;
}

interface ProcessedLocationSummary {
  locationCode: string;
  locationName: string;
  warehouseCode: string;
  fiscalYear: string;
  totalJsonItems: number;
  positiveQtyItems: number;
  zeroQtyItems: number;
  totalOpeningQty: number;
  matchedItems: number;
  unmatchedItems: number;
  previousLedgerRows: number;
  preservedLedgerRows: number;
  newLedgerRowsInserted: number;
  inventoryItemsUpdated: number;
  inventoryItemsInserted: number;
  inventoryItemsZeroed: number;
  status: 'SUCCESS' | 'DRY_RUN' | 'FAILED' | 'SKIPPED';
  error?: string;
}

/**
 * SQL WHERE clauses to strictly isolate FY 25-26 vs FY 26-27 opening balances.
 * This guarantees that deleting or querying FY 25-26 opening balances
 * will NEVER touch or delete FY 26-27 opening balances.
 */
const FY_2526_SQL_CONDITION = `(
  (reference_id ILIKE 'OPENING_25_26_%'
   OR reference_id ILIKE 'OPENING_2526_%'
   OR reference_id ILIKE 'OPENING_25-26_%'
   OR reference_id ILIKE '%25_26%'
   OR reference_id ILIKE '%2526%'
   OR created_at < '2026-06-01 00:00:00')
  AND NOT (
    created_at >= '2026-06-01 00:00:00'
    AND reference_id NOT ILIKE '%25_26%'
    AND reference_id NOT ILIKE '%2526%'
    AND reference_id NOT ILIKE '%25-26%'
  )
)`;

const FY_2627_SQL_CONDITION = `(
  created_at >= '2026-06-01 00:00:00'
  AND reference_id NOT ILIKE '%25_26%'
  AND reference_id NOT ILIKE '%2526%'
  AND reference_id NOT ILIKE '%25-26%'
)`;

/**
 * Normalizes input JSON into a unified list of { location, barcode, qty }.
 * Supports:
 * 1) Wide format (Pivot table):
 *    { "Barcode": "1001059203212", "P10001": 30, "P10002": 9, "P10003": 17, ... }
 *    where "Barcode" is the product barcode, and all other keys are location codes.
 * 2) Flat format:
 *    { "Location": "SS1010", "Barcode": "190085093469", "Opening": 2 }
 */
function parseOpeningData(rawJsonData: any[]): NormalizedOpeningRecord[] {
  if (!Array.isArray(rawJsonData)) {
    throw new Error('Input JSON data must be an array of records.');
  }

  const normalized: NormalizedOpeningRecord[] = [];
  let negativeCount = 0;

  // Metadata keys to ignore when parsing wide format
  const nonLocationKeys = new Set([
    'barcode',
    'bar_code',
    'itembarcode',
    'item_barcode',
    'total',
    'total_qty',
    'totalqty',
    'id',
    'item_name',
    'itemname',
    'description',
    'item_id',
    'itemid',
    'product',
    'product_name',
    'productname',
    'brand',
    'category',
    'division',
    'rate',
    'unit_cost',
    'unitcost',
    'cost',
  ]);

  for (let i = 0; i < rawJsonData.length; i++) {
    const row = rawJsonData[i];
    if (!row || typeof row !== 'object') continue;

    // Check if flat format (has Location/Store key AND Barcode key)
    const locKey = Object.keys(row).find((k) =>
      [
        'location',
        'locationcode',
        'location_code',
        'store',
        'storecode',
      ].includes(k.toLowerCase().trim()),
    );
    const barcodeKey = Object.keys(row).find((k) =>
      ['barcode', 'bar_code', 'itembarcode', 'item_barcode'].includes(
        k.toLowerCase().trim(),
      ),
    );

    if (locKey && barcodeKey) {
      const loc = String(row[locKey] || '')
        .trim()
        .toUpperCase();
      const bc = String(row[barcodeKey] || '').trim();
      const openingKey = Object.keys(row).find((k) =>
        [
          'opening',
          'qty',
          'quantity',
          'balance',
          'opening_balance',
          'stock',
        ].includes(k.toLowerCase().trim()),
      );
      const rawQty = openingKey ? parseFloat(String(row[openingKey])) : 0;
      let qty = isNaN(rawQty) ? 0 : rawQty;
      if (qty < 0) {
        negativeCount++;
        qty = 0;
      }

      if (loc && bc) {
        normalized.push({ location: loc, barcode: bc, qty });
      }
      continue;
    }

    // Wide format: One key is barcode, remaining keys are store location codes
    const foundBarcodeKey = Object.keys(row).find((k) =>
      ['barcode', 'bar_code', 'itembarcode', 'item_barcode'].includes(
        k.toLowerCase().trim(),
      ),
    );

    if (!foundBarcodeKey) {
      continue;
    }

    const bc = String(row[foundBarcodeKey] || '').trim();
    if (!bc) continue;

    for (const [key, val] of Object.entries(row)) {
      const cleanKey = key.trim();
      if (nonLocationKeys.has(cleanKey.toLowerCase())) continue;
      if (val === null || val === undefined || val === '') continue;

      const rawQty = parseFloat(String(val));
      if (isNaN(rawQty)) continue;

      let qty = rawQty;
      if (qty < 0) {
        negativeCount++;
        qty = 0;
      }

      normalized.push({
        location: cleanKey.toUpperCase(),
        barcode: bc,
        qty,
      });
    }
  }

  if (negativeCount > 0) {
    console.warn(
      `⚠️ Warning: Found ${negativeCount.toLocaleString()} negative opening quantities in source JSON. Clamped to 0.`,
    );
  }

  return normalized;
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
  records: NormalizedOpeningRecord[],
  options: {
    isDryRun: boolean;
    locationFilters?: string[] | null;
    warehouseCodeOverride?: string | null;
    openingDateStr?: string;
    filePath?: string;
    fiscalYearArg?: string;
    forceSyncInventory?: boolean;
    skipSyncInventory?: boolean;
  },
) {
  const pool = new Pool({ connectionString });
  const client: PoolClient = await pool.connect();

  try {
    const {
      isDryRun,
      locationFilters,
      warehouseCodeOverride,
      filePath,
      openingDateStr,
      fiscalYearArg,
      forceSyncInventory,
      skipSyncInventory,
    } = options;

    // Detect target Fiscal Year
    let isFy2526 = false;
    if (fiscalYearArg) {
      isFy2526 = ['25-26', '2526', '25_26', '2025-2026', '2025_2026'].includes(
        fiscalYearArg.trim().toLowerCase(),
      );
    } else if (openingDateStr) {
      const d = new Date(openingDateStr);
      isFy2526 =
        d.getFullYear() === 2025 || d < new Date('2026-06-01T00:00:00.000Z');
    } else if (filePath) {
      const p = filePath.toLowerCase();
      isFy2526 =
        p.includes('25-26') ||
        p.includes('2526') ||
        p.includes('25_26') ||
        p.includes('2025-2026') ||
        p.includes('2025_2026') ||
        p.includes('2025 to 2026') ||
        p.includes('01-07-2025') ||
        p.includes('2025-07-01') ||
        /2025.*2026/.test(p) ||
        /25.*26/.test(p);
    }

    const targetFiscalYear = isFy2526 ? '25-26' : '26-27';
    const otherFiscalYear = isFy2526 ? '26-27' : '25-26';
    const targetFyCondition = isFy2526
      ? FY_2526_SQL_CONDITION
      : FY_2627_SQL_CONDITION;
    const otherFyCondition = isFy2526
      ? FY_2627_SQL_CONDITION
      : FY_2526_SQL_CONDITION;

    // Default opening dates:
    // FY 25-26: 2025-06-30T19:00:00.000Z (2025-07-01 00:00:00 PKT)
    // FY 26-27: 2026-06-30T19:00:00.000Z (2026-07-01 00:00:00 PKT)
    const defaultDateStr = isFy2526
      ? '2025-06-30T19:00:00.000Z'
      : '2026-06-30T19:00:00.000Z';
    const openingDate = openingDateStr
      ? new Date(openingDateStr)
      : new Date(defaultDateStr);

    // InventoryItem synchronization decision:
    // If uploading historical FY 25-26, do NOT overwrite current on-hand inventory (InventoryItem)
    // by default to preserve current FY 26-27 stock, unless explicitly forced via --sync-inventory.
    // If uploading FY 26-27, sync by default unless --skip-inventory-sync is passed.
    let shouldSyncInventory = !isFy2526;
    if (forceSyncInventory) shouldSyncInventory = true;
    if (skipSyncInventory) shouldSyncInventory = false;

    // Group rows by Location code (normalized uppercase)
    const byLocation = new Map<
      string,
      Array<{ barcode: string; qty: number }>
    >();
    for (const r of records) {
      if (!r.location || !r.barcode) continue;
      const loc = r.location.trim().toUpperCase();
      if (locationFilters && !locationFilters.includes(loc)) continue;

      const bc = r.barcode.trim();
      const qty = r.qty;

      if (!byLocation.has(loc)) {
        byLocation.set(loc, []);
      }
      byLocation.get(loc)!.push({ barcode: bc, qty });
    }

    if (byLocation.size === 0) {
      console.log('⚠️ No records found matching location filter.');
      return;
    }

    console.log(
      `\nFound ${byLocation.size} location(s) to process: ${Array.from(byLocation.keys()).sort().join(', ')}`,
    );

    // Cache for Item master lookups to avoid repeating queries across 40+ stores
    const itemLookupCache = new Map<
      string,
      { id: string; barCode: string; itemId: string; unitCost: number }
    >();
    const summaries: ProcessedLocationSummary[] = [];

    for (const [locCode, locRecords] of byLocation.entries()) {
      console.log(
        `\n========================================================================`,
      );
      console.log(
        `🏢 Processing Location: ${locCode} (${locRecords.length} records in file) [Target: FY ${targetFiscalYear}]`,
      );
      console.log(
        `========================================================================`,
      );

      // 1. Resolve Location record
      const locRes = await client.query(
        `SELECT id, code, name, "short_code", "warehouse_id" FROM "Location" WHERE UPPER(code) = $1 OR UPPER(name) = $1 OR UPPER("short_code") = $1 LIMIT 1`,
        [locCode],
      );

      if (locRes.rows.length === 0) {
        console.error(
          `❌ Location "${locCode}" not found in database! Skipping this location.`,
        );
        continue;
      }

      const location = locRes.rows[0];
      console.log(
        `✔ Found Location: ${location.name} [ID: ${location.id}, Code: ${location.code}]`,
      );

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
          console.log(
            `✔ Using Warehouse: ${whRes.rows[0].name} (${targetWarehouseCode}) [ID: ${targetWarehouseId}]`,
          );
        } else {
          // Fallback to first warehouse if C40001 not found
          const anyWh = await client.query(
            `SELECT id, code, name FROM "Warehouse" LIMIT 1`,
          );
          if (anyWh.rows.length === 0) {
            console.error(
              `❌ No warehouses found in database! Cannot link stock entries.`,
            );
            continue;
          }
          targetWarehouseId = anyWh.rows[0].id;
          targetWarehouseCode = anyWh.rows[0].code;
          console.log(
            `✔ Fallback Warehouse: ${anyWh.rows[0].name} (${targetWarehouseCode})`,
          );
        }
      }

      // 3. Deduplicate / aggregate quantities per barcode in case file has duplicates
      const qtyMap = new Map<string, number>();
      for (const r of locRecords) {
        qtyMap.set(r.barcode, (qtyMap.get(r.barcode) || 0) + r.qty);
      }

      const uniqueBarcodes = Array.from(qtyMap.keys());
      const totalPositiveItems = Array.from(qtyMap.values()).filter(
        (q) => q > 0,
      ).length;
      const totalZeroItems = Array.from(qtyMap.values()).filter(
        (q) => q <= 0,
      ).length;
      const totalSumQty = Array.from(qtyMap.values()).reduce(
        (sum, q) => sum + q,
        0,
      );

      console.log(`📊 Statistics for ${locCode}:`);
      console.log(
        `   - Unique Barcodes: ${uniqueBarcodes.length.toLocaleString()}`,
      );
      console.log(
        `   - Items with Opening Qty > 0: ${totalPositiveItems.toLocaleString()}`,
      );
      console.log(
        `   - Items with Opening Qty = 0: ${totalZeroItems.toLocaleString()}`,
      );
      console.log(`   - Total Opening Units: ${totalSumQty.toLocaleString()}`);

      // 4. Batch lookup Item records (barCode and itemId) with caching
      console.log(`\n🔍 Matching barcodes against Item master...`);
      const barcodesToFetch = uniqueBarcodes.filter(
        (bc) => !itemLookupCache.has(bc),
      );

      if (barcodesToFetch.length > 0) {
        const barcodeChunks = chunkArray(barcodesToFetch, 1000);
        for (const chunk of barcodeChunks) {
          const itemRes = await client.query(
            `SELECT id, "barCode", "itemId", unit_cost 
             FROM "Item" 
             WHERE "barCode" = ANY($1) OR "itemId" = ANY($1)`,
            [chunk],
          );

          for (const item of itemRes.rows) {
            const cost = parseFloat(item.unit_cost) || 0;
            const entry = {
              id: item.id,
              barCode: item.barCode,
              itemId: item.itemId,
              unitCost: cost,
            };
            if (item.barCode) itemLookupCache.set(item.barCode, entry);
            if (item.itemId) itemLookupCache.set(item.itemId, entry);
          }
        }
      }

      const matchedBarcodes: Array<{
        barcode: string;
        itemId: string;
        qty: number;
        unitCost: number;
      }> = [];
      const unmatchedBarcodes: string[] = [];

      for (const bc of uniqueBarcodes) {
        const found = itemLookupCache.get(bc);
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

      console.log(
        `✔ Matched in Item table: ${matchedBarcodes.length.toLocaleString()} / ${uniqueBarcodes.length.toLocaleString()}`,
      );
      if (unmatchedBarcodes.length > 0) {
        console.warn(
          `⚠️ Unmatched Barcodes (${unmatchedBarcodes.length}):`,
          unmatchedBarcodes.slice(0, 10),
        );
      }

      // Check current state in database
      // 1. Existing opening balances for target FY (these will be replaced)
      const prevLedger = await client.query(
        `SELECT count(*)::int as count, COALESCE(SUM(qty), 0)::numeric as total_qty 
         FROM stock_ledgers 
         WHERE location_id = $1 
           AND movement_type = 'OPENING_BALANCE'
           AND ${targetFyCondition}`,
        [location.id],
      );
      const prevLedgerCount = prevLedger.rows[0].count;
      const prevLedgerQty = parseFloat(prevLedger.rows[0].total_qty);

      // 2. Existing opening balances for other FY (these are PROTECTED and MUST NOT BE DELETED)
      const otherLedger = await client.query(
        `SELECT count(*)::int as count, COALESCE(SUM(qty), 0)::numeric as total_qty 
         FROM stock_ledgers 
         WHERE location_id = $1 
           AND movement_type = 'OPENING_BALANCE'
           AND ${otherFyCondition}`,
        [location.id],
      );
      const otherLedgerCount = otherLedger.rows[0].count;
      const otherLedgerQty = parseFloat(otherLedger.rows[0].total_qty);

      const prevInv = await client.query(
        `SELECT count(*)::int as count, COALESCE(SUM(quantity), 0)::numeric as total_qty 
         FROM "InventoryItem" 
         WHERE "locationId" = $1`,
        [location.id],
      );
      const prevInvCount = prevInv.rows[0].count;
      const prevInvQty = parseFloat(prevInv.rows[0].total_qty);

      console.log(`\n📋 Current DB State for ${locCode}:`);
      console.log(
        `   - StockLedger FY ${targetFiscalYear} OPENING entries: ${prevLedgerCount.toLocaleString()} (Total Qty: ${prevLedgerQty.toLocaleString()})`,
      );
      console.log(
        `   - StockLedger FY ${otherFiscalYear} OPENING entries [🔒 PROTECTED]: ${otherLedgerCount.toLocaleString()} (Total Qty: ${otherLedgerQty.toLocaleString()})`,
      );
      console.log(
        `   - InventoryItem records: ${prevInvCount.toLocaleString()} (Total Qty: ${prevInvQty.toLocaleString()})`,
      );

      if (isDryRun) {
        console.log(`\n🔍 [DRY RUN MODE] No database modifications made.`);
        console.log(
          `   Would delete ${prevLedgerCount.toLocaleString()} existing FY ${targetFiscalYear} opening entries.`,
        );
        console.log(
          `   🔒 PROTECTED: ${otherLedgerCount.toLocaleString()} FY ${otherFiscalYear} opening entries will NOT be touched.`,
        );
        console.log(
          `   Would insert ${matchedBarcodes.filter((m) => m.qty > 0).length.toLocaleString()} positive FY ${targetFiscalYear} stock ledger entries.`,
        );
        if (shouldSyncInventory) {
          console.log(
            `   Would synchronize ${matchedBarcodes.length.toLocaleString()} InventoryItem balances.`,
          );
        } else {
          console.log(
            `   ℹ️ InventoryItem sync is SKIPPED for FY ${targetFiscalYear} (preserves current FY ${otherFiscalYear} on-hand stock).`,
          );
        }

        summaries.push({
          locationCode: location.code,
          locationName: location.name,
          warehouseCode: targetWarehouseCode,
          fiscalYear: targetFiscalYear,
          totalJsonItems: uniqueBarcodes.length,
          positiveQtyItems: totalPositiveItems,
          zeroQtyItems: totalZeroItems,
          totalOpeningQty: totalSumQty,
          matchedItems: matchedBarcodes.length,
          unmatchedItems: unmatchedBarcodes.length,
          previousLedgerRows: prevLedgerCount,
          preservedLedgerRows: otherLedgerCount,
          newLedgerRowsInserted: matchedBarcodes.filter((m) => m.qty > 0)
            .length,
          inventoryItemsUpdated: 0,
          inventoryItemsInserted: 0,
          inventoryItemsZeroed: 0,
          status: 'DRY_RUN',
        });
        continue;
      }

      // 5. Execute DB Transaction
      console.log(`\n💾 Executing database transaction...`);
      await client.query('BEGIN');

      try {
        // A. Delete existing OPENING_BALANCE entries ONLY for the target fiscal year!
        // CRITICAL: NEVER delete opening entries of the other fiscal year (e.g. FY 26-27 is strictly preserved)
        const delRes = await client.query(
          `DELETE FROM stock_ledgers 
           WHERE location_id = $1 
             AND movement_type = 'OPENING_BALANCE'
             AND ${targetFyCondition}`,
          [location.id],
        );
        console.log(
          `   ✔ Deleted ${delRes.rowCount} previous FY ${targetFiscalYear} OPENING_BALANCE entries.`,
        );
        console.log(
          `   🔒 Preserved ${otherLedgerCount.toLocaleString()} FY ${otherFiscalYear} OPENING_BALANCE entries (NOT touched).`,
        );

        // B. Insert new OPENING_BALANCE entries (only for items with qty > 0)
        const positiveItems = matchedBarcodes.filter((m) => m.qty > 0);
        const refId = `OPENING_${isFy2526 ? '25_26_' : ''}${location.code}`;
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

        console.log(
          `   ✔ Inserted ${insertedCount.toLocaleString()} new FY ${targetFiscalYear} OPENING_BALANCE stock ledger entries.`,
        );

        // C. Synchronize InventoryItem quantities for this location (if enabled)
        let invUpdated = 0;
        let invInserted = 0;
        let invZeroed = 0;

        if (shouldSyncInventory) {
          const matchedItemIds = matchedBarcodes.map((m) => m.itemId);
          const invChunks = chunkArray(matchedBarcodes, 1000);

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
            const updateRes = await client.query(
              `
              UPDATE "InventoryItem" inv
              SET quantity = t.target_qty,
                  "updatedAt" = NOW()
              FROM temp_inv_sync t
              WHERE inv."itemId" = t.item_id
                AND inv."locationId" = $1
                AND inv."warehouseId" = $2;
            `,
              [location.id, targetWarehouseId],
            );
            invUpdated += updateRes.rowCount || 0;

            // Insert missing InventoryItem (only for qty > 0)
            const insertRes = await client.query(
              `
              INSERT INTO "InventoryItem" (
                id, "warehouseId", "locationId", "itemId", quantity, status, "createdAt", "updatedAt"
              )
              SELECT 
                gen_random_uuid()::text, $1, $2, t.item_id, t.target_qty, 'AVAILABLE', NOW(), NOW()
              FROM temp_inv_sync t
              WHERE t.target_qty > 0
                AND NOT EXISTS (
                  SELECT 1 FROM "InventoryItem" inv
                  WHERE inv."itemId" = t.item_id
                    AND inv."locationId" = $2
                    AND inv."warehouseId" = $1
                );
            `,
              [targetWarehouseId, location.id],
            );
            invInserted += insertRes.rowCount || 0;

            await client.query(`DROP TABLE IF EXISTS temp_inv_sync;`);
          }

          // Zero out any remaining InventoryItem for this location that had stock before but is not in new opening
          const cleanMatchedItemIds = matchedItemIds.filter(Boolean);
          if (cleanMatchedItemIds.length > 0) {
            const zeroRes = await client.query(
              `UPDATE "InventoryItem" 
               SET quantity = 0, "updatedAt" = NOW()
               WHERE "locationId" = $1 
                 AND quantity > 0
                 AND "itemId" NOT IN (SELECT unnest($2::text[]))`,
              [location.id, cleanMatchedItemIds],
            );
            invZeroed = zeroRes.rowCount || 0;
          } else {
            const zeroRes = await client.query(
              `UPDATE "InventoryItem" 
               SET quantity = 0, "updatedAt" = NOW()
               WHERE "locationId" = $1 
                 AND quantity > 0`,
              [location.id],
            );
            invZeroed = zeroRes.rowCount || 0;
          }

          console.log(
            `   ✔ InventoryItem Updated: ${invUpdated.toLocaleString()}`,
          );
          console.log(
            `   ✔ InventoryItem Inserted: ${invInserted.toLocaleString()}`,
          );
          console.log(
            `   ✔ InventoryItem Reset to 0: ${invZeroed.toLocaleString()}`,
          );
        } else {
          console.log(
            `   ℹ️ InventoryItem synchronization SKIPPED for FY ${targetFiscalYear} to preserve current FY ${otherFiscalYear} on-hand inventory.`,
          );
        }

        await client.query('COMMIT');
        console.log(`\n✅ Transaction committed successfully for ${locCode}!`);

        // D. Verify Final State
        const finalTargetLedger = await client.query(
          `SELECT count(*)::int as count, COALESCE(SUM(qty), 0)::numeric as total_qty 
           FROM stock_ledgers 
           WHERE location_id = $1 
             AND movement_type = 'OPENING_BALANCE'
             AND ${targetFyCondition}`,
          [location.id],
        );
        const finalOtherLedger = await client.query(
          `SELECT count(*)::int as count, COALESCE(SUM(qty), 0)::numeric as total_qty 
           FROM stock_ledgers 
           WHERE location_id = $1 
             AND movement_type = 'OPENING_BALANCE'
             AND ${otherFyCondition}`,
          [location.id],
        );
        const finalInv = await client.query(
          `SELECT count(*)::int as count, COALESCE(SUM(quantity), 0)::numeric as total_qty 
           FROM "InventoryItem" 
           WHERE "locationId" = $1`,
          [location.id],
        );

        console.log(`\n🎉 New Verified State for ${locCode}:`);
        console.log(
          `   - StockLedger FY ${targetFiscalYear} OPENING: ${finalTargetLedger.rows[0].count} entries, Total Qty = ${finalTargetLedger.rows[0].total_qty}`,
        );
        console.log(
          `   - StockLedger FY ${otherFiscalYear} OPENING [PRESERVED]: ${finalOtherLedger.rows[0].count} entries, Total Qty = ${finalOtherLedger.rows[0].total_qty}`,
        );
        console.log(
          `   - InventoryItem in Location: ${finalInv.rows[0].count} records, Total Qty = ${finalInv.rows[0].total_qty}`,
        );

        summaries.push({
          locationCode: location.code,
          locationName: location.name,
          warehouseCode: targetWarehouseCode,
          fiscalYear: targetFiscalYear,
          totalJsonItems: uniqueBarcodes.length,
          positiveQtyItems: totalPositiveItems,
          zeroQtyItems: totalZeroItems,
          totalOpeningQty: totalSumQty,
          matchedItems: matchedBarcodes.length,
          unmatchedItems: unmatchedBarcodes.length,
          previousLedgerRows: prevLedgerCount,
          preservedLedgerRows: otherLedgerCount,
          newLedgerRowsInserted: insertedCount,
          inventoryItemsUpdated: invUpdated,
          inventoryItemsInserted: invInserted,
          inventoryItemsZeroed: invZeroed,
          status: 'SUCCESS',
        });
      } catch (txErr: any) {
        await client.query('ROLLBACK');
        console.error(
          `❌ Transaction failed and rolled back for ${locCode}: ${txErr.message}`,
          txErr.stack,
        );
        summaries.push({
          locationCode: location.code,
          locationName: location.name,
          warehouseCode: targetWarehouseCode,
          fiscalYear: targetFiscalYear,
          totalJsonItems: uniqueBarcodes.length,
          positiveQtyItems: totalPositiveItems,
          zeroQtyItems: totalZeroItems,
          totalOpeningQty: totalSumQty,
          matchedItems: matchedBarcodes.length,
          unmatchedItems: unmatchedBarcodes.length,
          previousLedgerRows: prevLedgerCount,
          preservedLedgerRows: otherLedgerCount,
          newLedgerRowsInserted: 0,
          inventoryItemsUpdated: 0,
          inventoryItemsInserted: 0,
          inventoryItemsZeroed: 0,
          status: 'FAILED',
          error: txErr.message,
        });
      }
    }

    // Print summary report across all processed locations
    if (summaries.length > 0) {
      console.log(
        `\n========================================================================================================`,
      );
      console.log(
        `📊 EXECUTION SUMMARY REPORT (${summaries.length} location(s))`,
      );
      console.log(
        `========================================================================================================`,
      );
      console.table(
        summaries.map((s) => ({
          'Loc Code': s.locationCode,
          'Location Name': s.locationName.slice(0, 20),
          FY: s.fiscalYear,
          'Total Qty': s.totalOpeningQty,
          'Items (+ve)': s.positiveQtyItems,
          Matched: s.matchedItems,
          'Ledger Ins': s.newLedgerRowsInserted,
          'Del (Target FY)': s.previousLedgerRows,
          'Preserved (26-27)': s.preservedLedgerRows,
          'Inv Upd': s.inventoryItemsUpdated,
          'Inv Ins': s.inventoryItemsInserted,
          'Inv Zeroed': s.inventoryItemsZeroed,
          Status: s.status,
        })),
      );
    }
  } finally {
    client.release();
    await pool.end();
  }
}

function getArgValue(args: string[], flags: string[]): string | undefined {
  for (const flag of flags) {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (
        arg === flag &&
        i + 1 < args.length &&
        !args[i + 1].startsWith('--')
      ) {
        return args[i + 1];
      }
      if (arg.startsWith(`${flag}=`)) {
        return arg.slice(flag.length + 1);
      }
    }
  }
  return undefined;
}

function getAllArgValues(args: string[], flags: string[]): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    for (const flag of flags) {
      if (
        arg === flag &&
        i + 1 < args.length &&
        !args[i + 1].startsWith('--')
      ) {
        values.push(args[i + 1]);
      } else if (arg.startsWith(`${flag}=`)) {
        values.push(arg.slice(flag.length + 1));
      }
    }
  }
  return values;
}

/**
 * CLI Runner
 */
async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');

  let filePath = '';
  const fileArg = getArgValue(args, ['--file', '-f']);
  if (fileArg) {
    filePath = path.isAbsolute(fileArg)
      ? fileArg
      : path.resolve(process.cwd(), fileArg);
  } else {
    // Default candidate: check for new wide opening stock JSON, then fallback to old flat format
    const candidates = [
      path.resolve(__dirname, '..', 'data', 'opening stock location wise against Netsales 01-07-2025 to 30-06-2026.json'),
      path.resolve(__dirname, '..', 'data', 'SS_LG_25-26_opening.json'),
    ];
    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        filePath = cand;
        break;
      }
    }
  }

  if (!filePath || !fs.existsSync(filePath)) {
    console.error(
      `❌ File not found at: ${filePath}. Please supply via --file <path> or --file=<path>`,
    );
    process.exit(1);
  }

  const rawLocValues = getAllArgValues(args, ['--location', '-l']);
  const locationFilters =
    rawLocValues.length > 0
      ? rawLocValues
          .flatMap((v) => v.split(/[,\s]+/))
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
      : null;
  const warehouseOverride = getArgValue(args, ['--warehouse', '-w']) || null;
  const openingDateStr =
    getArgValue(args, ['--opening-date', '--date', '-d']) || undefined;
  const tenantFilter = getArgValue(args, ['--tenant', '-t']) || null;
  const fiscalYearArg =
    getArgValue(args, ['--fy', '--fiscal-year', '--year']) || undefined;
  const forceSyncInventory =
    args.includes('--sync-inventory') || args.includes('--sync-inv');
  const skipSyncInventory =
    args.includes('--skip-inventory-sync') ||
    args.includes('--no-sync-inventory') ||
    args.includes('--skip-inv-sync');

  // Detect target Fiscal Year for banner
  let isFy2526Banner = false;
  if (fiscalYearArg) {
    isFy2526Banner = [
      '25-26',
      '2526',
      '25_26',
      '2025-2026',
      '2025_2026',
    ].includes(fiscalYearArg.trim().toLowerCase());
  } else if (openingDateStr) {
    const d = new Date(openingDateStr);
    isFy2526Banner =
      d.getFullYear() === 2025 || d < new Date('2026-06-01T00:00:00.000Z');
  } else if (filePath) {
    const p = filePath.toLowerCase();
    isFy2526Banner =
      p.includes('25-26') ||
      p.includes('2526') ||
      p.includes('25_26') ||
      p.includes('2025-2026') ||
      p.includes('2025_2026') ||
      p.includes('2025 to 2026') ||
      p.includes('01-07-2025') ||
      p.includes('2025-07-01') ||
      /2025.*2026/.test(p) ||
      /25.*26/.test(p);
  }

  const targetFyName = isFy2526Banner ? '25-26' : '26-27';
  const otherFyName = isFy2526Banner ? '26-27' : '25-26';

  console.log(
    `========================================================================`,
  );
  console.log(
    `📦 Speed (pvt.) Limited - Opening Balance Uploader (Target: FY ${targetFyName})`,
  );
  console.log(
    `========================================================================`,
  );
  console.log(`📂 Source File: ${filePath}`);
  console.log(
    `📅 Target Fiscal Year: FY ${targetFyName} | Opening Date: ${openingDateStr || (isFy2526Banner ? '2025-06-30T19:00:00.000Z (2025-07-01 PKT)' : '2026-06-30T19:00:00.000Z (2026-07-01 PKT)')}`,
  );
  console.log(
    `🛡️ Safety Guard: Existing FY ${otherFyName} opening records will NOT be deleted`,
  );
  console.log(
    `⚙️ Options: Dry Run: ${isDryRun} | Location Filter: ${locationFilters ? locationFilters.join(', ') : 'All Stores'} | Warehouse: ${warehouseOverride || 'C40001 (auto)'}`,
  );

  const rawJson = fs.readFileSync(filePath, 'utf8');
  const rawRecords = JSON.parse(rawJson);
  const records = parseOpeningData(rawRecords);
  console.log(
    `✔ Loaded ${rawRecords.length.toLocaleString()} raw rows from JSON, parsed into ${records.length.toLocaleString()} store entries.`,
  );

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  const directDbUrl = process.env.DATABASE_URL;

  // Single direct DB if flag or if no management URL
  if (directDbUrl && (!managementUrl || args.includes('--single-db'))) {
    console.log(`🔗 Connecting directly via DATABASE_URL...`);
    await processOpeningsForTenant(directDbUrl, records, {
      isDryRun,
      locationFilters,
      warehouseCodeOverride: warehouseOverride,
      openingDateStr,
      filePath,
      fiscalYearArg,
      forceSyncInventory,
      skipSyncInventory,
    });
    return;
  }

  if (!managementUrl || !masterKey) {
    if (directDbUrl) {
      console.log(`🔗 Connecting via DATABASE_URL...`);
      await processOpeningsForTenant(directDbUrl, records, {
        isDryRun,
        locationFilters,
        warehouseCodeOverride: warehouseOverride,
        openingDateStr,
        filePath,
        fiscalYearArg,
        forceSyncInventory,
        skipSyncInventory,
      });
      return;
    }
    console.error(
      '❌ Neither DATABASE_URL nor DATABASE_URL_MANAGEMENT + MASTER_ENCRYPTION_KEY found in .env',
    );
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
      console.log(
        `\n🏢 Tenant Company: ${company.name} (${company.code}) [DB: ${company.dbName}]`,
      );
      let connectionString = company.dbUrl;
      if (company.dbPassword) {
        try {
          const decPassword = encodeURIComponent(
            decrypt(company.dbPassword, masterKey),
          );
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
        locationFilters,
        warehouseCodeOverride: warehouseOverride,
        openingDateStr,
        filePath,
        fiscalYearArg,
        forceSyncInventory,
        skipSyncInventory,
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
