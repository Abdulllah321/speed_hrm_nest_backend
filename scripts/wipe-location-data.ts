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
 *   --locationCode <code>  Target location code or shortCode (e.g. SS1002)
 *   --tenant <name>        Target tenant DB name (e.g. speed_limit)
 *   --dryRun / --dry-run   Preview count of records that will be deleted
 *   --force                Bypass confirmation prompts
 *
 * Usage:
 *   bun ./scripts/wipe-location-data.ts --locationCode "SS1002" --dryRun
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

async function wipeLocationData(prisma: PrismaClient, options: WipeOptions) {
  const { locationId, locationCode, isDryRun } = options;

  if (!locationId && !locationCode) {
    console.error(
      '❌ Error: You must provide either --locationId or --locationCode',
    );
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
    console.error(
      `❌ Location not found matching criteria (ID: ${locationId || 'N/A'}, Code: ${locationCode || 'N/A'})`,
    );
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

  // Count records to delete
  const salesOrdersCount = await prisma.salesOrder.count({
    where: { locationId: locId },
  });

  const posTerminals = await prisma.pos.findMany({
    where: { locationId: locId },
    select: { id: true },
  });
  const posIds = posTerminals.map((p) => p.id);
  const posSessionsCount =
    posIds.length > 0
      ? await prisma.posSession.count({ where: { posId: { in: posIds } } })
      : 0;

  const transferRequestsCount = await prisma.transferRequest.count({
    where: { OR: [{ fromLocationId: locId }, { toLocationId: locId }] },
  });

  const stockMovementsCount = await prisma.stockMovement.count({
    where: { OR: [{ fromLocationId: locId }, { toLocationId: locId }] },
  });

  const stockRequisitionsCount = await prisma.stockRequisition.count({
    where: { toLocationId: locId },
  });

  const stockAdjustmentsCount = await prisma.stockAdjustment.count({
    where: { locationId: locId },
  });

  const stockLedgerCount = await prisma.stockLedger.count({
    where: { locationId: locId },
  });

  const inventoryItemsCount = await prisma.inventoryItem.count({
    where: { locationId: locId },
  });

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
    console.log(
      '🔍 [DRY RUN] Finished count inspection. No records were deleted.',
    );
    return;
  }

  console.log(
    `⚠️ DELETING ALL TRANSACTIONS & DATA FOR LOCATION "${location.name}"...`,
  );

  await prisma.$transaction(async (tx) => {
    // 1. Delete POS Claims
    await tx.$executeRaw`
      DELETE FROM pos_claim_items WHERE claim_id IN (
        SELECT pc.id FROM pos_claims pc
        JOIN sales_orders so ON so.id = pc.sales_order_id
        WHERE so.location_id = ${locId}
      );
    `;
    await tx.$executeRaw`
      DELETE FROM pos_claims WHERE sales_order_id IN (
        SELECT id FROM sales_orders WHERE location_id = ${locId}
      );
    `;

    // 2. Delete Voucher Redemptions & Transactions for sales orders
    await tx.$executeRaw`
      DELETE FROM pos_voucher_redemptions WHERE order_id IN (
        SELECT id FROM sales_orders WHERE location_id = ${locId}
      );
    `;
    await tx.$executeRaw`
      DELETE FROM pos_voucher_transactions WHERE location_id = ${locId} OR order_id IN (
        SELECT id FROM sales_orders WHERE location_id = ${locId}
      );
    `;

    // 3. Delete Sales Order Items & Sales Orders
    const salesOrders = await tx.salesOrder.findMany({
      where: { locationId: locId },
      select: { id: true },
    });
    const orderIds = salesOrders.map((o) => o.id);

    if (orderIds.length > 0) {
      await tx.salesOrderItem.deleteMany({
        where: { salesOrderId: { in: orderIds } },
      });
      await tx.salesOrder.deleteMany({
        where: { locationId: locId },
      });
      console.log(
        `   ✅ Wiped ${orderIds.length} Sales Order(s) & associated items.`,
      );
    }

    // 4. Delete POS Sessions & POS Terminals
    if (posIds.length > 0) {
      const posSessions = await tx.posSession.findMany({
        where: { posId: { in: posIds } },
        select: { id: true },
      });
      const sessionIds = posSessions.map((s) => s.id);

      if (sessionIds.length > 0) {
        await tx.$executeRaw`
          DELETE FROM pos_session_cash_denominations WHERE pos_session_id IN (
            SELECT id FROM "PosSession" WHERE "posId" IN (${posIds.join(',')})
          );
        `;
        await tx.$executeRaw`
          DELETE FROM pos_session_transactions WHERE pos_session_id IN (
            SELECT id FROM "PosSession" WHERE "posId" IN (${posIds.join(',')})
          );
        `;
        await tx.posSession.deleteMany({
          where: { posId: { in: posIds } },
        });
      }

      await tx.pos.deleteMany({
        where: { locationId: locId },
      });
      console.log(
        `   ✅ Wiped ${posIds.length} POS Terminal(s) & ${posSessionsCount} Session(s).`,
      );
    }

    // 5. Delete Transfer Requests & Items
    const transferRequests = await tx.transferRequest.findMany({
      where: { OR: [{ fromLocationId: locId }, { toLocationId: locId }] },
      select: { id: true },
    });
    const transferRequestIds = transferRequests.map((tr) => tr.id);

    if (transferRequestIds.length > 0) {
      await tx.transferRequestItem.deleteMany({
        where: { transferRequestId: { in: transferRequestIds } },
      });
      await tx.transferRequest.deleteMany({
        where: { id: { in: transferRequestIds } },
      });
      console.log(
        `   ✅ Wiped ${transferRequestIds.length} Transfer Request(s) & items.`,
      );
    }

    // 6. Delete Stock Movements
    const deletedMovements = await tx.stockMovement.deleteMany({
      where: { OR: [{ fromLocationId: locId }, { toLocationId: locId }] },
    });
    console.log(`   ✅ Wiped ${deletedMovements.count} Stock Movement(s).`);

    // 7. Delete Stock Requisitions
    const stockRequisitions = await tx.stockRequisition.findMany({
      where: { toLocationId: locId },
      select: { id: true },
    });
    const reqIds = stockRequisitions.map((r) => r.id);

    if (reqIds.length > 0) {
      await tx.stockRequisitionItem.deleteMany({
        where: { stockRequisitionId: { in: reqIds } },
      });
      await tx.stockRequisition.deleteMany({
        where: { id: { in: reqIds } },
      });
      console.log(`   ✅ Wiped ${reqIds.length} Stock Requisition(s).`);
    }

    // 8. Delete Stock Adjustments & Items
    const stockAdjustments = await tx.stockAdjustment.findMany({
      where: { locationId: locId },
      select: { id: true },
    });
    const adjIds = stockAdjustments.map((a) => a.id);

    if (adjIds.length > 0) {
      await tx.stockAdjustmentItem.deleteMany({
        where: { stockAdjustmentId: { in: adjIds } },
      });
      await tx.stockAdjustment.deleteMany({
        where: { locationId: locId },
      });
      console.log(`   ✅ Wiped ${adjIds.length} Stock Adjustment(s).`);
    }

    // 9. Delete Stock Ledgers & Inventory Items
    const deletedLedger = await tx.stockLedger.deleteMany({
      where: { locationId: locId },
    });
    const deletedInventory = await tx.inventoryItem.deleteMany({
      where: { locationId: locId },
    });
    console.log(
      `   ✅ Wiped ${deletedLedger.count} Stock Ledger rows & ${deletedInventory.count} Inventory rows.`,
    );
  });

  console.log(
    `\n✨ Successfully wiped all sales, transfers, stock movements, and inventory for location: "${location.name}".`,
  );
}

async function main() {
  console.log('🚀 Starting Location Outlet Data Wipe Script...');

  const isDryRun =
    process.argv.includes('--dryRun') || process.argv.includes('--dry-run');
  const force = process.argv.includes('--force') || process.argv.includes('-y');

  const locationIdIdx =
    process.argv.indexOf('--locationId') !== -1
      ? process.argv.indexOf('--locationId')
      : process.argv.indexOf('--location-id');
  const locationId =
    locationIdIdx !== -1 ? process.argv[locationIdIdx + 1] : null;

  const locationCodeIdx =
    process.argv.indexOf('--locationCode') !== -1
      ? process.argv.indexOf('--locationCode')
      : process.argv.indexOf('--location-code');
  const locationCode =
    locationCodeIdx !== -1 ? process.argv[locationCodeIdx + 1] : null;

  const tenantArgIdx = process.argv.indexOf('--tenant');
  const specificTenant =
    tenantArgIdx !== -1 ? process.argv[tenantArgIdx + 1] : null;

  const options: WipeOptions = {
    locationId,
    locationCode,
    isDryRun,
    force,
  };

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (managementUrl && masterKey) {
    const pool = new Pool({ connectionString: managementUrl });
    const adapter = new PrismaPg(pool);
    const management = new ManagementClient({ adapter } as any);

    try {
      const companies = await management.company.findMany({
        where: {
          status: 'active',
          ...(specificTenant ? { dbName: specificTenant } : {}),
        },
      });

      if (companies.length === 0) {
        console.log('ℹ️ No active tenant companies found matching filter.');
        return;
      }

      for (const company of companies) {
        console.log(
          `\n👉 Processing Tenant Company: ${company.name} (${company.code})`,
        );
        let connectionString = company.dbUrl;
        if (company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(
              decrypt(company.dbPassword, masterKey),
            );
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch {
            console.warn(`  ⚠️ Decryption failed, using stored dbUrl`);
          }
        }

        if (!connectionString) {
          console.error(
            `  ❌ No database connection details available for company: ${company.code}`,
          );
          continue;
        }

        const tenantPool = new Pool({ connectionString });
        const tenantAdapter = new PrismaPg(tenantPool);
        const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

        try {
          await tenantPrisma.$connect();
          await wipeLocationData(tenantPrisma, options);
        } catch (err: any) {
          console.error(
            `  ❌ Failed wiping location data for tenant ${company.code}: ${err.message}`,
          );
        } finally {
          await tenantPrisma.$disconnect();
          await tenantPool.end();
        }
      }
    } finally {
      await management.$disconnect();
      await pool.end();
    }
  } else {
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
