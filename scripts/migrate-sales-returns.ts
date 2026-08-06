/**
 * migrate-sales-returns.ts
 *
 * Reads "All Stores (Sales Return) 01-07-2025 to 30-06-2026.xlsx" and, for every
 * unique return document (FORMATTED Number), links the original SalesOrder with:
 *   - status      → 'returned'
 *   - returnNumber → the FORMATTED Number from the file (e.g. "EXC-Adi MS-0001")
 *
 * Then links the Exchange Voucher (pos_vouchers.code = FORMATTED Number) to the
 * order via sourceOrderId.
 *
 * ⚠️  NO stock movements are created — this is a pure data-linkage migration.
 *
 * Usage:
 *   npx ts-node -P tsconfig.scripts.json scripts/migrate-sales-returns.ts [--dry-run]
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';
import * as xlsx from 'xlsx';

// ─── Config ───────────────────────────────────────────────────────────────────

const EXCEL_FILE = path.join(
  process.cwd(),
  'All Stores (Sales Return) 01-07-2025 to 30-06-2026.xlsx',
);

const masterDbUrl =
  process.env.DATABASE_URL ||
  'postgresql://postgres:root@localhost:5432/spl_core_db?schema=public';

const IGNORED_DBS = [
  'postgres',
  'whatsapp_clone',
  'quizdb',
  'anim_library',
  'glider_ui',
  'omni-test-express',
  'omni-test-next',
];

const DRY_RUN = process.argv.includes('--dry-run');

// ─── Excel Row Interface ──────────────────────────────────────────────────────

interface ExcelRow {
  DocumentNumber: number | string;
  DocumentDate: number | string;
  Type: string;
  'SUB Type': string;
  BarCode: string;
  Quantity: number;
  UnitPrice: number;
  Price_W_O_T: number;
  Total_Price_W_O_T: number;
  DiscountAmount: number;
  'Value Ex Sales Tax': number;
  'Sales Tax': number;
  'Additional Sales Tax': number;
  'Total Sales Tax': number;
  'Value Incl Sales Tax': number;
  'Short-Code': string;
  CostCentre: string;
  'POS ID': number | string;
  'FBR Invoice#': string;
  FKExchangeVoucherNumber: number | string;
  DiscountRate_Given: number;
  Remarks: string;
  'Is Alliance Discount': string;
  FKInvoiceNumber_Sale: number | string;
  'Formatted SI': string;         // e.g. "SI-ADIMS26-00004"
  DocumentDate_Sale: number | string;
  FKInvoiceNumber_Settle: number | string;
  DocumentDate_Settle: number | string;
  'FORMATTED Number': string;     // e.g. "EXC-Adi MS-0001"
}

// ─── Grouped return document ──────────────────────────────────────────────────

interface ReturnDoc {
  formattedNumber: string;   // returnNumber to set on SalesOrder
  formattedSI: string;       // original SalesOrder.orderNumber
  posId: string;             // legacy POS ID
  costCentre: string;        // location short-code
  subType: string;           // Exchange | Claim | Refund
  totalValueInclTax: number;
  rows: ExcelRow[];
}

// ─── Load & Group Excel ───────────────────────────────────────────────────────

function loadExcel(): ReturnDoc[] {
  if (!fs.existsSync(EXCEL_FILE)) {
    console.error(`\u274C Excel file not found: ${EXCEL_FILE}`);
    process.exit(1);
  }

  console.log(`\u{1F4C4} Reading: ${path.basename(EXCEL_FILE)}`);
  const wb = xlsx.readFile(EXCEL_FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: ExcelRow[] = xlsx.utils.sheet_to_json(ws, { defval: '' });
  console.log(`   ${rows.length} line-item rows loaded.`);

  const docMap = new Map<string, ReturnDoc>();

  for (const row of rows) {
    const formattedNumber = String(row['FORMATTED Number'] || '').trim();
    const formattedSI = String(row['Formatted SI'] || '').trim();
    if (!formattedNumber || !formattedSI) continue;

    if (!docMap.has(formattedNumber)) {
      docMap.set(formattedNumber, {
        formattedNumber,
        formattedSI,
        posId: String(row['POS ID'] || '').trim(),
        costCentre: String(row['CostCentre'] || '').trim(),
        subType: String(row['SUB Type'] || '').trim(),
        totalValueInclTax: 0,
        rows: [],
      });
    }

    const doc = docMap.get(formattedNumber)!;
    doc.rows.push(row);
    doc.totalValueInclTax += Math.abs(Number(row['Value Incl Sales Tax'] || 0));
  }

  const docs = Array.from(docMap.values());
  console.log(`   Grouped into ${docs.length} unique return documents.\n`);
  return docs;
}

// ─── Per-DB migration ─────────────────────────────────────────────────────────

async function migrateReturnsToDb(
  prisma: PrismaClient,
  dbName: string,
  docs: ReturnDoc[],
): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`\u{1F680}  Processing DB [${dbName}]`);
  console.log(`${'='.repeat(60)}`);

  let linked = 0;
  let skippedOrderNotFound = 0;
  let skippedAlreadyDone = 0;
  let voucherLinked = 0;
  let voucherNotFound = 0;
  let voucherAlreadyLinked = 0;
  let errors = 0;

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];

    try {
      // ── 1. Locate original SalesOrder by order number ────────────────────
      const order = await (prisma as any).salesOrder.findFirst({
        where: { orderNumber: doc.formattedSI },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          returnNumber: true,
        },
      });

      if (!order) {
        skippedOrderNotFound++;
        if (skippedOrderNotFound <= 20) {
          console.warn(
            `  \u26A0\uFE0F  Order not found: SI=${doc.formattedSI} | Return=${doc.formattedNumber}`,
          );
        }
        continue;
      }

      // ── 2. Skip if already linked with same return number ────────────────
      if (
        order.status === 'returned' &&
        order.returnNumber === doc.formattedNumber
      ) {
        skippedAlreadyDone++;
        continue;
      }

      // ── 3. Update SalesOrder ─────────────────────────────────────────────
      if (!DRY_RUN) {
        await (prisma as any).salesOrder.update({
          where: { id: order.id },
          data: {
            status: 'returned',
            // Only set returnNumber if not already set (unique constraint)
            returnNumber: order.returnNumber ?? doc.formattedNumber,
            notes: `[Migrated SR] Return: ${doc.formattedNumber} | Type: ${doc.subType}`,
          },
        });
      }
      linked++;

      // ── 4. Link Exchange Voucher → order via sourceOrderId ───────────────
      // The FORMATTED Number IS the voucher code inserted by migrate-exchange-vouchers
      const voucher = await (prisma as any).voucher.findFirst({
        where: { code: doc.formattedNumber },
        select: { id: true, code: true, sourceOrderId: true },
      });

      if (!voucher) {
        voucherNotFound++;
        // Non-blocking: Claim / Refund sub-types may not have a voucher
      } else if (voucher.sourceOrderId) {
        if (voucher.sourceOrderId !== order.id) {
          console.warn(
            `  \u26A0\uFE0F  Voucher ${voucher.code} already linked to ${voucher.sourceOrderId} — skipping`,
          );
        }
        voucherAlreadyLinked++;
      } else {
        if (!DRY_RUN) {
          await (prisma as any).voucher.update({
            where: { id: voucher.id },
            data: { sourceOrderId: order.id },
          });
        }
        voucherLinked++;
      }
    } catch (err: any) {
      errors++;
      console.error(
        `  \u274C  Error on ${doc.formattedNumber}: ${err.message}`,
      );
    }

    if ((i + 1) % 500 === 0) {
      console.log(`  Progress: ${i + 1} / ${docs.length} documents...`);
    }
  }

  console.log(`\n\u2705  DB [${dbName}] summary:`);
  console.log(`   Orders marked returned:    ${linked}`);
  console.log(`   Already done (skipped):    ${skippedAlreadyDone}`);
  console.log(`   Order not found:           ${skippedOrderNotFound}`);
  console.log(`   Vouchers linked:           ${voucherLinked}`);
  console.log(`   Vouchers already linked:   ${voucherAlreadyLinked}`);
  console.log(`   Vouchers not found:        ${voucherNotFound}`);
  console.log(`   Errors:                    ${errors}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (DRY_RUN) {
    console.log('\n\u{1F50D}  DRY-RUN MODE — no writes will be made.\n');
  }

  const docs = loadExcel();
  if (docs.length === 0) {
    console.error('\u274C No return documents parsed from Excel. Exiting.');
    process.exit(1);
  }

  // ── Discover all tenant databases ────────────────────────────────────────
  const mainPool = new Pool({ connectionString: masterDbUrl });
  const dbRes = await mainPool.query(
    `SELECT datname FROM pg_database WHERE datistemplate = false;`,
  );
  await mainPool.end();

  for (const dbRow of dbRes.rows) {
    const dbName: string = dbRow.datname;
    if (IGNORED_DBS.includes(dbName)) continue;

    // Replace DB name in connection string
    const dbUrl = masterDbUrl.replace(/\/[^/?]+(\?.*)?$/, `/${dbName}$1`);
    const tPool = new Pool({ connectionString: dbUrl });

    try {
      // Only process DBs that have sales_orders table
      const tableCheck = await tPool.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'sales_orders' LIMIT 1;`,
      );
      if (tableCheck.rows.length === 0) {
        // tPool.end() will be called in finally — don't call it here too
        continue;
      }

      const adapter = new PrismaPg(tPool);
      const prisma = new PrismaClient({ adapter } as any);
      await prisma.$connect();

      await migrateReturnsToDb(prisma, dbName, docs);

      // Do NOT call prisma.$disconnect() — PrismaPg internally calls pool.end(),
      // which would cause "Called end on pool more than once" when finally runs.
    } catch (err: any) {
      console.error(`\u274C Error on DB [${dbName}]: ${err.message}`);
    } finally {
      // Single authoritative cleanup for this DB's pool
      try { await tPool.end(); } catch { /* already ended or never opened */ }
    }

  }

  console.log(`\n\u{1F389}  Migration complete.`);
}

main().catch((e) => {
  console.error('\u274C Fatal error:', e);
  process.exit(1);
});
