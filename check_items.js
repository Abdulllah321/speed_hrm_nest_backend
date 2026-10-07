const { PrismaClient } = require('@prisma/client'); 
const prisma = new PrismaClient(); 

async function main() { 
    const items = await prisma.item.findMany({ 
        where: { 
            OR: [
                { sku: { contains: 'JC5943' } }, 
                { barCode: { contains: 'JC5943' } }, 
                { description: { contains: 'JC5943' } }, 
                { itemId: { contains: 'JC5943' } }
            ] 
        } 
    }); 
    
    console.log('Items found:', items.map(i => ({ id: i.id, sku: i.sku, barCode: i.barCode }))); 
    
    for (const item of items) { 
        const sl = await prisma.stockLedger.aggregate({ 
            where: { itemId: item.id }, 
            _sum: { qty: true } 
        }); 
        console.log('Stock for item ' + item.sku + ' (id: ' + item.id + '):', sl._sum.qty); 
    } 
} 

main().finally(() => prisma.$disconnect());
