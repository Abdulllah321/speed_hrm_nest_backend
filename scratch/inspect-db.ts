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

async function run() {
  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (managementUrl && masterKey) {
    const pool = new Pool({ connectionString: managementUrl });
    const adapter = new PrismaPg(pool);
    const management = new ManagementClient({ adapter } as any);

    const companies = await management.company.findMany({
      where: { status: 'active' },
    });
    console.log(`Found ${companies.length} active companies`);

    for (const company of companies) {
      console.log(`\n--- Company: ${company.name} (${company.code}) ---`);
      let connectionString = company.dbUrl;
      if (company.dbPassword) {
        try {
          const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
          connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
        } catch (e: any) {
          console.warn(`Decryption failed: ${e.message}`);
        }
      }

      if (!connectionString) continue;

      const tenantPool = new Pool({ connectionString });
      const tenantAdapter = new PrismaPg(tenantPool);
      const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

      try {
        const orderCount = await tenantPrisma.salesOrder.count();
        console.log(`sales_orders count: ${orderCount}`);

        const voucherTypes = await tenantPrisma.voucher.groupBy({
          by: ['voucherType'],
          _count: { id: true },
        });
        console.log('pos_vouchers breakdown:', voucherTypes);

        const sampleVouchers = await tenantPrisma.voucher.findMany({
          take: 5,
          select: { code: true, voucherType: true, faceValue: true, issuedByLocationId: true },
        });
        console.log('Sample vouchers:', sampleVouchers);

        const sampleOrders = await tenantPrisma.salesOrder.findMany({
          take: 5,
          select: {
            orderNumber: true,
            subtotal: true,
            discountAmount: true,
            taxAmount: true,
            grandTotal: true,
            cashAmount: true,
            cardAmount: true,
            voucherAmount: true,
            notes: true,
          },
        });
        console.log('Sample orders:', sampleOrders);

        const locations = await tenantPrisma.location.findMany({
          select: { id: true, code: true, shortCode: true, name: true },
        });
        console.log('Locations count:', locations.length);
        console.log('Sample locations:', locations.slice(0, 5));
      } finally {
        await tenantPrisma.$disconnect();
        await tenantPool.end();
      }
    }

    await management.$disconnect();
    await pool.end();
  }
}

run();
