import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
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

async function seedTaxSlabs(tenantDbUrl: string, tenantName: string) {
    const pool = new Pool({ connectionString: tenantDbUrl });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter } as any);

    try {
        console.log(`\n===========================================`);
        console.log(`🌱 Seeding Tax Slabs for: ${tenantName}`);
        console.log(`===========================================`);

        const slabs = [
            { name: "Slab 1 (Up to Rs. 600,000)", minAmount: 0, maxAmount: 600000, rate: 0, fixedAmount: 0 },
            { name: "Slab 2 (Rs. 600,001 to Rs. 1,200,000)", minAmount: 600000, maxAmount: 1200000, rate: 1, fixedAmount: 0 },
            { name: "Slab 3 (Rs. 1,200,001 to Rs. 2,200,000)", minAmount: 1200000, maxAmount: 2200000, rate: 11, fixedAmount: 6000 },
            { name: "Slab 4 (Rs. 2,200,001 to Rs. 3,200,000)", minAmount: 2200000, maxAmount: 3200000, rate: 20, fixedAmount: 116000 },
            { name: "Slab 5 (Rs. 3,200,001 to Rs. 4,100,000)", minAmount: 3200000, maxAmount: 4100000, rate: 25, fixedAmount: 316000 },
            { name: "Slab 6 (Rs. 4,100,001 to Rs. 5,600,000)", minAmount: 4100000, maxAmount: 5600000, rate: 29, fixedAmount: 541000 },
            { name: "Slab 7 (Rs. 5,600,001 to Rs. 7,000,000)", minAmount: 5600000, maxAmount: 7000000, rate: 32, fixedAmount: 976000 },
            { name: "Slab 8 (Above Rs. 7,000,000)", minAmount: 7000000, maxAmount: 999999999, rate: 35, fixedAmount: 1424000 },
        ];

        // We mark any existing active slabs as deleted or inactive to prevent conflict, or clean up before seeding
        await prisma.taxSlab.updateMany({
            where: { status: 'active' },
            data: { status: 'inactive', isDeleted: true }
        });

        for (const slab of slabs) {
            await prisma.taxSlab.create({
                data: {
                    name: slab.name,
                    minAmount: slab.minAmount,
                    maxAmount: slab.maxAmount,
                    rate: slab.rate,
                    fixedAmount: slab.fixedAmount,
                    status: 'active'
                }
            });
            console.log(`  Added: ${slab.name} (Min: ${slab.minAmount}, Max: ${slab.maxAmount}, Fixed: ${slab.fixedAmount}, Rate: ${slab.rate}%)`);
        }

        console.log('✅ Tax Slabs seeded successfully.');

    } catch (error) {
        console.error(`❌ Error seeding tenant: ${error}`);
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

async function main() {
    const args = process.argv.slice(2);
    let targetTenant = '';

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--tenant' && args[i + 1]) {
            targetTenant = args[i + 1];
            i++;
        }
    }

    const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
    const masterKey = process.env.MASTER_ENCRYPTION_KEY;

    if (!managementUrl || !masterKey) {
        console.error('❌ DATABASE_URL_MANAGEMENT or MASTER_ENCRYPTION_KEY missing in .env');
        process.exit(1);
    }

    const pool = new Pool({ connectionString: managementUrl });
    const adapter = new PrismaPg(pool);
    const mClient = new ManagementClient({ adapter } as any);

    try {
        console.log('🔍 Connecting to Management Database...');

        const companyWhere = targetTenant ? { dbName: targetTenant } : { status: 'active' };

        const companies = await mClient.company.findMany({
            where: companyWhere
        });

        if (companies.length === 0) {
            console.error(`❌ No matching active companies found.`);
            process.exit(1);
        }

        console.log(`📡 Found ${companies.length} companies. Starting seed...`);

        for (const company of companies) {
            let connectionString = `postgresql://${company.dbUser}:${company.dbPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;

            if (company.dbPassword) {
                try {
                    const decPassword = decrypt(company.dbPassword, masterKey);
                    const encUser = encodeURIComponent(company.dbUser || '');
                    const encPassword = encodeURIComponent(decPassword);
                    connectionString = `postgresql://${encUser}:${encPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
                } catch (e) {
                    console.warn(`⚠️ Failed to decrypt password for ${company.name}, trying stored URL...`);
                }
            }

            await seedTaxSlabs(connectionString, company.name);
        }

        console.log('\n🎉 All done seeding Tax Slabs!');

    } catch (error: any) {
        console.error(`\n❌ Error: ${error.message}`);
    } finally {
        await mClient.$disconnect();
        await pool.end();
    }
}

main();
