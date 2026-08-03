import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

const masterDbUrl = process.env.DATABASE_URL || 'postgresql://postgres:root@localhost:5432/spl_core_db?schema=public';

interface CSVCreditVoucherRow {
    CostCentre: string;
    DocumentNumber: string;
    DocumentDate: string;
    'T Day'?: string;
    'T Month'?: string;
    'T Year'?: string;
    IssueFromFKInvoiceNumber?: string;
    Amount: string;
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
    'adidas - madison square': 'A10003',
    'adidas jinnah icon mall': 'A10002',
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
    'nike-safa mall': 'N10005',
    'nike-xinhua mall': 'N10002',
    'pedro-dolmen clifton': 'P10001',
    'pedro-dolmen lahore': 'P10003',
    'pedro-online': 'P10004',
    'pedro-packages mall': 'P10002',
    'puma - dolmen mall lahore': 'PU1001',
    'speed sports-dolmen clifton': 'SS1002',
    'speed sports-dolmen lahore': 'SS1006',
    'speed sports-emporium mall': 'SS1005',
    'speed sports-fountain avenue': 'SS1004',
    'speed sports-giga mall': 'SS1008',
    'speed sports-lucky one mall': 'SS1001',
    'speed sports-lyallpur galleria': 'SS1010',
    'speed sports-mall of multan': 'SS1009',
    'speed sports-online': 'SS1011',
    'speed sports-safa mall': 'SS1007',
    'speed sports-the forum': 'SS1012',
    'spl pos-iwc dolmen lahore': 'W10009',
    'spl pos-iwc sialkot': 'W10011',
    'tag heuer-emporium mall': 'W10002',
};

async function seedCreditVouchersFromCSV(prisma: PrismaClient, dbName: string, rows: CSVCreditVoucherRow[]) {
    const locations = await prisma.location.findMany({
        where: { isDeleted: false },
        select: { id: true, name: true, code: true, shortCode: true },
    });

    console.log(`\n======================================================`);
    console.log(`🚀 MIGRATING CREDIT VOUCHERS TO DB [${dbName}] (${rows.length} Records)`);
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
        const prefix = (loc.shortCode || loc.code || 'CRD').toUpperCase();
        const code = `CRD-${prefix}-${docNoStr.padStart(4, '0')}`;
        const amount = parseFloat(String(row.Amount).replace(/[^0-9.-]/g, '')) || 0;
        const createdAt = parseFlexibleDate(row.DocumentDate);
        const invNo = row.IssueFromFKInvoiceNumber ? String(row.IssueFromFKInvoiceNumber).trim() : null;
        const description = `Legacy Credit Voucher Doc #${docNoStr}${invNo ? ` (Invoice Ref: #${invNo})` : ''}`;

        // Check if exists
        const existing = await prisma.voucher.findFirst({
            where: {
                OR: [
                    { code },
                    {
                        AND: [
                            { issuedByLocationId: loc.id },
                            { voucherType: 'CREDIT' },
                            { description: { contains: `Legacy Credit Voucher Doc #${docNoStr}` } },
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
                voucherType: 'CREDIT',
                faceValue: amount,
                discount: 0,
                description,
                issuedByLocationId: loc.id,
                expiresAt: null, // Credit vouchers do not expire by default
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
                        notes: `Migrated legacy Credit Voucher Doc #${docNoStr} (${loc.name})`,
                    }
                }
            }
        });

        inserted++;
        if (inserted % 100 === 0) {
            console.log(`  Progress: ${inserted} / ${rows.length} credit vouchers created...`);
        }
    }

    console.log(`\n🎉 DB [${dbName}] Credit Voucher Migration Completed! Created: ${inserted}, Skipped: ${skipped}`);
}

async function main() {
    const csvPath = path.join(process.cwd(), 'Outstanding Credit Vouchers_20260731_171209.csv');
    if (!fs.existsSync(csvPath)) {
        console.error(`❌ CSV File not found at: ${csvPath}`);
        process.exit(1);
    }

    console.log(`📄 Parsing CSV File: ${csvPath}`);
    const fileContent = fs.readFileSync(csvPath, 'utf8');
    const rows: CSVCreditVoucherRow[] = parse(fileContent, {
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
            await seedCreditVouchersFromCSV(prisma, dbName, rows);
            await prisma.$disconnect();
        } catch (err: any) {
            console.error(`Error processing DB ${dbName}:`, err.message);
        } finally {
            await tPool.end();
        }
    }
}

main().catch(e => {
    console.error('❌ Credit Voucher Migration Error:', e);
    process.exit(1);
});
