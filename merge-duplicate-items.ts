import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

async function main() {
  const dbUrl = process.env.DATABASE_URL; // MAKE SURE THIS POINTS TO THE LIVE DB
  const pool = new Pool({ connectionString: dbUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter: adapter as any });
  
  await prisma.$connect();

  const realItemIds = [
    '846eecca-01f8-4bac-bbd9-0b8978d22b9e', '1c5ed371-17cd-4bbf-be37-77286e071cfc',
    '9c22efb2-364b-4b0e-a40b-9dd2f43ce45a', '38a59e78-336b-4bc1-b184-55235a2585cc',
    'c512b797-fc55-45fa-bf4d-b5be735c20e4', 'cbd38219-6228-4920-bd4c-11fcb27ecdab',
    'af10bb71-9d9d-45a8-8d0a-56922f174902', 'e57f7123-e454-4c91-a441-5a61236a2805',
    '139415a4-2b63-4524-bf6b-7965203b30aa', 'c0802456-277f-4f1c-94ee-c64c803a94e7',
    '6bf666c8-18ed-4eb6-8dad-27172b5ade58', 'a38b9e13-6328-4966-a45f-c72caab47556',
    'f19f474d-74da-4709-8e5f-475961a7703d', '9a4e8027-160d-48b2-99bb-7bba436afa0d',
    '5eeda180-1938-4d2a-a36c-411d5088beb6', '3046ce1c-c41c-4284-9756-7f101bae6f3d',
    'b39e8349-7d0b-4b3f-b604-313ca44178da', '5bf8aeec-b3d0-4a62-8f1d-78634e1df6e0',
    'e73c75b8-99dc-48c1-9856-a8f581a46eec', '83812b85-bb80-453d-ad42-5d666b04bc0b',
    'bec7cef8-8c5b-46ea-ad26-ec76293da1a4', '44692c21-15b0-43b8-a389-917ba70d0b94',
    '7152a3d5-c780-4882-a0f7-d4daa811d189', '468b0475-67ed-46f2-8549-8f8ac8c3b98a',
    '7c408b71-aa64-405a-9c44-e5dcd84537aa', 'e7d3a0e4-3322-4caf-a144-fb85f735e013',
    '436a4529-9dc5-4884-bcb5-ab6de284708a', '821a69db-8aef-4963-a602-f88ed7762027',
    '51feb06b-09b5-4ce2-9c33-2316763e010d', '3da9852b-d536-4de3-aa76-03e9ce7606b9',
    '8cd8e122-d082-4e9d-aa33-5651430e942b', 'f3105b8f-b357-418f-8c18-c8959c9559d3',
    'c470080d-4eae-4028-8f52-e24a24edd6ae', 'a8198d1f-f2f2-428e-9b88-b06810f900bf'
  ];

  // 1. Get all tables that reference items
  const tablesResult = await prisma.$queryRawUnsafe<any[]>(`
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE column_name IN ('item_id', 'itemId', 'swap_item_id') 
      AND table_schema = 'public'
      AND table_name != 'Item';
  `);

  console.log(`Found ${tablesResult.length} tables referencing items.`);

  for (const realId of realItemIds) {
    const realItem = await prisma.item.findUnique({ where: { id: realId } });
    if (!realItem || !realItem.barCode) {
      console.log(`[${realId}] Real item not found or has no barcode. Skipping.`);
      continue;
    }

    // Find duplicates (usually STN Items)
    const duplicates = await prisma.item.findMany({
      where: { 
        barCode: realItem.barCode, 
        id: { not: realId }
      }
    });

    if (duplicates.length === 0) {
      console.log(`[${realItem.barCode}] No duplicates found for this item.`);
      continue;
    }

    for (const dup of duplicates) {
      console.log(`[${realItem.barCode}] Merging duplicate ${dup.id} -> ${realId}`);

      // Manually merge InventoryItem as it has unique constraints
      const invItems = await prisma.inventoryItem.findMany({ where: { itemId: dup.id } });
      for (const inv of invItems) {
        const existing = await prisma.inventoryItem.findFirst({
          where: {
            itemId: realId,
            locationId: inv.locationId,
            warehouseId: inv.warehouseId,
            batchNumber: inv.batchNumber,
            status: inv.status
          }
        });

        if (existing) {
          // Merge quantities
          await prisma.inventoryItem.update({
            where: { id: existing.id },
            data: {
              quantity: { increment: inv.quantity },
              available: { increment: inv.available },
              reserved: { increment: inv.reserved }
            }
          });
          await prisma.inventoryItem.delete({ where: { id: inv.id } });
        } else {
          // Just re-assign
          await prisma.inventoryItem.update({
            where: { id: inv.id },
            data: { itemId: realId }
          });
        }
      }

      // 2. Update all other related tables dynamically using raw SQL
      for (const { table_name, column_name } of tablesResult) {
        if (table_name === 'InventoryItem' || table_name === 'inventory_items') continue;
        
        await prisma.$executeRawUnsafe(`
          UPDATE "${table_name}"
          SET "${column_name}" = $1
          WHERE "${column_name}" = $2
        `, realId, dup.id);
      }

      // 3. Delete the duplicate item safely
      try {
        await prisma.item.delete({ where: { id: dup.id } });
        console.log(`[${realItem.barCode}] Successfully deleted duplicate ${dup.id}`);
      } catch (e: any) {
        console.error(`[${realItem.barCode}] Could not delete ${dup.id}: ${e.message}`);
        // Fallback: Rename and disable
        await prisma.item.update({
          where: { id: dup.id },
          data: { barCode: 'DUP-' + dup.barCode, isActive: false, status: 'inactive' }
        });
      }
    }
  }

  console.log('Merge complete!');
  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
