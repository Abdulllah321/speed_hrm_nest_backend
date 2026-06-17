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
exports.leavesPoliciesSeed = exports.leaveTypesSeed = void 0;
require("dotenv/config");
const client_1 = require("@prisma/client");
const management_client_1 = require("@prisma/management-client");
const crypto = __importStar(require("crypto"));
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
exports.leaveTypesSeed = [
    'Annual Leave',
    'Sick Leave',
    'Casual Leave',
    'Emergency Leave',
    'Maternity Leave',
    'Paternity Leave',
    'Compensatory Leave',
    'Unpaid Leave',
    'Half Day Leave',
    'Short Leave',
    'Privilege Leave',
];
exports.leavesPoliciesSeed = [
    {
        name: 'Standard Leave Policy',
        details: 'Standard leave policy for all employees',
        fullDayDeductionRate: 1.0,
        halfDayDeductionRate: 0.5,
        shortLeaveDeductionRate: 0.25,
        isDefault: true,
        leaveTypes: [
            { name: 'Annual Leave', numberOfLeaves: 14 },
            { name: 'Sick Leave', numberOfLeaves: 10 },
            { name: 'Casual Leave', numberOfLeaves: 5 },
            { name: 'Emergency Leave', numberOfLeaves: 3 },
        ],
    },
    {
        name: 'Executive Leave Policy',
        details: 'Enhanced leave policy for executives',
        fullDayDeductionRate: 1.0,
        halfDayDeductionRate: 0.5,
        shortLeaveDeductionRate: 0.25,
        isDefault: false,
        leaveTypes: [
            { name: 'Annual Leave', numberOfLeaves: 20 },
            { name: 'Sick Leave', numberOfLeaves: 15 },
            { name: 'Casual Leave', numberOfLeaves: 7 },
            { name: 'Emergency Leave', numberOfLeaves: 5 },
            { name: 'Compensatory Leave', numberOfLeaves: 5 },
        ],
    },
    {
        name: 'Probation Leave Policy',
        details: 'Limited leave policy for probationary employees',
        fullDayDeductionRate: 1.0,
        halfDayDeductionRate: 0.5,
        shortLeaveDeductionRate: 0.25,
        isDefault: false,
        leaveTypes: [
            { name: 'Sick Leave', numberOfLeaves: 5 },
            { name: 'Emergency Leave', numberOfLeaves: 2 },
        ],
    },
    {
        id: '9d080e70-d566-4d16-a819-5396a1ca1f5a',
        name: 'Speed Sport Leave Policy',
        details: 'Leave policy with casual, sick, and privilege leaves',
        fullDayDeductionRate: 1.0,
        halfDayDeductionRate: 0.5,
        shortLeaveDeductionRate: 0.25,
        isDefault: false,
        leaveTypes: [
            { name: 'Casual Leave', numberOfLeaves: 5 },
            { name: 'Sick Leave', numberOfLeaves: 10 },
            { name: 'Privilege Leave', numberOfLeaves: 15 },
        ],
    },
];
function decrypt(encryptedText, masterKeyString) {
    if (!masterKeyString || masterKeyString.length < 32) {
        throw new Error('MASTER_ENCRYPTION_KEY must be at least 32 characters');
    }
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
async function seedLeaveTypes(prisma, createdById) {
    console.log('   📋 Seeding leave types...');
    let created = 0;
    let skipped = 0;
    const leaveTypeMap = new Map();
    for (const name of exports.leaveTypesSeed) {
        try {
            const existing = await prisma.leaveType.findFirst({ where: { name } });
            if (existing) {
                skipped++;
                leaveTypeMap.set(name, existing.id);
                continue;
            }
            const leaveType = await prisma.leaveType.create({
                data: { name, status: 'active', createdById },
            });
            leaveTypeMap.set(name, leaveType.id);
            created++;
        }
        catch (error) {
            console.error(`   Error seeding leave type "${name}":`, error.message);
        }
    }
    console.log(`   ✓ Leave Types: ${created} created, ${skipped} skipped`);
    return leaveTypeMap;
}
async function seedLeavesPolicies(prisma, createdById) {
    console.log('   📜 Seeding leaves policies...');
    const leaveTypeMap = await seedLeaveTypes(prisma, createdById);
    let created = 0;
    let skipped = 0;
    for (const policy of exports.leavesPoliciesSeed) {
        try {
            const existing = await prisma.leavesPolicy.findFirst({
                where: { name: policy.name },
            });
            if (existing) {
                skipped++;
                continue;
            }
            const leavesPolicy = await prisma.leavesPolicy.create({
                data: {
                    ...(policy.id ? { id: policy.id } : {}),
                    name: policy.name,
                    details: policy.details,
                    fullDayDeductionRate: policy.fullDayDeductionRate,
                    halfDayDeductionRate: policy.halfDayDeductionRate,
                    shortLeaveDeductionRate: policy.shortLeaveDeductionRate,
                    status: 'active',
                    isDefault: policy.isDefault,
                    createdById,
                },
            });
            for (const lt of policy.leaveTypes) {
                const leaveTypeId = leaveTypeMap.get(lt.name);
                if (leaveTypeId) {
                    await prisma.leavesPolicyLeaveType.create({
                        data: {
                            leavesPolicyId: leavesPolicy.id,
                            leaveTypeId,
                            numberOfLeaves: lt.numberOfLeaves,
                        },
                    });
                }
            }
            created++;
        }
        catch (error) {
            console.error(`   Error seeding leaves policy "${policy.name}":`, error.message);
        }
    }
    console.log(`   ✓ Leaves Policies: ${created} created, ${skipped} skipped`);
}
async function main() {
    console.log('🚀 Starting Multi-Tenant Leave Types & Policies Seeding...');
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
        const tenantArgIdx = process.argv.indexOf('--tenant');
        const specificTenant = tenantArgIdx !== -1 ? process.argv[tenantArgIdx + 1] : null;
        const companies = await management.company.findMany({
            where: {
                status: 'active',
                ...(specificTenant ? { dbName: specificTenant } : {}),
            },
        });
        if (companies.length === 0) {
            console.log(specificTenant
                ? `ℹ️  No active company found with database name: ${specificTenant}`
                : 'ℹ️  No active companies found in Master DB.');
            return;
        }
        console.log(specificTenant
            ? `📡 Targeting tenant: ${specificTenant}. Seeding leave data...`
            : `📡 Found ${companies.length} active companies. Seeding leave data...`);
        for (const company of companies) {
            console.log(`\n👉 Processing tenant: ${company.name} (${company.code})`);
            try {
                let connectionString = company.dbUrl;
                if (company.dbPassword) {
                    try {
                        const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
                        connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
                    }
                    catch {
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
                    const createdById = 'system';
                    await seedLeavesPolicies(tenantPrisma, createdById);
                    console.log(`   ✅ Success!`);
                }
                finally {
                    await tenantPrisma.$disconnect();
                    await tenantPool.end();
                }
            }
            catch (err) {
                console.error(`   ❌ Failed to seed ${company.code}: ${err.message}`);
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
//# sourceMappingURL=seed-leaves.js.map