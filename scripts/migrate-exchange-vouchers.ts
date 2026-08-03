import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

const masterDbUrl = process.env.DATABASE_URL || 'postgresql://postgres:root@localhost:5432/spl_core_db?schema=public';

interface CSVExchangeRow {
    CostCentre: string;
    DocumentNumber: string;
    DocumentDate: string;
    Customer?: string;
    FKInvoiceNumber_Sale?: string;
    DocumentDate_Sale?: string;
    FKInvoiceNumber_Exchange?: string;
    DocumentDate_Exchange?: string;
    CalcLineTotal_Net?: string;
    CalcLine_SubTotal?: string;
    UnitPrice?: string;
    Quantity?: string;
}

function parseFlexibleDate(str: string): Date {
    if (!str) return new Date();
    const cleanStr = String(str).trim();
    if (cleanStr.includes('/')) {
        const [datePart, timePart] = cleanStr.split(' ');
        const parts = datePart.split('/').map(Number);
        if (parts.length === 3) {
            const [d, m, y] = parts;
            let hh = 0, mm = 0;
            if (timePart) {
                const timeComponents = timePart.split(':').map(Number);
                hh = timeComponents[0] || 0;
                mm = timeComponents[1] || 0;
                if (cleanStr.toLowerCase().includes('pm') && hh < 12) hh += 12;
                if (cleanStr.toLowerCase().includes('am') && hh === 12) hh = 0;
            }
            const year = y < 100 ? 2000 + y : y;
            return new Date(Date.UTC(year, m - 1, d, hh, mm));
        }
    }
    const parsed = new Date(cleanStr);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
}

const COST_CENTRE_MAPPING: Record<string, string> = {
    'speed sports-online': 'SS1011',
    'nike-dolmen clifton': 'N10001',
    'nike-xinhua mall': 'N10002',
    'nike-packages mall': 'N10003',
    'nike-centaurus mall': 'N10004',
    'speed sports-safa mall': 'SS1007',
    'speed sports-the forum': 'SS1012',
    'speed sports-lucky one mall': 'SS1001',
    'speed sports-emporium mall': 'SS1005',
    'speed sports-fountain avenue': 'SS1004',
    'speed sports-dolmen lahore': 'SS1006',
    'speed sports-mall of multan': 'SS1009',
    'speed sports-lyallpur galleria': 'SS1010',
    'nike-safa mall': 'N10005',
    'speed sports-dolmen clifton': 'SS1002',
    'speed sports-giga mall': 'SS1008',
    'charles & keith-dolmen clifton': 'CK1001',
    'charles & keith-lucky one': 'CK1002',
    'charles & keith-emporium mall': 'CK1003',
    'charles & keith-packages mall': 'CK1004',
    'charles & keith-centaurus mall': 'CK1006',
    'charles & keith-dolmen lahore': 'CK1005',
    'pedro-dolmen clifton': 'P10001',
    'pedro-packages mall': 'P10002',
    'pedro-online': 'P10004',
    'pedro-dolmen lahore': 'P10003',
    'tag heuer-safa mall': 'W10004',
    'tag heuer-packages mall': 'W10003',
    'tag heuer-emporium mall': 'W10002',
    'spl pos-iwc lucky one': 'W10006',
    'spl pos-iwc dolmen tariq road': 'W10007',
    'spl pos-iwc dolmen lahore': 'W10009',
    'spl pos-iwc sialkot': 'W10011',
    'adidas-lucky one mall': 'A10001',
    'adidas - madison square': 'A10003',
    'adidas jinnah icon mall': 'A10002',
    'puma - dolmen mall lahore': 'PU1001',
};

interface GroupedExchangeVoucher {
    costCentre: string;
    docNo: string;
    docDate: string;
    customer?: string;
    saleInv?: string;
    exchangeInv?: string;
    exchangeDate?: string;
    totalAmount: number;
}

async function seedExchangeVouchersFromCSV(prisma: PrismaClient, dbName: string, vouchers: GroupedExchangeVoucher[]) {
    const locations = await prisma.location.findMany({
        where: { isDeleted: false },
        select: { id: true, name: true, code: true, shortCode: true },
    });

    console.log(`\n======================================================`);
    console.log(`🚀 MIGRATING EXCHANGE VOUCHERS TO DB [${dbName}] (${vouchers.length} Vouchers)`);
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

    let insertedOutstanding = 0;
    let insertedRedeemed = 0;
    let skipped = 0;

    for (let i = 0; i < vouchers.length; i++) {
        const v = vouchers[i];
        const loc = findLocation(v.costCentre);
        if (!loc) {
            console.warn(`  ⚠️ Could not resolve location for CostCentre: "${v.costCentre}"`);
            continue;
        }

        const docNoStr = v.docNo.trim();
        const prefix = (loc.shortCode || loc.code || 'EXC').toUpperCase();
        const code = `EXC-${prefix}-${docNoStr.padStart(4, '0')}`;
        const createdAt = parseFlexibleDate(v.docDate);
        const isOutstanding = !v.exchangeInv || v.exchangeInv === '0' || v.exchangeInv.trim() === '';
        const isRedeemed = !isOutstanding;
        const isActive = isOutstanding;

        const description = `Legacy Exchange Voucher Doc #${docNoStr}${v.saleInv ? ` (Sale Invoice Ref: #${v.saleInv})` : ''}${isRedeemed ? ` (Redeemed on Exchange Invoice #${v.exchangeInv})` : ''}`;

        // Check if exists
        const existing = await prisma.voucher.findFirst({
            where: {
                OR: [
                    { code },
                    {
                        AND: [
                            { issuedByLocationId: loc.id },
                            { voucherType: 'EXCHANGE' },
                            { description: { contains: `Legacy Exchange Voucher Doc #${docNoStr}` } },
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
                voucherType: 'EXCHANGE',
                faceValue: Math.round(v.totalAmount * 100) / 100,
                discount: 0,
                description,
                companyName: v.customer || null,
                issuedByLocationId: loc.id,
                expiresAt: null,
                createdAt,
                isActive,
                isRedeemed,
                locations: {
                    create: [{ locationId: loc.id }]
                },
                transactions: {
                    create: isRedeemed ? [
                        {
                            action: 'ISSUED',
                            amountUsed: 0,
                            locationId: loc.id,
                            notes: `Migrated legacy Exchange Voucher Doc #${docNoStr} (${loc.name})`,
                            createdAt,
                        },
                        {
                            action: 'REDEEMED',
                            amountUsed: Math.round(v.totalAmount * 100) / 100,
                            locationId: loc.id,
                            notes: `Redeemed on legacy Exchange Invoice #${v.exchangeInv}`,
                            createdAt: v.exchangeDate ? parseFlexibleDate(v.exchangeDate) : createdAt,
                        }
                    ] : [
                        {
                            action: 'ISSUED',
                            amountUsed: 0,
                            locationId: loc.id,
                            notes: `Migrated legacy Exchange Voucher Doc #${docNoStr} (${loc.name})`,
                            createdAt,
                        }
                    ]
                }
            }
        });

        if (isOutstanding) insertedOutstanding++;
        else insertedRedeemed++;

        if ((i + 1) % 500 === 0) {
            console.log(`  Progress: ${i + 1} / ${vouchers.length} exchange vouchers processed...`);
        }
    }

    console.log(`\n🎉 DB [${dbName}] Exchange Voucher Migration Completed!`);
    console.log(`   - Outstanding Vouchers Created (Live/Active): ${insertedOutstanding}`);
    console.log(`   - Historical Redeemed Vouchers Created: ${insertedRedeemed}`);
    console.log(`   - Skipped Existing: ${skipped}`);
}

async function main() {
    const csvPath = path.join(process.cwd(), 'Sales Return_Exchange Register_Format II_20260731_171439.csv');
    if (!fs.existsSync(csvPath)) {
        console.error(`❌ CSV File not found at: ${csvPath}`);
        process.exit(1);
    }

    console.log(`📄 Parsing CSV File: ${csvPath}`);
    const fileContent = fs.readFileSync(csvPath, 'utf8');
    const rows: CSVExchangeRow[] = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_quotes: true,
        relax_column_count: true,
    });

    console.log(`Loaded ${rows.length} line item records from CSV. Grouping into return documents...`);

    const docMap = new Map<string, GroupedExchangeVoucher>();
    for (const r of rows) {
        const cc = (r.CostCentre || '').trim();
        const docNo = (r.DocumentNumber || '').trim();
        if (!cc || !docNo) continue;

        const key = `${cc}___${docNo}`;
        const amt = parseFloat(r.CalcLineTotal_Net || r.CalcLine_SubTotal || r.UnitPrice || '0') || 0;
        const exchangeInv = (r.FKInvoiceNumber_Exchange || '').trim();
        const exchangeDate = (r.DocumentDate_Exchange || '').trim();

        if (!docMap.has(key)) {
            docMap.set(key, {
                costCentre: cc,
                docNo,
                docDate: r.DocumentDate,
                customer: r.Customer,
                saleInv: r.FKInvoiceNumber_Sale,
                exchangeInv,
                exchangeDate,
                totalAmount: 0,
            });
        }
        docMap.get(key)!.totalAmount += amt;
    }

    const vouchers = Array.from(docMap.values());
    const outstandingCount = vouchers.filter(v => !v.exchangeInv || v.exchangeInv === '0').length;
    console.log(`Grouped into ${vouchers.length} total distinct Exchange Vouchers (${outstandingCount} Outstanding, ${vouchers.length - outstandingCount} Historical Redeemed).`);

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
            await seedExchangeVouchersFromCSV(prisma, dbName, vouchers);
            await prisma.$disconnect();
        } catch (err: any) {
            console.error(`Error processing DB ${dbName}:`, err.message);
        } finally {
            await tPool.end();
        }
    }
}

main().catch(e => {
    console.error('❌ Exchange Voucher Migration Error:', e);
    process.exit(1);
});
