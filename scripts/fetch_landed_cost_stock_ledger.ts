import { PrismaClient } from '@prisma/client';

/**
 * Script: Fetch Stock Ledger Entries for Specific Barcodes from Landed Cost
 * Target Barcodes: 198729340542, 888408294531
 * Source: Landed Cost (referenceType = 'LANDED_COST')
 */
async function main() {
  const prisma = new PrismaClient();

  const targetBarcodes = ['198729340542', '888408294531'];

  console.log(`Fetching Stock Ledger entries for barcodes: ${targetBarcodes.join(', ')} with source LANDED_COST...`);

  try {
    const entries = await prisma.stockLedger.findMany({
      where: {
        referenceType: 'LANDED_COST',
        item: {
          barCode: {
            in: targetBarcodes,
          },
        },
      },
      include: {
        item: {
          select: {
            id: true,
            barCode: true,
            sku: true,
            description: true,
          },
        },
        warehouse: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    console.log(`Found ${entries.length} stock ledger entries:`);
    console.table(
      entries.map((entry) => ({
        id: entry.id.toString(),
        barCode: entry.item.barCode,
        sku: entry.item.sku,
        description: entry.item.description,
        qty: Number(entry.qty),
        unitCost: Number(entry.unitCost ?? 0),
        rate: Number(entry.rate ?? 0),
        movementType: entry.movementType,
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        warehouse: entry.warehouse?.name || entry.warehouseId,
        createdAt: entry.createdAt.toISOString(),
      }))
    );
  } catch (error) {
    console.error('Error fetching stock ledger entries:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
