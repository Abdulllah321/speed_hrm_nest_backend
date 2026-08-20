// @ts-nocheck
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

function decrypt(encryptedText: string, masterKeyString: string): string {
  if (!masterKeyString || masterKeyString.length < 32) {
    throw new Error('MASTER_ENCRYPTION_KEY must be at least 32 characters');
  }
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export const BRAND_GL_CODES: { code: string; name: string }[] = [
  { code: 'IMP001', name: 'NIKE' },
  { code: 'IMP002', name: 'DIOR' },
  { code: 'IMP003', name: 'ADIDAS' },
  { code: 'IMP004', name: 'ASICS' },
  { code: 'IMP005', name: 'BIRKENSTOCK' },
  { code: 'IMP006', name: 'PUMA' },
  { code: 'IMP007', name: 'UNDER ARMOUR' },
  { code: 'IMP008', name: 'CHARLES & KEITH' },
  { code: 'IMP009', name: 'PEDRO' },
  { code: 'IMP010', name: 'TAG HEUER' },
  { code: 'IMP011', name: 'TIMEX' },
  { code: 'IMP012', name: 'TIMBERLAND' },
  { code: 'IMP013', name: 'POLICE' },
  { code: 'IMP014', name: 'USPA' },
  { code: 'IMP015', name: 'DANISH DESIGN' },
  { code: 'IMP016', name: 'NAUTICA' },
  { code: 'IMP017', name: 'TISSOT' },
  { code: 'IMP018', name: 'RADO' },
  { code: 'IMP019', name: 'GUESS' },
  { code: 'IMP020', name: 'ORIS' },
  { code: 'IMP021', name: 'FENDI' },
];

export async function syncBrandGLCodes(prisma: PrismaClient, tenantLabel = 'MAIN') {
  console.log(`\n========================================`);
  console.log(`🏷️ Syncing Brand GL Codes for Tenant: ${tenantLabel}`);
  console.log(`========================================`);

  let updatedCount = 0;
  let createdCount = 0;
  const summary: any[] = [];

  for (const item of BRAND_GL_CODES) {
    const targetCode = item.code.trim();
    const targetName = item.name.trim();

    // Check if brand exists by code or by name (case-insensitive)
    let existingBrand = await prisma.brand.findFirst({
      where: {
        OR: [
          { code: targetCode },
          { name: { equals: targetName, mode: 'insensitive' } },
        ],
      },
    });

    if (existingBrand) {
      // Update code if different or missing
      if (existingBrand.code !== targetCode || existingBrand.name !== targetName) {
        const updated = await prisma.brand.update({
          where: { id: existingBrand.id },
          data: {
            code: targetCode,
            name: existingBrand.name || targetName,
          },
        });
        updatedCount++;
        summary.push({
          status: 'UPDATED',
          id: updated.id,
          code: updated.code,
          name: updated.name,
        });
      } else {
        summary.push({
          status: 'EXISTS',
          id: existingBrand.id,
          code: existingBrand.code,
          name: existingBrand.name,
        });
      }
    } else {
      // Create new Brand
      const created = await prisma.brand.create({
        data: {
          code: targetCode,
          name: targetName,
          status: 'active',
        },
      });
      createdCount++;
      summary.push({
        status: 'CREATED',
        id: created.id,
        code: created.code,
        name: created.name,
      });
    }
  }

  console.log(`✅ Brand GL Codes Sync Summary:`);
  console.log(`  • Updated: ${updatedCount}`);
  console.log(`  • Created: ${createdCount}`);
  console.table(summary);

  return { updatedCount, createdCount, summary };
}

async function main() {
  const managementUrl = process.env.DATABASE_URL_MANAGEMENT || process.env.MASTER_DATABASE_URL;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  const singleDbUrl = process.env.DATABASE_URL;

  let processedTenantsCount = 0;

  if (managementUrl && masterKey) {
    console.log('📡 Connecting to Master DB to query active companies/tenants...');
    const pool = new Pool({ connectionString: managementUrl });
    const adapter = new PrismaPg(pool);
    const management = new ManagementClient({ adapter } as any);

    try {
      await management.$connect();

      let companies: any[] = [];
      try {
        companies = await management.company.findMany({ where: { status: 'active' } });
      } catch {
        try {
          companies = await management.tenant.findMany({ where: { isDeleted: false } });
        } catch {
          companies = [];
        }
      }

      if (companies.length > 0) {
        console.log(`📡 Found ${companies.length} active company/tenant database(s). Running brand sync...`);
        for (const company of companies) {
          const cCode = company.code || company.dbName || 'TENANT';
          const cName = company.name || company.code || 'Tenant';
          console.log(`\n👉 Syncing brands for tenant: ${cName} (${cCode})`);

          let connectionString = company.dbUrl;
          const rawPassword = company.dbPassword || company.dbPasswordEnc;
          const dbUser = company.dbUser || company.dbUsername;

          if (rawPassword) {
            try {
              const decPassword = encodeURIComponent(decrypt(rawPassword, masterKey));
              connectionString = `postgresql://${dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
            } catch {
              console.warn(`  ⚠️ Decryption failed for ${cCode}, using stored dbUrl...`);
            }
          }

          if (!connectionString) {
            console.error(`  ❌ No connection details for ${cCode}`);
            continue;
          }

          try {
            const tenantPool = new Pool({ connectionString });
            const tenantAdapter = new PrismaPg(tenantPool);
            const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

            try {
              await tenantPrisma.$connect();
              await syncBrandGLCodes(tenantPrisma, `${cName} (${cCode})`);
              processedTenantsCount++;
            } finally {
              await tenantPrisma.$disconnect();
              await tenantPool.end();
            }
          } catch (err: any) {
            console.error(`  ❌ Failed processing tenant ${cCode}: ${err.message}`);
          }
        }
      } else {
        console.log('ℹ️ No active companies/tenants found in Master DB.');
      }
    } catch (mErr: any) {
      console.warn(`⚠️ Master DB connection failed: ${mErr.message}`);
    } finally {
      await management.$disconnect().catch(() => {});
      await pool.end().catch(() => {});
    }
  }

  if (processedTenantsCount === 0 && singleDbUrl) {
    console.log('📡 Running brand GL codes sync script in Single Database Mode (using DATABASE_URL)...');
    const tenantPool = new Pool({ connectionString: singleDbUrl });
    const tenantAdapter = new PrismaPg(tenantPool);
    const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

    try {
      await tenantPrisma.$connect();
      await syncBrandGLCodes(tenantPrisma, 'MAIN');
    } finally {
      await tenantPrisma.$disconnect();
      await tenantPool.end();
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal script error:', err);
    process.exit(1);
  });
}
