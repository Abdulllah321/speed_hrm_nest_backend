"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
async function checkCoa() {
    const prisma = new client_1.PrismaClient();
    try {
        const allAccounts = await prisma.chartOfAccount.findMany({
            include: { children: true }
        });
        const anomalies = allAccounts.filter(a => a.children.length > 0 && !a.isGroup);
        console.log(`Found ${anomalies.length} accounts with children but isGroup=false:`);
        anomalies.forEach(a => {
            console.log(`- ${a.code} ${a.name} (Children: ${a.children.length}, Balance: ${a.balance})`);
        });
        if (anomalies.length > 0) {
            console.log('\nFixing anomalies...');
            for (const a of anomalies) {
                await prisma.chartOfAccount.update({
                    where: { id: a.id },
                    data: { isGroup: true }
                });
                console.log(`Fixed: ${a.code}`);
            }
        }
    }
    catch (err) {
        console.error(err);
    }
    finally {
        await prisma.$disconnect();
    }
}
checkCoa();
//# sourceMappingURL=fix-coa-groups.js.map