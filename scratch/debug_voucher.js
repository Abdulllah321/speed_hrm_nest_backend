"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
async function checkVoucher() {
    const prisma = new client_1.PrismaClient();
    try {
        const order = await prisma.salesOrder.findFirst({
            where: { orderNumber: 'SO-20260414-0001' },
            include: { coupon: true }
        });
        console.log('Order:', JSON.stringify(order, null, 2));
        const voucher = await prisma.couponCode.findFirst({
            where: { code: 'VCH-8I2WN6' }
        });
        console.log('Voucher:', JSON.stringify(voucher, null, 2));
        const locations = await prisma.couponCodeLocation.findMany({
            where: { couponId: voucher?.id }
        });
        console.log('Voucher Locations:', JSON.stringify(locations, null, 2));
    }
    catch (error) {
        console.error(error);
    }
    finally {
        await prisma.$disconnect();
    }
}
checkVoucher();
//# sourceMappingURL=debug_voucher.js.map