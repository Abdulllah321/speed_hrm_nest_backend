import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient();

async function main() {
  const referenceId = 'd7994184-479b-47e2-ac76-54b4493919b4';

  console.log(`Updating Stock Ledger costing for Landed Cost reference ID ${referenceId}...`);

  await prisma.$transaction(async (tx) => {
    // 1. Update 198729340542
    await tx.$executeRaw`
      UPDATE stock_ledgers sl
      SET unit_cost = 3502.84, rate = 3502.84
      FROM "Item" i
      WHERE sl.item_id = i.id
        AND (i."barCode" = '198729340542' OR i.sku = '198729340542' OR i."itemId" = '198729340542')
        AND sl.reference_type = 'LANDED_COST'
        AND sl.reference_id = ${referenceId}::uuid;
    `;

    await tx.$executeRaw`
      UPDATE "Item"
      SET unit_cost = 3502.84
      WHERE "barCode" = '198729340542' OR sku = '198729340542' OR "itemId" = '198729340542';
    `;

    // 2. Update 888408294531
    await tx.$executeRaw`
      UPDATE stock_ledgers sl
      SET unit_cost = 2175.51, rate = 2175.51
      FROM "Item" i
      WHERE sl.item_id = i.id
        AND (i."barCode" = '888408294531' OR i.sku = '888408294531' OR i."itemId" = '888408294531')
        AND sl.reference_type = 'LANDED_COST'
        AND sl.reference_id = ${referenceId}::uuid;
    `;

    await tx.$executeRaw`
      UPDATE "Item"
      SET unit_cost = 2175.51
      WHERE "barCode" = '888408294531' OR sku = '888408294531' OR "itemId" = '888408294531';
    `;
  });

  console.log('Stock Ledger costing update completed successfully.');

  // Fetch updated entries
  const results = await prisma.$queryRaw`
    SELECT 
      sl.id AS "ledgerId",
      i."barCode" AS "barCode",
      i.sku AS "sku",
      sl.qty AS "qty",
      sl.unit_cost AS "unitCost",
      sl.rate AS "rate",
      sl.movement_type AS "movementType",
      sl.reference_type AS "referenceType",
      sl.reference_id AS "referenceId",
      i.unit_cost AS "itemMasterUnitCost"
    FROM stock_ledgers sl
    JOIN "Item" i ON sl.item_id = i.id
    WHERE sl.reference_type = 'LANDED_COST'
      AND sl.reference_id = ${referenceId}::uuid
      AND i."barCode" IN ('198729340542', '888408294531')
    ORDER BY sl.created_at DESC;
  `;

  console.table(results);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
