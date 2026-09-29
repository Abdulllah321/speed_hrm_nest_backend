import { Pool } from 'pg';

const livePool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/spl_live_temp',
});

const localPool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi',
});

async function checkOtherPurchaseTables() {
  const tables = [
    'purchase_requisitions',
    'purchase_requisition_items',
    'request_for_quotations',
    'vendor_quotations',
    'debit_notes',
    'landed_cost_charge_types',
  ];

  for (const t of tables) {
    const liveC = await livePool.query(`SELECT count(*) FROM "${t}"`).catch(e => ({ rows: [{ count: `error: ${e.message}` }] }));
    const localC = await localPool.query(`SELECT count(*) FROM "${t}"`).catch(e => ({ rows: [{ count: `error: ${e.message}` }] }));
    console.log(`${t}: Live = ${liveC.rows[0].count}, Local = ${localC.rows[0].count}`);
  }

  await livePool.end();
  await localPool.end();
}

checkOtherPurchaseTables().catch(console.error);
