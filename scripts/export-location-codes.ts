import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';

const masterDbUrl = process.env.DATABASE_URL || 'postgresql://postgres:root@localhost:5432/spl_core_db?schema=public';

async function main() {
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
            const tableRes = await tPool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='Location';`);
            if (tableRes.rows.length === 0) continue;

            const adapter = new PrismaPg(tPool);
            const prisma = new PrismaClient({ adapter });
            await prisma.$connect();

            const locations = await prisma.location.findMany({
                where: { isDeleted: false },
                select: { id: true, name: true, code: true, shortCode: true },
                orderBy: { name: 'asc' },
            });

            console.log(`\n======================================================`);
            console.log(`📌 LOCATION CODES DIRECTORY FOR DB [${dbName}] (${locations.length} Locations)`);
            console.log(`======================================================\n`);
            console.table(locations.map(l => ({
                'Location Code': l.code,
                'Short Code': l.shortCode,
                'Location Name': l.name,
                'ID': l.id,
            })));

            const jsonPath = path.join(process.cwd(), 'location_codes_reference.json');
            fs.writeFileSync(jsonPath, JSON.stringify(locations, null, 2));
            console.log(`\n💾 Exported location reference list to: ${jsonPath}`);

            await prisma.$disconnect();
            break;
        } catch (err: any) {
            console.error(`Error reading DB ${dbName}:`, err.message);
        } finally {
            await tPool.end();
        }
    }
}

main().catch(console.error);
