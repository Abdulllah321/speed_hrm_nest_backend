// @ts-nocheck
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import * as XLSX from 'xlsx';

/**
 * Decrypt password for tenant DB connection using master key
 */
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

interface BarcodeCostMap {
  [barcode: string]: number;
}

/**
 * Reads Excel / CSV file and extracts a mapping of barcode -> unitCost
 */
function loadBarcodeCostMap(filePath: string): { costMap: BarcodeCostMap; totalRows: number } {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at path: ${filePath}`);
  }

  console.log(`📖 Reading spreadsheet file: ${filePath}...`);
  const workbook = XLSX.readFile(filePath, { cellDates: true, raw: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error(`No sheets found in file: ${filePath}`);
  }

  const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, { raw: false, defval: '' });
  if (rawRows.length === 0) {
    throw new Error(`Spreadsheet is empty.`);
  }

  // Detect column headers
  const sampleRow = rawRows[0];
  const keys = Object.keys(sampleRow);

  const barcodeKey = keys.find((k) => /barcode/i.test(k.replace(/[\s_]/g, '')) || /itembarcode/i.test(k.replace(/[\s_]/g, '')) || /code/i.test(k));
  const costKey = keys.find((k) => /unitcost/i.test(k.replace(/[\s_]/g, '')) || /cost/i.test(k.replace(/[\s_]/g, '')) || /price/i.test(k));

  if (!barcodeKey) {
    throw new Error(`Could not find a 'Barcode' column in file. Found columns: ${keys.join(', ')}`);
  }
  if (!costKey) {
    throw new Error(`Could not find a 'Unit Cost' column in file. Found columns: ${keys.join(', ')}`);
  }

  console.log(`🎯 Using Columns -> Barcode: "${barcodeKey}", Unit Cost: "${costKey}"`);

  const costMap: BarcodeCostMap = {};
  let totalRows = 0;

  for (const row of rawRows) {
    totalRows++;
    const rawBarcode = row[barcodeKey];
    const rawCost = row[costKey];

    if (rawBarcode === undefined || rawBarcode === null || rawBarcode === '') continue;

    const barcode = String(rawBarcode).trim();
    if (!barcode) continue;

    // Parse cost float safely
    const cleanCostStr = String(rawCost).replace(/,/g, '').trim();
    const parsedCost = parseFloat(cleanCostStr);

    if (!isNaN(parsedCost) && parsedCost >= 0) {
      costMap[barcode] = parsedCost;
    }
  }

  return { costMap, totalRows };
}

function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Updates item unitCost in database matching item barcodes
 */
async function updateUnitCostByBarcodes(
  prisma: PrismaClient,
  costMap: BarcodeCostMap,
  batchSize: number = 500,
  isDryRun: boolean = false
) {
  const allBarcodes = Object.keys(costMap);
  const totalUniqueBarcodes = allBarcodes.length;

  console.log(`\n📋 Processing ${totalUniqueBarcodes.toLocaleString()} unique barcodes from file...`);
  if (isDryRun) {
    console.log('🔍 [DRY RUN MODE] Calculating updates without modifying database.');
  }

  const batches = chunkArray(allBarcodes, batchSize);

  let totalMatched = 0;
  let totalUpdated = 0;
  let totalUnchanged = 0;
  const missingBarcodes: string[] = [];

  const startTime = Date.now();

  for (let i = 0; i < batches.length; i++) {
    const batchBarcodes = batches[i];
    const batchNum = i + 1;
    const progressPct = (((i + 1) / batches.length) * 100).toFixed(1);

    // 1. Query items in DB matching current batch barcodes
    const matchingItems = await prisma.item.findMany({
      where: {
        barCode: { in: batchBarcodes },
      },
      select: {
        id: true,
        barCode: true,
        unitCost: true,
      },
    });

    const foundBarcodesInBatch = new Set(matchingItems.map((item) => item.barCode));

    // Track missing barcodes
    for (const bc of batchBarcodes) {
      if (!foundBarcodesInBatch.has(bc)) {
        missingBarcodes.push(bc);
      }
    }

    totalMatched += matchingItems.length;

    // 2. Identify items that need updates
    const updatesToApply: { id: string; barCode: string; newCost: number; oldCost: number }[] = [];

    for (const item of matchingItems) {
      if (!item.barCode) continue;
      const targetCost = costMap[item.barCode];
      if (targetCost === undefined) continue;

      // Allow small tolerance float equality comparison
      if (Math.abs(item.unitCost - targetCost) > 0.0001) {
        updatesToApply.push({
          id: item.id,
          barCode: item.barCode,
          newCost: targetCost,
          oldCost: item.unitCost,
        });
      } else {
        totalUnchanged++;
      }
    }

    // 3. Perform database updates
    if (!isDryRun && updatesToApply.length > 0) {
      // Execute in transactions of 250 updates for maximum speed
      const updateChunks = chunkArray(updatesToApply, 250);
      for (const uChunk of updateChunks) {
        await prisma.$transaction(
          uChunk.map((u) =>
            prisma.item.update({
              where: { id: u.id },
              data: { unitCost: u.newCost },
            })
          )
        );
      }
      totalUpdated += updatesToApply.length;
    } else if (isDryRun) {
      totalUpdated += updatesToApply.length;
    }

    process.stdout.write(
      `\r⏳ Batch ${batchNum}/${batches.length} (${progressPct}%): Matched: ${totalMatched.toLocaleString()} | Updated: ${totalUpdated.toLocaleString()} | Unchanged: ${totalUnchanged.toLocaleString()}`
    );
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\n\n==================================================`);
  console.log(`✨ Process Completed in ${durationSec}s`);
  console.log(`==================================================`);
  console.log(`📊 Unique Barcodes in File : ${totalUniqueBarcodes.toLocaleString()}`);
  console.log(`🔍 DB Items Matched       : ${totalMatched.toLocaleString()}`);
  if (isDryRun) {
    console.log(`📝 Items Requiring Update : ${totalUpdated.toLocaleString()} (Dry Run)`);
  } else {
    console.log(`✅ Items Successfully Updated: ${totalUpdated.toLocaleString()}`);
  }
  console.log(`ℹ️ Items Already Up-to-Date : ${totalUnchanged.toLocaleString()}`);
  console.log(`⚠️ Barcodes Not Found in DB : ${missingBarcodes.length.toLocaleString()}`);
  console.log(`==================================================\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');

  const fileArgIdx = args.indexOf('--file');
  let filePath = fileArgIdx !== -1 ? args[fileArgIdx + 1] : null;

  if (!filePath) {
    const candidates = [
      path.resolve(__dirname, '../Overall Opening Stock Unit Cost 1st  july 2026 for INPL.xlsx'),
      path.resolve(process.cwd(), 'Overall Opening Stock Unit Cost 1st  july 2026 for INPL.xlsx'),
      path.resolve(__dirname, 'Overall Opening Stock Unit Cost 1st  july 2026 for INPL.xlsx'),
    ];

    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        filePath = cand;
        break;
      }
    }
  }

  if (!filePath || !fs.existsSync(filePath)) {
    console.error(`❌ Excel file not found. Pass file via --file <path> or place 'Overall Opening Stock Unit Cost 1st  july 2026 for INPL.xlsx' in backend folder.`);
    process.exit(1);
  }

  const batchArgIdx = args.indexOf('--batch-size');
  const batchSize = batchArgIdx !== -1 ? parseInt(args[batchArgIdx + 1], 10) : 500;

  console.log(`📁 Target Excel file: ${filePath}`);
  const { costMap, totalRows } = loadBarcodeCostMap(filePath);
  console.log(`✔ Read ${totalRows.toLocaleString()} rows, found ${Object.keys(costMap).length.toLocaleString()} valid barcode cost mappings.`);

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  const directDbUrl = process.env.DATABASE_URL;

  // Option 1: Direct single DB connection via DATABASE_URL
  if (directDbUrl && (!managementUrl || args.includes('--single-db'))) {
    console.log(`🔗 Connecting directly via DATABASE_URL...`);
    const pool = new Pool({ connectionString: directDbUrl });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter });

    try {
      await prisma.$connect();
      await updateUnitCostByBarcodes(prisma, costMap, batchSize, isDryRun);
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

  // Option 2: Iterate over active company tenant databases
  console.log(`🏢 Connecting via Management DB to process company tenant databases...`);
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
      console.log('ℹ️ No matching active tenant companies found.');
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
        await updateUnitCostByBarcodes(tenantPrisma, costMap, batchSize, isDryRun);
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
  console.error('❌ Script execution failed:', err);
  process.exit(1);
});
