"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const management_client_1 = require("@prisma/management-client");
const child_process_1 = require("child_process");
const crypto = __importStar(require("crypto"));
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const fs_1 = require("fs");
const path_1 = require("path");
function parseUrl(url) {
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
    }
    catch (e) {
        return null;
    }
}
function decrypt(encryptedText, masterKeyString) {
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
async function createDatabase(dbName) {
    const baseUrl = process.env.DATABASE_URL_MANAGEMENT || process.env.DATABASE_URL;
    const config = parseUrl(baseUrl);
    if (!config) {
        console.error('❌ Could not parse connection string for database creation');
        return;
    }
    const maintenancePool = new pg_1.Pool({
        user: config.username,
        password: config.password,
        host: config.host,
        port: parseInt(config.port),
        database: 'postgres',
    });
    try {
        const checkRes = await maintenancePool.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
        if (checkRes.rowCount === 0) {
            console.log(`✨ Creating database '${dbName}'...`);
            await maintenancePool.query(`CREATE DATABASE "${dbName}"`);
            console.log(`   ✅ Database '${dbName}' created.`);
        }
    }
    catch (e) {
        console.warn(`   ⚠️  Error checking/creating database '${dbName}': ${e.message}`);
    }
    finally {
        await maintenancePool.end();
    }
}
async function restoreDatabase(connectionString, filePath) {
    const config = parseUrl(connectionString);
    if (!config) {
        console.error(`❌ Invalid connection string for ${filePath}`);
        return;
    }
    console.log(`📦 Restoring ${(0, path_1.basename)(filePath)} to database '${config.database}'...`);
    try {
        const fileBuffer = (0, fs_1.readFileSync)(filePath);
        const isCustomFormat = fileBuffer.length > 4 &&
            fileBuffer[0] === 0x50 && fileBuffer[1] === 0x47 &&
            fileBuffer[2] === 0x44 && fileBuffer[3] === 0x4d;
        if (isCustomFormat) {
            const pgRestoreCmd = `pg_restore --no-owner --no-acl --clean --if-exists -h ${config.host} -p ${config.port} -U ${config.username} -d ${config.database} "${filePath}"`;
            (0, child_process_1.execSync)(pgRestoreCmd, {
                env: { ...process.env, PGPASSWORD: config.password },
                stdio: 'inherit',
                shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
            });
        }
        else {
            const { writeFileSync, unlinkSync } = require('fs');
            const bridgeFilePath = (0, path_1.join)(process.cwd(), `tmp_restore_${config.database}.sql`);
            const normalizedPath = filePath.replace(/\\/g, '/');
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
                    (0, child_process_1.execSync)(psqlCmd, {
                        env: { ...process.env, PGPASSWORD: config.password },
                        stdio: 'ignore',
                        shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
                    });
                }
                catch (e) {
                }
            }
            finally {
                if ((0, fs_1.existsSync)(bridgeFilePath))
                    unlinkSync(bridgeFilePath);
            }
        }
        console.log('   ✅ Restored successfully.');
    }
    catch (error) {
        throw new Error(`Restoration failed: ${error.message}`);
    }
}
function findBackupFile(dbName) {
    const companiesDir = (0, path_1.join)(process.cwd(), 'backup', 'companies');
    if (!(0, fs_1.existsSync)(companiesDir))
        return null;
    const files = (0, fs_1.readdirSync)(companiesDir).filter(f => f.endsWith('.sql'));
    const exactMatch = files.find(f => f === `${dbName}.sql`);
    if (exactMatch)
        return (0, path_1.join)(companiesDir, exactMatch);
    const partialMatch = files.find(f => f.includes(dbName));
    if (partialMatch)
        return (0, path_1.join)(companiesDir, partialMatch);
    if (files.length > 0)
        return (0, path_1.join)(companiesDir, files[0]);
    return null;
}
async function seedTenant(company, managementUrl, masterKey) {
    const dbName = company.dbName;
    console.log(`\n👉 Processing tenant: ${company.name} (${company.code}) [DB: ${dbName}]`);
    let connectionString = company.dbUrl;
    if (company.dbPassword) {
        try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
        }
        catch (e) {
            console.warn(`   ⚠️  Decryption failed for ${company.code}, using stored dbUrl...`);
        }
    }
    if (!connectionString) {
        console.error(`   ❌ No connection details for ${dbName}`);
        return;
    }
    try {
        await createDatabase(dbName);
        console.log('   🛠️  Pushing schema...');
        (0, child_process_1.execSync)('bunx prisma db push --schema prisma/schema --accept-data-loss', {
            env: { ...process.env, DATABASE_URL: connectionString },
            stdio: 'ignore',
            shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
        });
        console.log('   ✅ Schema pushed.');
        const sqlPath = findBackupFile(dbName);
        if (sqlPath) {
            await restoreDatabase(connectionString, sqlPath);
        }
        else {
            console.log('   ℹ️  No matching SQL backup found in backup/companies/, skipping restoration.');
        }
        console.log('   📊 Seeding Chart of Accounts...');
        (0, child_process_1.execSync)(`bun ./scripts/chart-of-account.ts --tenant ${dbName}`, {
            stdio: 'ignore',
            shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
        });
        console.log('   ✅ Chart of accounts seeded.');
        console.log(`✨ Tenant '${dbName}' seeded successfully.`);
    }
    catch (err) {
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
    const pool = new pg_1.Pool({ connectionString: managementUrl });
    const adapter = new adapter_pg_1.PrismaPg(pool);
    const management = new management_client_1.PrismaClient({ adapter });
    try {
        const companies = await management.company.findMany({
            where: { status: 'active' }
        });
        if (companies.length === 0) {
            console.log('ℹ️ No active companies found in Master DB.');
            return;
        }
        console.log(`📡 Found ${companies.length} active companies. Proceeding with implementation...`);
        const results = { success: 0, failed: 0 };
        for (const company of companies) {
            try {
                await seedTenant(company, managementUrl, masterKey);
                results.success++;
            }
            catch (err) {
                results.failed++;
            }
        }
        console.log('\n--- Seeding Summary ---');
        console.log(`✅ Success: ${results.success}`);
        console.log(`❌ Failed:  ${results.failed}`);
        if (results.failed > 0) {
            process.exit(1);
        }
    }
    catch (error) {
        console.error(`\n❌ Error during automated seeding process: ${error.message}`);
        process.exit(1);
    }
    finally {
        await management.$disconnect();
        await pool.end();
    }
}
main();
//# sourceMappingURL=seed-tenant.js.map