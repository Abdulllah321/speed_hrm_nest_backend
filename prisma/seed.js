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
const client_1 = require("@prisma/client");
const crypto = __importStar(require("crypto"));
const adapter_pg_1 = require("@prisma/adapter-pg");
const pg_1 = require("pg");
const fs_1 = require("fs");
const path_1 = require("path");
const child_process_1 = require("child_process");
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
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
            console.log('   ↳ Detected pg_dump custom format, using pg_restore...');
            const pgRestoreCmd = `pg_restore --no-owner --no-acl --clean --if-exists -h ${config.host} -p ${config.port} -U ${config.username} -d ${config.database} "${filePath}"`;
            try {
                (0, child_process_1.execSync)(pgRestoreCmd, {
                    env: { ...process.env, PGPASSWORD: config.password },
                    stdio: 'inherit',
                    shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
                });
                console.log('   ✅ Restored successfully.');
            }
            catch (error) {
                console.warn('   ⚠️  pg_restore encountered errors (check output above).');
            }
        }
        else {
            console.log('   ↳ Executing plain SQL file...');
            const tempPool = new pg_1.Pool({ connectionString });
            const client = await tempPool.connect();
            try {
                const sqlContent = (0, fs_1.readFileSync)(filePath, 'utf-8');
                await client.query(sqlContent);
                console.log('   ✅ SQL executed successfully.');
            }
            catch (err) {
                console.error(`   ❌ SQL Execution failed: ${err.message}`);
            }
            finally {
                client.release();
                await tempPool.end();
            }
        }
    }
    catch (error) {
        console.error(`   ❌ Restoration failed: ${error.message}`);
    }
}
async function createDatabase(dbName) {
    const baseUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_MANAGEMENT;
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
        else {
        }
    }
    catch (e) {
        console.warn(`   ⚠️  Error checking/creating database '${dbName}': ${e.message}`);
    }
    finally {
        await maintenancePool.end();
    }
}
async function pushTenantSchema(connectionString) {
    try {
        console.log('   ↳ Pushing schema to tenant database...');
        const env = { ...process.env, DATABASE_URL: connectionString };
        (0, child_process_1.execSync)('bunx prisma db push --schema prisma/schema --accept-data-loss --config prisma.config.ts', {
            env,
            stdio: 'ignore'
        });
        console.log('   ✅ Schema pushed successfully.');
    }
    catch (e) {
        console.error(`   ❌ Schema push failed: ${e.message}`);
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
        throw new Error('Invalid encrypted text format: ' + encryptedText);
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
async function main() {
    console.log('🌱 Seeding database...');
    console.log('');
    const possibleBackupDirs = [
        (0, path_1.join)(process.cwd(), 'backup'),
        (0, path_1.join)(process.cwd(), '..', 'backup'),
    ];
    const backupDir = possibleBackupDirs.find(d => (0, fs_1.existsSync)(d) && (0, fs_1.statSync)(d).isDirectory());
    console.log('RUN_BACKUP_RESTORE =', process.env.RUN_BACKUP_RESTORE);
    if (String(process.env.RUN_BACKUP_RESTORE).toLowerCase() === 'true') {
        if (backupDir) {
            console.log(`📂 Found multi-tenant backup directory: ${backupDir}`);
            const rolesFile = (0, path_1.join)(backupDir, 'roles', 'company_roles.sql');
            if ((0, fs_1.existsSync)(rolesFile)) {
                console.log('👤 Restoring global roles...');
                await restoreDatabase(process.env.DATABASE_URL_MANAGEMENT || process.env.DATABASE_URL, rolesFile);
            }
            const masterFile = (0, path_1.join)(backupDir, 'master', 'master_data.sql');
            if ((0, fs_1.existsSync)(masterFile)) {
                console.log('🏢 Restoring Master Database...');
                if (!process.env.DATABASE_URL_MANAGEMENT) {
                    console.error('❌ DATABASE_URL_MANAGEMENT is not defined in .env');
                }
                else {
                    await restoreDatabase(process.env.DATABASE_URL_MANAGEMENT, masterFile);
                }
            }
        }
        else {
            console.log('⚠️  Multi-tenant backup dir not found. Searching for legacy backup.sql...');
            const possibleFiles = [
                (0, path_1.join)(process.cwd(), 'backup.sql'),
                (0, path_1.join)(process.cwd(), '..', 'backup.sql'),
            ];
            const legacyFile = possibleFiles.find(f => (0, fs_1.existsSync)(f));
            if (legacyFile) {
                await restoreDatabase(process.env.DATABASE_URL, legacyFile);
            }
            else {
                console.log('ℹ️  No backup files found. Skipping restore.');
            }
        }
    }
    else {
        console.log('no data restored from backup');
    }
    console.log('');
    console.log('✅ Database seeding finished.');
}
main()
    .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
});
//# sourceMappingURL=seed.js.map