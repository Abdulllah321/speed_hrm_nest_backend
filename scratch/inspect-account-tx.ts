import { Pool } from 'pg';

const livePool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/spl_live_temp',
});

const localPool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi',
});

async function inspectAccountTx() {
  const liveTx = await livePool.query(`
    SELECT "sourceType", count(*) 
    FROM "AccountTransaction" 
    GROUP BY "sourceType"
  `);
  console.log('Live AccountTransaction by sourceType:', liveTx.rows);

  const localTx = await localPool.query(`
    SELECT "sourceType", count(*) 
    FROM "AccountTransaction" 
    GROUP BY "sourceType"
  `);
  console.log('Local AccountTransaction by sourceType:', localTx.rows);

  await livePool.end();
  await localPool.end();
}

inspectAccountTx().catch(console.error);
