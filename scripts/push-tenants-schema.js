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
async function pushToAllTenants() {
    console.log('🚀 Starting Multi-Tenant Schema Push...');
    const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
    const masterKey = process.env.MASTER_ENCRYPTION_KEY;
    if (!managementUrl) {
        console.error('❌ DATABASE_URL_MANAGEMENT not found in .env');
        process.exit(1);
    }
    if (!masterKey) {
        console.error('❌ MASTER_ENCRYPTION_KEY not found in .env');
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
        console.log(`📡 Found ${companies.length} active companies. Syncing schemas...`);
        for (const company of companies) {
            console.log(`\n👉 Processing tenant: ${company.name} (${company.code})`);
            try {
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
                    console.error(`   ❌ No connection details for ${company.code}`);
                    continue;
                }
                console.log(`   🛠️  Running prisma db push on database: ${company.dbName}`);
                const env = { ...process.env, DATABASE_URL: connectionString };
                (0, child_process_1.execSync)('bunx prisma db push --schema prisma/schema --accept-data-loss', {
                    env,
                    stdio: 'inherit',
                    shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
                });
                console.log(`   ✅ Success!`);
            }
            catch (err) {
                console.error(`   ❌ Failed to sync ${company.code}: ${err.message}`);
            }
        }
        console.log('\n✨ All tenants processed.');
    }
    catch (error) {
        console.error(`\n❌ Error querying Master DB: ${error.message}`);
    }
    finally {
        await management.$disconnect();
        await pool.end();
    }
}
pushToAllTenants();
//# sourceMappingURL=push-tenants-schema.js.map