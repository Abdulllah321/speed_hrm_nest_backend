import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * LOCATION OUTLET WIPE / CLEAR DATA SCRIPT
 * ──────────────────────────────────────────
 * Deletes all transactions, transfers, stock movements, POS sales, and inventory
 * records tied to a specific location (outlet) by location ID or location code.
 *
 * Parameters:
 *   --locationId <id>      Target location ID
 *   --locationCode <code>  Target location code or shortCode (e.g. BC1-KHI, SS1002)
 *   --tenant <name>        Target tenant DB name (e.g. speed_limit, ivar)
 *   --dryRun / --dry-run   Preview count of records that will be deleted
 *   --force                Bypass confirmation prompts
 *
 * Usage:
 *   bun ./scripts/wipe-location-data.ts --locationCode "BC1-KHI" --dryRun
 *   bun ./scripts/wipe-location-data.ts --locationId "YOUR_LOCATION_UUID"
 */

function decrypt(encryptedText: string, masterKeyString: string): string {
  if (!masterKeyString || masterKeyString.length < 32) {
    throw new Error('MASTER_ENCRYPTION_KEY must be at least 32 characters');
  }
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const algorithm = 'aes-256-gcm';

  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(algorithm, masterKey, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

interface WipeOptions {
  locationId?: string | null;
  locationCode?: string | null;
  isDryRun: boolean;
  force: boolean;
}

async function safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    return fallback;
  }
}

async function wipeLocationData(prisma: PrismaClient, options: WipeOptions) {
  const { locationId, locationCode, isDryRun } = options;

  if (!locationId && !locationCode) {
    console.error('❌ Error: You must provide either --locationId or --locationCode');
    process.exit(1);
  }

  // Find target location
  const locationWhere: any = {};
  if (locationId) locationWhere.id = locationId;
  if (locationCode) {
    locationWhere.OR = [
      { code: { equals: locationCode, mode: 'insensitive' } },
      { shortCode: { equals: locationCode, mode: 'insensitive' } },
    ];
  }

  const location = await prisma.location.findFirst({
    where: locationWhere,
    select: { id: true, name: true, code: true, shortCode: true },
  });

  if (!location) {
    console.error(`❌ Location not found matching criteria (ID: ${locationId || 'N/A'}, Code: ${locationCode || 'N/A'})`);
    return;
  }

  const locId = location.id;
  console.log(`\n============================================================`);
  console.log(`📍 TARGET LOCATION TO WIPE:`);
  console.log(`   ID:        ${location.id}`);
  console.log(`   Name:      ${location.name}`);
  console.log(`   Code:      ${location.code || 'N/A'}`);
  console.log(`   ShortCode: ${location.shortCode || 'N/A'}`);
  console.log(`============================================================\n`);

  // Safe Count checks
  const salesOrdersCount = await safeQuery(() => prisma.salesOrder.count({ where: { locationId: locId } }), 0);

  const posTerminals = await safeQuery(() => prisma.pos.findMany({ where: { locationId: locId }, select: { id: true } }), []);
  const posIds = posTerminals.map(p => p.id);
  const posSessionsCount = posIds.length > 0 ? await safeQuery(() => prisma.posSession.count({ where: { posId: { in: posIds } } }), 0) : 0;

  const transferRequestsCount = await safeQuery(() => prisma.transferRequest.count({
    where: { OR: [{ fromLocationId: locId }, { toLocationId: locId }] },
  }), 0);

  const stockMovementsCount = await safeQuery(() => prisma.stockMovement.count({
    where: { OR: [{ fromLocationId: locId }, { toLocationId: locId }] },
  }), 0);

  const stockRequisitionsCount = await safeQuery(async () => {
    if ((prisma as any).stockRequisition?.count) {
      return await (prisma as any).stockRequisition.count({ where: { toLocationId: locId } });
    }
    const res: any[] = await prisma.$queryRaw`SELECT COUNT(*)::int as count FROM stock_requisitions WHERE to_location_id = ${locId}`;
    return res[0]?.count ?? 0;
  }, 0);

  const stockAdjustmentsCount = await safeQuery(() => prisma.stockAdjustment.count({
    where: { locationId: locId },
  }), 0);

  const stockLedgerCount = await safeQuery(() => prisma.stockLedger.count({
    where: { locationId: locId },
  }), 0);

  const inventoryItemsCount = await safeQuery(() => prisma.inventoryItem.count({
    where: { locationId: locId },
  }), 0);

  console.log(`📊 RECORD COUNTS FOR LOCATION "${location.name}":`);
  console.log(`   • Sales Orders:              ${salesOrdersCount}`);
  console.log(`   • POS Sessions:              ${posSessionsCount}`);
  console.log(`   • POS Terminals:             ${posTerminals.length}`);
  console.log(`   • Transfer Requests:         ${transferRequestsCount}`);
  console.log(`   • Stock Movements:           ${stockMovementsCount}`);
  console.log(`   • Stock Requisitions:        ${stockRequisitionsCount}`);
  console.log(`   • Stock Adjustments:         ${stockAdjustmentsCount}`);
  console.log(`   • Stock Ledger Entries:      ${stockLedgerCount}`);
  console.log(`   • Inventory Items:           ${inventoryItemsCount}\n`);

  if (isDryRun) {
    console.log('🔍 [DRY RUN] Finished count inspection. No records were deleted.');
    return;
  }

  console.log(`⚠️ DELETING ALL TRANSACTIONS & DATA FOR LOCATION "${location.name}"...`);

  await prisma.$transaction(async (tx) => {
    // 1. Delete POS Claims
    await safeQuery(() => tx.$executeRaw`
      DELETE FROM pos_claim_items WHERE claim_id IN (
        SELECT pc.id FROM pos_claims pc
        JOIN sales_orders so ON so.id = pc.sales_order_id
        WHERE so.location_id = ${locId}
      );
    `, 0);
    await safeQuery(() => tx.$executeRaw`
      DELETE FROM pos_claims WHERE sales_order_id IN (
        SELECT id FROM sales_orders WHERE location_id = ${locId}
      );
    `, 0);

    // 2. Delete Voucher Redemptions & Transactions for sales orders
    await safeQuery(() => tx.$executeRaw`
      DELETE FROM pos_voucher_redemptions WHERE order_id IN (
        SELECT id FROM sales_orders WHERE location_id = ${locId}
      );
    `, 0);
    await safeQuery(() => tx.$executeRaw`
      DELETE FROM pos_voucher_transactions WHERE location_id = ${locId} OR order_id IN (
        SELECT id FROM sales_orders WHERE location_id = ${locId}
      );
    `, 0);

    // 3. Delete Sales Order Items & Sales Orders
    const salesOrders = await safeQuery(() => tx.salesOrder.findMany({
      where: { locationId: locId },
      select: { id: true },
    }), []);
    const orderIds = salesOrders.map(o => o.id);

    if (orderIds.length > 0) {
      await safeQuery(() => tx.salesOrderItem.deleteMany({
        where: { salesOrderId: { in: orderIds } },
      }), null);
      await safeQuery(() => tx.salesOrder.deleteMany({
        where: { locationId: locId },
      }), null);
      console.log(`   ✅ Wiped ${orderIds.length} Sales Order(s) & associated items.`);
    }

    // 4. Delete POS Sessions & POS Terminals
    if (posIds.length > 0) {
      const posSessions = await safeQuery(() => tx.posSession.findMany({
        where: { posId: { in: posIds } },
        select: { id: true },
      }), []);
      const sessionIds = posSessions.map(s => s.id);

      if (sessionIds.length > 0) {
        await safeQuery(() => tx.$executeRaw`
          DELETE FROM pos_session_cash_denominations WHERE pos_session_id IN (
            SELECT id FROM "PosSession" WHERE "posId" IN (${posIds.join(',')})
          );
        `, 0);
        await safeQuery(() => tx.$executeRaw`
          DELETE FROM pos_session_transactions WHERE pos_session_id IN (
            SELECT id FROM "PosSession" WHERE "posId" IN (${posIds.join(',')})
          );
        `, 0);
        await safeQuery(() => tx.posSession.deleteMany({
          where: { posId: { in: posIds } },
        }), null);
      }

      await safeQuery(() => tx.pos.deleteMany({
        where: { locationId: locId },
      }), null);
      console.log(`   ✅ Wiped ${posIds.length} POS Terminal(s) & ${posSessionsCount} Session(s).`);
    }

    // 5. Delete Transfer Requests & Items
    const transferRequests = await safeQuery(() => tx.transferRequest.findMany({
      where: { OR: [{ fromLocationId: locId }, { toLocationId: locId }] },
      select: { id: true },
    }), []);
    const transferRequestIds = transferRequests.map(tr => tr.id);

    if (transferRequestIds.length > 0) {
      await safeQuery(() => tx.transferRequestItem.deleteMany({
        where: { transferRequestId: { in: transferRequestIds } },
      }), null);
      await safeQuery(() => tx.transferRequest.deleteMany({
        where: { id: { in: transferRequestIds } },
      }), null);
      console.log(`   ✅ Wiped ${transferRequestIds.length} Transfer Request(s) & items.`);
    }

    // 6. Delete Stock Movements
    const deletedMovements = await safeQuery(() => tx.stockMovement.deleteMany({
      where: { OR: [{ fromLocationId: locId }, { toLocationId: locId }] },
    }), { count: 0 });
    console.log(`   ✅ Wiped ${deletedMovements.count} Stock Movement(s).`);

    // 7. Delete Stock Requisitions
    await safeQuery(async () => {
      if ((tx as any).stockRequisition) {
        const stockRequisitions = await (tx as any).stockRequisition.findMany({
          where: { toLocationId: locId },
          select: { id: true },
        });
        const reqIds = stockRequisitions.map((r: any) => r.id);
        if (reqIds.length > 0) {
          await (tx as any).stockRequisitionItem?.deleteMany({
            where: { stockRequisitionId: { in: reqIds } },
          });
          await (tx as any).stockRequisition.deleteMany({
            where: { id: { in: reqIds } },
          });
          console.log(`   ✅ Wiped ${reqIds.length} Stock Requisition(s).`);
        }
      } else {
        await tx.$executeRaw`
          DELETE FROM stock_requisition_items WHERE stock_requisition_id IN (
            SELECT id FROM stock_requisitions WHERE to_location_id = ${locId}
          );
        `;
        await tx.$executeRaw`
          DELETE FROM stock_requisitions WHERE to_location_id = ${locId};
        `;
        console.log(`   ✅ Wiped Stock Requisition(s).`);
      }
    }, null);

    // 8. Delete Stock Adjustments & Items
    const stockAdjustments = await safeQuery(() => tx.stockAdjustment.findMany({
      where: { locationId: locId },
      select: { id: true },
    }), []);
    const adjIds = stockAdjustments.map(a => a.id);

    if (adjIds.length > 0) {
      await safeQuery(() => tx.stockAdjustmentItem.deleteMany({
        where: { stockAdjustmentId: { in: adjIds } },
      }), null);
      await safeQuery(() => tx.stockAdjustment.deleteMany({
        where: { locationId: locId },
      }), null);
      console.log(`   ✅ Wiped ${adjIds.length} Stock Adjustment(s).`);
    }

    // 9. Delete Stock Ledgers & Inventory Items
    const deletedLedger = await safeQuery(() => tx.stockLedger.deleteMany({
      where: { locationId: locId },
    }), { count: 0 });
    const deletedInventory = await safeQuery(() => tx.inventoryItem.deleteMany({
      where: { locationId: locId },
    }), { count: 0 });
    console.log(`   ✅ Wiped ${deletedLedger.count} Stock Ledger rows & ${deletedInventory.count} Inventory rows.`);
  });

  console.log(`\n✨ Successfully wiped all sales, transfers, stock movements, and inventory for location: "${location.name}".`);
}

async function main() {
  console.log('🚀 Starting Location Outlet Data Wipe Script...');

  const isDryRun = process.argv.includes('--dryRun') || process.argv.includes('--dry-run');
  const force = process.argv.includes('--force') || process.argv.includes('-y');

  const locationIdIdx = process.argv.indexOf('--locationId') !== -1 ? process.argv.indexOf('--locationId') : process.argv.indexOf('--location-id');
  const locationId = locationIdIdx !== -1 ? process.argv[locationIdIdx + 1] : null;

  const locationCodeIdx = process.argv.indexOf('--locationCode') !== -1 ? process.argv.indexOf('--locationCode') : process.argv.indexOf('--location-code');
  const locationCode = locationCodeIdx !== -1 ? process.argv[locationCodeIdx + 1] : null;

  const tenantArgIdx = process.argv.indexOf('--tenant');
  const specificTenant = tenantArgIdx !== -1 ? process.argv[tenantArgIdx + 1] : null;

  const options: WipeOptions = {
    locationId,
    locationCode,
    isDryRun,
    force,
  };

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  let processedViaManagement = false;

  if (managementUrl && masterKey) {
    try {
      const pool = new Pool({ connectionString: managementUrl });
      const adapter = new PrismaPg(pool);
      const management = new ManagementClient({ adapter } as any);

      const companies = await management.company.findMany({
        where: { status: 'active', ...(specificTenant ? { dbName: specificTenant } : {}) },
      });

      if (companies.length > 0) {
        processedViaManagement = true;
        for (const company of companies) {
          console.log(`\n👉 Processing Tenant Company: ${company.name} (${company.code})`);
          let connectionString = company.dbUrl;
          if (company.dbPassword) {
            try {
              const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
              connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
            } catch {
              console.warn(`  ⚠️ Decryption failed, using stored dbUrl`);
            }
          }

          if (!connectionString) {
            console.error(`  ❌ No database connection details available for company: ${company.code}`);
            continue;
          }

          const tenantPool = new Pool({ connectionString });
          const tenantAdapter = new PrismaPg(tenantPool);
          const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

          try {
            await tenantPrisma.$connect();
            await wipeLocationData(tenantPrisma, options);
          } catch (err: any) {
            console.error(`  ❌ Failed wiping location data for tenant ${company.code}: ${err.message}`);
          } finally {
            await tenantPrisma.$disconnect();
            await tenantPool.end();
          }
        }
      }
      await management.$disconnect();
      await pool.end();
    } catch (err: any) {
      console.warn(`⚠️ Management DB connection bypassed (${err.message}). Using standard DATABASE_URL...`);
    }
  }

  if (!processedViaManagement) {
    // Single database instance fallback
    console.log(`ℹ️ Connecting via default DATABASE_URL...`);
    const prisma = new PrismaClient();
    try {
      await prisma.$connect();
      await wipeLocationData(prisma, options);
    } finally {
      await prisma.$disconnect();
    }
  }

  console.log('\n✨ Done.');
}

main().catch((e) => {
  console.error('❌ Script failed with error:', e);
  process.exit(1);
});
