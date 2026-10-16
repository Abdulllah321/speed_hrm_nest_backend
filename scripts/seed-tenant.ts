import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { execSync } from 'child_process';
import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';

/**
 * Helper to parse connection string components
 */
function parseUrl(url: string) {
    try {
        const parsed = new URL(url);
        return {
            host: parsed.hostname,
            port: parsed.port || '5432',
            database: parsed.pathname.slice(1),
            username: parsed.username,
            password: parsed.password,
            protocol: parsed.protocol
        };
    } catch (e) {
        return null;
    }
}

/**
 * Decrypt password using AES-256-GCM
 */
function decrypt(encryptedText: string, masterKeyString: string): string {
    if (!masterKeyString || masterKeyString.length < 32) {
        throw new Error('MASTER_ENCRYPTION_KEY must be at least 32 characters');
    }
    const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
    const algorithm = 'aes-256-gcm';

    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted text format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv(algorithm, masterKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

/**
 * Create database if it doesn't exist
 */
async function createDatabase(dbName: string) {
    const baseUrl = process.env.DATABASE_URL_MANAGEMENT || process.env.DATABASE_URL!;
    const config = parseUrl(baseUrl);

    if (!config) {
        console.error('❌ Could not parse connection string for database creation');
        return;
    }

    const maintenancePool = new Pool({
        user: config.username,
        password: config.password,
        host: config.host,
        port: parseInt(config.port),
        database: 'postgres',
    });

    try {
        const checkRes = await maintenancePool.query(
            `SELECT 1 FROM pg_database WHERE datname = $1`,
            [dbName]
        );

        if (checkRes.rowCount === 0) {
            console.log(`✨ Creating database '${dbName}'...`);
            await maintenancePool.query(`CREATE DATABASE "${dbName}"`);
            console.log(`   ✅ Database '${dbName}' created.`);
        }
    } catch (e: any) {
        console.warn(`   ⚠️  Error checking/creating database '${dbName}': ${e.message}`);
    } finally {
        await maintenancePool.end();
    }
}

/**
 * Terminate active connections to a specific database
 */
async function terminateConnections(dbName: string) {
    const baseUrl = process.env.DATABASE_URL_MANAGEMENT || process.env.DATABASE_URL!;
    const config = parseUrl(baseUrl);
    if (!config) return;

    const maintenancePool = new Pool({
        user: config.username,
        password: config.password,
        host: config.host,
        port: parseInt(config.port),
        database: 'postgres',
    });

    try {
        await maintenancePool.query(
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
            [dbName]
        );
    } catch (e: any) {
        console.warn(`   ⚠️  Warning terminating connections for '${dbName}': ${e.message}`);
    } finally {
        await maintenancePool.end();
    }
}

/**
 * Execute SQL or dump file against a specific database
 */
async function restoreDatabase(connectionString: string, filePath: string): Promise<void> {
    const config = parseUrl(connectionString);
    if (!config) {
        console.error(`❌ Invalid connection string for ${filePath}`);
        return;
    }

    console.log(`📦 Restoring ${basename(filePath)} to database '${config.database}'...`);

    // Terminate existing active connections to prevent table lock conflicts
    await terminateConnections(config.database);

    try {
        const fileBuffer = readFileSync(filePath);
        const isCustomFormat = fileBuffer.length > 4 &&
            fileBuffer[0] === 0x50 && fileBuffer[1] === 0x47 &&
            fileBuffer[2] === 0x44 && fileBuffer[3] === 0x4d;

        if (isCustomFormat) {
            // Reset public schema to cleanly wipe existing objects and avoid FK constraint conflicts
            const resetPool = new Pool({
                user: config.username,
                password: config.password,
                host: config.host,
                port: parseInt(config.port),
                database: config.database,
            });
            try {
                await resetPool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
                console.log('   🧹 Reset public schema to clean state.');
            } catch (e: any) {
                console.warn(`   ⚠️  Warning resetting schema: ${e.message}`);
            } finally {
                await resetPool.end();
            }

            console.log('   ↳ Restoring custom format dump with pg_restore...');
            const pgRestoreCmd = `pg_restore --no-owner --no-acl -h ${config.host} -p ${config.port} -U ${config.username} -d ${config.database} "${filePath}"`;
            try {
                execSync(pgRestoreCmd, {
                    env: { ...process.env, PGPASSWORD: config.password },
                    stdio: 'inherit',
                    shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
                });
            } catch (e: any) {
                // pg_restore returns 1 on non-fatal notices/warnings. Status > 1 indicates fatal error.
                if (e.status === 1) {
                    console.log('   ⚠️  pg_restore completed with non-fatal warnings (code 1).');
                } else {
                    throw e;
                }
            }
        } else {
            const { writeFileSync, unlinkSync } = require('fs');
            const bridgeFilePath = join(process.cwd(), `tmp_restore_${config.database}.sql`);
            const normalizedPath = filePath.replace(/\\/g, '/');

            // Build bridge: truncate all non-migration tables, then load data with FK checks disabled
            const truncateBlock = `
DO $$
DECLARE r RECORD;
BEGIN
  SET session_replication_role = 'replica';
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations') LOOP
    EXECUTE 'TRUNCATE TABLE "' || r.tablename || '" CASCADE';
  END LOOP;
  SET session_replication_role = 'origin';
END $$;
`;
            const bridgeContent = `${truncateBlock}\nSET session_replication_role = 'replica';\n\\i '${normalizedPath}'\nSET session_replication_role = 'origin';`;
            writeFileSync(bridgeFilePath, bridgeContent);

            try {
                console.log('   ↳ Truncating existing data and restoring from backup...');
                const psqlCmd = `psql -h ${config.host} -p ${config.port} -U ${config.username} -d ${config.database} -f "${bridgeFilePath}" -v ON_ERROR_STOP=0 --quiet`;
                try {
                    execSync(psqlCmd, {
                        env: { ...process.env, PGPASSWORD: config.password },
                        stdio: 'ignore',
                        shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
                    });
                } catch (e) {
                    // Non-zero exit is expected due to pre-existing schema constraints in the SQL file
                }
            } finally {
                if (existsSync(bridgeFilePath)) unlinkSync(bridgeFilePath);
            }
        }
        console.log('   ✅ Restored successfully.');
    } catch (error: any) {
        throw new Error(`Restoration failed: ${error.message}`);
    }
}

/**
 * Find matching backup file for a tenant (.dump, .sql, .tar, .bak)
 */
function findBackupFile(dbName: string, companyCode?: string, explicitFile?: string): string | null {
    // 0. If explicit file was provided, check it first
    if (explicitFile) {
        const resolved = join(process.cwd(), explicitFile);
        if (existsSync(resolved)) return resolved;
        if (existsSync(explicitFile)) return explicitFile;
    }

    const searchDirs = [
        join(process.cwd(), 'backup', 'tenant_backup_chunks'),
        join(process.cwd(), 'backup', 'companies'),
        join(process.cwd(), 'backup'),
    ];

    const validExts = ['.dump', '.sql', '.tar', '.bak'];

    for (const dir of searchDirs) {
        if (!existsSync(dir)) continue;
        const files = readdirSync(dir).filter(f => validExts.some(ext => f.endsWith(ext)));

        // 1. Exact match on dbName + extension
        const exactMatch = files.find(f => validExts.some(ext => f === `${dbName}${ext}`));
        if (exactMatch) return join(dir, exactMatch);

        // 2. Starts with or contains dbName
        const dbMatch = files.find(f => f.includes(dbName));
        if (dbMatch) return join(dir, dbMatch);

        // 3. Contains companyCode (e.g. 'spl')
        if (companyCode) {
            const codeMatch = files.find(f => f.toLowerCase().includes(companyCode.toLowerCase()));
            if (codeMatch) return join(dir, codeMatch);
        }
    }

    return null;
}

async function seedTenant(company: any, managementUrl: string, masterKey: string, explicitBackupFile?: string) {
    const dbName = company.dbName;
    console.log(`\n👉 Processing tenant: ${company.name} (${company.code}) [DB: ${dbName}]`);

    let connectionString = company.dbUrl;
    if (company.dbPassword) {
        try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
        } catch (e) {
            console.warn(`   ⚠️  Decryption failed for ${company.code}, using stored dbUrl...`);
        }
    }

    if (!connectionString) {
        console.error(`   ❌ No connection details for ${dbName}`);
        return;
    }

    try {
        // 1. Create DB if missing
        await createDatabase(dbName);

        // 2. Automated Backup Restoration
        const backupPath = findBackupFile(dbName, company.code, explicitBackupFile);
        if (backupPath) {
            await restoreDatabase(connectionString, backupPath);
        } else {
            console.log('   ℹ️  No matching backup file found in backup/ directories, skipping restoration.');
        }

        // 3. Push Schema (ensure schema matches latest Prisma schema definitions after restore)
        console.log('   🛠️  Syncing schema with prisma db push...');
        execSync('bunx prisma db push --schema prisma/schema --accept-data-loss', {
            env: { ...process.env, DATABASE_URL: connectionString },
            stdio: 'ignore',
            shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
        });
        console.log('   ✅ Schema synced.');

        // 4. Run Chart of Accounts Seeding
        console.log('   📊 Seeding Chart of Accounts...');
        execSync(`bun ./scripts/chart-of-account.ts --tenant ${dbName}`, {
            stdio: 'ignore',
            shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
        });
        console.log('   ✅ Chart of accounts seeded.');

        console.log(`✨ Tenant '${dbName}' seeded successfully.`);
    } catch (err: any) {
        console.error(`❌ Failed to seed ${dbName}: ${err.message}`);
        throw err;
    }
}

async function main() {
    console.log('🚀 Starting Automated Tenant Seeding Flow...');

    const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
    const masterKey = process.env.MASTER_ENCRYPTION_KEY;

    if (!managementUrl || !masterKey) {
        console.error('❌ DATABASE_URL_MANAGEMENT or MASTER_ENCRYPTION_KEY not found in .env');
        process.exit(1);
    }

    // CLI args parsing
    const args = process.argv.slice(2);
    let targetTenant: string | null = null;
    let explicitFile: string | null = null;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--tenant' || arg === '-t') {
            targetTenant = args[++i];
        } else if (arg.startsWith('--tenant=')) {
            targetTenant = arg.split('=')[1];
        } else if (arg === '--file' || arg === '-f') {
            explicitFile = args[++i];
        } else if (arg.startsWith('--file=')) {
            explicitFile = arg.split('=')[1];
        } else if (!arg.startsWith('-') && !explicitFile && !targetTenant) {
            // Positional arg could be a file path or a tenant code/dbName
            if (arg.endsWith('.dump') || arg.endsWith('.sql') || arg.endsWith('.tar') || arg.endsWith('.bak')) {
                explicitFile = arg;
            } else {
                targetTenant = arg;
            }
        }
    }

    const pool = new Pool({ connectionString: managementUrl });
    const adapter = new PrismaPg(pool);
    const management = new ManagementClient({ adapter } as any);

    try {
        let companies = await management.company.findMany({
            where: { status: 'active' }
        });

        if (companies.length === 0) {
            console.log('ℹ️ No active companies found in Master DB.');
            return;
        }

        // Filter by targetTenant if specified
        if (targetTenant) {
            const filtered = companies.filter(c =>
                c.code.toLowerCase() === targetTenant!.toLowerCase() ||
                c.dbName.toLowerCase() === targetTenant!.toLowerCase()
            );
            if (filtered.length === 0) {
                console.error(`❌ Tenant '${targetTenant}' not found in active companies.`);
                console.log('Available companies:', companies.map(c => `${c.code} (${c.dbName})`).join(', '));
                process.exit(1);
            }
            companies = filtered;
        } else if (explicitFile) {
            // Infer tenant from explicit file name if not explicitly specified
            const fileName = basename(explicitFile);
            const matched = companies.find(c =>
                fileName.includes(c.dbName) || fileName.toLowerCase().includes(c.code.toLowerCase())
            );
            if (matched) {
                console.log(`🎯 Inferred tenant '${matched.code}' (${matched.dbName}) from file: ${fileName}`);
                companies = [matched];
            }
        }

        console.log(`📡 Found ${companies.length} active company to process. Proceeding...`);

        const results = { success: 0, failed: 0 };
        for (const company of companies) {
            try {
                await seedTenant(company, managementUrl, masterKey, explicitFile || undefined);
                results.success++;
            } catch (err) {
                results.failed++;
            }
        }

        console.log('\n--- Seeding Summary ---');
        console.log(`✅ Success: ${results.success}`);
        console.log(`❌ Failed:  ${results.failed}`);

        if (results.failed > 0) {
            process.exit(1);
        } else {
            process.exit(0);
        }
    } catch (error: any) {
        console.error(`\n❌ Error during automated seeding process: ${error.message}`);
        process.exit(1);
    } finally {
        try {
            await management.$disconnect();
            await pool.end();
        } catch (_) {}
    }
}

main().catch(() => process.exit(1));
