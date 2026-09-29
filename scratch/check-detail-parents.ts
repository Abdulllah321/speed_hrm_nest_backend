import { Pool } from 'pg';

const livePool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/spl_live_temp',
});

const localPool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi',
});

async function checkParents() {
  const localJVs = await localPool.query(`SELECT id FROM "JournalVoucher"`);
  const localJVSet = new Set(localJVs.rows.map(r => r.id));

  const liveJVD = await livePool.query(`SELECT id, "journalVoucherId" FROM "JournalVoucherDetail"`);
  const localJVD = await localPool.query(`SELECT id FROM "JournalVoucherDetail"`);
  const localJVDSet = new Set(localJVD.rows.map(r => r.id));
  const missingJVD = liveJVD.rows.filter(r => !localJVDSet.has(r.id));

  const validParent = missingJVD.filter(d => localJVSet.has(d.journalVoucherId));
  console.log(`Missing JVD total: ${missingJVD.length}, with valid parent in local: ${validParent.length}`);

  const localPVs = await localPool.query(`SELECT id FROM "PaymentVoucher"`);
  const localPVSet = new Set(localPVs.rows.map(r => r.id));

  const livePVD = await livePool.query(`SELECT id, "paymentVoucherId" FROM "PaymentVoucherDetail"`);
  const localPVD = await localPool.query(`SELECT id FROM "PaymentVoucherDetail"`);
  const localPVDSet = new Set(localPVD.rows.map(r => r.id));
  const missingPVD = livePVD.rows.filter(r => !localPVDSet.has(r.id));
  const validPVD = missingPVD.filter(d => localPVSet.has(d.paymentVoucherId));
  console.log(`Missing PVD total: ${missingPVD.length}, with valid parent in local: ${validPVD.length}`);

  const localRVs = await localPool.query(`SELECT id FROM "ReceiptVoucher"`);
  const localRVSet = new Set(localRVs.rows.map(r => r.id));

  const liveRVD = await livePool.query(`SELECT id, "receiptVoucherId" FROM "ReceiptVoucherDetail"`);
  const localRVD = await localPool.query(`SELECT id FROM "ReceiptVoucherDetail"`);
  const localRVDSet = new Set(localRVD.rows.map(r => r.id));
  const missingRVD = liveRVD.rows.filter(r => !localRVDSet.has(r.id));
  const validRVD = missingRVD.filter(d => localRVSet.has(d.receiptVoucherId));
  console.log(`Missing RVD total: ${missingRVD.length}, with valid parent in local: ${validRVD.length}`);

  await livePool.end();
  await localPool.end();
}

checkParents().catch(console.error);
