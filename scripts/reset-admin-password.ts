// @ts-nocheck
import 'dotenv/config';
import { PrismaClient } from '@prisma/management-client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

async function main() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL_MANAGEMENT });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter });

    const newPassword = 'Password@123';

    console.log(`🔄 Resetting password for all users...`);

    try {
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        const result = await prisma.user.updateMany({
            data: {
                password: hashedPassword,
                isFirstPassword: false,
                mustChangePassword: false,
            },
        });

        console.log(`✅ Password successfully updated for ${result.count} users`);
    } catch (error) {
        console.error('❌ Error resetting passwords:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

main();
