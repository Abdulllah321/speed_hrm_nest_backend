import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { execSync } from 'child_process';
import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Decrypt password using AES-256-GCM
 * (Logic aligned with EncryptionService)
 */
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

    const pool = new Pool({ connectionString: managementUrl });
    const adapter = new PrismaPg(pool);
    const management = new ManagementClient({ adapter } as any);

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

                // Decrypt password and reconstruct URL if needed for accuracy
                if (company.dbPassword) {
                    try {
                        const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
                        connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
                    } catch (e) {
                        console.warn(`   ⚠️  Decryption failed for ${company.code}, using stored dbUrl...`);
                    }
                }

                if (!connectionString) {
                    console.error(`   ❌ No connection details for ${company.code}`);
                    continue;
                }

                console.log(`   🛠️  Running prisma db push on database: ${company.dbName}`);

                // Set DATABASE_URL for the prisma command
                const env = { ...process.env, DATABASE_URL: connectionString };

                execSync('bunx prisma db push --schema prisma/schema --accept-data-loss', {
                    env,
                    stdio: 'inherit',
                    shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
                });

                console.log(`   ✅ Success!`);
            } catch (err: any) {
                console.error(`   ❌ Failed to sync ${company.code}: ${err.message}`);
            }
        }

        console.log('\n✨ All tenants processed.');
    } catch (error: any) {
        console.error(`\n❌ Error querying Master DB: ${error.message}`);
    } finally {
        await management.$disconnect();
        await pool.end();
    }
}

pushToAllTenants();
