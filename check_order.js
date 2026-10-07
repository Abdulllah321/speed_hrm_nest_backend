const { PrismaClient } = require('@prisma/client'); 
const prisma = new PrismaClient(); 

async function main() { 
    const orderRows = await prisma.onlineOrder.findMany({ where: { orderNumber: '93235' } }); 
    console.log(JSON.stringify(orderRows, null, 2));
} 

main().finally(() => prisma.$disconnect());
