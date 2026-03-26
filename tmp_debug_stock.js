const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    try {
        const item = await prisma.item.findFirst({ where: { sku: 'ewerrerwe444' } });
        if (!item) {
            console.log('ITEM_NOT_FOUND');
            return;
        }
        const entries = await prisma.stockLedger.findMany({
            where: { itemId: item.id },
            select: { qty: true, warehouseId: true, locationId: true }
        });
        console.log('ENTRIES:', JSON.stringify(entries, null, 2));

        const warehouses = await prisma.warehouse.findMany({
            select: { id: true, name: true }
        });
        console.log('WAREHOUSES:', JSON.stringify(warehouses, null, 2));

        const locations = await prisma.warehouseLocation.findMany({
            where: { warehouseId: { in: warehouses.map(w => w.id) } },
            select: { id: true, name: true, warehouseId: true }
        });
        console.log('LOCATIONS:', JSON.stringify(locations, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}
main();
