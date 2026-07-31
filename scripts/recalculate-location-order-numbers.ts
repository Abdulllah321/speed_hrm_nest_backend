import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * LOCATION ORDER NUMBER RECALCULATION & BACKFILL SCRIPT
 * ───────────────────────────────────────────────────────
 * Recalculates and updates POS sales order sequence numbers (`orderNumber`, `returnNumber`, `refundNumber`)
 * for sales orders based on location ID / shortCode and Pakistan Fiscal Year (July 1 - June 30).
 *
 * Sequence Format:
 *   orderNumber:  SI-{cleanCode}{fySuffix}-{seq:5d}  (e.g., SI-SS100226-00001)
 *   returnNumber: SR-{cleanCode}{fySuffix}-{seq:5d}  (e.g., SR-SS100226-00001)
 *   refundNumber: RF-{cleanCode}{fySuffix}-{seq:5d}  (e.g., RF-SS100226-00001)
 *
 * Arguments:
 *   --locationId <id>      Process specific location ID
 *   --locationCode <code>  Process specific location by code / shortCode (e.g. SS1002)
 *   --tenant <name>        Process specific tenant database (e.g. speed_limit)
 *   --dryRun / --dry-run   Preview changes without updating DB
 *
 * Usage Examples:
 *   bun ./scripts/recalculate-location-order-numbers.ts --dryRun
 *   bun ./scripts/recalculate-location-order-numbers.ts --locationId "loc_123"
 *   bun ./scripts/recalculate-location-order-numbers.ts --locationCode "SS1002" --tenant "speed_limit"
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

/**
 * Cleans location shortCode / name to produce alphanumeric uppercase code.
 */
function getCleanLocationCode(location: { name: string; shortCode?: string | null }): string {
  const rawCode = location.shortCode?.trim() || location.name;
  const cleanCode = rawCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return cleanCode || 'LOC';
}

/**
 * Returns Pakistan fiscal year 2-digit suffix based on date (July 1st start).
 */
function getFySuffix(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-indexed, July is 6
  const fiscalYearStartYear = month >= 6 ? year : year - 1;
  return String(fiscalYearStartYear).slice(-2);
}

interface ProcessOptions {
  locationIdFilter?: string | null;
  locationCodeFilter?: string | null;
  isDryRun: boolean;
}

async function processTenant(prisma: PrismaClient, options: ProcessOptions) {
  const { locationIdFilter, locationCodeFilter, isDryRun } = options;

  console.log(`\n📋 Fetching locations...`);

  // Build location query
  const locationWhere: any = {};
  if (locationIdFilter) {
    locationWhere.id = locationIdFilter;
  }
  if (locationCodeFilter) {
    locationWhere.OR = [
      { code: { equals: locationCodeFilter, mode: 'insensitive' } },
      { shortCode: { equals: locationCodeFilter, mode: 'insensitive' } },
    ];
  }

  const locations = await prisma.location.findMany({
    where: locationWhere,
    select: { id: true, name: true, code: true, shortCode: true },
  });

  if (locations.length === 0) {
    console.log(`⚠️ No matching locations found.`);
    return;
  }

  console.log(`📍 Found ${locations.length} location(s) to evaluate.`);

  let totalOrdersChecked = 0;
  let totalOrdersToUpdate = 0;
  let totalReturnsToUpdate = 0;
  let totalRefundsToUpdate = 0;

  for (const loc of locations) {
    const cleanCode = getCleanLocationCode(loc);
    console.log(`\n────────────────────────────────────────────────────────────`);
    console.log(`🏢 Location: ${loc.name} (Code: ${loc.code || 'N/A'}, ShortCode: ${loc.shortCode || 'N/A'}) => Clean: "${cleanCode}"`);

    // Fetch all sales orders for this location ordered chronologically
    const orders = await prisma.salesOrder.findMany({
      where: { locationId: loc.id },
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      select: {
        id: true,
        orderNumber: true,
        returnNumber: true,
        refundNumber: true,
        createdAt: true,
      },
    });

    if (orders.length === 0) {
      console.log(`   ℹ️ No sales orders found for location ID: ${loc.id}`);
      continue;
    }

    console.log(`   📦 Processing ${orders.length} sales order(s)...`);
    totalOrdersChecked += orders.length;

    // Group orders by fiscal year suffix
    const ordersByFy: Map<string, typeof orders> = new Map();
    for (const order of orders) {
      const fySuffix = getFySuffix(order.createdAt);
      if (!ordersByFy.has(fySuffix)) {
        ordersByFy.set(fySuffix, []);
      }
      ordersByFy.get(fySuffix)!.push(order);
    }

    const updates: Array<{
      id: string;
      currentOrderNumber: string;
      newOrderNumber: string;
      currentReturnNumber?: string | null;
      newReturnNumber?: string | null;
      currentRefundNumber?: string | null;
      newRefundNumber?: string | null;
    }> = [];

    for (const [fySuffix, fyOrders] of ordersByFy.entries()) {
      let orderSeq = 1;
      let returnSeq = 1;
      let refundSeq = 1;

      for (const order of fyOrders) {
        const expectedOrderNumber = `SI-${cleanCode}${fySuffix}-${String(orderSeq++).padStart(5, '0')}`;

        let expectedReturnNumber: string | null = null;
        if (order.returnNumber) {
          expectedReturnNumber = `SR-${cleanCode}${fySuffix}-${String(returnSeq++).padStart(5, '0')}`;
        }

        let expectedRefundNumber: string | null = null;
        if (order.refundNumber) {
          expectedRefundNumber = `RF-${cleanCode}${fySuffix}-${String(refundSeq++).padStart(5, '0')}`;
        }

        const needsOrderUpdate = order.orderNumber !== expectedOrderNumber;
        const needsReturnUpdate = order.returnNumber !== expectedReturnNumber;
        const needsRefundUpdate = order.refundNumber !== expectedRefundNumber;

        if (needsOrderUpdate || needsReturnUpdate || needsRefundUpdate) {
          updates.push({
            id: order.id,
            currentOrderNumber: order.orderNumber,
            newOrderNumber: expectedOrderNumber,
            currentReturnNumber: order.returnNumber,
            newReturnNumber: expectedReturnNumber,
            currentRefundNumber: order.refundNumber,
            newRefundNumber: expectedRefundNumber,
          });

          if (needsOrderUpdate) totalOrdersToUpdate++;
          if (needsReturnUpdate) totalReturnsToUpdate++;
          if (needsRefundUpdate) totalRefundsToUpdate++;
        }
      }
    }

    if (updates.length === 0) {
      console.log(`   ✅ All order numbers for this location are already correctly sequential.`);
      continue;
    }

    console.log(`   ⚠️ Found ${updates.length} order(s) requiring sequence number update.`);
    for (const update of updates.slice(0, 10)) {
      console.log(`      Order ID: ${update.id}`);
      if (update.currentOrderNumber !== update.newOrderNumber) {
        console.log(`        orderNumber: ${update.currentOrderNumber} ➔ ${update.newOrderNumber}`);
      }
      if (update.currentReturnNumber !== update.newReturnNumber) {
        console.log(`        returnNumber: ${update.currentReturnNumber} ➔ ${update.newReturnNumber}`);
      }
      if (update.currentRefundNumber !== update.newRefundNumber) {
        console.log(`        refundNumber: ${update.currentRefundNumber} ➔ ${update.newRefundNumber}`);
      }
    }
    if (updates.length > 10) {
      console.log(`      ... and ${updates.length - 10} more update(s).`);
    }

    if (!isDryRun) {
      console.log(`   ⏳ Applying updates in database (safe 2-step update)...`);

      // Execute safely in 2 passes to avoid unique constraint violations
      await prisma.$transaction(async (tx) => {
        // Step 1: Assign temporary numbers to prevent unique index collision
        for (const u of updates) {
          await tx.salesOrder.update({
            where: { id: u.id },
            data: {
              orderNumber: `TEMP_${u.id}_${Date.now()}`,
              ...(u.currentReturnNumber ? { returnNumber: `TEMP_RET_${u.id}_${Date.now()}` } : {}),
              ...(u.currentRefundNumber ? { refundNumber: `TEMP_REF_${u.id}_${Date.now()}` } : {}),
            },
          });
        }

        // Step 2: Assign final recalculated sequence numbers
        for (const u of updates) {
          await tx.salesOrder.update({
            where: { id: u.id },
            data: {
              orderNumber: u.newOrderNumber,
              ...(u.newReturnNumber !== undefined ? { returnNumber: u.newReturnNumber } : {}),
              ...(u.newRefundNumber !== undefined ? { refundNumber: u.newRefundNumber } : {}),
            },
          });
        }
      });

      console.log(`   ✅ Successfully updated ${updates.length} order(s) for location.`);
    } else {
      console.log(`   🔍 [DRY RUN] Skipping database update.`);
    }
  }

  console.log(`\n============================================================`);
  console.log(`📊 SUMMARY (${isDryRun ? 'DRY RUN' : 'EXECUTED'}):`);
  console.log(`   Total Orders Evaluated:   ${totalOrdersChecked}`);
  console.log(`   Order Numbers Updated:    ${totalOrdersToUpdate}`);
  console.log(`   Return Numbers Updated:   ${totalReturnsToUpdate}`);
  console.log(`   Refund Numbers Updated:   ${totalRefundsToUpdate}`);
  console.log(`============================================================\n`);
}

async function main() {
  console.log('🚀 Starting Location Order Number Recalculation Script...');

  const isDryRun = process.argv.includes('--dryRun') || process.argv.includes('--dry-run');
  const locationIdIdx = process.argv.indexOf('--locationId') !== -1 ? process.argv.indexOf('--locationId') : process.argv.indexOf('--location-id');
  const locationIdFilter = locationIdIdx !== -1 ? process.argv[locationIdIdx + 1] : null;

  const locationCodeIdx = process.argv.indexOf('--locationCode') !== -1 ? process.argv.indexOf('--locationCode') : process.argv.indexOf('--location-code');
  const locationCodeFilter = locationCodeIdx !== -1 ? process.argv[locationCodeIdx + 1] : null;

  const tenantArgIdx = process.argv.indexOf('--tenant');
  const specificTenant = tenantArgIdx !== -1 ? process.argv[tenantArgIdx + 1] : null;

  if (isDryRun) {
    console.log('🔍 Running in DRY RUN mode. No database records will be modified.');
  }

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (managementUrl && masterKey) {
    const pool = new Pool({ connectionString: managementUrl });
    const adapter = new PrismaPg(pool);
    const management = new ManagementClient({ adapter } as any);

    try {
      const companies = await management.company.findMany({
        where: { status: 'active', ...(specificTenant ? { dbName: specificTenant } : {}) },
      });

      if (companies.length === 0) {
        console.log('ℹ️ No active tenant companies found matching filter.');
        return;
      }

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
          await processTenant(tenantPrisma, { locationIdFilter, locationCodeFilter, isDryRun });
        } catch (err: any) {
          console.error(`  ❌ Failed processing tenant ${company.code}: ${err.message}`);
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
      await processTenant(prisma, { locationIdFilter, locationCodeFilter, isDryRun });
    } finally {
      await prisma.$disconnect();
    }
  }

  console.log('✨ Done.');
}

main().catch((e) => {
  console.error('❌ Script failed with error:', e);
  process.exit(1);
});
