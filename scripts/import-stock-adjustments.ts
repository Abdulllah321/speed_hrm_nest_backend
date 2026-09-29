/**
 * import-stock-adjustments.ts
 *
 * Imports stock adjustments from data/stock-adjustment.json into the system,
 * following the exact same flow as StockAdjustmentService.submit():
 *   1. Create StockAdjustment header (SUBMITTED)
 *   2. Create StockAdjustmentItem rows (with currentQty, physicalQty, adjustedQty, rate)
 *   3. Update InventoryItem quantities
 *   4. Create StockLedger entries
 *
 * Grouping key: (Location ID, DocumentNumber, DocumentDate, Remarks)
 * -> one StockAdjustment per unique group
 *
 * The JSON "Quantity" field is a DELTA (already the adjustment amount).
 *   Positive  -> stock increase
 *   Negative  -> stock decrease
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/import-stock-adjustments.ts [--dry-run] [--tenant=code]
 */

import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient, Prisma, MovementType } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// CLI flags
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const tenantArg = args.find((a) => a.startsWith('--tenant='));
const targetTenant = tenantArg ? tenantArg.split('=')[1] : null;

if (isDryRun) console.log('DRY-RUN mode - no database writes will occur.');

// Raw JSON shape
interface RawAdjRow {
  CostCentre: string;
  'Location ID': string;
  DocumentNumber: string;
  DocumentDate: string;
  SKU: string;
  Color: string;
  Size: string;
  Barcode: string;
  UnitPrice: string;
  Quantity: string;
  Remarks: string;
}

function decrypt(encryptedText: string, masterKeyString: string): string {
  if (!masterKeyString || masterKeyString.length < 32) {
    throw new Error('MASTER_ENCRYPTION_KEY must be at least 32 characters');
  }
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const algorithm = 'aes-256-gcm';
  const parts = encryptedText.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted text format');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  const decipher = crypto.createDecipheriv(algorithm, masterKey, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Parse M/D/YY or M/D/YYYY -> Date (midnight UTC to avoid tz drift)
 */
function parseDate(s: string): Date {
  const parts = s.trim().split('/');
  if (parts.length !== 3) return new Date();
  const month = parseInt(parts[0], 10) - 1;
  const day = parseInt(parts[1], 10);
  let year = parseInt(parts[2], 10);
  if (year < 100) year += 2000;
  return new Date(Date.UTC(year, month, day));
}

/**
 * Generate adjustment number: SADJ-YY-YY-NNNNN
 */
function buildAdjNo(date: Date, seq: number): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const startYear = month >= 6 ? year : year - 1;
  const endYear = startYear + 1;
  const fy = `${String(startYear % 100).padStart(2, '0')}-${String(endYear % 100).padStart(2, '0')}`;
  return `SADJ-${fy}-${String(seq).padStart(5, '0')}`;
}

function groupKey(row: RawAdjRow): string {
  return `${row['Location ID']}||${row.DocumentNumber}||${row.DocumentDate}||${row.Remarks}`;
}

async function run() {
  const jsonPath = path.join(__dirname, '../data/stock-adjustment.json');
  if (!fs.existsSync(jsonPath)) {
    console.error(`File not found: ${jsonPath}`);
    process.exit(1);
  }
  const rawRows: RawAdjRow[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  console.log(`Loaded ${rawRows.length} rows from stock-adjustment.json`);

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT || process.env.DATABASE_URL;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (managementUrl && masterKey) {
    const mgmtPool = new Pool({ connectionString: managementUrl });
    const mgmtAdapter = new PrismaPg(mgmtPool);
    const management = new ManagementClient({ adapter: mgmtAdapter } as any);

    let companies: any[] = [];
    try {
      companies = await management.company.findMany({
        where: {
          status: 'active',
          ...(targetTenant ? { code: targetTenant } : {}),
        },
      });
    } catch (err: any) {
      console.warn(`ℹ️ Multi-tenant check skipped (${err.message}).`);
    } finally {
      await management.$disconnect();
      await mgmtPool.end();
    }

    if (companies.length > 0) {
      console.log(`\n🏢 Found ${companies.length} tenant companies. Running adjustment import for each...`);
      for (const company of companies) {
        console.log(`\n👉 Processing Tenant: ${company.name} (${company.code})`);
        let connectionString = company.dbUrl;
        if (!connectionString && company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch (e) {
            console.warn(`  ⚠️ Decryption failed for tenant dbPassword`);
          }
        }

        if (!connectionString) {
          connectionString = process.env.DATABASE_URL;
        }

        if (!connectionString) continue;

        const tenantPool = new Pool({ connectionString });
        const tenantAdapter = new PrismaPg(tenantPool);
        const tenantPrisma = new PrismaClient({ adapter: tenantAdapter as any });

        try {
          await tenantPrisma.$connect();
          await processTenant(tenantPrisma, rawRows, isDryRun);
        } finally {
          await tenantPrisma.$disconnect();
          await tenantPool.end();
        }
      }
      console.log('\nDone.');
      return;
    }
  }

  // Fallback to DATABASE_URL if management check didn't run or found no companies
  const dbUrl = process.env.DATABASE_URL!;
  if (!dbUrl) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as any);

  try {
    await prisma.$connect();
    await processTenant(prisma, rawRows, isDryRun);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }

  console.log('\nDone.');
}

async function processTenant(
  prisma: PrismaClient,
  rawRows: RawAdjRow[],
  dryRun: boolean,
) {
  const warehouse = await prisma.warehouse.findFirst({
    where: { isActive: true },
    select: { id: true, name: true, code: true },
  });
  if (!warehouse) {
    console.error('  No active warehouse found - aborting.');
    return;
  }
  console.log(`  Warehouse: ${warehouse.name} (${warehouse.id})`);

  // Build location cache: code -> { id, name }
  const allLocations = await prisma.location.findMany({
    select: { id: true, code: true, name: true },
  });
  const locationByCode = new Map<string, { id: string; name: string }>();
  for (const loc of allLocations) {
    if (loc.code) locationByCode.set(loc.code.trim().toUpperCase(), loc);
  }
  console.log(`  Loaded ${locationByCode.size} locations`);

  // Group rows by (locationCode, docNo, docDate, remarks)
  const groups = new Map<string, RawAdjRow[]>();
  for (const row of rawRows) {
    const key = groupKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  console.log(`  ${groups.size} adjustment groups to process`);

  let seqCounter = await getNextSeq(prisma);
  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const [_key, rows] of groups) {
    const firstRow = rows[0];
    const locationCode = firstRow['Location ID'].trim().toUpperCase();
    const docDate = parseDate(firstRow.DocumentDate);
    const remarks = firstRow.Remarks;
    const docNo = firstRow.DocumentNumber;

    const location = locationByCode.get(locationCode);
    if (!location) {
      console.warn(`  Unknown location code "${locationCode}" - skipping group`);
      skipped++;
      continue;
    }

    const adjNo = buildAdjNo(docDate, seqCounter);

    // Idempotency: skip if this number already exists
    const existing = await prisma.stockAdjustment.findFirst({
      where: { adjustmentNo: adjNo },
    });
    if (existing) {
      console.log(`  ${adjNo} already exists - skipping`);
      skipped++;
      seqCounter++;
      continue;
    }

    console.log(
      `  ${adjNo} | ${locationCode} | Doc#${docNo} | ${firstRow.DocumentDate} | ${remarks.substring(0, 60)}`,
    );

    type ResolvedItem = {
      itemId: string;
      locationId: string;
      currentQty: Prisma.Decimal;
      physicalQty: Prisma.Decimal;
      adjustedQty: Prisma.Decimal;
      rate: Prisma.Decimal;
    };

    const resolvedItems: ResolvedItem[] = [];
    let failedCount = 0;

    for (const row of rows) {
      const barcode = row.Barcode.trim();
      const delta = parseFloat(row.Quantity);
      const unitPrice = parseFloat(row.UnitPrice) || 0;

      if (isNaN(delta) || delta === 0) continue;

      // NOTE: Item model uses barCode (camelCase) as the field name
      const itemRecord = await prisma.item.findFirst({
        where: { barCode: barcode },
        select: { id: true, unitPrice: true },
      });

      if (!itemRecord) {
        console.warn(`    Barcode not found: ${barcode} (SKU: ${row.SKU})`);
        failedCount++;
        continue;
      }

      // Current stock at this location+warehouse
      const stockAgg = await prisma.inventoryItem.aggregate({
        where: {
          warehouseId: warehouse.id,
          locationId: location.id,
          itemId: itemRecord.id,
          status: 'AVAILABLE',
        },
        _sum: { quantity: true },
      });
      const currentQty = stockAgg._sum.quantity ? Number(stockAgg._sum.quantity) : 0;

      // physicalQty = currentQty + delta  (adjustedQty = physicalQty - currentQty = delta)
      const physicalQty = currentQty + delta;
      const adjustedQty = delta;
      const rate = unitPrice || (itemRecord.unitPrice ? Number(itemRecord.unitPrice) : 0);

      resolvedItems.push({
        itemId: itemRecord.id,
        locationId: location.id,
        currentQty: new Prisma.Decimal(currentQty),
        physicalQty: new Prisma.Decimal(physicalQty),
        adjustedQty: new Prisma.Decimal(adjustedQty),
        rate: new Prisma.Decimal(rate),
      });
    }

    if (resolvedItems.length === 0) {
      console.warn(`    No valid items resolved - skipping group`);
      skipped++;
      seqCounter++;
      continue;
    }

    if (dryRun) {
      console.log(
        `    [DRY-RUN] Would create ${adjNo} with ${resolvedItems.length} items (${failedCount} failed barcodes)`,
      );
      created++;
      seqCounter++;
      continue;
    }

    try {
      await prisma.$transaction(
        async (tx) => {
          // 1. Create StockAdjustment header + items
          const adj = await tx.stockAdjustment.create({
            data: {
              adjustmentNo: adjNo,
              warehouseId: warehouse.id,
              reason: remarks,
              notes: `Imported | Doc#${docNo} | Location: ${locationCode} | ${firstRow.CostCentre}`,
              status: 'SUBMITTED',
              adjustmentType: 'STANDARD',
              adjustmentDate: docDate,
              items: {
                create: resolvedItems.map((ri) => ({
                  itemId: ri.itemId,
                  locationId: ri.locationId,
                  currentQty: ri.currentQty,
                  physicalQty: ri.physicalQty,
                  adjustedQty: ri.adjustedQty,
                  rate: ri.rate,
                })),
              },
            },
            include: { items: true },
          });

          // 2. Apply inventory changes + stock ledger entries
          for (const ri of resolvedItems) {
            const adjustedQtyNum = Number(ri.adjustedQty);
            if (adjustedQtyNum === 0) continue;

            const existingStock = await tx.inventoryItem.findFirst({
              where: {
                warehouseId: warehouse.id,
                locationId: ri.locationId,
                itemId: ri.itemId,
                status: 'AVAILABLE',
              },
            });

            if (adjustedQtyNum > 0) {
              // Increment stock
              if (existingStock) {
                await tx.inventoryItem.update({
                  where: { id: existingStock.id },
                  data: { quantity: { increment: new Prisma.Decimal(adjustedQtyNum) } },
                });
              } else {
                await tx.inventoryItem.create({
                  data: {
                    warehouseId: warehouse.id,
                    locationId: ri.locationId,
                    itemId: ri.itemId,
                    quantity: new Prisma.Decimal(adjustedQtyNum),
                    status: 'AVAILABLE',
                  },
                });
              }
            } else {
              // Decrement stock (allow negative for import; reconciles naturally)
              const absQty = Math.abs(adjustedQtyNum);
              if (existingStock) {
                await tx.inventoryItem.update({
                  where: { id: existingStock.id },
                  data: { quantity: { decrement: new Prisma.Decimal(absQty) } },
                });
              } else {
                await tx.inventoryItem.create({
                  data: {
                    warehouseId: warehouse.id,
                    locationId: ri.locationId,
                    itemId: ri.itemId,
                    quantity: new Prisma.Decimal(-absQty),
                    status: 'AVAILABLE',
                  },
                });
              }
            }

            // 3. Stock Ledger entry (no 'date' field - createdAt is auto-set)
            await tx.stockLedger.create({
              data: {
                itemId: ri.itemId,
                warehouseId: warehouse.id,
                locationId: ri.locationId,
                qty: new Prisma.Decimal(adjustedQtyNum),
                movementType: MovementType.ADJUSTMENT,
                referenceType: 'STOCK_ADJUSTMENT',
                referenceId: adj.id,
                rate: ri.rate,
              },
            });
          }
        },
        { timeout: 60_000 },
      );

      console.log(
        `    Created ${adjNo} with ${resolvedItems.length} items (${failedCount} unresolved barcodes)`,
      );
      created++;
    } catch (err: any) {
      console.error(`    Failed to create ${adjNo}: ${err.message}`);
      errors++;
    }

    seqCounter++;
  }

  console.log(`\n  Summary:`);
  console.log(`     Created : ${created}`);
  console.log(`     Skipped : ${skipped}`);
  console.log(`     Errors  : ${errors}`);
}

/**
 * Get next available sequence number continuing from the last SADJ in this fiscal year.
 */
async function getNextSeq(prisma: PrismaClient): Promise<number> {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const startYear = month >= 6 ? year : year - 1;
  const endYear = startYear + 1;
  const fy = `${String(startYear % 100).padStart(2, '0')}-${String(endYear % 100).padStart(2, '0')}`;
  const prefix = `SADJ-${fy}-`;
  const fiscalYearStartDate = new Date(Date.UTC(startYear, 6, 1));

  const lastAdj = await prisma.stockAdjustment.findFirst({
    where: {
      adjustmentNo: { startsWith: prefix },
      createdAt: { gte: fiscalYearStartDate },
    },
    orderBy: { createdAt: 'desc' },
    select: { adjustmentNo: true },
  });

  if (!lastAdj?.adjustmentNo) return 1;
  const parts = lastAdj.adjustmentNo.split('-');
  const lastSeq = parseInt(parts[parts.length - 1], 10);
  return isNaN(lastSeq) ? 1 : lastSeq + 1;
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
