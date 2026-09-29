import { Pool } from 'pg';

const livePool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/spl_live_temp',
});

const localPool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi',
});

async function checkVouchers() {
  // New JVs
  const liveJVs = await livePool.query(`SELECT id, "jvNo", "jvDate", description, status FROM "JournalVoucher" ORDER BY "jvDate" DESC`);
  const localJVs = await localPool.query(`SELECT id FROM "JournalVoucher"`);
  const localJVIds = new Set(localJVs.rows.map(r => r.id));
  const newJVs = liveJVs.rows.filter(r => !localJVIds.has(r.id));
  console.log(`Live JVs: ${liveJVs.rows.length}, Local: ${localJVs.rows.length}, New: ${newJVs.length}`);
  console.log(`Sample new JVs:`, newJVs.slice(0, 5));

  // New PVs
  const livePVs = await livePool.query(`SELECT id, "pvNo", "pvDate", "supplierId", "creditAmount", status FROM "PaymentVoucher" ORDER BY "pvDate" DESC`);
  const localPVs = await localPool.query(`SELECT id FROM "PaymentVoucher"`);
  const localPVIds = new Set(localPVs.rows.map(r => r.id));
  const newPVs = livePVs.rows.filter(r => !localPVIds.has(r.id));
  console.log(`\nLive PVs: ${livePVs.rows.length}, Local: ${localPVs.rows.length}, New: ${newPVs.length}`);
  console.log(`Sample new PVs:`, newPVs.slice(0, 5));

  // New RVs
  const liveRVs = await livePool.query(`SELECT id, "rvNo", "rvDate", "debitAmount", status FROM "ReceiptVoucher" ORDER BY "rvDate" DESC`);
  const localRVs = await localPool.query(`SELECT id FROM "ReceiptVoucher"`);
  const localRVIds = new Set(localRVs.rows.map(r => r.id));
  const newRVs = liveRVs.rows.filter(r => !localRVIds.has(r.id));
  console.log(`\nLive RVs: ${liveRVs.rows.length}, Local: ${localRVs.rows.length}, New: ${newRVs.length}`);
  console.log(`Sample new RVs:`, newRVs.slice(0, 5));

  // Check new supplier_ledger entries
  const liveSL = await livePool.query(`SELECT id, "source_ref", "entry_type", debit, credit FROM supplier_ledger`);
  const localSL = await localPool.query(`SELECT id FROM supplier_ledger`);
  const localSLIds = new Set(localSL.rows.map(r => r.id));
  const newSL = liveSL.rows.filter(r => !localSLIds.has(r.id));
  console.log(`\nsupplier_ledger: Live = ${liveSL.rows.length}, Local = ${localSL.rows.length}, New: ${newSL.length}`);
  console.log('New supplier ledger entries:', newSL);

  await livePool.end();
  await localPool.end();
}

checkVouchers().catch(console.error);
