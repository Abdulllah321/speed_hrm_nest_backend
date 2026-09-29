import { Pool } from 'pg';

const livePool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/spl_live_temp',
});

const localPool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi',
});

async function checkDependencies() {
  console.log('--- Checking Prerequisites & Dependencies ---');

  // 1. Missing Suppliers
  const liveSuppliers = await livePool.query(`SELECT id, name, code FROM "Supplier"`);
  const localSuppliers = await localPool.query(`SELECT id FROM "Supplier"`);
  const localSupplierIds = new Set(localSuppliers.rows.map(r => r.id));
  const missingSuppliers = liveSuppliers.rows.filter(r => !localSupplierIds.has(r.id));
  console.log(`Suppliers: Live = ${liveSuppliers.rows.length}, Local = ${localSuppliers.rows.length}, Missing in Local = ${missingSuppliers.length}`);

  // 2. Missing Warehouses
  const liveWarehouses = await livePool.query(`SELECT id, name, code FROM "Warehouse"`);
  const localWarehouses = await localPool.query(`SELECT id FROM "Warehouse"`);
  const localWhIds = new Set(localWarehouses.rows.map(r => r.id));
  const missingWh = liveWarehouses.rows.filter(r => !localWhIds.has(r.id));
  console.log(`Warehouses: Live = ${liveWarehouses.rows.length}, Local = ${localWarehouses.rows.length}, Missing in Local = ${missingWh.length}`);

  // 3. Purchase Orders
  const livePOs = await livePool.query(`SELECT id, "po_number", "created_at", status, "total_amount", "vendor_id" FROM purchase_orders ORDER BY "created_at" ASC`);
  const localPOs = await localPool.query(`SELECT id, "po_number" FROM purchase_orders`);
  const localPOIds = new Set(localPOs.rows.map(r => r.id));
  const newPOs = livePOs.rows.filter(r => !localPOIds.has(r.id));
  console.log(`\nPurchase Orders: Live = ${livePOs.rows.length}, Local = ${localPOs.rows.length}, New to Migrate = ${newPOs.length}`);
  for (const po of newPOs) {
    console.log(`  PO: ${po.po_number} | Status: ${po.status} | Amount: ${po.total_amount} | Created: ${po.created_at}`);
  }

  // Check items in new POs
  if (newPOs.length > 0) {
    const poIdsList = newPOs.map(p => `'${p.id}'`).join(',');
    const poItems = await livePool.query(`
      SELECT DISTINCT "item_id" 
      FROM purchase_order_items 
      WHERE "purchase_order_id" IN (${poIdsList})
    `);
    const localItems = await localPool.query(`SELECT id FROM "Item"`);
    const localItemIds = new Set(localItems.rows.map(r => r.id));
    const missingItems = poItems.rows.filter(r => !localItemIds.has(r.item_id));
    console.log(`  Unique Items in new POs: ${poItems.rows.length}, Missing in Local "Item": ${missingItems.length}`);
    if (missingItems.length > 0) {
      console.log('  Sample missing items:', missingItems.slice(0, 5));
    }
  }

  // 4. Goods Receipt Notes (GRN)
  const liveGRNs = await livePool.query(`SELECT id, "grn_number", "purchase_order_id", status FROM goods_receipt_notes`);
  const localGRNs = await localPool.query(`SELECT id, "grn_number" FROM goods_receipt_notes`);
  const localGRNIds = new Set(localGRNs.rows.map(r => r.id));
  const newGRNs = liveGRNs.rows.filter(r => !localGRNIds.has(r.id));
  console.log(`\nGoods Receipt Notes: Live = ${liveGRNs.rows.length}, Local = ${localGRNs.rows.length}, New to Migrate = ${newGRNs.length}`);

  // 5. Landed Costs (LC)
  const liveLCs = await livePool.query(`SELECT id, "landed_cost_number", "grn_id", "lc_no" FROM landed_costs`);
  const localLCs = await localPool.query(`SELECT id, "landed_cost_number" FROM landed_costs`);
  const localLCIds = new Set(localLCs.rows.map(r => r.id));
  const newLCs = liveLCs.rows.filter(r => !localLCIds.has(r.id));
  console.log(`\nLanded Costs: Live = ${liveLCs.rows.length}, Local = ${localLCs.rows.length}, New to Migrate = ${newLCs.length}`);

  // 6. Purchase Invoices (PI)
  const livePIs = await livePool.query(`SELECT id, "invoice_number", "grn_id", "landed_cost_id" FROM purchase_invoices`);
  const localPIs = await localPool.query(`SELECT id, "invoice_number" FROM purchase_invoices`);
  const localPIIds = new Set(localPIs.rows.map(r => r.id));
  const newPIs = livePIs.rows.filter(r => !localPIIds.has(r.id));
  console.log(`\nPurchase Invoices: Live = ${livePIs.rows.length}, Local = ${localPIs.rows.length}, New to Migrate = ${newPIs.length}`);

  // 7. Purchase Returns (PR)
  const livePRs = await livePool.query(`SELECT id, "return_number", "purchase_invoice_id", status FROM purchase_returns`);
  const localPRs = await localPool.query(`SELECT id, "return_number" FROM purchase_returns`);
  const localPRIds = new Set(localPRs.rows.map(r => r.id));
  const newPRs = livePRs.rows.filter(r => !localPRIds.has(r.id));
  console.log(`\nPurchase Returns: Live = ${livePRs.rows.length}, Local = ${localPRs.rows.length}, New to Migrate = ${newPRs.length}`);

  // 8. Debit Notes
  const liveDNs = await livePool.query(`SELECT id, "debit_note_no" FROM debit_notes`);
  const localDNs = await localPool.query(`SELECT id, "debit_note_no" FROM debit_notes`);
  const localDNIds = new Set(localDNs.rows.map(r => r.id));
  const newDNs = liveDNs.rows.filter(r => !localDNIds.has(r.id));
  console.log(`\nDebit Notes: Live = ${liveDNs.rows.length}, Local = ${localDNs.rows.length}, New to Migrate = ${newDNs.length}`);

  // 9. Stock Ledger entries associated with GRN / Landed Cost
  const liveStockLedger = await livePool.query(`SELECT count(*) FROM stock_ledgers`);
  const localStockLedger = await localPool.query(`SELECT count(*) FROM stock_ledgers`);
  console.log(`\nStock Ledger: Live = ${liveStockLedger.rows[0].count}, Local = ${localStockLedger.rows[0].count}`);

  // Check new stock ledger entries by reference_type
  const liveSLRefTypes = await livePool.query(`
    SELECT reference_type, count(*) 
    FROM stock_ledgers 
    GROUP BY reference_type
  `);
  console.log('Stock Ledger by reference_type in Live:', liveSLRefTypes.rows);

  // 10. Supplier Ledger entries
  const liveSuppLedger = await livePool.query(`SELECT count(*) FROM "SupplierLedger"`);
  const localSuppLedger = await localPool.query(`SELECT count(*) FROM "SupplierLedger"`);
  console.log(`\nSupplier Ledger: Live = ${liveSuppLedger.rows[0].count}, Local = ${localSuppLedger.rows[0].count}`);

  // 11. Finance Vouchers
  const liveJV = await livePool.query(`SELECT count(*) FROM "JournalVoucher"`);
  const localJV = await localPool.query(`SELECT count(*) FROM "JournalVoucher"`);
  console.log(`\nJournal Vouchers: Live = ${liveJV.rows[0].count}, Local = ${localJV.rows[0].count}`);

  const livePV = await livePool.query(`SELECT count(*) FROM "PaymentVoucher"`);
  const localPV = await localPool.query(`SELECT count(*) FROM "PaymentVoucher"`);
  console.log(`Payment Vouchers: Live = ${livePV.rows[0].count}, Local = ${localPV.rows[0].count}`);

  const liveRV = await livePool.query(`SELECT count(*) FROM "ReceiptVoucher"`);
  const localRV = await localPool.query(`SELECT count(*) FROM "ReceiptVoucher"`);
  console.log(`Receipt Vouchers: Live = ${liveRV.rows[0].count}, Local = ${localRV.rows[0].count}`);

  await livePool.end();
  await localPool.end();
}

checkDependencies().catch(console.error);
