const { PrismaClient } = require('@prisma/client'); 
const prisma = new PrismaClient(); 

async function main() { 
    const orderRows = await prisma.onlineOrder.findMany({ 
        where: { orderNumber: '93235' } 
    });
    
    console.log("Order rows:", orderRows.map(r => ({ sku: r.sku, systemSku: r.systemSku, barcode: r.barcode })));
    
    const skus = Array.from(new Set(orderRows.flatMap(r => [r.sku, r.systemSku, r.barcode]).filter(Boolean)));
    
    const dbItems = await prisma.item.findMany({
        where: {
            OR: [
                { sku: { in: skus } },
                { barCode: { in: skus } },
                { itemId: { in: skus } }
            ]
        }
    });
    
    console.log("Matched DB items:", dbItems.map(i => ({ id: i.id, sku: i.sku, barCode: i.barCode })));
    
    for (const i of dbItems) {
        const stockSum = await prisma.stockLedger.aggregate({
            where: { itemId: i.id }, // omitting locationId to see total
            _sum: { qty: true }
        });
        console.log(`Stock for item ${i.sku} (id: ${i.id}):`, stockSum._sum.qty);
    }
} 

main().finally(() => prisma.$disconnect());
