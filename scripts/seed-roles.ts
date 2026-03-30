// @ts-nocheck
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

export const roles: any[] = [
  {
    id: 'cecb5af1-c24c-4141-84b1-95f9bfce6312',
    name: 'hr',
    description: 'Human Resource Manager with access to HR and Master modules.',
    isSystem: false,
    createdAt: '2026-01-30T15:08:50.649Z',
    updatedAt: '2026-01-30T15:08:50.649Z'
  },
  {
    id: '6af8b2de-1143-4722-9d6f-85266d9277a0',
    name: 'employee',
    description: 'Standard employee with self-service access.',
    isSystem: false,
    createdAt: '2026-01-30T15:08:50.661Z',
    updatedAt: '2026-01-30T15:08:50.661Z'
  },
  {
    id: '4fbdb247-4cc7-406d-9651-7e9bd2eb9f21',
    name: 'admin',
    description: 'System Administrator',
    isSystem: true,
    createdAt: '2026-01-07T07:32:15.553Z',
    updatedAt: '2026-01-07T07:32:15.553Z'
  }
];

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

async function seedRoles(prisma: PrismaClient, rolesData: any[]) {
  for (const role of rolesData) {
    console.log(`Processing Role: ${role.name}`);

    await prisma.role.upsert({
      where: { id: role.id },
      update: {
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
      },
      create: {
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
      },
    });
  }
}

async function main() {
  console.log('🚀 Starting Multi-Tenant Role Seeding...');

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
      where: { status: 'active' },
    });

    if (companies.length === 0) {
      console.log('ℹ️ No active companies found in Master DB.');
      return;
    }

    console.log(
      `📡 Found ${companies.length} active companies. Seeding roles...`,
    );

    for (const company of companies) {
      console.log(`\n👉 Processing tenant: ${company.name} (${company.code})`);

      try {
        let connectionString = company.dbUrl;

        if (company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch (e) {
            console.warn(
              `   ⚠️  Decryption failed for ${company.code}, using stored dbUrl...`,
            );
          }
        }

        if (!connectionString) {
          console.error(`   ❌ No connection details for ${company.code}`);
          continue;
        }

        const tenantPool = new Pool({ connectionString });
        const tenantAdapter = new PrismaPg(tenantPool);
        const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

        try {
          await tenantPrisma.$connect();
          console.log(`   Seeding Roles...`);
          await seedRoles(tenantPrisma, roles);

          console.log(`   ✅ Success!`);
        } finally {
          await tenantPrisma.$disconnect();
          await tenantPool.end();
        }
      } catch (err: any) {
        console.error(`   ❌ Failed to seed ${company.code}: ${err.message}`);
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
