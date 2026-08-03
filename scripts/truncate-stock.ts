import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
    const masterDbUrl = process.env.DATABASE_URL || 'postgresql://postgres:root@localhost:5432/spl_core_db?schema=public';
    const pool = new Pool({ connectionString: masterDbUrl });
    
    const res = await pool.query(`SELECT datname FROM pg_database WHERE datistemplate = false;`);
    console.log('Databases in PostgreSQL:', res.rows.map(r => r.datname));

    for (const row of res.rows) {
        const dbName = row.datname;
        if (['postgres', 'whatsapp_clone', 'quizdb', 'anim_library', 'glider_ui', 'omni-test-express', 'omni-test-next'].includes(dbName)) continue;
        
        const tenantUrl = masterDbUrl.replace('/spl_core_db', `/${dbName}`);
        const tPool = new Pool({ connectionString: tenantUrl });
        try {
            const tableRes = await tPool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name='stock_ledgers' OR table_name='InventoryItem' OR table_name='BulkUpload');`);
            const foundTables = tableRes.rows.map(r => r.table_name);
            if (foundTables.length > 0) {
                console.log(`\n--- Cleaning stock in database: ${dbName} (Tables: ${foundTables.join(', ')}) ---`);
                
                if (foundTables.includes('stock_ledgers')) {
                    const delLedger = await tPool.query(`DELETE FROM stock_ledgers;`);
                    console.log(`[${dbName}] Cleared ${delLedger.rowCount} total stock_ledgers records.`);
                }

                if (foundTables.includes('InventoryItem')) {
                    const delInv = await tPool.query(`DELETE FROM "InventoryItem";`);
                    console.log(`[${dbName}] Cleared ${delInv.rowCount} total InventoryItem records.`);
                }

                if (foundTables.includes('BulkUpload')) {
                    const delBulk = await tPool.query(`DELETE FROM "BulkUpload";`);
                    console.log(`[${dbName}] Cleared ${delBulk.rowCount} total BulkUpload records.`);
                }
            }
        } catch (e: any) {
            console.error(`Error querying ${dbName}:`, e.message);
        } finally {
            await tPool.end();
        }
    }

    await pool.end();
}

main().catch(console.error);
