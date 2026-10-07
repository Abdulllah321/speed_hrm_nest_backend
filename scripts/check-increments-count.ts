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
  const masterUrl = process.env.MASTER_DATABASE_URL || process.env.DATABASE_URL;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  const pool = new Pool({ connectionString: masterUrl });
  const adapter = new PrismaPg(pool);
  const management = new ManagementClient({ adapter });

  try {
    await management.$connect();
    const companies = await management.company.findMany({
      where: { status: 'active' },
      select: { id: true, name: true, code: true, dbUrl: true, dbHost: true, dbPort: true, dbName: true, dbUser: true, dbPassword: true },
    });

    for (const company of companies) {
      let connectionString = company.dbUrl;
      if (company.dbPassword) {
        try {
          const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
          connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
        } catch (e) {}
      }

      const tenantPool = new Pool({ connectionString });
      const tenantAdapter = new PrismaPg(tenantPool);
      const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

      try {
        await tenantPrisma.$connect();
        const totalInc = await tenantPrisma.increment.count();
        console.log(`Tenant ${company.code}: Total Increments in DB = ${totalInc}`);

        // Check increments list
        const incs = await tenantPrisma.increment.findMany({
          include: { employee: { select: { employeeId: true, employeeName: true } } },
          orderBy: { createdAt: 'desc' },
        });
        console.log(`Total fetched increments = ${incs.length}`);

        // Check if there are any duplicate employees in increments
        const empCountMap = new Map<string, number>();
        for (const i of incs) {
          const empCode = i.employee?.employeeId || i.employeeId;
          empCountMap.set(empCode, (empCountMap.get(empCode) || 0) + 1);
        }

        const duplicates = [];
        for (const [empCode, count] of empCountMap.entries()) {
          if (count > 1) duplicates.push({ empCode, count });
        }
        console.log('Duplicates in Increment table:', duplicates);

      } finally {
        await tenantPrisma.$disconnect();
        await tenantPool.end();
      }
    }
  } finally {
    await management.$disconnect();
    await pool.end();
  }
}

main().catch(console.error);
