import { Pool } from 'pg';

const livePool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/spl_live_temp',
});

const localPool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi',
});

async function getCommonColumns(tableName: string): Promise<string[]> {
  const q = `
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `;
  const liveCols = (await livePool.query(q, [tableName])).rows.map(r => r.column_name);
  const localCols = (await localPool.query(q, [tableName])).rows.map(r => r.column_name);
  const localSet = new Set(localCols);
  return liveCols.filter(col => localSet.has(col));
}

async function syncVoucherDetails() {
  console.log('--- Syncing Remaining Voucher Details & Account Transactions ---');

  // 1. JournalVoucherDetail
  const liveJVD = await livePool.query(`SELECT id FROM "JournalVoucherDetail"`);
  const localJVD = await localPool.query(`SELECT id FROM "JournalVoucherDetail"`);
  const localJVDSet = new Set(localJVD.rows.map(r => r.id));
  const missingJVDIds = liveJVD.rows.filter(r => !localJVDSet.has(r.id)).map(r => r.id);

  if (missingJVDIds.length > 0) {
    const commonCols = await getCommonColumns('JournalVoucherDetail');
    const colSql = commonCols.map(c => `"${c}"`).join(', ');
    const chunkSize = 200;
    let inserted = 0;
    for (let i = 0; i < missingJVDIds.length; i += chunkSize) {
      const chunk = missingJVDIds.slice(i, i + chunkSize);
      const rows = await livePool.query(
        `SELECT ${colSql} FROM "JournalVoucherDetail" WHERE id = ANY($1)`,
        [chunk]
      );
      for (const row of rows.rows) {
        const vals = commonCols.map(c => row[c]);
        const placeholders = vals.map((_, idx) => `$${idx + 1}`).join(',');
        await localPool.query(
          `INSERT INTO "JournalVoucherDetail" (${colSql}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          vals
        );
        inserted++;
      }
    }
    console.log(`Synced JournalVoucherDetail: ${inserted} records`);
  }

  // 2. PaymentVoucherDetail
  const livePVD = await livePool.query(`SELECT id FROM "PaymentVoucherDetail"`);
  const localPVD = await localPool.query(`SELECT id FROM "PaymentVoucherDetail"`);
  const localPVDSet = new Set(localPVD.rows.map(r => r.id));
  const missingPVDIds = livePVD.rows.filter(r => !localPVDSet.has(r.id)).map(r => r.id);

  if (missingPVDIds.length > 0) {
    const commonCols = await getCommonColumns('PaymentVoucherDetail');
    const colSql = commonCols.map(c => `"${c}"`).join(', ');
    const chunkSize = 200;
    let inserted = 0;
    for (let i = 0; i < missingPVDIds.length; i += chunkSize) {
      const chunk = missingPVDIds.slice(i, i + chunkSize);
      const rows = await livePool.query(
        `SELECT ${colSql} FROM "PaymentVoucherDetail" WHERE id = ANY($1)`,
        [chunk]
      );
      for (const row of rows.rows) {
        const vals = commonCols.map(c => row[c]);
        const placeholders = vals.map((_, idx) => `$${idx + 1}`).join(',');
        await localPool.query(
          `INSERT INTO "PaymentVoucherDetail" (${colSql}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          vals
        );
        inserted++;
      }
    }
    console.log(`Synced PaymentVoucherDetail: ${inserted} records`);
  }

  // 3. ReceiptVoucherDetail
  const liveRVD = await livePool.query(`SELECT id FROM "ReceiptVoucherDetail"`);
  const localRVD = await localPool.query(`SELECT id FROM "ReceiptVoucherDetail"`);
  const localRVDSet = new Set(localRVD.rows.map(r => r.id));
  const missingRVDIds = liveRVD.rows.filter(r => !localRVDSet.has(r.id)).map(r => r.id);

  if (missingRVDIds.length > 0) {
    const commonCols = await getCommonColumns('ReceiptVoucherDetail');
    const colSql = commonCols.map(c => `"${c}"`).join(', ');
    const chunkSize = 200;
    let inserted = 0;
    for (let i = 0; i < missingRVDIds.length; i += chunkSize) {
      const chunk = missingRVDIds.slice(i, i + chunkSize);
      const rows = await livePool.query(
        `SELECT ${colSql} FROM "ReceiptVoucherDetail" WHERE id = ANY($1)`,
        [chunk]
      );
      for (const row of rows.rows) {
        const vals = commonCols.map(c => row[c]);
        const placeholders = vals.map((_, idx) => `$${idx + 1}`).join(',');
        await localPool.query(
          `INSERT INTO "ReceiptVoucherDetail" (${colSql}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          vals
        );
        inserted++;
      }
    }
    console.log(`Synced ReceiptVoucherDetail: ${inserted} records`);
  }

  // 4. AccountTransaction
  const liveAT = await livePool.query(`SELECT id FROM "AccountTransaction"`);
  const localAT = await localPool.query(`SELECT id FROM "AccountTransaction"`);
  const localATSet = new Set(localAT.rows.map(r => r.id));
  const missingATIds = liveAT.rows.filter(r => !localATSet.has(r.id)).map(r => r.id);

  if (missingATIds.length > 0) {
    const commonCols = await getCommonColumns('AccountTransaction');
    const colSql = commonCols.map(c => `"${c}"`).join(', ');
    const chunkSize = 500;
    let inserted = 0;
    for (let i = 0; i < missingATIds.length; i += chunkSize) {
      const chunk = missingATIds.slice(i, i + chunkSize);
      const rows = await livePool.query(
        `SELECT ${colSql} FROM "AccountTransaction" WHERE id = ANY($1)`,
        [chunk]
      );
      for (const row of rows.rows) {
        const vals = commonCols.map(c => row[c]);
        const placeholders = vals.map((_, idx) => `$${idx + 1}`).join(',');
        await localPool.query(
          `INSERT INTO "AccountTransaction" (${colSql}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          vals
        );
        inserted++;
      }
    }
    console.log(`Synced AccountTransaction: ${inserted} records`);
  }

  console.log('\n--- Sync Completed Successfully ---');
  await livePool.end();
  await localPool.end();
}

syncVoucherDetails().catch(console.error);
