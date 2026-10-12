import 'dotenv/config';
import { Pool } from 'pg';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi?schema=public';

const pool = new Pool({ connectionString });

async function main() {
  console.log('\n======================================================================');
  console.log('🚀 Starting Monthly Stock Snapshot Seeder (seed-snapshots.ts)');
  console.log('======================================================================\n');

  // 1. Audit records BEFORE deletion
  const beforeCountRes = await pool.query('SELECT COUNT(*) as count FROM monthly_stock_snapshots;');
  const beforeCount = parseInt(beforeCountRes.rows[0].count, 10);
  console.log(`📊 Current snapshot records in database: ${beforeCount.toLocaleString()}`);

  if (beforeCount > 0) {
    const datesRes = await pool.query(`
      SELECT date::text, COUNT(*) as count 
      FROM monthly_stock_snapshots 
      GROUP BY date 
      ORDER BY date DESC;
    `);
    console.log(`📅 Breakdown of existing snapshots to be cleared:`);
    for (const r of datesRes.rows) {
      console.log(`   - Date: ${r.date} -> ${parseInt(r.count, 10).toLocaleString()} records`);
    }
  } else {
    console.log(`ℹ️  Table monthly_stock_snapshots is currently empty.`);
  }

  // 2. Clear old snapshots
  console.log(`\n🧹 Step 1: Wiping previous snapshots (TRUNCATE TABLE monthly_stock_snapshots CASCADE)...`);
  await pool.query('TRUNCATE TABLE monthly_stock_snapshots CASCADE;');

  const afterClearRes = await pool.query('SELECT COUNT(*) as count FROM monthly_stock_snapshots;');
  const afterClearCount = parseInt(afterClearRes.rows[0].count, 10);
  console.log(`✅ Table cleared successfully. Verified remaining rows: ${afterClearCount}`);

  // 3. Compute and insert new September 30 / October 1 00:00:00 snapshots
  const targetDateStr = '2026-10-01T00:00:00.000Z';
  const cutoffDateStr = '2026-10-01T00:00:00.000Z';

  console.log(`\n⏳ Step 2: Computing closing balances from stock_ledgers up to ${cutoffDateStr}...`);
  const startTime = Date.now();

  await pool.query(`
    INSERT INTO monthly_stock_snapshots (id, date, item_id, warehouse_id, location_id, closing_qty, unit_cost)
    SELECT 
      gen_random_uuid(),
      '${targetDateStr}'::timestamp,
      s.item_id, 
      s.warehouse_id, 
      loc.id as location_id, 
      SUM(s.qty),
      COALESCE(
          (SELECT COALESCE(unit_cost, rate) FROM stock_ledgers l2 
           WHERE l2.item_id = s.item_id 
           AND l2.created_at <= '${cutoffDateStr}'::timestamp 
           AND (l2.unit_cost > 0 OR l2.rate > 0)
           ORDER BY l2.created_at DESC LIMIT 1), 
           0
      ) as unit_cost
    FROM stock_ledgers s
    LEFT JOIN "Location" loc ON loc.id = s.location_id
    WHERE s.created_at <= '${cutoffDateStr}'::timestamp
    GROUP BY s.item_id, s.warehouse_id, loc.id
    HAVING SUM(s.qty) != 0;
  `);

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

  // 4. Audit records AFTER insertion
  const finalCountRes = await pool.query('SELECT COUNT(*) as count FROM monthly_stock_snapshots;');
  const finalCount = parseInt(finalCountRes.rows[0].count, 10);
  console.log(`✨ Step 3: Inserted ${finalCount.toLocaleString()} fresh snapshot records for 2026-10-01 in ${durationSec}s.`);

  // 5. Sample row preview
  const sampleRes = await pool.query(`
    SELECT m.date::text, m.closing_qty, m.unit_cost, i.sku, i."barCode", w.name as warehouse_name, l.name as location_name
    FROM monthly_stock_snapshots m
    LEFT JOIN "Item" i ON i.id = m.item_id
    LEFT JOIN "Warehouse" w ON w.id = m.warehouse_id
    LEFT JOIN "Location" l ON l.id = m.location_id
    ORDER BY m.closing_qty DESC
    LIMIT 3;
  `);

  if (sampleRes.rows.length > 0) {
    console.log(`\n🔍 Sample snapshot entries:`);
    for (const r of sampleRes.rows) {
      console.log(`   • Item: ${r.sku || r.barCode || 'N/A'} | Closing Qty: ${r.closing_qty} | Unit Cost: PKR ${r.unit_cost || 0} | Warehouse: ${r.warehouse_name || 'N/A'} | Location: ${r.location_name || 'None'}`);
    }
  }

  console.log('\n======================================================================');
  console.log('🎉 Snapshot synchronization completed successfully!');
  console.log('======================================================================\n');
}

main()
  .catch((err) => {
    console.error('❌ Error executing seed-snapshots:', err);
    process.exit(1);
  })
  .finally(() => pool.end());
