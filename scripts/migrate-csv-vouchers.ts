import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

const masterDbUrl = process.env.DATABASE_URL || 'postgresql://postgres:root@localhost:5432/spl_core_db?schema=public';

interface CSVVoucherRow {
    CostCentre: string;
    DocumentNumber: string;
    DocumentDate: string;
    TraderDetail: string;
    Amount: string;
    ValidTill: string;
}

function parseFlexibleDate(str: string): Date {
    if (!str) return new Date();
    const cleanStr = String(str).trim();
    if (cleanStr.includes('/')) {
        const [datePart, timePart] = cleanStr.split(' ');
        const parts = datePart.split('/').map(Number);
        if (parts.length === 3) {
            const [d, m, y] = parts;
            const [hh, mm] = (timePart || '00:00').split(':').map(Number);
            const year = y < 100 ? 2000 + y : y;
            return new Date(Date.UTC(year, m - 1, d, hh || 0, mm || 0));
        }
    }
    const parsed = new Date(cleanStr);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
}

const COST_CENTRE_MAPPING: Record<string, string> = {
    'adidas-lucky one mall': 'A10001',
    'charles & keith-centaurus mall': 'CK1006',
    'charles & keith-dolmen clifton': 'CK1001',
    'charles & keith-dolmen lahore': 'CK1005',
    'charles & keith-emporium mall': 'CK1003',
    'charles & keith-lucky one': 'CK1002',
    'charles & keith-packages mall': 'CK1004',
    'nike-centaurus mall': 'N10004',
    'nike-dolmen clifton': 'N10001',
    'nike-packages mall': 'N10003',
    'nike-xinhua mall': 'N10002',
    'pedro-dolmen clifton': 'P10001',
    'pedro-online': 'P10004',
    'speed sports-dolmen clifton': 'SS1002',
    'speed sports-dolmen lahore': 'SS1006',
    'speed sports-fountain avenue': 'SS1004',
    'speed sports-lucky one mall': 'SS1001',
    'speed sports-lyallpur galleria': 'SS1010',
    'speed sports-mall of multan': 'SS1009',
    'speed sports-online': 'SS1011',
    'speed sports-safa mall': 'SS1007',
    'speed sports-the forum': 'SS1012',
};

async function seedVouchersFromCSV(prisma: PrismaClient, dbName: string, rows: CSVVoucherRow[]) {
    const locations = await prisma.location.findMany({
        where: { isDeleted: false },
        select: { id: true, name: true, code: true, shortCode: true },
    });

    console.log(`\n======================================================`);
    console.log(`🚀 MIGRATING CSV VOUCHERS TO DB [${dbName}] (${rows.length} Records)`);
    console.log(`======================================================`);

    const locByCode = new Map(locations.map(l => [l.code.toUpperCase(), l]));

    function findLocation(costCentre: string) {
        const normCC = costCentre.trim().toLowerCase();
        const mappedCode = COST_CENTRE_MAPPING[normCC];
        if (mappedCode && locByCode.has(mappedCode)) {
            return locByCode.get(mappedCode);
        }
        // Fallback fuzzy search
        const cleanCC = normCC.replace(/[^a-z0-9]/g, '');
        for (const loc of locations) {
            const normName = loc.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (normName.includes(cleanCC) || cleanCC.includes(normName)) return loc;
            if (normCC.includes('centaurus') && loc.name.toLowerCase().includes('centaurus')) return loc;
            if (normCC.includes('dolmen') && loc.name.toLowerCase().includes('dolmen')) return loc;
            if (normCC.includes('lucky') && loc.name.toLowerCase().includes('lucky')) return loc;
        }
        return locations[0];
    }

    let inserted = 0;
    let skipped = 0;

    for (const row of rows) {
        const cc = row.CostCentre;
        const loc = findLocation(cc);
        if (!loc) {
            console.warn(`  ⚠️ Could not resolve location for CostCentre: "${cc}"`);
            continue;
        }

        const docNoStr = String(row.DocumentNumber).trim();
        const prefix = (loc.shortCode || loc.code || 'GFT').toUpperCase();
        const code = `GFT-${prefix}-${docNoStr.padStart(4, '0')}`;
        const amount = parseFloat(String(row.Amount).replace(/[^0-9.-]/g, '')) || 0;
        const createdAt = parseFlexibleDate(row.DocumentDate);
        const expiresAt = parseFlexibleDate(row.ValidTill);
        const trader = (row.TraderDetail || '').trim();
        const description = `Legacy Doc #${docNoStr}${trader ? ` - Trader: ${trader}` : ''}`;

        // Check if exists
        const existing = await prisma.voucher.findFirst({
            where: {
                OR: [
                    { code },
                    {
                        AND: [
                            { issuedByLocationId: loc.id },
                            { description: { contains: `Legacy Doc #${docNoStr}` } },
                        ]
                    }
                ]
            }
        });

        if (existing) {
            skipped++;
            continue;
        }

        await prisma.voucher.create({
            data: {
                code,
                voucherType: 'GIFT',
                faceValue: amount,
                discount: 0,
                description,
                companyName: trader || null,
                issuedByLocationId: loc.id,
                expiresAt,
                createdAt,
                isActive: true,
                isRedeemed: false,
                locations: {
                    create: [{ locationId: loc.id }]
                },
                transactions: {
                    create: {
                        action: 'ISSUED',
                        amountUsed: 0,
                        locationId: loc.id,
                        notes: `Migrated legacy Gift Voucher Doc #${docNoStr} (${loc.name})`,
                    }
                }
            }
        });

        inserted++;
        if (inserted % 50 === 0) {
            console.log(`  Progress: ${inserted} / ${rows.length} vouchers created...`);
        }
    }

    console.log(`\n🎉 DB [${dbName}] Migration Completed! Created: ${inserted}, Skipped: ${skipped}`);
}

async function main() {
    const csvPath = path.join(process.cwd(), 'Oustanding Gift Vouchers_20260731_171144.csv');
    if (!fs.existsSync(csvPath)) {
        console.error(`❌ CSV File not found at: ${csvPath}`);
        process.exit(1);
    }

    console.log(`📄 Parsing CSV File: ${csvPath}`);
    const fileContent = fs.readFileSync(csvPath, 'utf8');
    const rows: CSVVoucherRow[] = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
    });

    console.log(`Loaded ${rows.length} records from CSV.`);

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
            await seedVouchersFromCSV(prisma, dbName, rows);
            await prisma.$disconnect();
        } catch (err: any) {
            console.error(`Error processing DB ${dbName}:`, err.message);
        } finally {
            await tPool.end();
        }
    }
}

main().catch(e => {
    console.error('❌ Migration Error:', e);
    process.exit(1);
});
