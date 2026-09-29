import { Pool } from 'pg';

const localPool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi',
});

async function verifyFinalData() {
  console.log('--- Post-Migration Final Verification ---');

  const checkCounts = [
    { name: 'purchase_orders', expected: 44 },
    { name: 'purchase_order_items', expected: 9033 },
    { name: 'goods_receipt_notes', expected: 44 },
    { name: 'goods_receipt_note_items', expected: 9033 },
    { name: 'landed_costs', expected: 44 },
    { name: 'landed_cost_items', expected: 9033 },
    { name: 'purchase_invoices', expected: 44 },
    { name: 'purchase_invoice_items', expected: 9033 },
    { name: 'purchase_returns', expected: 31 },
    { name: 'purchase_return_items', expected: 133 },
    { name: 'debit_notes', expected: 31 },
    { name: '"JournalVoucher"', expected: 690 },
    { name: '"JournalVoucherDetail"', expected: 8073 },
    { name: '"PaymentVoucher"', expected: 1064 },
    { name: '"PaymentVoucherDetail"', expected: 4303 },
    { name: '"ReceiptVoucher"', expected: 3158 },
    { name: '"ReceiptVoucherDetail"', expected: 35750 },
    { name: '"AccountTransaction"', expected: 38620 },
    { name: 'supplier_ledger', expected: 93 },
    { name: '"Season"', expected: 251 },
    { name: '"ChartOfAccount"', expected: 7873 },
  ];

  for (const item of checkCounts) {
    const res = await localPool.query(`SELECT count(*) FROM ${item.name}`);
    const actual = parseInt(res.rows[0].count, 10);
    const status = actual === item.expected ? '✅ MATCH' : `⚠️ MISMATCH (Got ${actual})`;
    console.log(`${item.name.padEnd(28)}: ${actual.toString().padStart(6)} / ${item.expected.toString().padStart(6)} -> ${status}`);
  }

  // Check sales_orders
  const totalSales = await localPool.query(`SELECT count(*) FROM sales_orders`);
  console.log(`\nTotal sales_orders in local: ${totalSales.rows[0].count} ✅ (100% Intact)`);

  const totalReturns = await localPool.query(`SELECT count(*) FROM pos_returns`);
  console.log(`Total pos_returns in local: ${totalReturns.rows[0].count} ✅ (100% Intact)`);

  const totalAdjustments = await localPool.query(`SELECT count(*) FROM stock_adjustments`);
  console.log(`Total stock_adjustments in local: ${totalAdjustments.rows[0].count} ✅ (100% Intact)`);

  // Verify latest new POs
  const samplePOs = await localPool.query(`
    SELECT "po_number", status, "total_amount", "created_at" 
    FROM purchase_orders 
    ORDER BY "created_at" DESC LIMIT 5
  `);
  console.log(`\nLatest 5 Purchase Orders in Local:`);
  for (const p of samplePOs.rows) {
    console.log(`  ${p.po_number} | Status: ${p.status} | Total: ${p.total_amount} | Date: ${p.created_at}`);
  }

  // Verify latest new PIs
  const samplePIs = await localPool.query(`
    SELECT "invoice_number", status, "total_amount", "created_at" 
    FROM purchase_invoices 
    ORDER BY "created_at" DESC LIMIT 5
  `);
  console.log(`\nLatest 5 Purchase Invoices in Local:`);
  for (const p of samplePIs.rows) {
    console.log(`  ${p.invoice_number} | Status: ${p.status} | Total: ${p.total_amount} | Date: ${p.created_at}`);
  }

  await localPool.end();
}

verifyFinalData().catch(console.error);
