// @ts-nocheck
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

function decrypt(encryptedText: string, masterKeyString: string): string {
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const algorithm = 'aes-256-gcm';
  const parts = encryptedText.split(':');
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
  await management.$connect();

  const company = await management.company.findFirst({
    where: { status: 'active' },
  });

  let connectionString = company.dbUrl;
  if (company.dbPassword) {
    const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
    connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
  }

  const tenantPool = new Pool({ connectionString });
  const tenantAdapter = new PrismaPg(tenantPool);
  const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });
  await tenantPrisma.$connect();

  const totalIncrements = await tenantPrisma.increment.count();
  console.log(`Total Increment records in DB: ${totalIncrements}`);

  const increments = await tenantPrisma.increment.findMany({
    include: { employee: { select: { employeeId: true, employeeName: true } } },
    orderBy: { createdAt: 'desc' }
  });

  const empCounts: Record<string, number> = {};
  increments.forEach(inc => {
    const code = inc.employee?.employeeId || inc.employeeId;
    empCounts[code] = (empCounts[code] || 0) + 1;
  });

  const duplicates = Object.entries(empCounts).filter(([_, count]) => count > 1);
  console.log(`Unique employees with increments: ${Object.keys(empCounts).length}`);
  console.log(`Duplicate employees:`, duplicates);

  await tenantPrisma.$disconnect();
  await tenantPool.end();
  await management.$disconnect();
  await pool.end();
}

main().catch(console.error);
