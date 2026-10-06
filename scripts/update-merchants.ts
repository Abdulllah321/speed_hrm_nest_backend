import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';
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

function getMerchantCode(bankName: string): number {
  const name = bankName.toLowerCase();
  if (name.includes('amex')) return 4;
  if (name.includes('falah') || name.includes('falha')) return 2;
  if (name.includes('keenu')) return 3;
  if (name.includes('allied')) return 5;
  if (name.includes('meezan')) return 6;
  if (name.includes('hbl')) return 1;
  return 0;
}

async function main() {
  const jsonPath = path.join(__dirname, '..', 'data', 'merchants.json');
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  const merchantsToUpdate: { tagId: string; bankName: string; merchantCode: number; commissionRate: number }[] = [];
  let lastHeaderTagId: string | null = null;

  for (const d of data) {
    if (d.Bank === '' && d.tagId) {
      lastHeaderTagId = d.tagId.trim();
    }
    
    if (d.CostCentre && d.CostCentre.startsWith('|')) {
      if (lastHeaderTagId) {
        const bankName = d.tagId.trim();
        merchantsToUpdate.push({
          tagId: lastHeaderTagId,
          bankName,
          merchantCode: getMerchantCode(bankName),
          commissionRate: parseFloat(d.Description),
        });
      }
    } else if (d.Bank && d.CommissionRate && parseFloat(d.CommissionRate)) {
      const bankName = d.Bank.trim();
      merchantsToUpdate.push({
        tagId: d.tagId.trim(),
        bankName,
        merchantCode: getMerchantCode(bankName),
        commissionRate: parseFloat(d.CommissionRate),
      });
    }
  }

  console.log(`Parsed ${merchantsToUpdate.length} valid merchant commission rates.`);

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT || process.env.DATABASE_URL;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (!managementUrl) {
    console.error('❌ DATABASE_URL_MANAGEMENT or DATABASE_URL is missing.');
    process.exit(1);
  }

  const mPool = new Pool({ connectionString: managementUrl });
  const mAdapter = new PrismaPg(mPool);
  const management = new ManagementClient({ adapter: mAdapter as any });

  let companies: any[] = [];
  try {
    companies = await management.company.findMany({ where: { status: 'active' } });
  } catch (err: any) {
    console.warn(`ℹ️ Multi-tenant check skipped or failed (${err.message}).`);
  } finally {
    await management.$disconnect();
    await mPool.end();
  }

  if (companies.length === 0) return;

  console.log(`\n🏢 Found ${companies.length} tenant companies. Updating merchant configs...`);

  for (const company of companies) {
    console.log(`\n👉 Processing Tenant: ${company.name}`);
    let connectionString = company.dbUrl;
    if (company.dbPassword && masterKey) {
      try {
        const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
        connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
      } catch (e) {}
    }
    if (!connectionString) continue;

    const tPool = new Pool({ connectionString });
    const tAdapter = new PrismaPg(tPool);
    const tenantPrisma = new PrismaClient({ adapter: tAdapter as any });

    try {
      await tenantPrisma.$connect();
      let updatedCount = 0;
      
      for (const m of merchantsToUpdate) {
        if (!m.merchantCode) continue;

        // Try to find the existing merchant config for this location and bank
        const existing = await tenantPrisma.merchantConfig.findMany({
          where: {
            tagId: m.tagId,
            merchantCode: m.merchantCode
          }
        });

        for (const record of existing) {
          await tenantPrisma.merchantConfig.update({
            where: { id: record.id },
            data: { commissionRate: m.commissionRate }
          });
          updatedCount++;
        }
      }
      console.log(`  ✅ Updated ${updatedCount} merchant configs for ${company.name}`);
    } catch (e: any) {
      console.error(`  ❌ Failed processing tenant ${company.name}:`, e.message);
    } finally {
      await tenantPrisma.$disconnect();
      await tPool.end();
    }
  }
}

main().catch(console.error);
