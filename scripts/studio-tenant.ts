import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { spawn } from 'child_process';
import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Decrypt password using AES-256-GCM
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

async function main() {
    console.log('--- Tenant Prisma Studio Launcher ---');

    // Parse CLI arguments
    const args = process.argv.slice(2);
    let targetTenant: string | null = null;
    let fallbackPort = 5555;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--tenant' && i + 1 < args.length) {
            targetTenant = args[i + 1];
            i++;
        } else if (args[i] === '--port' && i + 1 < args.length) {
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

    const pool = new Pool({ connectionString: managementUrl });
    const adapter = new PrismaPg(pool);
    const mClient = new ManagementClient({ adapter } as any);

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
        } else {
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
            } catch (e) {
                console.error(`❌ Failed to decrypt password for ${company.name}`);
                process.exit(1);
            }
        }

        if (!connectionString) {
            console.error(`❌ No valid connection string constructed for ${company.name}`);
            process.exit(1);
        }

        console.log(`✅ Tenant '${company.name}' found. Launching Prisma Studio on port ${fallbackPort}...`);

        // Launch Prisma Studio
        const studioCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        const studioArgs = ['prisma', 'studio', '--port', fallbackPort.toString()];

        const child = spawn(studioCommand, studioArgs, {
            env: {
                ...process.env,
                DATABASE_URL: connectionString
            },
            stdio: 'inherit',
            shell: process.platform === 'win32' // Needed for spawning .cmd scripts correctly on Windows
        });

        child.on('error', (err) => {
            console.error(`❌ Failed to start Prisma Studio: ${err.message}`);
        });

        child.on('exit', (code) => {
            if (code !== 0) {
                console.log(`⚠️ Prisma Studio exited with code ${code}`);
            } else {
                console.log('Goodbye! 👋');
            }
        });

    } catch (error: any) {
        console.error(`\n❌ Error: ${error.message}`);
    } finally {
        await mClient.$disconnect();
        await pool.end();
    }
}

main().catch((e) => {
    console.error('Unhandled error:', e);
    process.exit(1);
});
