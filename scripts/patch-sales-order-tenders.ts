import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';

async function main() {
  console.log('Connecting to management database...');
  const managementUrl = process.env.DATABASE_URL_MANAGEMENT!;
  const mgmtPool = new Pool({ connectionString: managementUrl });
  const compRes = await mgmtPool.query(`
    SELECT "dbUrl" FROM "Company" WHERE status = 'active' AND "dbName" = 'tenant_speed_main_mox1gfsi'
  `);
  await mgmtPool.end();

  const tenantConnStr = compRes.rows[0].dbUrl;
  console.log('Connecting to tenant database...');
  const tenantPool = new Pool({ connectionString: tenantConnStr });

  const salesPath = path.join(__dirname, '..', 'data', 'SS_LG_2526_SALES.json');
  console.log(`Reading JSON from: ${salesPath}`);
  const salesRaw: any[] = JSON.parse(fs.readFileSync(salesPath, 'utf8'));
  console.log(`Loaded ${salesRaw.length} raw sales rows.`);

  const groups = new Map<string, any[]>();
  for (const s of salesRaw) {
    const docNo = String(s.DocumentNumber).trim();
    if (!groups.has(docNo)) groups.set(docNo, []);
    groups.get(docNo)!.push(s);
  }
  console.log(`Distinct Cash Memos in JSON: ${groups.size}`);

  const orderPrefix = 'SI-SSLG26-';

  let totalCashSum = 0;
  let totalCardSum = 0;
  let totalCreditSaleSum = 0;
  let totalExchangeSum = 0;
  let totalGiftSum = 0;
  let totalClaimSum = 0;
  let totalCorpSum = 0;
  let totalCreditVoucherSum = 0;
  let totalRewardSum = 0;
  let totalCreditIssuedSum = 0;
  let totalCashReturnSum = 0;

  const records: any[] = [];

  for (const [docNoStr, groupRows] of groups.entries()) {
    const sample = groupRows[0];
    const docNum = parseInt(docNoStr, 10);
    const padDoc = String(docNum).padStart(5, '0');
    const orderNumber = `${orderPrefix}${padDoc}`;

    const cashAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.CashSale)) || 0), 0);
    const cardAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.CardSale)) || 0), 0);
    const creditAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.CreditSale)) || 0), 0);
    const exchangeAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.ExchangeVoucherAmount)) || 0), 0);
    const giftAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.GiftVoucherAmount)) || 0), 0);
    const claimAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.ClaimVoucherAmount)) || 0), 0);
    const corpAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.GiftVoucherAmount_Corporate)) || 0), 0);
    const creditVoucherAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.CreditVoucherAmount)) || 0), 0);
    const rewardAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.RewardVoucherAmount)) || 0), 0);
    const creditIssuedAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.CreditVoucherIssuedAmount)) || 0), 0);
    const cashReturnAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.CashRetrun)) || 0), 0);

    const totalVoucherAmount = exchangeAmount + giftAmount + claimAmount + corpAmount + creditVoucherAmount + rewardAmount;

    totalCashSum += cashAmount;
    totalCardSum += cardAmount;
    totalCreditSaleSum += creditAmount;
    totalExchangeSum += exchangeAmount;
    totalGiftSum += giftAmount;
    totalClaimSum += claimAmount;
    totalCorpSum += corpAmount;
    totalCreditVoucherSum += creditVoucherAmount;
    totalRewardSum += rewardAmount;
    totalCreditIssuedSum += creditIssuedAmount;
    totalCashReturnSum += cashReturnAmount;

    let paymentMethod = 'cash';
    const activeTenders = [cashAmount > 0, cardAmount > 0, totalVoucherAmount > 0, creditAmount > 0].filter(Boolean).length;
    if (activeTenders > 1) {
      paymentMethod = 'split';
    } else if (cardAmount > 0) {
      paymentMethod = 'card';
    } else if (totalVoucherAmount > 0) {
      paymentMethod = 'voucher';
    } else if (creditAmount > 0) {
      paymentMethod = 'credit_account';
    }

    const notesParts = [`Original DocNo: ${docNoStr}`, `POS ID: ${sample['POS ID']}`];
    if (sample.FKSalesPersonID) notesParts.push(`SalesPerson: ${sample.FKSalesPersonID}`);
    if (sample.Remarks && sample.Remarks.trim() !== ';') notesParts.push(`Remarks: ${sample.Remarks.trim()}`);
    if (sample.FKExchangeVoucherNumber && sample.FKExchangeVoucherNumber.trim()) {
      notesParts.push(`ExVoucherRef: ${sample.FKExchangeVoucherNumber.trim()}`);
    }

    // Structured tags for exact parsing
    if (cashAmount > 0) notesParts.push(`[Cash Sale] Amount: ${cashAmount.toFixed(2)}`);
    if (cardAmount > 0) notesParts.push(`[Card Sale] Amount: ${cardAmount.toFixed(2)}`);
    if (exchangeAmount > 0) notesParts.push(`[Exchange Voucher] Amount: ${exchangeAmount.toFixed(2)}`);
    if (claimAmount > 0) notesParts.push(`[Claim Voucher] Amount: ${claimAmount.toFixed(2)}`);
    if (corpAmount > 0) notesParts.push(`[Corporate Voucher] Amount: ${corpAmount.toFixed(2)}`);
    if (giftAmount > 0) notesParts.push(`[Gift Voucher] Amount: ${giftAmount.toFixed(2)}`);
    if (creditVoucherAmount > 0) notesParts.push(`[Credit Voucher] Amount: ${creditVoucherAmount.toFixed(2)}`);
    if (rewardAmount > 0) notesParts.push(`[Reward Voucher] Amount: ${rewardAmount.toFixed(2)}`);
    if (creditAmount > 0) notesParts.push(`[Credit Sale] Balance: ${creditAmount.toFixed(2)}`);
    if (creditIssuedAmount > 0) notesParts.push(`[Credit Voucher Issued] Amount: ${creditIssuedAmount.toFixed(2)}`);
    if (cashReturnAmount > 0) notesParts.push(`[Cash Return] Amount: ${cashReturnAmount.toFixed(2)}`);

    records.push({
      orderNumber,
      cashAmount: cashAmount > 0 ? cashAmount : null,
      cardAmount: cardAmount > 0 ? cardAmount : null,
      voucherAmount: totalVoucherAmount > 0 ? totalVoucherAmount : null,
      paymentMethod,
      notes: notesParts.join(' | '),
    });
  }

  console.log(`Starting bulk update for ${records.length} records...`);
  const client = await tenantPool.connect();

  try {
    const batchSize = 250;
    let totalUpdated = 0;

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      
      const valueStrings: string[] = [];
      const params: any[] = [];
      let pIdx = 1;

      for (const r of batch) {
        valueStrings.push(`($${pIdx}, $${pIdx + 1}::numeric, $${pIdx + 2}::numeric, $${pIdx + 3}::numeric, $${pIdx + 4}, $${pIdx + 5})`);
        params.push(r.orderNumber, r.cashAmount, r.cardAmount, r.voucherAmount, r.paymentMethod, r.notes);
        pIdx += 6;
      }

      const query = `
        UPDATE sales_orders AS so
        SET cash_amount = v.cash_amount,
            card_amount = v.card_amount,
            voucher_amount = v.voucher_amount,
            payment_method = v.payment_method,
            notes = v.notes
        FROM (VALUES ${valueStrings.join(', ')}) AS v("orderNumber", cash_amount, card_amount, voucher_amount, payment_method, notes)
        WHERE so."orderNumber" = v."orderNumber"
      `;

      const res = await client.query(query, params);
      totalUpdated += res.rowCount || 0;
      console.log(`Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(records.length / batchSize)}: Updated ${res.rowCount} orders (Total so far: ${totalUpdated})`);
    }

    console.log(`\n🎉 Bulk update complete! Total updated orders: ${totalUpdated}`);
  } catch (err: any) {
    console.error('Error during bulk update:', err);
  } finally {
    client.release();
    await tenantPool.end();
  }

  console.log('\n--- VERIFIED GROUND TRUTH SUMS ---');
  console.log({
    totalCash: totalCashSum.toFixed(2),
    totalCard: totalCardSum.toFixed(2),
    totalCreditSale: totalCreditSaleSum.toFixed(2),
    totalExchangeVoucher: totalExchangeSum.toFixed(2),
    totalGiftVoucher: totalGiftSum.toFixed(2),
    totalClaimVoucher: totalClaimSum.toFixed(2),
    totalCorpGiftVoucher: totalCorpSum.toFixed(2),
    totalCreditVoucher: totalCreditVoucherSum.toFixed(2),
    totalRewardVoucher: totalRewardSum.toFixed(2),
    totalCreditVoucherIssued: totalCreditIssuedSum.toFixed(2),
    totalCashReturn: totalCashReturnSum.toFixed(2),
  });
}

main().catch(console.error);
