import { Pool } from 'pg';
import 'dotenv/config';

async function fixOwnership() {
  const managementPool = new Pool({ connectionString: process.env.DATABASE_URL_MANAGEMENT });
  
  try {
    const { rows: companies } = await managementPool.query('SELECT "name", "code", "dbName", "dbUser", "dbHost", "dbPort" FROM "Company" WHERE status = \'active\'');
    console.log(`Found ${companies.length} active companies.`);

    for (const company of companies) {
      console.log(`Fixing ownership for ${company.dbName} -> ${company.dbUser}`);
      const tenantPool = new Pool({
        connectionString: `postgresql://postgres:root@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`
      });

      try {
        await tenantPool.query(`REASSIGN OWNED BY postgres TO ${company.dbUser};`);
        console.log(`✅ Success for ${company.dbName}`);
      } catch (e: any) {
        console.error(`❌ Failed for ${company.dbName}: ${e.message}`);
      }
      await tenantPool.end();
    }
  } finally {
    await managementPool.end();
  }
}

fixOwnership().catch(console.error);
