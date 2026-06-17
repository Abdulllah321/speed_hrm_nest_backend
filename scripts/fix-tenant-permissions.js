"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const pg_1 = require("pg");
async function main() {
    const dbName = 'tenant_speed_sport_mkzblxzg';
    const dbUser = 'user_speed_sport_mkzblxzh';
    console.log(`Fixing permissions for DB: ${dbName}, User: ${dbUser}`);
    const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
    if (!managementUrl) {
        throw new Error('DATABASE_URL_MANAGEMENT not set');
    }
    const url = new URL(managementUrl);
    const pool = new pg_1.Pool({
        host: url.hostname,
        port: parseInt(url.port || '5432'),
        user: url.username,
        password: url.password,
        database: dbName,
    });
    try {
        console.log('Connecting to tenant database as superuser...');
        console.log('Granting database ownership/permissions...');
        try {
            await pool.query(`ALTER DATABASE "${dbName}" OWNER TO ${dbUser};`);
        }
        catch (e) {
            console.warn('Could not alter database owner (might need to be connected to a different DB or have higher privileges), trying GRANT ALL...');
            await pool.query(`GRANT ALL PRIVILEGES ON DATABASE "${dbName}" TO ${dbUser};`);
        }
        console.log('Ensuring schema public exists and granting usage...');
        await pool.query(`CREATE SCHEMA IF NOT EXISTS public;`);
        await pool.query(`GRANT USAGE ON SCHEMA public TO ${dbUser};`);
        await pool.query(`GRANT CREATE ON SCHEMA public TO ${dbUser};`);
        console.log('Granting all tables...');
        await pool.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${dbUser};`);
        console.log('Granting all sequences...');
        await pool.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${dbUser};`);
        console.log('Altering default privileges...');
        await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO ${dbUser};`);
        await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO ${dbUser};`);
        console.log('Transferring ownership of schema, tables, sequences, and types...');
        await pool.query(`ALTER SCHEMA public OWNER TO ${dbUser};`);
        const tables = await pool.query(`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public';
    `);
        for (const row of tables.rows) {
            await pool.query(`ALTER TABLE "public"."${row.tablename}" OWNER TO ${dbUser};`);
        }
        const sequences = await pool.query(`
        SELECT sequencename FROM pg_sequences WHERE schemaname = 'public';
    `);
        for (const row of sequences.rows) {
            await pool.query(`ALTER SEQUENCE "public"."${row.sequencename}" OWNER TO ${dbUser};`);
        }
        const types = await pool.query(`
        SELECT t.typname 
        FROM pg_type t 
        JOIN pg_namespace n ON n.oid = t.typnamespace 
        WHERE n.nspname = 'public' AND t.typtype = 'e'; -- 'e' for enum, can remove filter for all types
    `);
        for (const row of types.rows) {
            await pool.query(`ALTER TYPE "public"."${row.typname}" OWNER TO ${dbUser};`);
        }
        console.log('Verifying Employee table permissions...');
        const result = await pool.query(`
        SELECT grantee, privilege_type 
        FROM information_schema.role_table_grants 
        WHERE table_name = 'Employee' AND grantee = '${dbUser}';
    `);
        console.log('Current grants for Employee:', result.rows);
        if (result.rows.length > 0) {
            console.log('✅ Permissions fixed!');
        }
        else {
            console.log('⚠️ Employee table might not exist or grants failed?');
            const tableCheck = await pool.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'Employee';
        `);
            if (tableCheck.rows.length === 0) {
                console.log('❌ Table "Employee" does not exist in this database!');
            }
        }
    }
    catch (e) {
        console.error('❌ Error:', e);
    }
    finally {
        await pool.end();
    }
}
main();
//# sourceMappingURL=fix-tenant-permissions.js.map