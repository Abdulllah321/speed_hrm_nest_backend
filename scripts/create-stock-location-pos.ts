// @ts-nocheck
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

const DEFAULT_PIN = '1234';

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

async function createOrUpdatePosForStockLocations(prisma: PrismaClient, tenantName: string = 'DEFAULT') {
  console.log(`\n================================================================`);
  console.log(`📌 Processing POS Terminals (Create/Update) for tenant: [${tenantName}]`);
  console.log(`🔑 Default Terminal PIN: ${DEFAULT_PIN}`);
  console.log(`================================================================`);

  // Hash the default PIN
  const hashedPin = await bcrypt.hash(DEFAULT_PIN, 10);

  // 1. Fetch all stock locations (isStockLocation = true)
  const stockLocations = await prisma.location.findMany({
    where: {
      isStockLocation: true,
      isDeleted: false,
    },
    select: {
      id: true,
      name: true,
      code: true,
      shortCode: true,
      companyId: true,
    },
  });

  // 2. Sort by shortCode (or code/name as fallback) like a pro
  stockLocations.sort((a, b) => {
    const keyA = (a.shortCode || a.code || a.name).trim();
    const keyB = (b.shortCode || b.code || b.name).trim();
    return keyA.localeCompare(keyB, undefined, { numeric: true, sensitivity: 'base' });
  });

  console.log(`🔍 Found ${stockLocations.length} active stock location(s).`);

  let createdCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  for (const location of stockLocations) {
    try {
      // Set terminal name to "Main Counter"
      const posName = 'Main Counter';

      // Generate base terminal code
      const locIdentifier = location.shortCode || location.code || location.name;
      const cleanPrefix = locIdentifier.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 6) || 'POS';
      const baseTerminalCode = `${cleanPrefix}-POS-01`;

      // Check if a POS already exists for this location
      const existingPos = await prisma.pos.findFirst({
        where: {
          locationId: location.id,
          isDeleted: false,
        },
      });

      if (existingPos) {
        // UPDATE existing POS terminal
        const updatedPos = await prisma.pos.update({
          where: { id: existingPos.id },
          data: {
            name: posName,
            terminalPin: hashedPin,
            isParent: true,
            status: 'active',
            companyId: location.companyId || existingPos.companyId,
          },
        });

        console.log(`🔄 UPDATED POS for "${location.name}": [ShortCode: ${location.shortCode || 'N/A'}, Name: "${updatedPos.name}", Code: "${updatedPos.terminalCode}", PIN: ${DEFAULT_PIN}]`);
        updatedCount++;
      } else {
        // Guarantee terminalCode is globally unique for creation
        let terminalCode = baseTerminalCode;
        const existingCode = await prisma.pos.findFirst({
          where: { terminalCode, isDeleted: false },
        });
        if (existingCode) {
          terminalCode = `${cleanPrefix}-POS-01-${Math.floor(100 + Math.random() * 900)}`;
        }

        // CREATE new POS terminal
        const newPos = await prisma.pos.create({
          data: {
            name: posName,
            posId: '001',
            terminalCode: terminalCode,
            terminalPin: hashedPin,
            locationId: location.id,
            companyId: location.companyId,
            isParent: true,
            status: 'active',
            isDeleted: false,
          },
        });

        console.log(`✅ CREATED POS for "${location.name}": [ShortCode: ${location.shortCode || 'N/A'}, Name: "${newPos.name}", Code: "${newPos.terminalCode}", PIN: ${DEFAULT_PIN}]`);
        createdCount++;
      }
    } catch (err: any) {
      console.error(`❌ Error processing POS for location "${location.name}": ${err.message}`);
      errorCount++;
    }
  }

  console.log(`\n📊 Summary for [${tenantName}]:`);
  console.log(`   - Created: ${createdCount}`);
  console.log(`   - Updated: ${updatedCount}`);
  console.log(`   - Errors: ${errorCount}`);
  console.log(`   - Default PIN for all terminals: ${DEFAULT_PIN}`);
  console.log(`================================================================\n`);
}

async function main() {
  console.log('🚀 Starting Terminal & POS Updater/Seeder for all stock locations...');

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  const singleDbUrl = process.env.DATABASE_URL;

  const tenantArgIdx = process.argv.indexOf('--tenant');
  const specificTenant = tenantArgIdx !== -1 ? process.argv[tenantArgIdx + 1] : null;

  if (managementUrl && masterKey) {
    console.log('📡 Running in Multi-Tenant Mode (using DATABASE_URL_MANAGEMENT)...');
    const pool = new Pool({ connectionString: managementUrl });
    const adapter = new PrismaPg(pool);
    const management = new ManagementClient({ adapter } as any);

    try {
      const companies = await management.company.findMany({
        where: {
          status: 'active',
          ...(specificTenant ? { dbName: specificTenant } : {}),
        },
      });

      if (companies.length === 0) {
        console.log('ℹ️ No matching active tenant companies found.');
        return;
      }

      console.log(`📡 Found ${companies.length} active company database(s).`);

      for (const company of companies) {
        let tenantDbUrl = `postgresql://${company.dbUser}:${company.dbPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;

        if (company.dbPassword) {
          try {
            const decPassword = decrypt(company.dbPassword, masterKey);
            const encUser = encodeURIComponent(company.dbUser || '');
            const encPassword = encodeURIComponent(decPassword);
            tenantDbUrl = `postgresql://${encUser}:${encPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch (e) {
            console.warn(`⚠️ Failed to decrypt password for ${company.name}, attempting fallback URL...`);
          }
        }

        const tenantPool = new Pool({ connectionString: tenantDbUrl });
        const tenantAdapter = new PrismaPg(tenantPool);
        const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

        try {
          await tenantPrisma.$connect();
          await createOrUpdatePosForStockLocations(tenantPrisma, company.name);
        } catch (e: any) {
          console.error(`❌ Failed processing tenant ${company.name}: ${e.message}`);
        } finally {
          await tenantPrisma.$disconnect();
          await tenantPool.end();
        }
      }
    } finally {
      await management.$disconnect();
      await pool.end();
    }
  } else if (singleDbUrl) {
    console.log('📡 Running in Single Database Mode (using DATABASE_URL)...');
    const tenantPool = new Pool({ connectionString: singleDbUrl });
    const tenantAdapter = new PrismaPg(tenantPool);
    const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

    try {
      await tenantPrisma.$connect();
      await createOrUpdatePosForStockLocations(tenantPrisma, 'MAIN');
    } catch (e: any) {
      console.error(`❌ Failed processing database: ${e.message}`);
    } finally {
      await tenantPrisma.$disconnect();
      await tenantPool.end();
    }
  } else {
    console.error('❌ Neither DATABASE_URL_MANAGEMENT nor DATABASE_URL found in .env');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Fatal error in script:', err);
  process.exit(1);
});
