import 'dotenv/config';
import * as crypto from 'crypto';
import { Pool } from 'pg';

function decrypt(encryptedText: string, masterKeyString: string): string {
    const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
    const parts = encryptedText.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, Buffer.from(parts[0], 'hex'));
    decipher.setAuthTag(Buffer.from(parts[1], 'hex'));
    let decrypted = decipher.update(parts[2], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

async function main() {
    const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
    const masterKey = process.env.MASTER_ENCRYPTION_KEY;
    if (!managementUrl || !masterKey) return;
    
    const mPool = new Pool({ connectionString: managementUrl });
    const companiesRes = await mPool.query(`SELECT name, code, "dbUrl", "dbPassword", "dbHost", "dbPort", "dbUser", "dbName" FROM "Company" WHERE status = 'active'`);
    const companies = companiesRes.rows;
    
    for (const company of companies) {
        let connectionString = company.dbUrl;
        if (company.dbPassword) {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
        }
        
        const p = new Pool({ connectionString });
        console.log(`Tenant ${company.name}`);
        const cols = await p.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'sales_orders'`);
        console.log('Columns in sales_orders:', cols.rows.map(r => r.column_name));
        
        const res = await p.query(`SELECT "orderNumber", "created_at" FROM sales_orders WHERE "orderNumber" LIKE '%27-0000%' ORDER BY "created_at" DESC LIMIT 10`);
        console.log('27-0000x Orders:', res.rows);
        await p.end();
    }
    await mPool.end();
}
main().catch(console.error);
