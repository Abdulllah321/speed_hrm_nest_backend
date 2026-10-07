// @ts-nocheck
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';

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

function parseOldSalaryFile(): Array<{ empId: string; name: string; salary: number }> {
  const filePath = path.join(__dirname, '..', 'old salary.txt');
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  const records: Array<{ empId: string; name: string; salary: number }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('EMP_ID') || trimmed.startsWith('---') || trimmed.startsWith('(')) {
      continue;
    }

    const parts = trimmed.split('|').map((p) => p.trim());
    if (parts.length >= 3) {
      const empId = parts[0];
      const name = parts[1];
      const salary = parseFloat(parts[2]);

      if (empId && !isNaN(salary) && salary >= 0) {
        records.push({ empId, name, salary });
      }
    }
  }

  return records;
}

async function restoreSalariesForTenant(prisma: PrismaClient, records: Array<{ empId: string; name: string; salary: number }>) {
  console.log(`📊 Processing ${records.length} salary records...`);

  let updated = 0;
  let notFound = 0;
  const missingList: string[] = [];

  for (const rec of records) {
    const emp = await prisma.employee.findFirst({
      where: {
        OR: [
          { employeeId: rec.empId },
          { employeeId: { equals: rec.empId, mode: 'insensitive' } },
        ],
      },
      select: { id: true, employeeId: true, employeeName: true, employeeSalary: true },
    });

    if (!emp) {
      notFound++;
      missingList.push(rec.empId);
      continue;
    }

    await prisma.employee.update({
      where: { id: emp.id },
      data: {
        employeeSalary: rec.salary,
      },
    });

    updated++;
  }

  console.log(`\n========================================`);
  console.log(`✅ Successfully restored salaries: ${updated}`);
  if (notFound > 0) {
    console.log(`⚠️ Employees not found in this DB: ${notFound} (${missingList.join(', ')})`);
  }
  console.log(`========================================\n`);
}

async function main() {
  const records = parseOldSalaryFile();
  console.log(`📁 Loaded ${records.length} employee records from "old salary.txt".`);

  const masterUrl = process.env.MASTER_DATABASE_URL || process.env.DATABASE_URL;
  if (!masterUrl) {
    console.error('❌ MASTER_DATABASE_URL not found in .env');
    process.exit(1);
  }

  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  if (!masterKey) {
    console.error('❌ MASTER_ENCRYPTION_KEY not set in .env');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: masterUrl });
  const adapter = new PrismaPg(pool);
  const management = new ManagementClient({ adapter });

  try {
    await management.$connect();
    console.log('✅ Connected to Master DB.');

    const companies = await management.company.findMany({
      where: { status: 'active' },
      select: { id: true, name: true, code: true, dbUrl: true, dbHost: true, dbPort: true, dbName: true, dbUser: true, dbPassword: true },
    });

    if (companies.length === 0) {
      console.log('ℹ️ No active companies found in Master DB.');
      return;
    }

    console.log(`📡 Found ${companies.length} active companies.`);

    for (const company of companies) {
      console.log(`\n👉 Processing tenant: ${company.name} (${company.code})`);

      try {
        let connectionString = company.dbUrl;

        if (company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch (e) {
            console.warn(`   ⚠️ Decryption failed for ${company.code}, using stored dbUrl...`);
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
          await restoreSalariesForTenant(tenantPrisma, records);
          console.log(`   ✅ Tenant ${company.code} restored successfully.`);
        } finally {
          await tenantPrisma.$disconnect();
          await tenantPool.end();
        }
      } catch (err: any) {
        console.error(`   ❌ Failed to restore for ${company.code}: ${err.message}`);
      }
    }
  } catch (error: any) {
    console.error(`❌ Master DB Error: ${error.message}`);
  } finally {
    await management.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
