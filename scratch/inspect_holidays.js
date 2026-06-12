"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
async function main() {
    const prisma = new client_1.PrismaClient();
    const holidays = await prisma.holiday.findMany({
        where: { status: 'active' },
    });
    console.log(JSON.stringify(holidays, null, 2));
    await prisma.$disconnect();
}
main();
//# sourceMappingURL=inspect_holidays.js.map