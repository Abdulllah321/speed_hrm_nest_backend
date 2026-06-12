"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const management_client_1 = require("@prisma/management-client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL_MANAGEMENT });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new management_client_1.PrismaClient({ adapter });
async function checkSeeded() {
    try {
        const adminUser = await prisma.user.findUnique({
            where: { email: 'admin@speedlimit.com' }
        });
        process.exit(adminUser ? 0 : 1);
    }
    catch (error) {
        process.exit(1);
    }
    finally {
        await prisma.$disconnect();
        await pool.end();
    }
}
checkSeeded();
//# sourceMappingURL=check-seed.js.map