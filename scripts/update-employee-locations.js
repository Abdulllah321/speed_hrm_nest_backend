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
const management_client_1 = require("@prisma/management-client");
const crypto = __importStar(require("crypto"));
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const XLSX = __importStar(require("xlsx"));
const path = __importStar(require("path"));
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
async function updateEmployeeLocations(prisma) {
    const filePath = path.join(__dirname, '..', 'Employee List location.xlsx');
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames.find(name => name.toLowerCase().includes('sheet2')) || workbook.SheetNames[0];
    console.log(`📖 Reading sheet: "${sheetName}"`);
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
        console.error(`❌ Sheet "${sheetName}" not found in Excel file!`);
        return;
    }
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    console.log(`📊 Found ${rows.length} rows in the excel sheet.`);
    let updatedCount = 0;
    let employeeNotFound = 0;
    let locationNotFound = 0;
    let skippedRows = 0;
    for (let i = 3; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0)
            continue;
        const employeeName = row[0]?.toString().trim();
        const employeeCode = row[1]?.toString().trim();
        const locationName = row[2]?.toString().trim();
        const subCode = row[3]?.toString().trim();
        if (!employeeCode && !subCode) {
            continue;
        }
        if (!employeeCode || !subCode) {
            console.warn(`⚠️ Row ${i + 1}: Missing employee code ("${employeeCode}") or location sub code ("${subCode}") for "${employeeName || 'Unknown'}". Skipping.`);
            skippedRows++;
            continue;
        }
        const location = await prisma.location.findFirst({
            where: { code: subCode, isDeleted: false }
        });
        if (!location) {
            console.warn(`⚠️ Row ${i + 1}: Location code "${subCode}" ("${locationName}") not found in database for employee "${employeeName}" (${employeeCode})`);
            locationNotFound++;
            continue;
        }
        const employee = await prisma.employee.findUnique({
            where: { employeeId: employeeCode }
        });
        if (!employee) {
            console.warn(`⚠️ Row ${i + 1}: Employee "${employeeName}" with code "${employeeCode}" not found in database`);
            employeeNotFound++;
            continue;
        }
        await prisma.employee.update({
            where: { id: employee.id },
            data: { locationId: location.id }
        });
        console.log(`✅ Row ${i + 1}: Updated location for "${employee.employeeName}" (${employeeCode}) to "${location.name}" (${subCode})`);
        updatedCount++;
    }
    console.log(`\n🎉 Tenant Location Update Summary:`);
    console.log(`   - Total Updated: ${updatedCount}`);
    console.log(`   - Employee Not Found: ${employeeNotFound}`);
    console.log(`   - Location Not Found: ${locationNotFound}`);
    console.log(`   - Skipped Rows (incomplete info): ${skippedRows}`);
}
async function main() {
    console.log('🚀 Starting Employee Location Update Script...');
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
            where: { status: 'active' },
        });
        if (companies.length === 0) {
            console.log('ℹ️ No active companies found in Master DB.');
            return;
        }
        console.log(`📡 Found ${companies.length} active companies.`);
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
                const tenantPool = new pg_1.Pool({ connectionString });
                const tenantAdapter = new adapter_pg_1.PrismaPg(tenantPool);
                const tenantPrisma = new client_1.PrismaClient({ adapter: tenantAdapter });
                try {
                    await tenantPrisma.$connect();
                    await updateEmployeeLocations(tenantPrisma);
                    console.log(`   ✅ Tenant ${company.code} update completed successfully.`);
                }
                finally {
                    await tenantPrisma.$disconnect();
                    await tenantPool.end();
                }
            }
            catch (err) {
                console.error(`   ❌ Failed to update employee locations for ${company.code}: ${err.message}`);
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
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
//# sourceMappingURL=update-employee-locations.js.map