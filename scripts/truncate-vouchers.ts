import 'dotenv/config';
import { Pool } from 'pg';

const masterDbUrl = process.env.DATABASE_URL || 'postgresql://postgres:root@localhost:5432/spl_core_db?schema=public';

async function main() {
    console.log('🧹 Starting Voucher Truncate / Cleanup across all tenant databases...');
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

            console.log(`\n--- Cleaning vouchers in database: [${dbName}] ---`);

            const delRedemptions = await tPool.query(`DELETE FROM pos_voucher_redemptions;`);
            console.log(`  ✓ Cleared ${delRedemptions.rowCount} pos_voucher_redemptions records.`);

            const delTransactions = await tPool.query(`DELETE FROM pos_voucher_transactions;`);
            console.log(`  ✓ Cleared ${delTransactions.rowCount} pos_voucher_transactions records.`);

            const delLocations = await tPool.query(`DELETE FROM pos_voucher_locations;`);
            console.log(`  ✓ Cleared ${delLocations.rowCount} pos_voucher_locations records.`);

            const delVouchers = await tPool.query(`DELETE FROM pos_vouchers;`);
            console.log(`  ✓ Cleared ${delVouchers.rowCount} pos_vouchers records.`);

        } catch (e: any) {
            console.error(`  ❌ Error cleaning vouchers in ${dbName}:`, e.message);
        } finally {
            await tPool.end();
        }
    }

    console.log('\n🎉 Voucher truncation complete across all target databases!');
}

main().catch(console.error);
