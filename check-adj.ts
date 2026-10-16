import { Pool } from 'pg';

const pool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi',
});

async function main() {
  console.log('Applying DB migration for stock_adjustments...');

  await pool.query(`
    ALTER TABLE stock_adjustments ADD COLUMN IF NOT EXISTS location_id text;
    ALTER TABLE stock_adjustments ALTER COLUMN warehouse_id DROP NOT NULL;
  `);

  await pool.query(`
    DO $$ 
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'stock_adjustments_location_id_fkey'
      ) THEN
        ALTER TABLE stock_adjustments 
        ADD CONSTRAINT stock_adjustments_location_id_fkey 
        FOREIGN KEY (location_id) REFERENCES "Location"(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  // Update existing outlet adjustments to have location_id set and warehouse_id set to null
  await pool.query(`
    UPDATE stock_adjustments sa
    SET location_id = sai.location_id,
        warehouse_id = NULL
    FROM stock_adjustment_items sai
    WHERE sai.stock_adjustment_id = sa.id
      AND sai.location_id IS NOT NULL;
  `);

  // Fix SADJ-26-27-00066 with current_qty = -1, physical_qty = 0, adjusted_qty = 1
  await pool.query(`
    UPDATE stock_adjustment_items
    SET current_qty = -1.0000,
        physical_qty = 0.0000,
        adjusted_qty = 1.0000
    WHERE stock_adjustment_id IN (
      SELECT id FROM stock_adjustments WHERE adjustment_no = 'SADJ-26-27-00066'
    );
  `);

  console.log('Migration and record update complete!');

  const check = await pool.query(`
    SELECT sa.id, sa.adjustment_no, sa.warehouse_id, sa.location_id,
           sai.current_qty, sai.physical_qty, sai.adjusted_qty, sai.location_id as item_loc_id
    FROM stock_adjustments sa
    JOIN stock_adjustment_items sai ON sai.stock_adjustment_id = sa.id
    WHERE sa.adjustment_no = 'SADJ-26-27-00066';
  `);
  console.log('Updated SADJ-26-27-00066:', check.rows);
}

main().catch(console.error).finally(() => pool.end());
