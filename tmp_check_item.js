const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        console.log("Checking item by id='133554'");
        const itemById = await prisma.item.findUnique({ where: { id: '133554' } });
        console.log(itemById ? `FOUND: id=${itemById.id}, itemId=${itemById.itemId}, sku=${itemById.sku}, desc=${itemById.description}` : "NOT FOUND");

        console.log("Checking item by itemId='133554'");
        const itemByItemId = await prisma.item.findUnique({ where: { itemId: '133554' } });
        console.log(itemByItemId ? `FOUND: id=${itemByItemId.id}, itemId=${itemByItemId.itemId}, sku=${itemByItemId.sku}, desc=${itemByItemId.description}` : "NOT FOUND");

    } finally {
        await prisma.$disconnect();
    }
}
main();
