import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import fs from 'fs';
import readline from 'readline';
import crypto from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as ManagementClient } from '@prisma/management-client';

function decrypt(encryptedText: string, masterKeyString: string): string {
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const parts = encryptedText.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted text format');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(parts[2], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function loadBarcodesFromFile(filePath: string): Promise<string[]> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Barcode file not found at path: ${filePath}`);
  }

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const uniqueBarcodes = new Set<string>();
  let isFirstLine = true;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip header line if present
    if (isFirstLine && trimmed.toLowerCase() === 'barcode') {
      isFirstLine = false;
      continue;
    }
    isFirstLine = false;

    uniqueBarcodes.add(trimmed);
  }

  return Array.from(uniqueBarcodes);
}

function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

async function deleteItemsByBarcodes(
  prisma: PrismaClient,
  barcodes: string[],
  batchSize: number = 500,
  isDryRun: boolean = false
) {
  const totalBarcodes = barcodes.length;
  console.log(`\n📋 Processing ${totalBarcodes.toLocaleString()} unique barcodes...`);
  if (isDryRun) {
    console.log('🔍 [DRY RUN MODE] Counting matching items without deleting.');
  }

  const batches = chunkArray(barcodes, batchSize);
  let totalItemsMatched = 0;
  let totalItemsDeleted = 0;
  let totalFKFailures = 0;
  const startTime = Date.now();

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchNum = i + 1;
    const progressPct = (((i + 1) / batches.length) * 100).toFixed(1);

    if (isDryRun) {
      const count = await prisma.item.count({
        where: {
          barCode: { in: batch },
        },
      });
      totalItemsMatched += count;
      process.stdout.write(
        `\r⏳ [DRY RUN] Batch ${batchNum}/${batches.length} (${progressPct}%): Found ${totalItemsMatched.toLocaleString()} items...`
      );
    } else {
      try {
        const result = await prisma.item.deleteMany({
          where: {
            barCode: { in: batch },
          },
        });
        totalItemsDeleted += result.count;
        process.stdout.write(
          `\r⏳ Batch ${batchNum}/${batches.length} (${progressPct}%): Deleted ${totalItemsDeleted.toLocaleString()} items...`
        );
      } catch (err: any) {
        console.warn(`\n⚠️ Batch ${batchNum} bulk delete failed (${err.message}). Falling back to individual deletes...`);
        for (const barcode of batch) {
          try {
            const delResult = await prisma.item.deleteMany({
              where: { barCode: barcode },
            });
            totalItemsDeleted += delResult.count;
          } catch (itemErr) {
            totalFKFailures++;
          }
        }
      }
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n\n==================================================`);
  console.log(`✨ Done in ${durationSec}s`);
  console.log(`==================================================`);
  console.log(`📊 Unique Barcodes in input: ${totalBarcodes.toLocaleString()}`);
  if (isDryRun) {
    console.log(`🔍 Total items in DB matching barcodes: ${totalItemsMatched.toLocaleString()}`);
  } else {
    console.log(`✅ Total items deleted from DB: ${totalItemsDeleted.toLocaleString()}`);
    if (totalFKFailures > 0) {
      console.log(`⚠️ Items skipped due to foreign key constraints: ${totalFKFailures.toLocaleString()}`);
    }
  }
  console.log(`==================================================\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');

  const fileArgIdx = args.indexOf('--file');
  let filePath = fileArgIdx !== -1 ? args[fileArgIdx + 1] : null;

  if (!filePath) {
    const candidates = [
      path.resolve(__dirname, '../../delete-barcodes.txt'),
      path.resolve(process.cwd(), '../delete-barcodes.txt'),
      path.resolve(process.cwd(), 'delete-barcodes.txt'),
      path.resolve(__dirname, '../delete-barcodes.txt'),
    ];
    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        filePath = cand;
        break;
      }
    }
  }

  if (!filePath || !fs.existsSync(filePath)) {
    console.error(`❌ Barcode file not found. Place 'delete-barcodes.txt' in root or pass via --file <path>`);
    process.exit(1);
  }

  const batchArgIdx = args.indexOf('--batch-size');
  const batchSize = batchArgIdx !== -1 ? parseInt(args[batchArgIdx + 1], 10) : 500;

  console.log(`📁 Barcode file: ${filePath}`);
  const barcodes = await loadBarcodesFromFile(filePath);
  console.log(`✔ Found ${barcodes.length.toLocaleString()} unique barcodes to process.`);

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  const directDbUrl = process.env.DATABASE_URL;

  // Single DB direct execution via DATABASE_URL if explicitly requested or if management url not set
  if (directDbUrl && (!managementUrl || args.includes('--single-db'))) {
    console.log(`🔗 Connecting using DATABASE_URL...`);
    const pool = new Pool({ connectionString: directDbUrl });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter });

    try {
      await prisma.$connect();
      await deleteItemsByBarcodes(prisma, barcodes, batchSize, isDryRun);
    } finally {
      await prisma.$disconnect();
      await pool.end();
    }
    return;
  }

  if (!managementUrl || !masterKey) {
    console.error('❌ Neither DATABASE_URL nor DATABASE_URL_MANAGEMENT + MASTER_ENCRYPTION_KEY found in .env');
    process.exit(1);
  }

  // Tenant / Company Database iteration using Management Client
  console.log(`🏢 Connecting via Management DB to process active company tenant databases...`);
  const pool = new Pool({ connectionString: managementUrl });
  const adapter = new PrismaPg(pool);
  const management = new ManagementClient({ adapter } as any);

  try {
    const tenantArgIdx = args.indexOf('--tenant');
    const specificTenant = tenantArgIdx !== -1 ? args[tenantArgIdx + 1] : null;

    const companies = await management.company.findMany({
      where: {
        status: 'active',
        ...(specificTenant ? { dbName: specificTenant } : {}),
      },
    });

    if (companies.length === 0) {
      console.log('ℹ️ No active companies found.');
      return;
    }

    for (const company of companies) {
      console.log(`\n👉 Company: ${company.name} (${company.code}) [DB: ${company.dbName}]`);
      let connectionString = company.dbUrl;
      if (company.dbPassword) {
        try {
          const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
          connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
        } catch {
          console.warn(`  ⚠️ Decryption failed, using stored dbUrl`);
        }
      }

      if (!connectionString) {
        console.error(`  ❌ Missing connection string for ${company.name}`);
        continue;
      }

      const tenantPool = new Pool({ connectionString });
      const tenantAdapter = new PrismaPg(tenantPool);
      const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

      try {
        await tenantPrisma.$connect();
        await deleteItemsByBarcodes(tenantPrisma, barcodes, batchSize, isDryRun);
      } catch (err: any) {
        console.error(`  ❌ Failed for company ${company.name}: ${err.message}`);
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

main().catch((err) => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
