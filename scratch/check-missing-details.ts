import { Pool } from 'pg';

const livePool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/spl_live_temp',
});

const localPool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi',
});

async function checkMissingDetails() {
  // Missing JVD
  const liveJVD = await livePool.query(`SELECT id, "journalVoucherId" FROM "JournalVoucherDetail"`);
  const localJVD = await localPool.query(`SELECT id FROM "JournalVoucherDetail"`);
  const localJVDSet = new Set(localJVD.rows.map(r => r.id));
  const missingJVD = liveJVD.rows.filter(r => !localJVDSet.has(r.id));
  console.log(`Missing JournalVoucherDetail in local: ${missingJVD.length}`);

  // Missing PVD
  const livePVD = await livePool.query(`SELECT id, "paymentVoucherId" FROM "PaymentVoucherDetail"`);
  const localPVD = await localPool.query(`SELECT id FROM "PaymentVoucherDetail"`);
  const localPVDSet = new Set(localPVD.rows.map(r => r.id));
  const missingPVD = livePVD.rows.filter(r => !localPVDSet.has(r.id));
  console.log(`Missing PaymentVoucherDetail in local: ${missingPVD.length}`);

  // Missing RVD
  const liveRVD = await livePool.query(`SELECT id, "receiptVoucherId" FROM "ReceiptVoucherDetail"`);
  const localRVD = await localPool.query(`SELECT id FROM "ReceiptVoucherDetail"`);
  const localRVDSet = new Set(localRVD.rows.map(r => r.id));
  const missingRVD = liveRVD.rows.filter(r => !localRVDSet.has(r.id));
  console.log(`Missing ReceiptVoucherDetail in local: ${missingRVD.length}`);

  await livePool.end();
  await localPool.end();
}

checkMissingDetails().catch(console.error);
