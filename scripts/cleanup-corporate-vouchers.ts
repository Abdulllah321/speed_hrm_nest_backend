import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';

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

async function cleanTenant(prisma: PrismaClient, name: string) {
  console.log(`\n🔍 Checking corporate vouchers in [${name}]...`);

  // 1. Count corporate vouchers with issuedByLocationId set
  const corpWithLocation = await prisma.voucher.count({
    where: {
      voucherType: 'CORPORATE',
      issuedByLocationId: { not: null },
    },
  });

  console.log(`Found ${corpWithLocation} CORPORATE vouchers with issuedByLocationId != null.`);

  // 2. Count ISSUED transactions for CORPORATE vouchers with locationId set
  const corpTransactionsWithLocation = await prisma.voucherTransaction.count({
    where: {
      action: 'ISSUED',
      locationId: { not: null },
      voucher: {
        voucherType: 'CORPORATE',
      },
    },
  });

  console.log(`Found ${corpTransactionsWithLocation} ISSUED transactions for CORPORATE vouchers with locationId != null.`);

  if (corpWithLocation > 0) {
    const updatedVouchers = await prisma.voucher.updateMany({
      where: {
        voucherType: 'CORPORATE',
        issuedByLocationId: { not: null },
      },
      data: {
        issuedByLocationId: null,
      },
    });
    console.log(`✅ Set issuedByLocationId = null on ${updatedVouchers.count} corporate vouchers.`);
  }

  if (corpTransactionsWithLocation > 0) {
    const updatedTransactions = await prisma.voucherTransaction.updateMany({
      where: {
        action: 'ISSUED',
        locationId: { not: null },
        voucher: {
          voucherType: 'CORPORATE',
        },
      },
      data: {
        locationId: null,
        notes: 'Issued as CORPORATE voucher (ERP issuance)',
      },
    });
    console.log(`✅ Set locationId = null on ${updatedTransactions.count} corporate voucher ISSUED transactions.`);
  }
}

async function main() {
  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY || 'default-master-key-32-chars-min!!';

  if (managementUrl) {
    const pool = new Pool({ connectionString: managementUrl });
    const adapter = new PrismaPg(pool);
    const management = new ManagementClient({ adapter } as any);

    try {
      const companies = await management.company.findMany({
        where: { status: 'active' },
      });

      if (companies.length > 0) {
        for (const company of companies) {
          let connectionString = company.dbUrl;
          if (company.dbPassword) {
            try {
              const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
              connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
            } catch (e: any) {
              console.warn(`Could not decrypt password for company ${company.name}, using dbUrl`);
            }
          }

          const tenantPool = new Pool({ connectionString });
          const tenantAdapter = new PrismaPg(tenantPool);
          const prisma = new PrismaClient({ adapter: tenantAdapter } as any);

          try {
            await cleanTenant(prisma, company.name);
          } catch (err: any) {
            console.error(`Error in ${company.name}:`, err.message);
          } finally {
            await prisma.$disconnect();
            await tenantPool.end();
          }
        }
        return;
      }
    } catch (err: any) {
      console.warn(`Management lookup skipped: ${err.message}`);
    } finally {
      await management.$disconnect();
      await pool.end();
    }
  }

  // Fallback to direct DATABASE_URL
  const directPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const directAdapter = new PrismaPg(directPool);
  const prisma = new PrismaClient({ adapter: directAdapter } as any);

  try {
    await cleanTenant(prisma, 'Direct DB');
  } finally {
    await prisma.$disconnect();
    await directPool.end();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
