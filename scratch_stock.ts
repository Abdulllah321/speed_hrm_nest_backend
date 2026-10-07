import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const items = await prisma.inventoryItem.findMany({
        where: { itemId: 'dc343c8d-a7cb-454c-a14b-c17f8a55dbb7' }
    });
    console.log("InventoryItems:", items);
}
main().catch(console.error).finally(() => prisma.$disconnect());
