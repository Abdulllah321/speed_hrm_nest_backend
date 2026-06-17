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
exports.liabilitiesOpeningBalances = exports.equityOpeningBalances = void 0;
require("dotenv/config");
const client_1 = require("@prisma/client");
const management_client_1 = require("@prisma/management-client");
const crypto = __importStar(require("crypto"));
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
exports.equityOpeningBalances = [
    { code: '10010001', name: 'AUTHORIZED CAPITAL', type: 'CREDIT', amount: 73_370_900 },
    { code: '10010002', name: 'SHARE PREMIUM', type: 'CREDIT', amount: 289_740_785 },
    { code: '10020001', name: 'UN APPROPRIATED PROFIT/(LOSS)', type: 'CREDIT', amount: 2_269_521_093 },
    { code: '10020002', name: 'DIVIDEND', type: 'DEBIT', amount: 961_134_738 },
    { code: '10030001', name: 'CAPITAL RESERVES', type: 'CREDIT', amount: 0 },
    { code: '10030002', name: 'REVENUE RESERVES', type: 'CREDIT', amount: 0 },
    { code: '10030003', name: 'ADVANCE AGAINST EQUITY', type: 'CREDIT', amount: 0 },
    { code: '10040001', name: 'LOAN FROM DIRECTORS', type: 'CREDIT', amount: 0 },
];
exports.liabilitiesOpeningBalances = [
    { code: '11010001', name: 'LT LOAN-SECURED', type: 'CREDIT', amount: 0 },
    { code: '11010002', name: 'DEFERRED GRANT', type: 'CREDIT', amount: 0 },
    { code: '11020001', name: 'LT LOAN-UN SECURED', type: 'CREDIT', amount: 0 },
    { code: '11030001', name: 'LONG TERM DEPOSITS P/A-SPORTS BRANDS', type: 'CREDIT', amount: 500_000 },
    { code: '11030002', name: 'LONG TERM DEPOSITS P/A-WATCHES', type: 'CREDIT', amount: 100_000 },
    { code: '11030003', name: 'LONG TERM DEPOSITS P/A-OTHERS', type: 'CREDIT', amount: 0 },
    { code: '11040001', name: 'LEASE LIABILITY', type: 'CREDIT', amount: 977_552_017 },
    { code: '11050001', name: 'DEFERRED COST', type: 'CREDIT', amount: 0 },
    { code: '12010001', name: 'BILLS PAYABLE-IMPORTS SPORTS BRANDS', type: 'CREDIT', amount: 0 },
    { code: '12010002', name: 'BILLS PAYABLE-IMPORTS FASHION BRANDS', type: 'CREDIT', amount: 0 },
    { code: '12010003', name: 'BILLS PAYABLE-IMPORTS WATCH BRNDS', type: 'CREDIT', amount: 0 },
    { code: '12010004', name: 'BILLS PAYABLE-LOCAL', type: 'CREDIT', amount: 134_434_228 },
    { code: '12020001', name: 'ADVANCE FROM CUSTOMERS', type: 'CREDIT', amount: 1_752_000 },
    { code: '12030001', name: 'A/P PARTIES', type: 'CREDIT', amount: 15_288_165 },
    { code: '12030002', name: 'A/P EMPLOYEES', type: 'CREDIT', amount: 5_062_274 },
    { code: '12030003', name: 'A/P SALARIES', type: 'CREDIT', amount: 60_906 },
    { code: '12030004', name: 'A/P PROVIDENT FUND', type: 'CREDIT', amount: 553_490 },
    { code: '12030005', name: 'A/P EOBI', type: 'CREDIT', amount: 0 },
    { code: '12030006', name: 'A/P SESSI/PESSI/IESSI', type: 'CREDIT', amount: 0 },
    { code: '12030007', name: 'A/P SALARIES-FINAL SETTLEMENT', type: 'CREDIT', amount: 0 },
    { code: '12030008', name: 'A/P P.O.-NIKE', type: 'CREDIT', amount: 8_993_317 },
    { code: '12030009', name: 'A/P P.O.-ADIDAS', type: 'CREDIT', amount: 0 },
    { code: '12030010', name: 'A/P P.O.-PUMA', type: 'CREDIT', amount: 0 },
    { code: '12030011', name: 'A/P P.O.-SPEED SPORTS', type: 'CREDIT', amount: 0 },
    { code: '12030012', name: 'A/P P.O.-CHARLES & KEITH', type: 'CREDIT', amount: 633_694 },
    { code: '12030013', name: 'A/P P.O.-PEDRO', type: 'CREDIT', amount: 0 },
    { code: '12030014', name: 'A/P P.O.-WATCHE BRANDS', type: 'CREDIT', amount: 938_215 },
    { code: '12030015', name: 'PROVISION FOR EXPENSES', type: 'CREDIT', amount: 9_172_146 },
    { code: '12030016', name: 'PROVISION FOR BONUS', type: 'CREDIT', amount: 58_749_000 },
    { code: '12030017', name: 'A/P-PARTIES RENT', type: 'CREDIT', amount: 10_477_766 },
    { code: '12030018', name: 'A/P-MISCELLANEOUS', type: 'CREDIT', amount: 380_098 },
    { code: '12040001', name: 'SALES TAX PAYABLE-FEDERAL', type: 'CREDIT', amount: 29_432_989 },
    { code: '12040002', name: 'SALES TAX PAYABLE-PROVINCIAL', type: 'CREDIT', amount: 0 },
    { code: '12040003', name: 'SALES TAX WITHHELD ON PURCHASES', type: 'CREDIT', amount: 0 },
    { code: '12040004', name: 'SALES TAX WITHHELD SRB', type: 'CREDIT', amount: 0 },
    { code: '12040005', name: 'SALES TAX WITHHELD PRA', type: 'CREDIT', amount: 0 },
    { code: '12040006', name: 'SALES TAX WITHHELD ICT', type: 'CREDIT', amount: 0 },
    { code: '12040007', name: 'SALES TAX WITHHELD ON SALES', type: 'CREDIT', amount: 0 },
    { code: '12050001', name: "WORKERS'S WELFARE FUND PAYABLE", type: 'CREDIT', amount: 10_028_159 },
    { code: '12060001', name: 'WH TAX PAYABLE-SALARY', type: 'CREDIT', amount: 0 },
    { code: '12060002', name: 'WH TAX PAYABLE-DIVIDEND', type: 'CREDIT', amount: 0 },
    { code: '12060003', name: 'WH TAX PAYABLE-GOODS', type: 'CREDIT', amount: 0 },
    { code: '12060004', name: 'WH TAX PAYABLE-SERVICES', type: 'CREDIT', amount: 0 },
    { code: '12060005', name: 'WH TAX PAYABLE-RENT', type: 'CREDIT', amount: 0 },
    { code: '12060006', name: 'WH TAX PAYABLE-COMMISSION', type: 'CREDIT', amount: 0 },
    { code: '12060007', name: 'WH TAX PAYABLE-RETAILERS', type: 'CREDIT', amount: 0 },
    { code: '12060008', name: 'DUTY & TAXES PAYABLE', type: 'CREDIT', amount: 0 },
    { code: '12060009', name: 'POS INTEGRATION FEE - PAYABLE', type: 'CREDIT', amount: 0 },
    { code: '12070001', name: 'SHORT TERM LOAN', type: 'CREDIT', amount: 0 },
    { code: '12070002', name: 'CURRENT ACCOUNT-CASH', type: 'CREDIT', amount: 0 },
    { code: '12070003', name: 'CURRENT ACCOUNT-CARDS', type: 'CREDIT', amount: 0 },
    { code: '12070004', name: 'CURRENT ACCOUNT-WHOLE SALES', type: 'CREDIT', amount: 0 },
    { code: '12070005', name: 'CURRENT ACCOUNT-AFTER SALES', type: 'CREDIT', amount: 0 },
    { code: '12070006', name: 'CREDIT VOUCHERS', type: 'CREDIT', amount: 3_912_745 },
    { code: '12070007', name: 'GIFT VOUCHERS', type: 'CREDIT', amount: 3_698_273 },
    { code: '12070008', name: 'GIFT VOUCHERS CORPORATE', type: 'CREDIT', amount: 15_303_292 },
    { code: '12070009', name: 'CLAIM VOUCHERS', type: 'CREDIT', amount: 0 },
    { code: '12070010', name: 'EXCHANGE VOUCHERS', type: 'CREDIT', amount: 1_629_192 },
    { code: '12070011', name: 'ALLIANCE & REWARD PROGRAM', type: 'CREDIT', amount: 0 },
    { code: '12070012', name: 'ADVANCE AG. PURC. OF VEHICLE', type: 'CREDIT', amount: 219_000 },
    { code: '12070013', name: 'RETENTION MONEY PAYABLE', type: 'CREDIT', amount: 0 },
    { code: '12070014', name: 'PROVISION FOR IMPAIRMENT', type: 'CREDIT', amount: 15_000_000 },
    { code: '12080001', name: 'CURRENT MATURITY OF LEASE LIABILITY', type: 'CREDIT', amount: 0 },
    { code: '12090001', name: 'PROVISION FOR TAXATION', type: 'CREDIT', amount: 17_184_238 },
    { code: '12090002', name: 'TAX PAYABLE-OTHERS', type: 'CREDIT', amount: 11_030_371 },
    { code: '12100001', name: 'PROVISION FOR SALES TAX', type: 'CREDIT', amount: 179_938_299 },
    { code: '12110001', name: 'ACC MARK UP ON RF', type: 'CREDIT', amount: 0 },
    { code: '12110002', name: 'ACC MARK UP ON SHORT TERM LOAN', type: 'CREDIT', amount: 0 },
];
function calculateDelta(accountType, debit, credit) {
    const normalDebit = accountType === client_1.AccountType.ASSET || accountType === client_1.AccountType.EXPENSE;
    return normalDebit ? debit - credit : credit - debit;
}
async function postOpeningBalance(prisma, entry, transactionDate) {
    if (entry.amount === 0) {
        console.log(`   ⏭  Skipping ${entry.code} – ${entry.name} (amount is 0)`);
        return;
    }
    const account = await prisma.chartOfAccount.findFirst({
        where: { code: entry.code },
        select: { id: true, code: true, name: true, type: true, isGroup: true, balance: true },
    });
    if (!account) {
        console.warn(`   ⚠️  Account not found for code ${entry.code} (${entry.name}) – skipping`);
        return;
    }
    if (account.isGroup) {
        console.warn(`   ⚠️  ${entry.code} is a group account – skipping`);
        return;
    }
    const existing = await prisma.accountTransaction.findFirst({
        where: { accountId: account.id, sourceType: 'OPENING_BALANCE' },
    });
    if (existing) {
        console.log(`   ⏭  ${entry.code} – ${entry.name} already has an opening balance – skipping`);
        return;
    }
    const debit = entry.type === 'DEBIT' ? entry.amount : 0;
    const credit = entry.type === 'CREDIT' ? entry.amount : 0;
    const delta = calculateDelta(account.type, debit, credit);
    const newBalance = Number(account.balance) + delta;
    await prisma.chartOfAccount.update({
        where: { id: account.id },
        data: { balance: { increment: delta } },
    });
    await prisma.accountTransaction.create({
        data: {
            accountId: account.id,
            debit,
            credit,
            balanceAfter: newBalance,
            sourceType: 'OPENING_BALANCE',
            sourceId: account.id,
            sourceRef: `Opening Balance - ${account.code}`,
            description: `Opening Balance for ${account.name}`,
            transactionDate,
        },
    });
    console.log(`   ✅ ${entry.code} – ${entry.name}: ${entry.type} ${entry.amount.toLocaleString()}`);
}
async function seedOpeningBalances(prisma, entries, transactionDate) {
    for (const entry of entries) {
        await postOpeningBalance(prisma, entry, transactionDate);
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
async function main() {
    console.log('🚀 Starting Opening Balance Seeding (Equity + Liabilities)...');
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
    const dateArgIdx = process.argv.indexOf('--date');
    const transactionDate = dateArgIdx !== -1
        ? new Date(process.argv[dateArgIdx + 1])
        : new Date('2026-01-01');
    console.log(`📅 Opening balance date: ${transactionDate.toISOString().split('T')[0]}`);
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
                ? `ℹ️ No active company found with database name: ${specificTenant}`
                : 'ℹ️ No active companies found in Master DB.');
            return;
        }
        console.log(specificTenant
            ? `📡 Targeting tenant: ${specificTenant}`
            : `📡 Found ${companies.length} active companies`);
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
                    console.log(`\n   📂 Seeding Equity opening balances...`);
                    await seedOpeningBalances(tenantPrisma, exports.equityOpeningBalances, transactionDate);
                    console.log(`\n   📂 Seeding Liabilities opening balances...`);
                    await seedOpeningBalances(tenantPrisma, exports.liabilitiesOpeningBalances, transactionDate);
                    console.log(`\n   ✅ Done for ${company.name}`);
                }
                finally {
                    await tenantPrisma.$disconnect();
                    await tenantPool.end();
                }
            }
            catch (err) {
                console.error(`   ❌ Failed to seed opening balances for ${company.code}: ${err.message}`);
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
//# sourceMappingURL=seed-opening-balances.js.map