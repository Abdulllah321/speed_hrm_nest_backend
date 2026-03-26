import { PrismaClient } from '@prisma/client';

async function main() {
    const prisma = new PrismaClient();
    try {
        const grn = await prisma.goodsReceiptNote.findUnique({
            where: { grnNumber: 'GRN-177260661433' },
            include: {
                items: true,
            },
        });
        console.log(JSON.stringify(grn, null, 2));
    } catch (error) {
        console.error(error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
