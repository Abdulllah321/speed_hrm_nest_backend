const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://speedlimit:speedlimit123@localhost:5433/tenant_speed_mql1nil9' });

async function run() {
  try {
    const res = await pool.query(`
      SELECT 
        so.id, 
        so."orderNumber", 
        so.cash_amount, 
        so.card_amount, 
        so.voucher_amount, 
        so."grandTotal", 
        so.payment_method, 
        so.tender_type,
        COALESCE((
          SELECT SUM(amount_used) 
          FROM pos_voucher_redemptions 
          WHERE order_id = so.id
        ), 0) as redemptions_sum
      FROM sales_orders so
      WHERE EXISTS (
        SELECT 1 
        FROM pos_voucher_redemptions 
        WHERE order_id = so.id
      )
      ORDER BY so.created_at DESC
    `);
    console.log("Orders with Redemptions:");
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
