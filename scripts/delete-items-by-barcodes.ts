import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as crypto from 'crypto';
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

async function processBarcodeDeletion(
  prisma: PrismaClient,
  barcodes: string[],
  batchSize: number,
  isDryRun: boolean
) {
  const totalBarcodes = barcodes.length;
  console.log(`\n📋 Starting barcode processing for ${totalBarcodes.toLocaleString()} unique barcodes...`);
  if (isDryRun) {
    console.log('🔍 [DRY RUN MODE] No records will be deleted.');
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
      // In dry run, count matching items
      const count = await prisma.item.count({
        where: {
          barCode: { in: batch },
        },
      });
      totalItemsMatched += count;
      process.stdout.write(
        `\r⏳ [DRY RUN] Batch ${batchNum}/${batches.length} (${progressPct}%): Found ${totalItemsMatched.toLocaleString()} items so far...`
      );
    } else {
      try {
        // Attempt bulk deletion for current batch
        const result = await prisma.item.deleteMany({
          where: {
            barCode: { in: batch },
          },
        });
        totalItemsDeleted += result.count;
        process.stdout.write(
          `\r⏳ Batch ${batchNum}/${batches.length} (${progressPct}%): Deleted ${totalItemsDeleted.toLocaleString()} items so far...`
        );
      } catch (err: any) {
        // If bulk delete fails (e.g. FK constraint P2003), fallback to item-by-item delete to delete unreferenced ones
        console.warn(`\n⚠️ Batch ${batchNum} bulk delete encountered error (${err.code || err.message}). Falling back to individual deletion for batch...`);
        for (const barcode of batch) {
          try {
            const delResult = await prisma.item.deleteMany({
              where: { barCode: barcode },
            });
            totalItemsDeleted += delResult.count;
          } catch (itemErr: any) {
            totalFKFailures++;
          }
        }
      }
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n\n==================================================`);
  console.log(`✨ Processing Completed in ${durationSec}s`);
  console.log(`==================================================`);
  console.log(`📊 Barcodes in input list: ${totalBarcodes.toLocaleString()}`);
  if (isDryRun) {
    console.log(`🔍 Total items matching barcodes found in DB: ${totalItemsMatched.toLocaleString()}`);
  } else {
    console.log(`✅ Total items deleted from DB: ${totalItemsDeleted.toLocaleString()}`);
    if (totalFKFailures > 0) {
      console.log(`⚠️ Total items skipped due to Foreign Key constraints: ${totalFKFailures.toLocaleString()}`);
    }
  }
  console.log(`==================================================\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isSingleDb = args.includes('--single-db');

  const fileArgIdx = args.indexOf('--file');
  let filePath = fileArgIdx !== -1 ? args[fileArgIdx + 1] : null;

  if (!filePath) {
    // Default search paths
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
    console.error(`❌ Could not locate barcode file. Provide path via --file <path>`);
    console.error(`Usage: bun scripts/delete-items-by-barcodes.ts [--dry-run] [--file <path>] [--tenant <dbName>] [--single-db] [--batch-size <number>]`);
    process.exit(1);
  }

  const batchArgIdx = args.indexOf('--batch-size');
  const batchSize = batchArgIdx !== -1 ? parseInt(args[batchArgIdx + 1], 10) : 500;

  const tenantArgIdx = args.indexOf('--tenant');
  const specificTenant = tenantArgIdx !== -1 ? args[tenantArgIdx + 1] : null;

  console.log(`📁 Loading barcodes from: ${filePath}`);
  const barcodes = await loadBarcodesFromFile(filePath);
  console.log(`✔ Read ${barcodes.length.toLocaleString()} unique barcodes from file.`);

  if (barcodes.length === 0) {
    console.log('⚠️ No barcodes found to process.');
    return;
  }

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  const singleDbUrl = process.env.DATABASE_URL;

  if (isSingleDb || !managementUrl || !masterKey) {
    if (!singleDbUrl) {
      console.error('❌ DATABASE_URL or (DATABASE_URL_MANAGEMENT + MASTER_ENCRYPTION_KEY) is required in .env');
      process.exit(1);
    }
    console.log(`🔗 Connecting directly to database via DATABASE_URL...`);
    const pool = new Pool({ connectionString: singleDbUrl });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter });

    try {
      await prisma.$connect();
      await processBarcodeDeletion(prisma, barcodes, batchSize, isDryRun);
    } finally {
      await prisma.$disconnect();
      await pool.end();
    }
    return;
  }

  // Multi-tenant mode
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
      console.log('ℹ️ No active companies found matching criteria.');
      return;
    }

    console.log(`🏢 Found ${companies.length} active company database(s) to process.`);

    for (const company of companies) {
      console.log(`\n👉 Target Company: ${company.name} (${company.code}) [DB: ${company.dbName}]`);
      try {
        let connectionString = company.dbUrl;
        if (company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch {
            console.warn(`  ⚠️ Decryption failed for dbPassword, falling back to stored dbUrl`);
          }
        }

        if (!connectionString) {
          console.error(`  ❌ No connection details available for ${company.name}`);
          continue;
        }

        const tenantPool = new Pool({ connectionString });
        const tenantAdapter = new PrismaPg(tenantPool);
        const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

        try {
          await tenantPrisma.$connect();
          await processBarcodeDeletion(tenantPrisma, barcodes, batchSize, isDryRun);
        } finally {
          await tenantPrisma.$disconnect();
          await tenantPool.end();
        }
      } catch (err: any) {
        console.error(`  ❌ Error processing company ${company.name}: ${err.message}`);
      }
    }
  } finally {
    await management.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Script execution error:', err);
  process.exit(1);
});
