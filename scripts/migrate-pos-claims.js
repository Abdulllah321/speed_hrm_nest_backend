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
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function decrypt(encryptedText, masterKeyString) {
    const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
    const parts = encryptedText.split(':');
    if (parts.length !== 3)
        throw new Error('Invalid encrypted text format');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(parts[2], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
const sql = fs.readFileSync(path.join(__dirname, 'create-pos-claims-tables.sql'), 'utf-8');
async function runMigration(connectionString, name) {
    const pool = new pg_1.Pool({ connectionString });
    try {
        await pool.query(sql);
        console.log(`  ✅ ${name}: pos_claims tables created/verified`);
    }
    catch (err) {
        console.error(`  ❌ ${name}: ${err.message}`);
    }
    finally {
        await pool.end();
    }
}
async function main() {
    const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
    const masterKey = process.env.MASTER_ENCRYPTION_KEY;
    if (!managementUrl || !masterKey) {
        console.error('❌ DATABASE_URL_MANAGEMENT and MASTER_ENCRYPTION_KEY required');
        process.exit(1);
    }
    const pool = new pg_1.Pool({ connectionString: managementUrl });
    const adapter = new adapter_pg_1.PrismaPg(pool);
    const management = new management_client_1.PrismaClient({ adapter });
    try {
        const tenantArg = process.argv.indexOf('--tenant');
        const specificTenant = tenantArg !== -1 ? process.argv[tenantArg + 1] : null;
        const companies = await management.company.findMany({
            where: { status: 'active', ...(specificTenant ? { dbName: specificTenant } : {}) },
        });
        console.log(`🚀 Running pos-claims migration on ${companies.length} tenant(s)...`);
        for (const company of companies) {
            console.log(`\n👉 ${company.name} (${company.code})`);
            try {
                let connectionString = company.dbUrl;
                if (company.dbPassword) {
                    const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
                    connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
                }
                if (!connectionString) {
                    console.error('  ❌ No connection details');
                    continue;
                }
                await runMigration(connectionString, company.name);
            }
            catch (err) {
                console.error(`  ❌ Failed: ${err.message}`);
            }
        }
        console.log('\n✨ Done.');
    }
    finally {
        await management.$disconnect();
        await pool.end();
    }
}
main().catch(e => { console.error(e); process.exit(1); });
//# sourceMappingURL=migrate-pos-claims.js.map