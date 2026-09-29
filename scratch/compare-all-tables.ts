import { Pool } from 'pg';

const livePool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/spl_live_temp',
});

const localPool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi',
});

async function compareAllTables() {
  const tablesRes = await livePool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  console.log(`Found ${tablesRes.rows.length} tables. Checking row counts...`);

  const diffs: any[] = [];

  for (const row of tablesRes.rows) {
    const table = row.table_name;
    try {
      const liveC = await livePool.query(`SELECT count(*) FROM "${table}"`);
      const localC = await localPool.query(`SELECT count(*) FROM "${table}"`);
      const lc = parseInt(liveC.rows[0].count, 10);
      const loc = parseInt(localC.rows[0].count, 10);
      if (lc !== loc) {
        diffs.push({ table, live: lc, local: loc, diff: lc - loc });
      }
    } catch (e: any) {
      diffs.push({ table, error: e.message });
    }
  }

  console.log(`\n--- Tables with Differences (Live vs Local) ---`);
  console.table(diffs);

  await livePool.end();
  await localPool.end();
}

compareAllTables().catch(console.error);
