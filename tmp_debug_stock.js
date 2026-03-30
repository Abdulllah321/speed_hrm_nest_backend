const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { PrismaClient } = require('@prisma/client');

console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'Loaded' : 'Missing');

const prisma = new PrismaClient();

async function main() {
    try {
        const items = await prisma.item.findMany({ where: { itemId: '133554' } });
        console.log('Items found:', items.length);
        
        for (const item of items) {
            console.log('Checking stock ledger for item UUID:', item.id);
            const ledgers = await prisma.stockLedger.findMany({
                where: { itemId: item.id },
                orderBy: { createdAt: 'desc' }
            });
            console.log('Total ledger entries:', ledgers.length);
            const inboundLedgers = ledgers.filter(l => l.movementType === 'INBOUND');
            console.log('Total INBOUND ledger entries:', inboundLedgers.length);
            
            if (inboundLedgers.length > 0) {
                console.log('Most recent INBOUND ledger:', inboundLedgers[0]);
            } else {
                console.log('No previous purchases or inbound movements for this item.');
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
