
import 'dotenv/config';
import { Pool } from 'pg';

async function main() {
  const dbName = 'tenant_speed_sport_mkzblxzg';
  const dbUser = 'user_speed_sport_mkzblxzh';
  
  console.log(`Fixing permissions for DB: ${dbName}, User: ${dbUser}`);

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  if (!managementUrl) {
    throw new Error('DATABASE_URL_MANAGEMENT not set');
  }

  const url = new URL(managementUrl);
  
  // Connect to the TENANT database using SUPERUSER credentials
  const pool = new Pool({
    host: url.hostname,
    port: parseInt(url.port || '5432'),
    user: url.username,
    password: url.password,
    database: dbName, 
  });

  try {
    console.log('Connecting to tenant database as superuser...');
    
    // 1. Grant Schema Usage
    console.log('Granting schema usage...');
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${dbUser};`);
    await pool.query(`GRANT CREATE ON SCHEMA public TO ${dbUser};`);
    
    // 2. Grant Tables
    console.log('Granting all tables...');
    await pool.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${dbUser};`);
    
    // 3. Grant Sequences
    console.log('Granting all sequences...');
    await pool.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${dbUser};`);

    // 4. Alter Default Privileges
    console.log('Altering default privileges...');
    await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO ${dbUser};`);
    await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO ${dbUser};`);

    // 5. Verify Employee table specifically
    console.log('Verifying Employee table permissions...');
    const result = await pool.query(`
        SELECT grantee, privilege_type 
        FROM information_schema.role_table_grants 
        WHERE table_name = 'Employee' AND grantee = '${dbUser}';
    `);
    
    console.log('Current grants for Employee:', result.rows);
    
    if (result.rows.length > 0) {
        console.log('✅ Permissions fixed!');
    } else {
        console.log('⚠️ Employee table might not exist or grants failed?');
        // Check if table exists
        const tableCheck = await pool.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'Employee';
        `);
        if (tableCheck.rows.length === 0) {
            console.log('❌ Table "Employee" does not exist in this database!');
        }
    }

  } catch (e) {
    console.error('❌ Error:', e);
  } finally {
    await pool.end();
  }
}

main();
