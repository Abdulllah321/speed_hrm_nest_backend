import { Pool } from 'pg';

const livePool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/spl_live_temp',
});

const localPool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi',
});

async function inspectFinanceAndLedgers() {
  console.log('--- Inspecting Finance Vouchers & Ledgers ---');

  // Check new JVs
  const liveJVs = await livePool.query(`SELECT id, "voucherNumber", "voucherDate", "totalAmount" FROM "JournalVoucher" ORDER BY "voucherDate" DESC LIMIT 10`);
  const localJVCount = await localPool.query(`SELECT count(*) FROM "JournalVoucher"`);
  console.log(`Live JVs sample (latest 10):`, liveJVs.rows);
  console.log(`Local JV Count: ${localJVCount.rows[0].count}`);

  // Check new PVs
  const livePVs = await livePool.query(`SELECT id, "voucherNumber", "voucherDate", "totalAmount" FROM "PaymentVoucher" ORDER BY "voucherDate" DESC LIMIT 10`);
  console.log(`\nLive PVs sample (latest 10):`, livePVs.rows);

  // Check new RVs
  const liveRVs = await livePool.query(`SELECT id, "voucherNumber", "voucherDate", "totalAmount" FROM "ReceiptVoucher" ORDER BY "voucherDate" DESC LIMIT 10`);
  console.log(`\nLive RVs sample (latest 10):`, liveRVs.rows);

  // Check supplier_ledger differences
  const liveSL = await livePool.query(`
    SELECT id, "supplier_id", "entry_date", "entry_type", "source_ref", debit, credit 
    FROM supplier_ledger 
    ORDER BY "entry_date" DESC LIMIT 15
  `);
  console.log(`\nLive supplier_ledger sample:`, liveSL.rows);

  // Check stock_ledgers for LANDED_COST
  const liveLCStock = await livePool.query(`
    SELECT id, "item_id", "warehouse_id", qty, "reference_type", "reference_id", "created_at" 
    FROM stock_ledgers 
    WHERE reference_type = 'LANDED_COST' 
    ORDER BY "created_at" DESC LIMIT 5
  `);
  console.log(`\nLive stock_ledgers for LANDED_COST sample:`, liveLCStock.rows);

  await livePool.end();
  await localPool.end();
}

inspectFinanceAndLedgers().catch(console.error);
