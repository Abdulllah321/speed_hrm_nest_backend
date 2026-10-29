import 'dotenv/config';
import { Pool } from 'pg';
import * as crypto from 'crypto';

function decrypt(encryptedText: string, masterKeyString: string): string {
  if (!masterKeyString || masterKeyString.length < 32) return encryptedText;
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const parts = encryptedText.split(':');
  if (parts.length !== 3) return encryptedText;
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(authTag);
  let dec = decipher.update(parts[2], 'hex', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

async function getTenantPool(): Promise<Pool> {
  // Option 1: Direct CLI argument e.g. --url=postgresql://...
  const urlArg = process.argv.find((a) => a.startsWith('--url='))?.replace('--url=', '');
  if (urlArg) {
    console.log('Connecting using connection string from --url argument.');
    return new Pool({ connectionString: urlArg });
  }

  // Option 2: Direct environment variable
  if (process.env.TENANT_DATABASE_URL) {
    console.log('Connecting using process.env.TENANT_DATABASE_URL.');
    return new Pool({ connectionString: process.env.TENANT_DATABASE_URL });
  }

  // Option 3: Auto-resolve from Company table in Management / Master DB
  const managementUrl = process.env.DATABASE_URL_MANAGEMENT || process.env.DATABASE_URL;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  let tenantConnStr = '';

  if (managementUrl) {
    try {
      const mgmtPool = new Pool({ connectionString: managementUrl });
      const compRes = await mgmtPool.query(`
        SELECT "dbName", "dbUser", "dbPassword", "dbHost", "dbPort", "dbUrl"
        FROM "Company"
        WHERE status = 'active'
        ORDER BY "createdAt" ASC
      `);
      await mgmtPool.end();

      if (compRes.rows.length > 0) {
        // Target 'tenant_speed_main_mox1gfsi' or first active company
        const company =
          compRes.rows.find((c) => c.dbName === 'tenant_speed_main_mox1gfsi') ||
          compRes.rows[0];

        tenantConnStr = company.dbUrl;
        if (company.dbPassword && masterKey) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            tenantConnStr = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch {}
        }
        console.log(`Auto-resolved tenant database credentials for "${company.dbName}" from Management DB.`);
      }
    } catch (e: any) {
      console.warn(`Could not auto-resolve from Management DB: ${e.message}`);
    }
  }

  // Option 4: Local fallback
  if (!tenantConnStr) {
    tenantConnStr =
      process.env.DATABASE_URL ||
      'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi';
    console.log('Falling back to default connection string.');
  }

  return new Pool({ connectionString: tenantConnStr });
}

const isApply = process.argv.includes('--apply');
const isDryRun = !isApply;

async function runCleanup() {
  console.log(`=======================================================`);
  console.log(`MODE: ${isApply ? '🚀 APPLY CHANGES (LIVE FIX)' : '🔍 DRY RUN (NO DB CHANGES WILL BE SAVED)'}`);
  console.log(`=======================================================\n`);

  const pool = await getTenantPool();
  const client = await pool.connect();

  try {
    if (isApply) {
      await client.query('BEGIN');
    }

    // ── 1. PAYMENT VOUCHERS (PaymentVoucherDetail) ─────────────────────────
    console.log('--- Step 1: Deduplicating PaymentVoucherDetail ---');
    const pvDupRows = await client.query(`
      WITH ranked AS (
        SELECT 
          id,
          "paymentVoucherId",
          ROW_NUMBER() OVER (
            PARTITION BY "paymentVoucherId", "accountId", COALESCE("tagAccountId", 'NONE'), "debit", "credit", COALESCE("narration", '')
            ORDER BY "createdAt" ASC, id ASC
          ) as rn
        FROM "PaymentVoucherDetail"
      )
      SELECT id FROM ranked WHERE rn > 1;
    `);
    const pvDeleteIds = pvDupRows.rows.map((r) => r.id);
    console.log(`Found ${pvDeleteIds.length} duplicate PaymentVoucherDetail rows to remove.`);

    if (isApply && pvDeleteIds.length > 0) {
      await client.query(`DELETE FROM "PaymentVoucherDetail" WHERE id = ANY($1)`, [pvDeleteIds]);
      console.log(`✓ Deleted ${pvDeleteIds.length} duplicate PaymentVoucherDetail rows.`);
    }

    // ── 2. RECEIPT VOUCHERS (ReceiptVoucherDetail - RV & RSRV) ─────────────
    console.log('\n--- Step 2: Deduplicating ReceiptVoucherDetail ---');
    const rvDupRows = await client.query(`
      WITH ranked AS (
        SELECT 
          id,
          "receiptVoucherId",
          ROW_NUMBER() OVER (
            PARTITION BY "receiptVoucherId", "accountId", COALESCE("tagAccountId", 'NONE'), "debit", "credit", COALESCE("narration", '')
            ORDER BY "createdAt" ASC, id ASC
          ) as rn
        FROM "ReceiptVoucherDetail"
      )
      SELECT id FROM ranked WHERE rn > 1;
    `);
    const rvDeleteIds = rvDupRows.rows.map((r) => r.id);
    console.log(`Found ${rvDeleteIds.length} duplicate ReceiptVoucherDetail rows to remove.`);

    if (isApply && rvDeleteIds.length > 0) {
      await client.query(`DELETE FROM "ReceiptVoucherDetail" WHERE id = ANY($1)`, [rvDeleteIds]);
      console.log(`✓ Deleted ${rvDeleteIds.length} duplicate ReceiptVoucherDetail rows.`);
    }

    // ── 3. JOURNAL VOUCHERS (JournalVoucherDetail) ─────────────────────────
    console.log('\n--- Step 3: Deduplicating JournalVoucherDetail ---');

    // For JV-26-27-0117: remove Batch 2 (from 2026-09-15) to restore original 82 printed lines
    const jv0117Batch2 = await client.query(`
      SELECT d.id 
      FROM "JournalVoucherDetail" d
      JOIN "JournalVoucher" jv ON jv.id = d."journalVoucherId"
      WHERE jv."jvNo" = 'JV-26-27-0117' AND d."createdAt" >= '2026-09-01'
    `);
    console.log(`JV-26-27-0117 Batch 2 duplicate lines: ${jv0117Batch2.rows.length} rows.`);

    // For other JVs: remove exact duplicate lines (rn > 1)
    const jvDupRows = await client.query(`
      WITH ranked AS (
        SELECT 
          d.id,
          d."journalVoucherId",
          jv."jvNo",
          ROW_NUMBER() OVER (
            PARTITION BY d."journalVoucherId", d."accountId", COALESCE(d."tagAccountId", 'NONE'), d."debit", d."credit", COALESCE(d."narration", '')
            ORDER BY d."createdAt" ASC, d.id ASC
          ) as rn
        FROM "JournalVoucherDetail" d
        JOIN "JournalVoucher" jv ON jv.id = d."journalVoucherId"
        WHERE jv."jvNo" != 'JV-26-27-0117'
      )
      SELECT id FROM ranked WHERE rn > 1;
    `);
    const jvOtherDeleteIds = jvDupRows.rows.map((r) => r.id);
    console.log(`Found ${jvOtherDeleteIds.length} duplicate lines in other Journal Vouchers to remove.`);

    const totalJvDeleteIds = [...jv0117Batch2.rows.map((r) => r.id), ...jvOtherDeleteIds];

    if (isApply && totalJvDeleteIds.length > 0) {
      await client.query(`DELETE FROM "JournalVoucherDetail" WHERE id = ANY($1)`, [totalJvDeleteIds]);
      console.log(`✓ Deleted ${totalJvDeleteIds.length} total duplicate JournalVoucherDetail rows.`);
    }

    // ── 4. ACCOUNT TRANSACTIONS (General Ledger) ───────────────────────────
    console.log('\n--- Step 4: Deduplicating AccountTransaction (GL entries) ---');

    // For JV-0117: remove the September 15 transactions (82 rows)
    const tx0117Batch2 = await client.query(`
      SELECT tx.id 
      FROM "AccountTransaction" tx
      JOIN "JournalVoucher" jv ON jv.id = tx."sourceId"
      WHERE jv."jvNo" = 'JV-26-27-0117' AND tx."createdAt" >= '2026-09-01'
    `);
    console.log(`JV-26-27-0117 Batch 2 AccountTransactions: ${tx0117Batch2.rows.length} rows.`);

    // For other vouchers: remove duplicate AccountTransactions (same sourceId, accountId, tag, debit, credit, narration)
    const txDupRows = await client.query(`
      WITH ranked AS (
        SELECT 
          id,
          "sourceId",
          "sourceType",
          ROW_NUMBER() OVER (
            PARTITION BY "sourceId", "sourceType", "accountId", COALESCE("tagAccountId", 'NONE'), "debit", "credit", COALESCE("narration", '')
            ORDER BY "createdAt" ASC, id ASC
          ) as rn
        FROM "AccountTransaction"
        WHERE "sourceId" != '8fd3737d-a3c3-4913-abf0-3bd8b26e3cc0'
      )
      SELECT id FROM ranked WHERE rn > 1;
    `);
    const txOtherDeleteIds = txDupRows.rows.map((r) => r.id);
    console.log(`Found ${txOtherDeleteIds.length} duplicate AccountTransaction rows in other vouchers to remove.`);

    const totalTxDeleteIds = [...tx0117Batch2.rows.map((r) => r.id), ...txOtherDeleteIds];

    if (isApply && totalTxDeleteIds.length > 0) {
      await client.query(`DELETE FROM "AccountTransaction" WHERE id = ANY($1)`, [totalTxDeleteIds]);
      console.log(`✓ Deleted ${totalTxDeleteIds.length} duplicate AccountTransaction rows.`);
    }

    // ── 5. RECONCILE ChartOfAccount.balance ────────────────────────────────
    console.log('\n--- Step 5: Reconciling ChartOfAccount.balance with true transactions ---');
    const coaRecalc = await client.query(
      `
      WITH tx_sums AS (
        SELECT 
          tx."accountId",
          SUM(
            CASE 
              WHEN a.type IN ('ASSET', 'EXPENSE') THEN tx.debit - tx.credit
              WHEN a.type IN ('LIABILITY', 'EQUITY', 'INCOME') THEN tx.credit - tx.debit
              ELSE 0
            END
          ) as true_balance
        FROM "AccountTransaction" tx
        JOIN "ChartOfAccount" a ON a.id = tx."accountId"
        ${isApply && totalTxDeleteIds.length > 0 ? `WHERE tx.id != ALL($1)` : ''}
        GROUP BY tx."accountId"
      )
      SELECT 
        a.id, 
        a.code, 
        a.name, 
        a.type, 
        a.balance as current_balance,
        COALESCE(ts.true_balance, 0) as expected_balance,
        ABS(a.balance - COALESCE(ts.true_balance, 0)) as diff
      FROM "ChartOfAccount" a
      LEFT JOIN tx_sums ts ON ts."accountId" = a.id
      WHERE a."isGroup" = false AND ABS(a.balance - COALESCE(ts.true_balance, 0)) > 0.01
      ORDER BY diff DESC;
    `,
      isApply && totalTxDeleteIds.length > 0 ? [totalTxDeleteIds] : []
    );

    console.log(`Found ${coaRecalc.rows.length} accounts whose COA.balance needs reconciliation.`);
    if (coaRecalc.rows.length > 0) {
      console.log('Sample top 5 accounts to be adjusted:');
      console.table(
        coaRecalc.rows.slice(0, 5).map((r) => ({
          code: r.code,
          name: r.name,
          type: r.type,
          current: Number(r.current_balance).toLocaleString(),
          expected: Number(r.expected_balance).toLocaleString(),
          difference: Number(r.diff).toLocaleString(),
        }))
      );
    }

    if (isApply) {
      console.log('Applying COA balance recalculation...');
      await client.query(`
        WITH tx_sums AS (
          SELECT 
            tx."accountId",
            SUM(
              CASE 
                WHEN a.type IN ('ASSET', 'EXPENSE') THEN tx.debit - tx.credit
                WHEN a.type IN ('LIABILITY', 'EQUITY', 'INCOME') THEN tx.credit - tx.debit
                ELSE 0
              END
            ) as true_balance
          FROM "AccountTransaction" tx
          JOIN "ChartOfAccount" a ON a.id = tx."accountId"
          GROUP BY tx."accountId"
        )
        UPDATE "ChartOfAccount" a
        SET balance = COALESCE(ts.true_balance, 0),
            "updatedAt" = NOW()
        FROM tx_sums ts
        WHERE a.id = ts."accountId" AND a."isGroup" = false AND ABS(a.balance - COALESCE(ts.true_balance, 0)) > 0.01;
      `);
      console.log('✓ Successfully reconciled all ChartOfAccount balances!');

      await client.query('COMMIT');
      console.log('\n=======================================================');
      console.log('🎉 ALL DUPLICATIONS RESOLVED & COMMITTED TO DATABASE!');
      console.log('=======================================================');
    } else {
      console.log('\n=======================================================');
      console.log('DRY RUN COMPLETE: No data was modified.');
      console.log('To apply these fixes, run:');
      console.log('bun ./scripts/cleanup-duplicated-vouchers.ts --apply');
      console.log('=======================================================');
    }
  } catch (err) {
    if (isApply) {
      await client.query('ROLLBACK');
      console.error('Transaction rolled back due to error.');
    }
    console.error('Cleanup error:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

runCleanup().catch(console.error);
