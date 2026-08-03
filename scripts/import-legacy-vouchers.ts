import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

const masterDbUrl = process.env.DATABASE_URL || 'postgresql://postgres:root@localhost:5432/spl_core_db?schema=public';

export interface LegacyVoucherInput {
    // Location identifier: can be location code (e.g., 'CK1006'), short code ('C&K CM'), or full name ('C&K-CENTAURUS MALL')
    locationCode?: string;
    locationShortCode?: string;
    locationName?: string;
    costCentre?: string; // legacy cost centre string fallback

    // Voucher details
    docNo: number | string;
    docDate: string; // 'DD/MM/YYYY HH:mm' or 'YYYY-MM-DD' or Excel serial date
    traderDetail?: string;
    amount: number;
    validTill: string; // 'DD/MM/YYYY HH:mm' or 'YYYY-MM-DD' or Excel serial date
    voucherType?: 'GIFT' | 'EXCHANGE' | 'CREDIT' | 'CORPORATE' | 'OUTLET_GIFT' | 'REFUND';
}

function parseFlexibleDate(val: any): Date {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    if (typeof val === 'number') {
        // Excel serial date number
        return new Date(Math.round((val - 25569) * 86400 * 1000));
    }
    const str = String(val).trim();
    if (str.includes('/')) {
        const [datePart, timePart] = str.split(' ');
        const parts = datePart.split('/').map(Number);
        if (parts.length === 3) {
            const [d, m, y] = parts;
            const [hh, mm] = (timePart || '00:00').split(':').map(Number);
            const year = y < 100 ? 2000 + y : y;
            return new Date(Date.UTC(year, m - 1, d, hh || 0, mm || 0));
        }
    }
    const parsed = new Date(str);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
}

function loadVoucherRecords(): LegacyVoucherInput[] {
    const jsonPath = path.join(process.cwd(), 'vouchers.json');
    const xlsxPath = path.join(process.cwd(), 'vouchers.xlsx');
    const csvPath = path.join(process.cwd(), 'vouchers.csv');

    if (fs.existsSync(jsonPath)) {
        console.log(`📄 Loading records from: ${jsonPath}`);
        const raw = fs.readFileSync(jsonPath, 'utf8');
        return JSON.parse(raw);
    }

    const excelFile = fs.existsSync(xlsxPath) ? xlsxPath : fs.existsSync(csvPath) ? csvPath : null;
    if (excelFile) {
        console.log(`📊 Loading records from Excel/CSV: ${excelFile}`);
        const workbook = XLSX.readFile(excelFile);
        const sheetName = workbook.SheetNames[0];
        const rows: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

        return rows.map((r, idx) => ({
            locationCode: r.LocationCode || r['Location Code'] || r.locationCode || r.Code,
            locationShortCode: r.LocationShortCode || r['Location Short Code'] || r.locationShortCode || r.ShortCode,
            locationName: r.LocationName || r['Location Name'] || r.locationName || r.CostCentre || r['Cost Centre'] || r.CostCentreName,
            costCentre: r.CostCentre || r['Cost Centre'],
            docNo: r.DocumentNumber || r['Document Number'] || r.docNo || r.DocNo || r.DocNumber || idx + 1,
            docDate: r.DocumentDate || r['Document Date'] || r.docDate || r.Date || new Date().toISOString(),
            traderDetail: r.TraderDetail || r['Trader Detail'] || r.traderDetail || r.Trader || r.Customer || '',
            amount: Number(r.Amount || r.faceValue || r['Amount'] || 0),
            validTill: r.ValidTill || r['Valid Till'] || r.validTill || r.ExpiryDate || r['Expiry Date'] || new Date().toISOString(),
            voucherType: (r.VoucherType || r['Voucher Type'] || r.voucherType || 'GIFT').toUpperCase(),
        }));
    }

    console.error('❌ No vouchers.json, vouchers.xlsx, or vouchers.csv found in backend root!');
    console.log('💡 Please place a vouchers.json or vouchers.xlsx file in nestjs_backend/ directory.');
    process.exit(1);
}

async function seedVouchersForDb(prisma: PrismaClient, dbName: string, items: LegacyVoucherInput[]) {
    const locations = await prisma.location.findMany({
        where: { isDeleted: false },
        select: { id: true, name: true, code: true, shortCode: true },
    });

    console.log(`\n======================================================`);
    console.log(`--- Processing DB [${dbName}] with ${locations.length} locations ---`);
    console.log(`======================================================`);

    const locMapByCode = new Map(locations.map(l => [l.code.toUpperCase(), l]));
    const locMapByShortCode = new Map(
        locations
            .filter((l): l is typeof l & { shortCode: string } => !!l.shortCode)
            .map(l => [l.shortCode.toUpperCase(), l])
    );
    const locMapByName = new Map(locations.map(l => [l.name.toUpperCase(), l]));

    function resolveLocation(item: LegacyVoucherInput) {
        if (item.locationCode) {
            const loc = locMapByCode.get(item.locationCode.trim().toUpperCase());
            if (loc) return loc;
        }
        if (item.locationShortCode) {
            const loc = locMapByShortCode.get(item.locationShortCode.trim().toUpperCase());
            if (loc) return loc;
        }
        if (item.locationName) {
            const loc = locMapByName.get(item.locationName.trim().toUpperCase());
            if (loc) return loc;
        }
        // Fuzzy search fallback
        const searchStr = (item.locationName || item.costCentre || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        for (const loc of locations) {
            const normName = loc.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (normName.includes(searchStr) || searchStr.includes(normName)) return loc;
            if (searchStr.includes('centaurus') && loc.name.toLowerCase().includes('centaurus')) return loc;
            if (searchStr.includes('dolmen') && loc.name.toLowerCase().includes('dolmen')) return loc;
            if (searchStr.includes('lucky') && loc.name.toLowerCase().includes('lucky')) return loc;
        }
        return locations[0];
    }

    let inserted = 0;
    let skipped = 0;

    for (const item of items) {
        const loc = resolveLocation(item);
        if (!loc) {
            console.warn(`  ⚠️ Could not resolve location for item:`, item);
            continue;
        }

        const prefix = (loc.shortCode || loc.code || 'GFT').toUpperCase();
        const docNoStr = String(item.docNo).trim();
        const code = `GFT-${prefix}-${docNoStr.padStart(4, '0')}`;
        const createdAt = parseFlexibleDate(item.docDate);
        const expiresAt = parseFlexibleDate(item.validTill);
        const description = `Legacy Doc #${docNoStr}${item.traderDetail ? ` - Trader: ${item.traderDetail}` : ''}`;
        const type = (item.voucherType || 'GIFT') as any;

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
            console.log(`  ⏩ Voucher ${code} (Doc #${docNoStr}) already exists. Skipping.`);
            skipped++;
            continue;
        }

        await prisma.voucher.create({
            data: {
                code,
                voucherType: type,
                faceValue: item.amount,
                discount: 0,
                description,
                companyName: item.traderDetail || null,
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
                        notes: `Migrated legacy ${type} Voucher Doc #${docNoStr} (${loc.name})`,
                    }
                }
            }
        });

        console.log(`  ✓ Created: ${code} | Val: Rs. ${item.amount.toLocaleString()} | Store: [${loc.code}] ${loc.name} | Expiry: ${expiresAt.toISOString().split('T')[0]}`);
        inserted++;
    }

    console.log(`\n🎉 [${dbName}] Migration Completed! Created: ${inserted}, Skipped: ${skipped}`);
}

async function main() {
    const items = loadVoucherRecords();
    console.log(`Found ${items.length} voucher records to import.`);

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
            await seedVouchersForDb(prisma, dbName, items);
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
