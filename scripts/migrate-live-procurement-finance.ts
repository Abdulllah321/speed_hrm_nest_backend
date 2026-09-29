import { Pool, PoolClient } from 'pg';

const livePool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/spl_live_temp',
});

const localPool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi',
});

// Helper to get common columns between live and local for any table
async function getCommonColumns(tableName: string): Promise<string[]> {
  const q = `
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `;
  const liveCols = (await livePool.query(q, [tableName])).rows.map(r => r.column_name);
  const localCols = (await localPool.query(q, [tableName])).rows.map(r => r.column_name);
  const localSet = new Set(localCols);
  return liveCols.filter(col => localSet.has(col));
}

// Helper to copy records by IDs with dynamic column mapping
async function copyTableByIds(
  client: PoolClient,
  tableName: string,
  idList: string[],
  idColumn: string = 'id',
  quoted: boolean = false
) {
  if (idList.length === 0) return 0;
  const tName = quoted ? `"${tableName}"` : tableName;
  const idCol = idColumn.includes('"') ? idColumn : `"${idColumn}"`;

  const commonCols = await getCommonColumns(tableName);
  const colSql = commonCols.map(c => `"${c}"`).join(', ');

  // Fetch from live
  const placeholders = idList.map((_, i) => `$${i + 1}`).join(',');
  const liveData = await livePool.query(
    `SELECT ${colSql} FROM ${tName} WHERE ${idCol} IN (${placeholders})`,
    idList
  );

  if (liveData.rows.length === 0) return 0;

  // Insert into local
  let inserted = 0;
  const chunkSize = 100;
  for (let i = 0; i < liveData.rows.length; i += chunkSize) {
    const chunk = liveData.rows.slice(i, i + chunkSize);
    for (const row of chunk) {
      const vals = commonCols.map(c => row[c]);
      const valPlaceholders = vals.map((_, idx) => `$${idx + 1}`).join(',');
      try {
        await client.query(
          `INSERT INTO ${tName} (${colSql}) VALUES (${valPlaceholders}) ON CONFLICT DO NOTHING`,
          vals
        );
        inserted++;
      } catch (err: any) {
        console.error(`Error inserting into ${tName} (${idCol}=${row[idColumn]}):`, err.message);
        throw err;
      }
    }
  }

  return inserted;
}

async function runMigration() {
  const isCommit = process.argv.includes('--commit');
  console.log(`=======================================================`);
  console.log(` MIGRATION MODE: ${isCommit ? '*** REAL COMMIT ***' : '--- DRY RUN (Testing) ---'}`);
  console.log(`=======================================================\n`);

  const localClient = await localPool.connect();

  try {
    await localClient.query('BEGIN');

    // ----------------------------------------------------
    // STEP 1: MASTER PREREQUISITES (Category, Size, Season, Item, ChartOfAccount)
    // ----------------------------------------------------
    console.log('--- Step 1: Syncing Master Prerequisites ---');

    // 1.1 Category
    const liveCats = await livePool.query(`SELECT id FROM "Category"`);
    const localCats = await localClient.query(`SELECT id FROM "Category"`);
    const localCatSet = new Set(localCats.rows.map(r => r.id));
    const missingCatIds = liveCats.rows.filter(r => !localCatSet.has(r.id)).map(r => r.id);
    if (missingCatIds.length > 0) {
      const c = await copyTableByIds(localClient, 'Category', missingCatIds, 'id', true);
      console.log(`  Synced Category: ${c} records`);
    } else {
      console.log(`  Category already in sync`);
    }

    // 1.2 Size
    const liveSizes = await livePool.query(`SELECT id FROM "Size"`);
    const localSizes = await localClient.query(`SELECT id FROM "Size"`);
    const localSizeSet = new Set(localSizes.rows.map(r => r.id));
    const missingSizeIds = liveSizes.rows.filter(r => !localSizeSet.has(r.id)).map(r => r.id);
    if (missingSizeIds.length > 0) {
      const c = await copyTableByIds(localClient, 'Size', missingSizeIds, 'id', true);
      console.log(`  Synced Size: ${c} records`);
    } else {
      console.log(`  Size already in sync`);
    }

    // 1.3 Season
    const liveSeasons = await livePool.query(`SELECT id FROM "Season"`);
    const localSeasons = await localClient.query(`SELECT id FROM "Season"`);
    const localSeasonSet = new Set(localSeasons.rows.map(r => r.id));
    const missingSeasonIds = liveSeasons.rows.filter(r => !localSeasonSet.has(r.id)).map(r => r.id);
    if (missingSeasonIds.length > 0) {
      const c = await copyTableByIds(localClient, 'Season', missingSeasonIds, 'id', true);
      console.log(`  Synced Season: ${c} records`);
    } else {
      console.log(`  Season already in sync`);
    }

    // 1.4 Item
    const liveItems = await livePool.query(`SELECT id FROM "Item"`);
    const localItems = await localClient.query(`SELECT id FROM "Item"`);
    const localItemSet = new Set(localItems.rows.map(r => r.id));
    const missingItemIds = liveItems.rows.filter(r => !localItemSet.has(r.id)).map(r => r.id);
    if (missingItemIds.length > 0) {
      const c = await copyTableByIds(localClient, 'Item', missingItemIds, 'id', true);
      console.log(`  Synced Item: ${c} records`);
    } else {
      console.log(`  Item already in sync`);
    }

    // 1.5 ChartOfAccount
    const liveCoA = await livePool.query(`SELECT id, "parentId" FROM "ChartOfAccount"`);
    const localCoA = await localClient.query(`SELECT id FROM "ChartOfAccount"`);
    const localCoASet = new Set(localCoA.rows.map(r => r.id));
    const missingCoAIds = liveCoA.rows.filter(r => !localCoASet.has(r.id)).map(r => r.id);
    if (missingCoAIds.length > 0) {
      // First insert missing CoA with parentId set to null to avoid self-referential FK constraint violations
      const commonCols = await getCommonColumns('ChartOfAccount');
      const colSql = commonCols.map(c => `"${c}"`).join(', ');
      const placeholders = missingCoAIds.map((_, i) => `$${i + 1}`).join(',');
      const rows = await livePool.query(
        `SELECT ${colSql} FROM "ChartOfAccount" WHERE id IN (${placeholders})`,
        missingCoAIds
      );

      for (const row of rows.rows) {
        // Temporarily null parentId if parent doesn't exist yet
        const parentExists = row.parentId && (localCoASet.has(row.parentId) || missingCoAIds.includes(row.parentId));
        const tempParentId = parentExists ? row.parentId : null;
        const vals = commonCols.map(c => c === 'parentId' ? tempParentId : row[c]);
        const valPlaceholders = vals.map((_, idx) => `$${idx + 1}`).join(',');
        await localClient.query(
          `INSERT INTO "ChartOfAccount" (${colSql}) VALUES (${valPlaceholders}) ON CONFLICT DO NOTHING`,
          vals
        );
      }
      // Second pass: restore true parentIds
      for (const row of rows.rows) {
        if (row.parentId) {
          await localClient.query(`UPDATE "ChartOfAccount" SET "parentId" = $1 WHERE id = $2`, [row.parentId, row.id]);
        }
      }
      console.log(`  Synced ChartOfAccount: ${missingCoAIds.length} records`);
    } else {
      console.log(`  ChartOfAccount already in sync`);
    }

    // ----------------------------------------------------
    // STEP 2: PROCUREMENT CASCADE (PO -> GRN -> LC -> PI -> PR -> DN)
    // ----------------------------------------------------
    console.log('\n--- Step 2: Syncing Procurement Documents ---');

    // 2.1 Purchase Orders
    const livePOs = await livePool.query(`SELECT id, "po_number" FROM purchase_orders ORDER BY "created_at" ASC`);
    const localPOs = await localClient.query(`SELECT id FROM purchase_orders`);
    const localPOSet = new Set(localPOs.rows.map(r => r.id));
    const missingPOIds = livePOs.rows.filter(r => !localPOSet.has(r.id)).map(r => r.id);

    if (missingPOIds.length > 0) {
      const cPO = await copyTableByIds(localClient, 'purchase_orders', missingPOIds);
      console.log(`  Synced purchase_orders: ${cPO} records`);

      // 2.1.1 Purchase Order Items
      const livePOItems = await livePool.query(
        `SELECT id FROM purchase_order_items WHERE "purchase_order_id" = ANY($1)`,
        [missingPOIds]
      );
      const cPOI = await copyTableByIds(localClient, 'purchase_order_items', livePOItems.rows.map(r => r.id));
      console.log(`  Synced purchase_order_items: ${cPOI} records`);
    } else {
      console.log(`  purchase_orders already in sync`);
    }

    // 2.2 Goods Receipt Notes (GRN)
    const liveGRNs = await livePool.query(`SELECT id, "grn_number" FROM goods_receipt_notes ORDER BY "created_at" ASC`);
    const localGRNs = await localClient.query(`SELECT id FROM goods_receipt_notes`);
    const localGRNSet = new Set(localGRNs.rows.map(r => r.id));
    const missingGRNIds = liveGRNs.rows.filter(r => !localGRNSet.has(r.id)).map(r => r.id);

    if (missingGRNIds.length > 0) {
      const cGRN = await copyTableByIds(localClient, 'goods_receipt_notes', missingGRNIds);
      console.log(`  Synced goods_receipt_notes: ${cGRN} records`);

      // 2.2.1 GRN Items
      const liveGRNItems = await livePool.query(
        `SELECT id FROM goods_receipt_note_items WHERE "goods_receipt_note_id" = ANY($1)`,
        [missingGRNIds]
      );
      const cGRNI = await copyTableByIds(localClient, 'goods_receipt_note_items', liveGRNItems.rows.map(r => r.id));
      console.log(`  Synced goods_receipt_note_items: ${cGRNI} records`);
    } else {
      console.log(`  goods_receipt_notes already in sync`);
    }

    // 2.3 Landed Costs (LC)
    const liveLCs = await livePool.query(`SELECT id, "landed_cost_number" FROM landed_costs ORDER BY "created_at" ASC`);
    const localLCs = await localClient.query(`SELECT id FROM landed_costs`);
    const localLCSet = new Set(localLCs.rows.map(r => r.id));
    const missingLCIds = liveLCs.rows.filter(r => !localLCSet.has(r.id)).map(r => r.id);

    if (missingLCIds.length > 0) {
      const cLC = await copyTableByIds(localClient, 'landed_costs', missingLCIds);
      console.log(`  Synced landed_costs: ${cLC} records`);

      // 2.3.1 LC Items
      const liveLCItems = await livePool.query(
        `SELECT id FROM landed_cost_items WHERE "landed_cost_id" = ANY($1)`,
        [missingLCIds]
      );
      const cLCI = await copyTableByIds(localClient, 'landed_cost_items', liveLCItems.rows.map(r => r.id));
      console.log(`  Synced landed_cost_items: ${cLCI} records`);
    } else {
      console.log(`  landed_costs already in sync`);
    }

    // 2.4 Purchase Invoices (PI)
    const livePIs = await livePool.query(`SELECT id, "invoice_number" FROM purchase_invoices ORDER BY "created_at" ASC`);
    const localPIs = await localClient.query(`SELECT id FROM purchase_invoices`);
    const localPISet = new Set(localPIs.rows.map(r => r.id));
    const missingPIIds = livePIs.rows.filter(r => !localPISet.has(r.id)).map(r => r.id);

    if (missingPIIds.length > 0) {
      const cPI = await copyTableByIds(localClient, 'purchase_invoices', missingPIIds);
      console.log(`  Synced purchase_invoices: ${cPI} records`);

      // 2.4.1 PI Items
      const livePIItems = await livePool.query(
        `SELECT id FROM purchase_invoice_items WHERE "purchase_invoice_id" = ANY($1)`,
        [missingPIIds]
      );
      const cPII = await copyTableByIds(localClient, 'purchase_invoice_items', livePIItems.rows.map(r => r.id));
      console.log(`  Synced purchase_invoice_items: ${cPII} records`);
    } else {
      console.log(`  purchase_invoices already in sync`);
    }

    // 2.5 Purchase Returns (PR)
    const livePRs = await livePool.query(`SELECT id, "return_number" FROM purchase_returns ORDER BY "created_at" ASC`);
    const localPRs = await localClient.query(`SELECT id FROM purchase_returns`);
    const localPRSet = new Set(localPRs.rows.map(r => r.id));
    const missingPRIds = livePRs.rows.filter(r => !localPRSet.has(r.id)).map(r => r.id);

    if (missingPRIds.length > 0) {
      const cPR = await copyTableByIds(localClient, 'purchase_returns', missingPRIds);
      console.log(`  Synced purchase_returns: ${cPR} records`);

      // 2.5.1 PR Items
      const livePRItems = await livePool.query(
        `SELECT id FROM purchase_return_items WHERE "purchase_return_id" = ANY($1)`,
        [missingPRIds]
      );
      const cPRI = await copyTableByIds(localClient, 'purchase_return_items', livePRItems.rows.map(r => r.id));
      console.log(`  Synced purchase_return_items: ${cPRI} records`);
    } else {
      console.log(`  purchase_returns already in sync`);
    }

    // 2.6 Debit Notes
    const liveDNs = await livePool.query(`SELECT id FROM debit_notes`);
    const localDNs = await localClient.query(`SELECT id FROM debit_notes`);
    const localDNSet = new Set(localDNs.rows.map(r => r.id));
    const missingDNIds = liveDNs.rows.filter(r => !localDNSet.has(r.id)).map(r => r.id);

    if (missingDNIds.length > 0) {
      const cDN = await copyTableByIds(localClient, 'debit_notes', missingDNIds);
      console.log(`  Synced debit_notes: ${cDN} records`);
    } else {
      console.log(`  debit_notes already in sync`);
    }

    // ----------------------------------------------------
    // STEP 3: LEDGERS (supplier_ledger & stock_ledgers)
    // ----------------------------------------------------
    console.log('\n--- Step 3: Syncing Ledgers ---');

    // 3.1 supplier_ledger
    const liveSL = await livePool.query(`SELECT id FROM supplier_ledger`);
    const localSL = await localClient.query(`SELECT id FROM supplier_ledger`);
    const localSLSet = new Set(localSL.rows.map(r => r.id));
    const missingSLIds = liveSL.rows.filter(r => !localSLSet.has(r.id)).map(r => r.id);

    if (missingSLIds.length > 0) {
      const cSL = await copyTableByIds(localClient, 'supplier_ledger', missingSLIds);
      console.log(`  Synced supplier_ledger: ${cSL} records`);
    } else {
      console.log(`  supplier_ledger already in sync`);
    }

    // 3.2 stock_ledgers (for LANDED_COST & PURCHASE_RETURN_INV)
    const targetRefIds = [...missingLCIds, ...missingPRIds];
    if (targetRefIds.length > 0) {
      const liveStockEntries = await livePool.query(
        `SELECT id FROM stock_ledgers WHERE reference_type IN ('LANDED_COST', 'PURCHASE_RETURN_INV') AND reference_id = ANY($1)`,
        [targetRefIds]
      );
      const localStockEntries = await localClient.query(
        `SELECT id FROM stock_ledgers WHERE reference_type IN ('LANDED_COST', 'PURCHASE_RETURN_INV') AND reference_id = ANY($1)`,
        [targetRefIds]
      );
      const localStockSet = new Set(localStockEntries.rows.map(r => r.id.toString()));
      const missingStockIds = liveStockEntries.rows
        .filter(r => !localStockSet.has(r.id.toString()))
        .map(r => r.id.toString());

      if (missingStockIds.length > 0) {
        const cStock = await copyTableByIds(localClient, 'stock_ledgers', missingStockIds);
        console.log(`  Synced stock_ledgers (Procurement & Returns): ${cStock} records`);
      } else {
        console.log(`  stock_ledgers for new LCs/PRs already in sync`);
      }
    }

    // ----------------------------------------------------
    // STEP 4: FINANCIAL VOUCHERS (JV, PV, RV, AccountTransaction)
    // ----------------------------------------------------
    console.log('\n--- Step 4: Syncing Financial Vouchers ---');

    // 4.1 Journal Vouchers
    const liveJVs = await livePool.query(`SELECT id FROM "JournalVoucher"`);
    const localJVs = await localClient.query(`SELECT id FROM "JournalVoucher"`);
    const localJVSet = new Set(localJVs.rows.map(r => r.id));
    const missingJVIds = liveJVs.rows.filter(r => !localJVSet.has(r.id)).map(r => r.id);

    if (missingJVIds.length > 0) {
      const cJV = await copyTableByIds(localClient, 'JournalVoucher', missingJVIds, 'id', true);
      console.log(`  Synced JournalVoucher: ${cJV} records`);

      // 4.1.1 JV Details
      const liveJVDetails = await livePool.query(
        `SELECT id FROM "JournalVoucherDetail" WHERE "journalVoucherId" = ANY($1)`,
        [missingJVIds]
      );
      const cJVD = await copyTableByIds(localClient, 'JournalVoucherDetail', liveJVDetails.rows.map(r => r.id), 'id', true);
      console.log(`  Synced JournalVoucherDetail: ${cJVD} records`);
    } else {
      console.log(`  JournalVoucher already in sync`);
    }

    // 4.2 Payment Vouchers
    const livePVs = await livePool.query(`SELECT id FROM "PaymentVoucher"`);
    const localPVs = await localClient.query(`SELECT id FROM "PaymentVoucher"`);
    const localPVSet = new Set(localPVs.rows.map(r => r.id));
    const missingPVIds = livePVs.rows.filter(r => !localPVSet.has(r.id)).map(r => r.id);

    if (missingPVIds.length > 0) {
      const cPV = await copyTableByIds(localClient, 'PaymentVoucher', missingPVIds, 'id', true);
      console.log(`  Synced PaymentVoucher: ${cPV} records`);

      // 4.2.1 PV Details
      const livePVDetails = await livePool.query(
        `SELECT id FROM "PaymentVoucherDetail" WHERE "paymentVoucherId" = ANY($1)`,
        [missingPVIds]
      );
      const cPVD = await copyTableByIds(localClient, 'PaymentVoucherDetail', livePVDetails.rows.map(r => r.id), 'id', true);
      console.log(`  Synced PaymentVoucherDetail: ${cPVD} records`);
    } else {
      console.log(`  PaymentVoucher already in sync`);
    }

    // 4.3 Receipt Vouchers
    const liveRVs = await livePool.query(`SELECT id FROM "ReceiptVoucher"`);
    const localRVs = await localClient.query(`SELECT id FROM "ReceiptVoucher"`);
    const localRVSet = new Set(localRVs.rows.map(r => r.id));
    const missingRVIds = liveRVs.rows.filter(r => !localRVSet.has(r.id)).map(r => r.id);

    if (missingRVIds.length > 0) {
      const cRV = await copyTableByIds(localClient, 'ReceiptVoucher', missingRVIds, 'id', true);
      console.log(`  Synced ReceiptVoucher: ${cRV} records`);

      // 4.3.1 RV Details
      const liveRVDetails = await livePool.query(
        `SELECT id FROM "ReceiptVoucherDetail" WHERE "receiptVoucherId" = ANY($1)`,
        [missingRVIds]
      );
      const cRVD = await copyTableByIds(localClient, 'ReceiptVoucherDetail', liveRVDetails.rows.map(r => r.id), 'id', true);
      console.log(`  Synced ReceiptVoucherDetail: ${cRVD} records`);
    } else {
      console.log(`  ReceiptVoucher already in sync`);
    }

    // 4.4 Account Transactions for migrated vouchers
    const allMigratedVoucherIds = [...missingJVIds, ...missingPVIds, ...missingRVIds];
    if (allMigratedVoucherIds.length > 0) {
      const liveATs = await livePool.query(
        `SELECT id FROM "AccountTransaction" WHERE "sourceId" = ANY($1)`,
        [allMigratedVoucherIds]
      );
      const localATs = await localClient.query(
        `SELECT id FROM "AccountTransaction" WHERE "sourceId" = ANY($1)`,
        [allMigratedVoucherIds]
      );
      const localATSet = new Set(localATs.rows.map(r => r.id));
      const missingATIds = liveATs.rows.filter(r => !localATSet.has(r.id)).map(r => r.id);

      if (missingATIds.length > 0) {
        const cAT = await copyTableByIds(localClient, 'AccountTransaction', missingATIds, 'id', true);
        console.log(`  Synced AccountTransaction: ${cAT} records`);
      } else {
        console.log(`  AccountTransaction for new vouchers already in sync`);
      }
    }

    // ----------------------------------------------------
    // FINAL COMMIT / ROLLBACK
    // ----------------------------------------------------
    if (isCommit) {
      await localClient.query('COMMIT');
      console.log(`\n>>> SUCCESS: MIGRATION COMMITTED TO LOCAL DATABASE! <<<`);
    } else {
      await localClient.query('ROLLBACK');
      console.log(`\n>>> DRY RUN COMPLETED SUCCESSFULLY! No changes were written. Run with --commit to apply. <<<`);
    }

  } catch (err: any) {
    await localClient.query('ROLLBACK');
    console.error(`\n>>> MIGRATION FAILED: Rolled back transaction. Error:`, err);
    throw err;
  } finally {
    localClient.release();
    await livePool.end();
    await localPool.end();
  }
}

runMigration().catch(console.error);
