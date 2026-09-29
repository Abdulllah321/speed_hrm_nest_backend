/**
 * import-stock-adjustments.ts
 *
 * Imports stock adjustments from data/stock-adjustment.json into the system,
 * following the exact same flow as StockAdjustmentService.submit():
 *   1. Cleanly resets / reverses any previous imported stock adjustments (InventoryItem, StockLedger, StockAdjustment)
 *   2. Identifies warehouse-specific adjustments (Location ID starting with WH-) vs retail store adjustments
 *   3. Sets currentQty = 0, adjustedQty = delta, physicalQty = delta
 *   4. Creates StockAdjustment header (SUBMITTED) & StockAdjustmentItem rows
 *   5. Updates InventoryItem quantities
 *   6. Creates StockLedger entries
 *
 * Grouping key: (Location ID, DocumentNumber, DocumentDate, Remarks)
 * -> one StockAdjustment per unique group
 *
 * Usage:
 *   bun run scripts/import-stock-adjustments.ts [--dry-run] [--tenant=code]
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

if (isDryRun) console.log('🔍 DRY-RUN mode - no database writes will occur.');

// Raw JSON shape
interface RawAdjRow {
  CostCentre?: string;
  'Location ID'?: string;
  Concept?: string;
  DocumentNumber?: string | number;
  DocumentDate?: string;
  SKU?: string;
  Color?: string;
  Size?: string;
  Barcode: string;
  UnitPrice?: string | number;
  Quantity: string | number;
  Remarks?: string;
}

function decrypt(encryptedText: string, masterKeyString: string): string {
  if (!encryptedText || !masterKeyString || masterKeyString.length < 32) {
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
  return new Date(Date.UTC(year, month, day, 12, 0, 0));
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
  const locId = (row['Location ID'] || row.Concept || '').trim();
  const docNo = String(row.DocumentNumber || '').trim();
  const docDate = String(row.DocumentDate || '').trim();
  const remarks = String(row.Remarks || '').trim();
  return `${locId}||${docNo}||${docDate}||${remarks}`;
}

async function run() {
  const jsonPath = path.join(__dirname, '../data/stock-adjustment.json');
  if (!fs.existsSync(jsonPath)) {
    console.error(`File not found: ${jsonPath}`);
    process.exit(1);
  }
  const rawRows: RawAdjRow[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  console.log(`📦 Loaded ${rawRows.length} rows from stock-adjustment.json`);

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
      console.log('\n🎉 Finished processing all tenants.');
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

  console.log('\n🎉 Done.');
}

async function processTenant(
  prisma: PrismaClient,
  rawRows: RawAdjRow[],
  dryRun: boolean,
) {
  // 1. Fetch Warehouses and Locations
  const allWarehouses = await prisma.warehouse.findMany();
  const allLocations = await prisma.location.findMany();
  const allItems = await prisma.item.findMany({
    select: { id: true, barCode: true, sku: true, unitPrice: true },
  });

  const defaultWarehouse = allWarehouses.find((w) => w.isActive) || allWarehouses[0];
  if (!defaultWarehouse) {
    console.error('  ❌ No warehouse found - aborting.');
    return;
  }
  console.log(`  🏢 Default Warehouse: ${defaultWarehouse.name} (${defaultWarehouse.code})`);

  // Build item cache by barcode
  const itemCache = new Map<string, { id: string; unitPrice: any }>();
  for (const item of allItems) {
    if (item.barCode) itemCache.set(item.barCode.trim(), item);
  }

  // 2. Clean Reset: Revert and delete all previous stock adjustments
  if (!dryRun) {
    console.log(`\n🧹 Resetting previously imported stock adjustments...`);
    const existingAdjs = await prisma.stockAdjustment.findMany({
      include: { items: true },
    });

    if (existingAdjs.length > 0) {
      console.log(`  Reverting inventory quantities for ${existingAdjs.length} existing adjustments...`);
      for (const adj of existingAdjs) {
        for (const item of adj.items) {
          const adjQtyNum = Number(item.adjustedQty);
          if (adjQtyNum !== 0) {
            const inv = await prisma.inventoryItem.findFirst({
              where: {
                warehouseId: adj.warehouseId,
                locationId: item.locationId,
                itemId: item.itemId,
                status: 'AVAILABLE',
              },
            });
            if (inv) {
              await prisma.inventoryItem.update({
                where: { id: inv.id },
                data: { quantity: { decrement: new Prisma.Decimal(adjQtyNum) } },
              });
            }
          }
        }
      }

      await prisma.stockLedger.deleteMany({
        where: { referenceType: 'STOCK_ADJUSTMENT' },
      });
      await prisma.stockAdjustment.deleteMany();
      console.log(`  ✅ Successfully purged ${existingAdjs.length} previous adjustments and reverted stock.`);
    } else {
      console.log(`  ✨ No existing stock adjustments found to purge.`);
    }
  }

  // 3. Group rows by (Location ID, DocumentNumber, DocumentDate, Remarks)
  const groups = new Map<string, RawAdjRow[]>();
  for (const row of rawRows) {
    const key = groupKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  console.log(`\n📂 ${groups.size} adjustment groups to process from stock-adjustment.json.`);

  let seqCounter = 1;
  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const [_key, rows] of groups) {
    const firstRow = rows[0];
    const rawLocId = (firstRow['Location ID'] || firstRow.Concept || '').trim();
    const costCentre = (firstRow.CostCentre || '').trim();
    const docDate = parseDate(String(firstRow.DocumentDate || ''));
    const remarks = firstRow.Remarks || '';
    const docNo = String(firstRow.DocumentNumber || '');

    // Check if adjustment is into a Warehouse (WH- prefix)
    const isWarehouse = rawLocId.toUpperCase().startsWith('WH-');
    const whCode = isWarehouse ? rawLocId.replace(/^WH-/i, '').trim() : null;

    // Determine target warehouse
    let targetWarehouse = isWarehouse
      ? allWarehouses.find(
          (w) =>
            w.code.toUpperCase() === whCode?.toUpperCase() ||
            w.name.toUpperCase().includes(costCentre.toUpperCase()) ||
            costCentre.toUpperCase().includes(w.name.toUpperCase()),
        )
      : null;

    if (!targetWarehouse) {
      targetWarehouse = defaultWarehouse;
    }

    // Determine target location
    let targetLocation = allLocations.find(
      (l) =>
        l.code?.toUpperCase() === rawLocId.toUpperCase() ||
        l.shortCode?.toUpperCase() === rawLocId.toUpperCase() ||
        (isWarehouse && whCode && (l.code?.toUpperCase() === whCode.toUpperCase() || l.shortCode?.toUpperCase() === whCode.toUpperCase())) ||
        l.name.toUpperCase() === costCentre.toUpperCase() ||
        (isWarehouse && l.warehouseId === targetWarehouse?.id),
    );

    if (!targetLocation) {
      console.warn(`  ⚠️ Unknown location code "${rawLocId}" ("${costCentre}") - skipping group`);
      skipped++;
      continue;
    }

    const adjNo = buildAdjNo(docDate, seqCounter);

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
      const barcode = String(row.Barcode || '').trim();
      const delta = typeof row.Quantity === 'number' ? row.Quantity : parseFloat(String(row.Quantity || '0'));
      const unitPrice = typeof row.UnitPrice === 'number' ? row.UnitPrice : (parseFloat(String(row.UnitPrice || '0')) || 0);

      if (isNaN(delta) || delta === 0) continue;

      const itemRecord = itemCache.get(barcode);
      if (!itemRecord) {
        console.warn(`    Barcode not found in Item catalog: ${barcode} (SKU: ${row.SKU || 'N/A'})`);
        failedCount++;
        continue;
      }

      // Requirement: currentQty = 0, adjustedQty = delta, physicalQty = delta
      const currentQty = 0;
      const adjustedQty = delta;
      const physicalQty = delta;
      const rate = unitPrice || (itemRecord.unitPrice ? Number(itemRecord.unitPrice) : 0);

      resolvedItems.push({
        itemId: itemRecord.id,
        locationId: targetLocation.id,
        currentQty: new Prisma.Decimal(currentQty),
        physicalQty: new Prisma.Decimal(physicalQty),
        adjustedQty: new Prisma.Decimal(adjustedQty),
        rate: new Prisma.Decimal(rate),
      });
    }

    if (resolvedItems.length === 0) {
      console.warn(`    No valid items resolved for ${adjNo} - skipping group`);
      skipped++;
      seqCounter++;
      continue;
    }

    if (dryRun) {
      console.log(
        `    [DRY-RUN] ${adjNo} | Wh: [${targetWarehouse.code}] "${targetWarehouse.name}" | Loc: [${targetLocation.code}] "${targetLocation.name}" | ${resolvedItems.length} items (${failedCount} failed)`,
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
              warehouseId: targetWarehouse!.id,
              reason: remarks,
              notes: `Imported | Doc#${docNo} | Location: ${rawLocId} | ${costCentre}`,
              status: 'SUBMITTED',
              adjustmentType: 'STANDARD',
              adjustmentDate: docDate,
              createdAt: docDate,
              updatedAt: docDate,
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
                warehouseId: targetWarehouse!.id,
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
                    warehouseId: targetWarehouse!.id,
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
                    warehouseId: targetWarehouse!.id,
                    locationId: ri.locationId,
                    itemId: ri.itemId,
                    quantity: new Prisma.Decimal(-absQty),
                    status: 'AVAILABLE',
                  },
                });
              }
            }

            // 3. Stock Ledger entry
            await tx.stockLedger.create({
              data: {
                itemId: ri.itemId,
                warehouseId: targetWarehouse!.id,
                locationId: ri.locationId,
                qty: new Prisma.Decimal(adjustedQtyNum),
                movementType: MovementType.ADJUSTMENT,
                referenceType: 'STOCK_ADJUSTMENT',
                referenceId: adj.id,
                rate: ri.rate,
                createdAt: docDate,
              },
            });
          }
        },
        { timeout: 60_000 },
      );

      console.log(
        `  ✔ Created ${adjNo} | Wh: [${targetWarehouse.code}] "${targetWarehouse.name}" | Loc: [${targetLocation.code}] "${targetLocation.name}" | ${resolvedItems.length} items (${remarks.slice(0, 45)})`,
      );
      created++;
    } catch (err: any) {
      console.error(`  ❌ Failed to create ${adjNo}: ${err.message}`);
      errors++;
    }

    seqCounter++;
  }

  console.log(`\n📊 Import Summary:`);
  console.log(`   ✔ Created : ${created} adjustments`);
  console.log(`   ⏩ Skipped : ${skipped}`);
  console.log(`   ❌ Errors  : ${errors}`);
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
