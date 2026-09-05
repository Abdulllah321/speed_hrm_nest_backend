import 'dotenv/config';
import { Pool } from 'pg';

async function main() {
  const p = new Pool({ connectionString: process.env.DATABASE_URL_MANAGEMENT });
  const c = await p.query('SELECT "dbUrl" FROM "Company" WHERE "dbName" = \'tenant_speed_main_mox1gfsi\'');
  await p.end();

  const tp = new Pool({ connectionString: c.rows[0].dbUrl });
  
  const prAgg = await tp.query(`
    SELECT count(id) as count,
           sum(total_refund_amount) as total_refund,
           sum(subtotal_wost) as subtotal_wost,
           sum(discount_wost) as discount_wost,
           sum(tax_amount) as tax_amount
    FROM pos_returns
  `);
  console.log('--- POS_RETURNS AGGREGATES IN DB ---');
  console.log(prAgg.rows[0]);

  const priAgg = await tp.query(`
    SELECT count(id) as count,
           sum(quantity) as total_qty,
           sum(line_total) as line_total,
           sum(tax_amount) as tax_amount,
           sum(discount_wost) as discount_wost,
           sum(line_total_wost) as line_total_wost
    FROM pos_return_items
  `);
  console.log('--- POS_RETURN_ITEMS AGGREGATES IN DB ---');
  console.log(priAgg.rows[0]);

  const samplePr = await tp.query('SELECT id, return_number, sales_order_id, return_type, refund_mode, subtotal_wost, discount_wost, tax_amount, total_refund_amount, created_at FROM pos_returns LIMIT 5');
  console.log('--- SAMPLE POS_RETURNS ---');
  console.log(samplePr.rows);

  const samplePri = await tp.query('SELECT id, pos_return_id, item_id, quantity, original_unit_price, unit_price_wost, discount_wost, tax_amount, line_total FROM pos_return_items LIMIT 5');
  console.log('--- SAMPLE POS_RETURN_ITEMS ---');
  console.log(samplePri.rows);

  // Check what raw return JSON has
  const rawReturns: any[] = JSON.parse(require('fs').readFileSync('data/SS_LG2526_Sales_return.json', 'utf8'));
  console.log(`\nRaw return JSON rows: ${rawReturns.length}`);

  let sumRetailPrice = 0;
  let sumValInclTax = 0;
  let sumValExTax = 0;
  let sumTax = 0;
  let sumQty = 0;

  for (const r of rawReturns) {
    const isShifted = !r.Barcode || r.Barcode.trim() === '';
    const qty = parseFloat(String(isShifted ? r.UnitPrice : r.Quantity)) || 1;
    const retailUnitPrice = parseFloat(String(isShifted ? r.TaxRate1 : r.UnitPrice)) || 0;
    const valInclTax = parseFloat(String(isShifted ? r.FKInvoiceNumber_Sale : r['Value Incl Sales Tax'])) || 0;
    const valExTax = parseFloat(String(isShifted ? r['Sales Tax'] : r['Value Ex Sales Tax'])) || 0;
    const tax = parseFloat(String(isShifted ? r['Value Incl Sales Tax'] : r['Total Sales Tax'])) || 0;

    sumQty += qty;
    sumRetailPrice += retailUnitPrice * qty;
    sumValInclTax += valInclTax;
    sumValExTax += valExTax;
    sumTax += tax;
  }

  console.log('--- RAW JSON EXPECTED SUMS ---');
  console.log({
    sumQty,
    sumRetailPrice: sumRetailPrice.toFixed(2),
    sumValExTax: sumValExTax.toFixed(2),
    sumTax: sumTax.toFixed(2),
    sumValInclTax: sumValInclTax.toFixed(2),
  });

  await tp.end();
}

main().catch(console.error);
