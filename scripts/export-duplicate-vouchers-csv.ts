import 'dotenv/config';
import { Pool } from 'pg';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

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
  const urlArg = process.argv.find((a) => a.startsWith('--url='))?.replace('--url=', '');
  if (urlArg) return new Pool({ connectionString: urlArg });

  if (process.env.TENANT_DATABASE_URL) {
    return new Pool({ connectionString: process.env.TENANT_DATABASE_URL });
  }

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
      }
    } catch {}
  }

  if (!tenantConnStr) {
    tenantConnStr =
      process.env.DATABASE_URL ||
      'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi';
  }

  return new Pool({ connectionString: tenantConnStr });
}

function escapeCsv(val: any): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function main() {
  console.log('Generating CSV audit exports for duplicated vouchers...\n');
  const pool = await getTenantPool();
  const client = await pool.connect();

  try {
    // ── 1. SUMMARY QUERY ACROSS ALL VOUCHER TYPES ───────────────────────────
    const summaryRows: any[] = [];

    // JVs
    const jvSummary = await client.query(`
      WITH dup_lines AS (
        SELECT "journalVoucherId", count(*) as excess
        FROM (
          SELECT id, "journalVoucherId",
                 ROW_NUMBER() OVER (
                   PARTITION BY "journalVoucherId", "accountId", COALESCE("tagAccountId", 'NONE'), "debit", "credit", COALESCE("narration", '')
                   ORDER BY "createdAt" ASC, id ASC
                 ) as rn
          FROM "JournalVoucherDetail"
        ) r
        WHERE rn > 1
        GROUP BY "journalVoucherId"
      ),
      jv0117_b2 AS (
        SELECT d."journalVoucherId", count(*) as b2_count
        FROM "JournalVoucherDetail" d
        JOIN "JournalVoucher" jv ON jv.id = d."journalVoucherId"
        WHERE jv."jvNo" = 'JV-26-27-0117' AND d."createdAt" >= '2026-09-01'
        GROUP BY d."journalVoucherId"
      ),
      totals AS (
        SELECT "journalVoucherId", count(*) as total_lines, sum(debit) as total_debit
        FROM "JournalVoucherDetail"
        GROUP BY "journalVoucherId"
      )
      SELECT 
        'Journal Voucher' as voucher_type,
        jv."jvNo" as voucher_no,
        jv."jvDate"::text as voucher_date,
        jv.status,
        COALESCE(t.total_debit, 0) as total_amount,
        COALESCE(t.total_lines, 0) as current_total_lines,
        CASE 
          WHEN jv."jvNo" = 'JV-26-27-0117' THEN COALESCE(b2.b2_count, 0)
          ELSE COALESCE(dl.excess, 0)
        END as duplicate_lines_to_remove,
        COALESCE(t.total_lines, 0) - CASE 
          WHEN jv."jvNo" = 'JV-26-27-0117' THEN COALESCE(b2.b2_count, 0)
          ELSE COALESCE(dl.excess, 0)
        END as lines_after_cleanup,
        jv.description
      FROM "JournalVoucher" jv
      JOIN totals t ON t."journalVoucherId" = jv.id
      LEFT JOIN dup_lines dl ON dl."journalVoucherId" = jv.id
      LEFT JOIN jv0117_b2 b2 ON b2."journalVoucherId" = jv.id
      WHERE COALESCE(dl.excess, 0) > 0 OR jv."jvNo" = 'JV-26-27-0117'
      ORDER BY duplicate_lines_to_remove DESC;
    `);
    summaryRows.push(...jvSummary.rows);

    // PVs
    const pvSummary = await client.query(`
      WITH dup_lines AS (
        SELECT "paymentVoucherId", count(*) as excess
        FROM (
          SELECT id, "paymentVoucherId",
                 ROW_NUMBER() OVER (
                   PARTITION BY "paymentVoucherId", "accountId", COALESCE("tagAccountId", 'NONE'), "debit", "credit", COALESCE("narration", '')
                   ORDER BY "createdAt" ASC, id ASC
                 ) as rn
          FROM "PaymentVoucherDetail"
        ) r
        WHERE rn > 1
        GROUP BY "paymentVoucherId"
      ),
      totals AS (
        SELECT "paymentVoucherId", count(*) as total_lines, sum(debit) as total_debit
        FROM "PaymentVoucherDetail"
        GROUP BY "paymentVoucherId"
      )
      SELECT 
        'Payment Voucher (' || pv.type || ')' as voucher_type,
        pv."pvNo" as voucher_no,
        pv."pvDate"::text as voucher_date,
        pv.status,
        pv."creditAmount" as total_amount,
        COALESCE(t.total_lines, 0) as current_total_lines,
        COALESCE(dl.excess, 0) as duplicate_lines_to_remove,
        COALESCE(t.total_lines, 0) - COALESCE(dl.excess, 0) as lines_after_cleanup,
        pv.description
      FROM "PaymentVoucher" pv
      JOIN totals t ON t."paymentVoucherId" = pv.id
      JOIN dup_lines dl ON dl."paymentVoucherId" = pv.id
      WHERE dl.excess > 0
      ORDER BY duplicate_lines_to_remove DESC;
    `);
    summaryRows.push(...pvSummary.rows);

    // RVs & RSRVs
    const rvSummary = await client.query(`
      WITH dup_lines AS (
        SELECT "receiptVoucherId", count(*) as excess
        FROM (
          SELECT id, "receiptVoucherId",
                 ROW_NUMBER() OVER (
                   PARTITION BY "receiptVoucherId", "accountId", COALESCE("tagAccountId", 'NONE'), "debit", "credit", COALESCE("narration", '')
                   ORDER BY "createdAt" ASC, id ASC
                 ) as rn
          FROM "ReceiptVoucherDetail"
        ) r
        WHERE rn > 1
        GROUP BY "receiptVoucherId"
      ),
      totals AS (
        SELECT "receiptVoucherId", count(*) as total_lines, sum(debit) as total_debit
        FROM "ReceiptVoucherDetail"
        GROUP BY "receiptVoucherId"
      )
      SELECT 
        CASE 
          WHEN rv.type = 'rs_rv' OR rv."rvNo" LIKE 'RSRV%' THEN 'Retail Sale RV (POS)'
          ELSE 'Receipt Voucher (' || rv.type || ')'
        END as voucher_type,
        rv."rvNo" as voucher_no,
        rv."rvDate"::text as voucher_date,
        rv.status,
        rv."debitAmount" as total_amount,
        COALESCE(t.total_lines, 0) as current_total_lines,
        COALESCE(dl.excess, 0) as duplicate_lines_to_remove,
        COALESCE(t.total_lines, 0) - COALESCE(dl.excess, 0) as lines_after_cleanup,
        rv.description
      FROM "ReceiptVoucher" rv
      JOIN totals t ON t."receiptVoucherId" = rv.id
      JOIN dup_lines dl ON dl."receiptVoucherId" = rv.id
      WHERE dl.excess > 0
      ORDER BY duplicate_lines_to_remove DESC;
    `);
    summaryRows.push(...rvSummary.rows);

    // ── WRITE SUMMARY CSV ──────────────────────────────────────────────────
    const summaryHeader = [
      'Voucher Type',
      'Voucher No',
      'Date',
      'Status',
      'Voucher Amount (PKR)',
      'Current Total Lines in DB',
      'Duplicate Lines to Remove',
      'Clean Lines After Fix',
      'Description',
    ];

    const summaryCsvLines = [
      summaryHeader.join(','),
      ...summaryRows.map((r) =>
        [
          escapeCsv(r.voucher_type),
          escapeCsv(r.voucher_no),
          escapeCsv(r.voucher_date?.slice(0, 10)),
          escapeCsv(r.status),
          escapeCsv(Number(r.total_amount || 0).toFixed(2)),
          escapeCsv(r.current_total_lines),
          escapeCsv(r.duplicate_lines_to_remove),
          escapeCsv(r.lines_after_cleanup),
          escapeCsv(r.description || ''),
        ].join(',')
      ),
    ];

    const summaryCsvPath = path.resolve(process.cwd(), 'duplicated_vouchers_summary.csv');
    fs.writeFileSync(summaryCsvPath, summaryCsvLines.join('\n'));
    console.log(`✓ Generated Summary CSV: ${summaryCsvPath} (${summaryRows.length} vouchers)`);

    // ── 2. LINE-BY-LINE DETAIL QUERY OF ALL DUPLICATES ──────────────────────
    console.log('Querying line-by-line duplicate details...');
    const detailRows: any[] = [];

    // JVs
    const jvDetails = await client.query(`
      WITH ranked AS (
        SELECT 
          d.id,
          d."journalVoucherId",
          d."accountId",
          d."tagAccountId",
          d.debit,
          d.credit,
          d.narration,
          d."createdAt",
          jv."jvNo",
          ROW_NUMBER() OVER (
            PARTITION BY d."journalVoucherId", d."accountId", COALESCE(d."tagAccountId", 'NONE'), d."debit", d."credit", COALESCE(d."narration", '')
            ORDER BY d."createdAt" ASC, d.id ASC
          ) as rn
        FROM "JournalVoucherDetail" d
        JOIN "JournalVoucher" jv ON jv.id = d."journalVoucherId"
      )
      SELECT 
        'Journal Voucher' as voucher_type,
        r."jvNo" as voucher_no,
        r.id as detail_line_id,
        a.code as account_code,
        a.name as account_name,
        t.code as tag_code,
        t.name as tag_name,
        r.debit,
        r.credit,
        r.narration,
        r."createdAt"::text as line_created_at
      FROM ranked r
      LEFT JOIN "ChartOfAccount" a ON a.id = r."accountId"
      LEFT JOIN "ChartOfAccount" t ON t.id = r."tagAccountId"
      WHERE (r."jvNo" != 'JV-26-27-0117' AND r.rn > 1)
         OR (r."jvNo" = 'JV-26-27-0117' AND r."createdAt" >= '2026-09-01')
      ORDER BY r."jvNo", r."createdAt" DESC;
    `);
    detailRows.push(...jvDetails.rows);

    // PVs
    const pvDetails = await client.query(`
      WITH ranked AS (
        SELECT 
          d.id,
          d."paymentVoucherId",
          d."accountId",
          d."tagAccountId",
          d.debit,
          d.credit,
          d.narration,
          d."createdAt",
          pv."pvNo",
          ROW_NUMBER() OVER (
            PARTITION BY d."paymentVoucherId", d."accountId", COALESCE(d."tagAccountId", 'NONE'), d."debit", d."credit", COALESCE(d."narration", '')
            ORDER BY d."createdAt" ASC, d.id ASC
          ) as rn
        FROM "PaymentVoucherDetail" d
        JOIN "PaymentVoucher" pv ON pv.id = d."paymentVoucherId"
      )
      SELECT 
        'Payment Voucher' as voucher_type,
        r."pvNo" as voucher_no,
        r.id as detail_line_id,
        a.code as account_code,
        a.name as account_name,
        t.code as tag_code,
        t.name as tag_name,
        r.debit,
        r.credit,
        r.narration,
        r."createdAt"::text as line_created_at
      FROM ranked r
      LEFT JOIN "ChartOfAccount" a ON a.id = r."accountId"
      LEFT JOIN "ChartOfAccount" t ON t.id = r."tagAccountId"
      WHERE r.rn > 1
      ORDER BY r."pvNo", r."createdAt" DESC;
    `);
    detailRows.push(...pvDetails.rows);

    // RVs
    const rvDetails = await client.query(`
      WITH ranked AS (
        SELECT 
          d.id,
          d."receiptVoucherId",
          d."accountId",
          d."tagAccountId",
          d.debit,
          d.credit,
          d.narration,
          d."createdAt",
          rv."rvNo",
          rv.type,
          ROW_NUMBER() OVER (
            PARTITION BY d."receiptVoucherId", d."accountId", COALESCE(d."tagAccountId", 'NONE'), d."debit", d."credit", COALESCE(d."narration", '')
            ORDER BY d."createdAt" ASC, d.id ASC
          ) as rn
        FROM "ReceiptVoucherDetail" d
        JOIN "ReceiptVoucher" rv ON rv.id = d."receiptVoucherId"
      )
      SELECT 
        CASE 
          WHEN r.type = 'rs_rv' OR r."rvNo" LIKE 'RSRV%' THEN 'Retail Sale RV (POS)'
          ELSE 'Receipt Voucher'
        END as voucher_type,
        r."rvNo" as voucher_no,
        r.id as detail_line_id,
        a.code as account_code,
        a.name as account_name,
        t.code as tag_code,
        t.name as tag_name,
        r.debit,
        r.credit,
        r.narration,
        r."createdAt"::text as line_created_at
      FROM ranked r
      LEFT JOIN "ChartOfAccount" a ON a.id = r."accountId"
      LEFT JOIN "ChartOfAccount" t ON t.id = r."tagAccountId"
      WHERE r.rn > 1
      ORDER BY r."rvNo", r."createdAt" DESC;
    `);
    detailRows.push(...rvDetails.rows);

    // ── WRITE DETAIL CSV ───────────────────────────────────────────────────
    const detailHeader = [
      'Voucher Type',
      'Voucher No',
      'Detail Line ID (to be removed)',
      'Account Code',
      'Account Name',
      'Sub-Account (Tag) Code',
      'Sub-Account (Tag) Name',
      'Debit (PKR)',
      'Credit (PKR)',
      'Narration',
      'Duplicate Created At',
    ];

    const detailCsvLines = [
      detailHeader.join(','),
      ...detailRows.map((r) =>
        [
          escapeCsv(r.voucher_type),
          escapeCsv(r.voucher_no),
          escapeCsv(r.detail_line_id),
          escapeCsv(r.account_code || ''),
          escapeCsv(r.account_name || ''),
          escapeCsv(r.tag_code || ''),
          escapeCsv(r.tag_name || ''),
          escapeCsv(Number(r.debit || 0).toFixed(2)),
          escapeCsv(Number(r.credit || 0).toFixed(2)),
          escapeCsv(r.narration || ''),
          escapeCsv(r.line_created_at || ''),
        ].join(',')
      ),
    ];

    const detailCsvPath = path.resolve(process.cwd(), 'duplicated_voucher_lines_detail.csv');
    fs.writeFileSync(detailCsvPath, detailCsvLines.join('\n'));
    console.log(`✓ Generated Detail CSV: ${detailCsvPath} (${detailRows.length} duplicate lines)`);

    console.log('\n=======================================================');
    console.log('✅ CSV EXPORT SUCCESSFUL!');
    console.log(`1. Summary CSV: ${summaryCsvPath}`);
    console.log(`2. Detail Lines CSV: ${detailCsvPath}`);
    console.log('=======================================================');
  } catch (err) {
    console.error('Error generating CSVs:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);

