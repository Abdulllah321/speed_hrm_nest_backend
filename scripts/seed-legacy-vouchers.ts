import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const masterDbUrl = process.env.DATABASE_URL || 'postgresql://postgres:root@localhost:5432/spl_core_db?schema=public';

interface LegacyVoucherItem {
    costCentre: string;
    docNo: number;
    docDate: string;
    traderDetail: string;
    amount: number;
    validTill: string;
}

const legacyData: LegacyVoucherItem[] = [
    { costCentre: 'Adidas-Lucky One Mall', docNo: 1, docDate: '31/12/2025 17:01', traderDetail: 'JASIR KHAN', amount: 20000, validTill: '29/06/2026 17:02' },
    { costCentre: 'Charles & Keith-Centaurus Mall', docNo: 1, docDate: '4/7/2025 11:51', traderDetail: 'HASSAN', amount: 20000, validTill: '31/12/2025 11:51' },
    { costCentre: 'Charles & Keith-Centaurus Mall', docNo: 2, docDate: '11/8/2025 15:06', traderDetail: 'Huma Khan', amount: 21000, validTill: '7/2/2026 15:06' },
    { costCentre: 'Charles & Keith-Centaurus Mall', docNo: 3, docDate: '26/11/2025 17:37', traderDetail: 'Farah', amount: 50000, validTill: '25/05/2026 17:38' },
    { costCentre: 'Charles & Keith-Centaurus Mall', docNo: 4, docDate: '14/02/2026 12:02', traderDetail: 'Saba Adil', amount: 20000, validTill: '13/08/2026 12:02' },
    { costCentre: 'Charles & Keith-Dolmen Clifton', docNo: 1, docDate: '19/07/2025 17:24', traderDetail: 'CHARLES & KEITH', amount: 10000, validTill: '15/01/2026 17:25' },
    { costCentre: 'Charles & Keith-Dolmen Clifton', docNo: 2, docDate: '5/8/2025 11:59', traderDetail: 'SANA', amount: 5000, validTill: '1/2/2026 11:59' },
    { costCentre: 'Charles & Keith-Dolmen Clifton', docNo: 3, docDate: '26/08/2025 15:36', traderDetail: 'CHARLES& KEITH', amount: 10000, validTill: '22/02/2026 15:36' },
    { costCentre: 'Charles & Keith-Dolmen Clifton', docNo: 4, docDate: '29/08/2025 16:37', traderDetail: 'CHARLES & KEITH', amount: 5000, validTill: '25/02/2026 16:38' },
    { costCentre: 'Charles & Keith-Dolmen Clifton', docNo: 5, docDate: '12/9/2025 15:29', traderDetail: 'CHARLES & KEITH', amount: 17000, validTill: '11/3/2026 15:30' },
    { costCentre: 'Charles & Keith-Dolmen Clifton', docNo: 6, docDate: '14/09/2025 15:38', traderDetail: 'CHARLES & KEITH', amount: 35000, validTill: '13/03/2026 15:38' },
    { costCentre: 'Charles & Keith-Dolmen Clifton', docNo: 7, docDate: '1/10/2025 17:21', traderDetail: 'CHARLES & KEITH', amount: 20000, validTill: '30/03/2026 17:22' },
    { costCentre: 'Charles & Keith-Dolmen Clifton', docNo: 8, docDate: '21/10/2025 18:30', traderDetail: 'CHARLES & KEITH', amount: 20000, validTill: '19/04/2026 18:31' },
    { costCentre: 'Charles & Keith-Dolmen Clifton', docNo: 9, docDate: '23/10/2025 12:38', traderDetail: 'MARYAM FATIMA', amount: 15000, validTill: '21/04/2026 12:38' },
    { costCentre: 'Charles & Keith-Dolmen Clifton', docNo: 10, docDate: '12/11/2025 19:19', traderDetail: 'CHARLES & KEITH', amount: 10000, validTill: '11/5/2026 19:20' },
    { costCentre: 'Charles & Keith-Dolmen Clifton', docNo: 11, docDate: '18/12/2025 14:58', traderDetail: 'CHARLES & KEITH', amount: 14000, validTill: '16/06/2026 14:59' },
    { costCentre: 'Charles & Keith-Dolmen Clifton', docNo: 12, docDate: '18/01/2026 20:21', traderDetail: 'CHARLES & KEITH', amount: 5000, validTill: '17/07/2026 20:21' },
];

function parseDate(str: string): Date {
    const [datePart, timePart] = str.trim().split(' ');
    const [day, month, year] = datePart.split('/').map(Number);
    const [hour, minute] = (timePart || '00:00').split(':').map(Number);
    return new Date(Date.UTC(year, month - 1, day, hour, minute));
}

async function seedVouchersForDb(prisma: PrismaClient, dbName: string) {
    const locations = await prisma.location.findMany({
        where: { isDeleted: false },
        select: { id: true, name: true, code: true, shortCode: true },
    });

    console.log(`\n--- DB [${dbName}]: Found ${locations.length} locations ---`);
    locations.forEach(l => console.log(`  - ID: ${l.id} | Name: "${l.name}" | Code: "${l.code}" | ShortCode: "${l.shortCode}"`));

    function findLocation(costCentre: string) {
        for (const loc of locations) {
            if (costCentre.toLowerCase().includes('centaurus') && loc.name.toLowerCase().includes('centaurus')) return loc;
            if (costCentre.toLowerCase().includes('dolmen') && loc.name.toLowerCase().includes('dolmen')) return loc;
            if (costCentre.toLowerCase().includes('lucky') && loc.name.toLowerCase().includes('lucky')) return loc;
        }
        return locations[0];
    }

    let inserted = 0;
    let skipped = 0;

    for (const item of legacyData) {
        const loc = findLocation(item.costCentre);
        const prefix = (loc?.shortCode || loc?.code || 'GFT').toUpperCase();
        const code = `GFT-${prefix}-${String(item.docNo).padStart(4, '0')}`;
        const createdAt = parseDate(item.docDate);
        const expiresAt = parseDate(item.validTill);
        const description = `Legacy Doc #${item.docNo} - Trader: ${item.traderDetail}`;

        const existing = await prisma.voucher.findFirst({
            where: {
                OR: [
                    { code },
                    {
                        AND: [
                            { issuedByLocationId: loc?.id },
                            { description: { contains: `Legacy Doc #${item.docNo}` } },
                        ]
                    }
                ]
            }
        });

        if (existing) {
            console.log(`  ⏩ Voucher ${code} (Doc #${item.docNo}) already exists. Skipping.`);
            skipped++;
            continue;
        }

        await prisma.voucher.create({
            data: {
                code,
                voucherType: 'GIFT',
                faceValue: item.amount,
                discount: 0,
                description,
                companyName: item.traderDetail,
                issuedByLocationId: loc?.id,
                expiresAt,
                createdAt,
                isActive: true,
                isRedeemed: false,
                locations: loc?.id ? {
                    create: [{ locationId: loc.id }]
                } : undefined,
                transactions: {
                    create: {
                        action: 'ISSUED',
                        amountUsed: 0,
                        locationId: loc?.id,
                        notes: `Migrated legacy Gift Voucher Doc #${item.docNo} (${item.costCentre})`,
                    }
                }
            }
        });

        console.log(`  ✓ Created Voucher: ${code} | Amount: Rs. ${item.amount} | Store: ${loc?.name} | Valid Till: ${expiresAt.toISOString()}`);
        inserted++;
    }

    console.log(`Finished [${dbName}] migration! Created: ${inserted}, Skipped: ${skipped}`);
}

async function main() {
    console.log('Starting legacy voucher multi-db migration...');
    const mainPool = new Pool({ connectionString: masterDbUrl });
    const res = await mainPool.query(`SELECT datname FROM pg_database WHERE datistemplate = false;`);
    await mainPool.end();

    const ignoredDbs = ['postgres', 'whatsapp_clone', 'quizdb', 'anim_library', 'glider_ui', 'omni-test-express', 'omni-test-next'];

    for (const row of res.rows) {
        const dbName = row.datname;
        if (ignoredDbs.includes(dbName)) continue;

        const dbUrl = masterDbUrl.replace('/spl_core_db', `/${dbName}`);
        const tPool = new Pool({ connectionString: dbUrl });

        try {
            const tableRes = await tPool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='pos_vouchers';`);
            if (tableRes.rows.length === 0) continue;

            const adapter = new PrismaPg(tPool);
            const prisma = new PrismaClient({ adapter });
            await prisma.$connect();
            await seedVouchersForDb(prisma, dbName);
            await prisma.$disconnect();
        } catch (err: any) {
            console.error(`Error processing DB ${dbName}:`, err.message);
        } finally {
            await tPool.end();
        }
    }
}

main().catch(e => {
    console.error('❌ Error during legacy voucher seed execution:', e);
    process.exit(1);
});
