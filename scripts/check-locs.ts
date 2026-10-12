import pg from 'pg';
const pool = new pg.Pool({ connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi?schema=public' });

async function check() {
  const locs = await pool.query(`
    SELECT id, code, name, is_stock_location, "isDeleted", status 
    FROM "Location" 
    ORDER BY is_stock_location DESC, name ASC
  `);
  console.log('Total locations:', locs.rows.length);
  const stockOnly = locs.rows.filter(l => l.is_stock_location && !l.isDeleted);
  console.log('Stock locations count:', stockOnly.length);
  console.log('Stock locations sample:', stockOnly.slice(0, 10).map(l => `${l.code}: ${l.name}`));
  const nonStock = locs.rows.filter(l => !l.is_stock_location || l.isDeleted);
  console.log('Non-stock or deleted locations:', nonStock.map(l => `${l.code}: ${l.name} (is_stock: ${l.is_stock_location}, del: ${l.isDeleted})`));
  await pool.end();
}
check();
