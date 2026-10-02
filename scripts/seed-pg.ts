import { Pool } from 'pg';

const dbUrl = process.argv[2] || 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi?schema=public';

const pool = new Pool({
  connectionString: dbUrl
});

async function main() {
  const targetDateStr = '2026-10-01T00:00:00.000Z';
  const cutoffDateStr = '2026-10-01T00:00:00.000Z';
  
  console.log('Running raw SQL seed (Fast Version)...');
  await pool.query(`DELETE FROM monthly_stock_snapshots;`);
  await pool.query(`
      INSERT INTO monthly_stock_snapshots (id, date, item_id, warehouse_id, location_id, closing_qty, unit_cost)
      SELECT 
        gen_random_uuid(),
        '${targetDateStr}'::timestamp,
        s.item_id, 
        s.warehouse_id, 
        s.location_id, 
        SUM(s.qty),
        MAX(s.unit_cost)
      FROM stock_ledgers s
      WHERE s.created_at <= '${cutoffDateStr}'::timestamp
      GROUP BY s.item_id, s.warehouse_id, s.location_id
      HAVING SUM(s.qty) != 0
  `);
  console.log('Seed done! Inserted snapshots for 1st October.');
}
main().finally(() => pool.end());
