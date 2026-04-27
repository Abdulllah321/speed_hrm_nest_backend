import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

// Same decryption logic used in seed-tenant
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

async function seedPosConfig(tenantDbUrl: string, tenantName: string) {
    const pool = new Pool({ connectionString: tenantDbUrl });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter } as any);

    try {
        console.log(`\n===========================================`);
        console.log(`🌱 Seeding POS Configs for: ${tenantName}`);
        console.log(`===========================================`);

        // Get a location to attach configs to, if available
        const location = await prisma.location.findFirst({
            where: { status: 'active' }
        });

        if (!location) {
            console.log('⚠️ No active locations found! Skipping POS Config seed.');
            return;
        }

        const locationId = location.id;

        // 1. Seed Promo Campaigns
        console.log('📦 Seeding Promos...');
        const promos = [
            { name: "Summer Sale 2026", code: "SUMMER26", type: "percent", value: 15, maxDiscount: 50, startDate: new Date(), endDate: new Date(new Date().setMonth(new Date().getMonth() + 3)) },
            { name: "Flat 100 Off", code: "FLAT100", type: "fixed", value: 100, minOrderAmount: 500, startDate: new Date(), endDate: new Date(new Date().setMonth(new Date().getMonth() + 1)) },
            { name: "Welcome Promo", code: "WELCOME", type: "buy_x_get_y", value: 0, startDate: new Date(new Date().setFullYear(new Date().getFullYear() - 1)), endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 5)) },
        ];

        for (const promo of promos) {
            const existing = await prisma.promoCampaign.findUnique({ where: { code: promo.code } });
            if (!existing) {
                await prisma.promoCampaign.create({
                    data: {
                        ...promo,
                        locations: {
                            create: { locationId }
                        }
                    }
                });
            }
        }
        console.log('✅ Promos seeded.');

        // 2. Seed Coupons
        console.log('🎟️ Seeding Coupons...');
        const coupons = [
            { code: "VIP10", description: "VIP Customer 10% Discount", discountType: "percent", discountValue: 10, maxUses: 100 },
            { code: "FREESHIP", description: "Free Shipping Equivalent ($50 off)", discountType: "fixed", discountValue: 50, minOrderAmount: 200 },
            { code: "FIRSTORDER", description: "20% off first order max $20", discountType: "percent", discountValue: 20, maxDiscount: 20 },
        ];

        for (const coupon of coupons) {
            const existing = await prisma.couponCode.findUnique({ where: { code: coupon.code } });
            if (!existing) {
                await prisma.couponCode.create({
                    data: {
                        ...coupon,
                        locations: {
                            create: { locationId }
                        }
                    }
                });
            }
        }
        console.log('✅ Coupons seeded.');

        // 3. Seed Alliances
        console.log('🤝 Seeding Alliances...');
        const alliances = [
            // ── Demographic Alliances ──────────────────────
            { partnerName: "Student Alliance", code: "STUDENT", discountPercent: 15, maxDiscount: 500, description: "Valid student ID (NADRA/University card) required" },
            { partnerName: "Senior Citizen", code: "SENIOR", discountPercent: 20, maxDiscount: 800, description: "65+ age proof (CNIC) required" },
            { partnerName: "Government Employee", code: "GOV-EMP", discountPercent: 10, maxDiscount: 300, description: "Valid government service card required" },

            // ── Meezan Bank ──────────────────────────────
            { partnerName: "Meezan Bank – Classic Card", code: "MEEZAN-CLASSIC", discountPercent: 15, maxDiscount: 1000, description: "Valid Meezan Classic credit/debit card required at POS" },
            { partnerName: "Meezan Bank – Women Card", code: "MEEZAN-WOMEN", discountPercent: 25, maxDiscount: 2000, description: "Valid Meezan Women credit card required at POS" },
            { partnerName: "Meezan Bank – Premium Card", code: "MEEZAN-PREMIUM", discountPercent: 40, maxDiscount: 5000, description: "Valid Meezan Premium credit card required at POS" },

            // ── HBL ────────────────────────────────────
            { partnerName: "HBL – Classic Card", code: "HBL-CLASSIC", discountPercent: 10, maxDiscount: 800, description: "Valid HBL Classic credit/debit card required at POS" },
            { partnerName: "HBL – Platinum Card", code: "HBL-PLATINUM", discountPercent: 20, maxDiscount: 2000, description: "Valid HBL Platinum card required at POS" },
            { partnerName: "HBL – Credit Card (Any)", code: "HBL-CC", discountPercent: 15, maxDiscount: 1500, description: "Any HBL credit card required at POS" },

            // ── UBL ────────────────────────────────────
            { partnerName: "UBL – Classic Card", code: "UBL-CLASSIC", discountPercent: 10, maxDiscount: 800, description: "Valid UBL Classic credit/debit card required at POS" },
            { partnerName: "UBL – Signature Card", code: "UBL-SIGNATURE", discountPercent: 20, maxDiscount: 2000, description: "Valid UBL Signature card required at POS" },

            // ── Habib Metro ───────────────────────────────
            { partnerName: "Habib Metro – Any Card", code: "HABIB-METRO", discountPercent: 12, maxDiscount: 1000, description: "Valid Habib Metro Bank card required at POS" },

            // ── MCB ─────────────────────────────────────
            { partnerName: "MCB – Credit Card", code: "MCB-CC", discountPercent: 10, maxDiscount: 800, description: "Valid MCB credit card required at POS" },
            { partnerName: "MCB – Lite Card", code: "MCB-LITE", discountPercent: 5, maxDiscount: 300, description: "Valid MCB Lite debit card required at POS" },
        ];

        for (const alliance of alliances) {
            const existing = await prisma.allianceDiscount.findUnique({ where: { code: alliance.code } });
            if (!existing) {
                await prisma.allianceDiscount.create({
                    data: {
                        ...alliance,
                        locations: {
                            create: { locationId }
                        }
                    }
                });
            }
        }
        console.log('✅ Alliances seeded.');

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

            await seedPosConfig(connectionString, company.name);
        }

        console.log('\n🎉 All done seeding POS configs!');

    } catch (error: any) {
        console.error(`\n❌ Error: ${error.message}`);
    } finally {
        await mClient.$disconnect();
        await pool.end();
    }
}

main();
