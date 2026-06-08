import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient as TenantClient } from '@prisma/client';
import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

function decrypt(encryptedText: string, masterKeyString: string): string {
    if (!masterKeyString || masterKeyString.length < 32) {
        throw new Error('MASTER_ENCRYPTION_KEY must be at least 32 characters');
    }
    const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
    const algorithm = 'aes-256-gcm';

    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted text format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv(algorithm, masterKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

async function main() {
    const managementUrl = process.env.DATABASE_URL_MANAGEMENT!;
    const masterKey = process.env.MASTER_ENCRYPTION_KEY!;

    const pool = new Pool({ connectionString: managementUrl });
    const adapter = new PrismaPg(pool);
    const mClient = new ManagementClient({ adapter } as any);

    await mClient.$connect();
    const company = await mClient.company.findFirst({
        where: { status: "active" }
    });

    if (!company) {
        console.error('No active company found');
        return;
    }

    let connectionString: string | undefined = company.dbUrl || undefined;
    if (company.dbPassword) {
        const decPassword = decrypt(company.dbPassword, masterKey);
        const encUser = encodeURIComponent(company.dbUser || '');
        const encPassword = encodeURIComponent(decPassword);
        connectionString = `postgresql://${encUser}:${encPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
    }

    await mClient.$disconnect();
    await pool.end();

    const tPool = new Pool({ connectionString });
    const tAdapter = new PrismaPg(tPool);
    const tClient = new TenantClient({ adapter: tAdapter as any } as any);

    await tClient.$connect();

    console.log('--- RECENT 10 ORDERS AND THEIR CREDIT VOUCHERS ---');
    const orders = await tClient.salesOrder.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
    });

    for (const order of orders) {
        const vouchers = await tClient.voucher.findMany({
            where: { sourceOrderId: order.id, isDeleted: false },
        });
        console.log(`Order: ${order.orderNumber} (ID: ${order.id})`);
        console.log(`- Grand Total: ${order.grandTotal}`);
        console.log(`- Created At: ${order.createdAt}`);
        if (vouchers.length > 0) {
            console.log(`- Linked Vouchers:`);
            vouchers.forEach(v => {
                console.log(`  * Code: ${v.code}, Value: ${v.faceValue}, Type: ${v.voucherType}`);
            });
        } else {
            console.log(`- No linked vouchers`);
        }
    }

    await tClient.$disconnect();
    await tPool.end();
}

main().catch(console.error);
