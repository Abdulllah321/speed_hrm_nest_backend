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
const client_1 = require("@prisma/client");
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
    const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
    const masterKey = process.env.MASTER_ENCRYPTION_KEY;
    const pool = new pg_1.Pool({ connectionString: managementUrl });
    const adapter = new adapter_pg_1.PrismaPg(pool);
    const mClient = new management_client_1.PrismaClient({ adapter });
    await mClient.$connect();
    const company = await mClient.company.findFirst({
        where: { status: "active" }
    });
    if (!company) {
        console.error('No active company found');
        return;
    }
    let connectionString = company.dbUrl || undefined;
    if (company.dbPassword) {
        const decPassword = decrypt(company.dbPassword, masterKey);
        const encUser = encodeURIComponent(company.dbUser || '');
        const encPassword = encodeURIComponent(decPassword);
        connectionString = `postgresql://${encUser}:${encPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
    }
    await mClient.$disconnect();
    await pool.end();
    const tPool = new pg_1.Pool({ connectionString });
    const tAdapter = new adapter_pg_1.PrismaPg(tPool);
    const tClient = new client_1.PrismaClient({ adapter: tAdapter });
    await tClient.$connect();
    console.log('--- RECENT 10 ORDERS AND THEIR CREDIT VOUCHERS ---');
    const orders = await tClient.salesOrder.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
    });
    for (const order of orders) {
        const vouchers = await tClient.voucher.findMany({
            where: { sourceOrderId: order.id, isDeleted: false },
        });
        console.log(`Order: ${order.orderNumber} (ID: ${order.id})`);
        console.log(`- Grand Total: ${order.grandTotal}`);
        console.log(`- Created At: ${order.createdAt}`);
        if (vouchers.length > 0) {
            console.log(`- Linked Vouchers:`);
            vouchers.forEach(v => {
                console.log(`  * Code: ${v.code}, Value: ${v.faceValue}, Type: ${v.voucherType}`);
            });
        }
        else {
            console.log(`- No linked vouchers`);
        }
    }
    await tClient.$disconnect();
    await tPool.end();
}
main().catch(console.error);
//# sourceMappingURL=check-orders.js.map