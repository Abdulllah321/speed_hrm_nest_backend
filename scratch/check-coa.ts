import { Pool } from 'pg';

const livePool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/spl_live_temp',
});

const localPool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi',
});

async function checkDetails() {
  const liveCoA = await livePool.query('SELECT id, code, name FROM "ChartOfAccount"');
  const localCoA = await localPool.query('SELECT id FROM "ChartOfAccount"');
  const localIds = new Set(localCoA.rows.map(r => r.id));
  const missingCoA = liveCoA.rows.filter(r => !localIds.has(r.id));
  console.log(`ChartOfAccount: Live = ${liveCoA.rows.length}, Local = ${localCoA.rows.length}, Missing = ${missingCoA.length}`);
  if (missingCoA.length > 0) {
    console.log('Missing CoA:', missingCoA);
  }

  // Advance applications
  const liveAdv = await livePool.query('SELECT count(*) FROM "AdvanceApplication"').catch(() => ({ rows: [{ count: 0 }] }));
  const localAdv = await localPool.query('SELECT count(*) FROM "AdvanceApplication"').catch(() => ({ rows: [{ count: 0 }] }));
  console.log(`AdvanceApplication: Live = ${liveAdv.rows[0].count}, Local = ${localAdv.rows[0].count}`);

  // PaymentVoucherToInvoice
  const livePV2Inv = await livePool.query('SELECT count(*) FROM "PaymentVoucherToInvoice"').catch(() => ({ rows: [{ count: 0 }] }));
  const localPV2Inv = await localPool.query('SELECT count(*) FROM "PaymentVoucherToInvoice"').catch(() => ({ rows: [{ count: 0 }] }));
  console.log(`PaymentVoucherToInvoice: Live = ${livePV2Inv.rows[0].count}, Local = ${localPV2Inv.rows[0].count}`);

  await livePool.end();
  await localPool.end();
}

checkDetails().catch(console.error);
