import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient as TenantClient } from '@prisma/client';
import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

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

async function main() {
    const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
    const masterKey = process.env.MASTER_ENCRYPTION_KEY;

    if (!managementUrl || !masterKey) {
        console.error('Missing env vars');
        process.exit(1);
    }

    const mPool = new Pool({ connectionString: managementUrl });
    const mAdapter = new PrismaPg(mPool);
    const management = new ManagementClient({ adapter: mAdapter } as any);

    try {
        const companies = await management.company.findMany({
            where: { status: 'active' }
        });

        for (const company of companies) {
            console.log(`\n=========================================`);
            console.log(`TENANT: ${company.name} (${company.code})`);
            console.log(`=========================================`);

            let connectionString = company.dbUrl;
            if (company.dbPassword) {
                try {
                    const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
                    connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
                } catch (e: any) {
                    console.warn(`Decryption failed: ${e.message}`);
                }
            }

            if (!connectionString) {
                console.log('No connection string');
                continue;
            }

            const tPool = new Pool({ connectionString });
            const tAdapter = new PrismaPg(tPool);
            const tenant = new TenantClient({ adapter: tAdapter } as any);

            try {
                const pvs = await tenant.paymentVoucher.findMany({
                    orderBy: { createdAt: 'desc' },
                    take: 3,
                    include: {
                        details: {
                            include: {
                                account: true,
                                tagAccount: true
                            }
                        },
                        creditAccount: true,
                        supplier: true
                    }
                });

                console.log(`Found ${pvs.length} Payment Vouchers.`);
                for (const pv of pvs) {
                    console.log(`\n-----------------------------------------`);
                    console.log(`PV No: ${pv.pvNo} | ID: ${pv.id}`);
                    console.log(`Date: ${pv.pvDate} | Status: ${pv.status}`);
                    console.log(`Description: ${pv.description}`);
                    console.log(`Credit Account: ${pv.creditAccount?.code} - ${pv.creditAccount?.name} (${pv.creditAccountId})`);
                    console.log(`Credit Amount: ${pv.creditAmount}`);
                    console.log(`Supplier: ${pv.supplier?.name} (${pv.supplierId})`);
                    console.log(`Is Advance: ${pv.isAdvance}`);
                    
                    console.log(`\nPV Details:`);
                    for (const d of pv.details) {
                        console.log(`  Account: ${d.account?.code} - ${d.account?.name} (${d.accountId})`);
                        console.log(`  Tag Account: ${d.tagAccount?.code} - ${d.tagAccount?.name} (${d.tagAccountId})`);
                        console.log(`  Debit: ${d.debit} | Credit: ${d.credit}`);
                        console.log(`  Narration: ${d.narration}`);
                        console.log(`  isTaxApplicable: ${d.isTaxApplicable}`);
                    }

                    const txs = await tenant.accountTransaction.findMany({
                        where: { sourceId: pv.id },
                        include: {
                            account: true,
                            tagAccount: true
                        }
                    });

                    console.log(`\nGL / Account Transactions for this PV:`);
                    if (txs.length === 0) {
                        console.log(`  (None found)`);
                    } else {
                        for (const tx of txs) {
                            console.log(`  Tx ID: ${tx.id}`);
                            console.log(`    Account: ${tx.account?.code} - ${tx.account?.name} (${tx.accountId})`);
                            console.log(`    Tag Account: ${tx.tagAccount?.code} - ${tx.tagAccount?.name} (${tx.tagAccountId})`);
                            console.log(`    Debit: ${tx.debit} | Credit: ${tx.credit}`);
                            console.log(`    Narration: ${tx.narration} | SourceRef: ${tx.sourceRef}`);
                        }
                    }
                }

            } catch (err: any) {
                console.error(`Error querying tenant ${company.code}: ${err.message}`);
            } finally {
                await tenant.$disconnect();
                await tPool.end();
            }
        }
    } finally {
        await management.$disconnect();
        await mPool.end();
    }
}

main().catch(console.error);
