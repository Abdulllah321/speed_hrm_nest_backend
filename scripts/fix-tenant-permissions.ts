
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

    // 0. Grant Database Ownership/Permissions
    console.log('Granting database ownership/permissions...');
    try {
        await pool.query(`ALTER DATABASE "${dbName}" OWNER TO ${dbUser};`);
    } catch (e) {
        console.warn('Could not alter database owner (might need to be connected to a different DB or have higher privileges), trying GRANT ALL...');
        await pool.query(`GRANT ALL PRIVILEGES ON DATABASE "${dbName}" TO ${dbUser};`);
    }
    
    // 1. Grant Schema Usage (Create if not exists)
    console.log('Ensuring schema public exists and granting usage...');
    await pool.query(`CREATE SCHEMA IF NOT EXISTS public;`);
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

    // 4.5 Transfer Ownership of everything (Required for DROP/RESET)
    console.log('Transferring ownership of schema, tables, sequences, and types...');
    
    // Schema
    await pool.query(`ALTER SCHEMA public OWNER TO ${dbUser};`);

    // Tables
    const tables = await pool.query(`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public';
    `);
    for (const row of tables.rows) {
        await pool.query(`ALTER TABLE "public"."${row.tablename}" OWNER TO ${dbUser};`);
    }

    // Sequences
    const sequences = await pool.query(`
        SELECT sequencename FROM pg_sequences WHERE schemaname = 'public';
    `);
    for (const row of sequences.rows) {
        await pool.query(`ALTER SEQUENCE "public"."${row.sequencename}" OWNER TO ${dbUser};`);
    }

    // Types (Enums, etc.)
    const types = await pool.query(`
        SELECT t.typname 
        FROM pg_type t 
        JOIN pg_namespace n ON n.oid = t.typnamespace 
        WHERE n.nspname = 'public' AND t.typtype = 'e'; -- 'e' for enum, can remove filter for all types
    `);
    // Note: 'e' is enum. We might need others too, but usually enums cause issues. 
    // Let's get all user defined types if possible, but filtering by 'e' (enum) and 'c' (composite) is safer?
    // Let's just do Enums first as that was the error.
    for (const row of types.rows) {
        await pool.query(`ALTER TYPE "public"."${row.typname}" OWNER TO ${dbUser};`);
    }

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
