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
async function main() {
    console.log('--- Tenant Prisma Studio Launcher ---');
    const args = process.argv.slice(2);
    let targetTenant = null;
    let fallbackPort = 5555;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--tenant' && i + 1 < args.length) {
            targetTenant = args[i + 1];
            i++;
        }
        else if (args[i] === '--port' && i + 1 < args.length) {
            fallbackPort = parseInt(args[i + 1], 10) || 5555;
            i++;
        }
    }
    const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
    if (!managementUrl) {
        console.error('❌ DATABASE_URL_MANAGEMENT environment variable is required.');
        process.exit(1);
    }
    const masterKey = process.env.MASTER_ENCRYPTION_KEY;
    if (!masterKey) {
        console.error('❌ MASTER_ENCRYPTION_KEY environment variable is required for decrypting tenant credentials.');
        process.exit(1);
    }
    const pool = new pg_1.Pool({ connectionString: managementUrl });
    const adapter = new adapter_pg_1.PrismaPg(pool);
    const mClient = new management_client_1.PrismaClient({ adapter });
    try {
        console.log('🔍 Connecting to Management Database...');
        await mClient.$connect();
        let company;
        if (targetTenant) {
            company = await mClient.company.findFirst({
                where: {
                    dbName: targetTenant,
                    status: "active"
                }
            });
            if (!company) {
                console.error(`❌ Tenant '${targetTenant}' not found or is inactive.`);
                process.exit(1);
            }
        }
        else {
            company = await mClient.company.findFirst({
                where: {
                    status: "active"
                }
            });
            if (!company) {
                console.error(`❌ No active tenants found in the management database.`);
                process.exit(1);
            }
            console.log(`ℹ️  No --tenant provided. Auto-selecting first active tenant: ${company.name} (${company.dbName})`);
        }
        let connectionString = company.dbUrl;
        if (company.dbPassword) {
            try {
                const decPassword = decrypt(company.dbPassword, masterKey);
                const encUser = encodeURIComponent(company.dbUser || '');
                const encPassword = encodeURIComponent(decPassword);
                connectionString = `postgresql://${encUser}:${encPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
            }
            catch (e) {
                console.error(`❌ Failed to decrypt password for ${company.name}`);
                process.exit(1);
            }
        }
        if (!connectionString) {
            console.error(`❌ No valid connection string constructed for ${company.name}`);
            process.exit(1);
        }
        console.log(`✅ Tenant '${company.name}' found. Launching Prisma Studio on port ${fallbackPort}...`);
        const studioCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        const studioArgs = ['prisma', 'studio', '--port', fallbackPort.toString()];
        const child = (0, child_process_1.spawn)(studioCommand, studioArgs, {
            env: {
                ...process.env,
                DATABASE_URL: connectionString
            },
            stdio: 'inherit',
            shell: process.platform === 'win32'
        });
        child.on('error', (err) => {
            console.error(`❌ Failed to start Prisma Studio: ${err.message}`);
        });
        child.on('exit', (code) => {
            if (code !== 0) {
                console.log(`⚠️ Prisma Studio exited with code ${code}`);
            }
            else {
                console.log('Goodbye! 👋');
            }
        });
    }
    catch (error) {
        console.error(`\n❌ Error: ${error.message}`);
    }
    finally {
        await mClient.$disconnect();
        await pool.end();
    }
}
main().catch((e) => {
    console.error('Unhandled error:', e);
    process.exit(1);
});
//# sourceMappingURL=studio-tenant.js.map