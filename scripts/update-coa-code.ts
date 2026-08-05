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

interface AccountCodeMapping {
  [accountNameNormalized: string]: {
    originalName: string;
    targetCode: string;
  };
}

/**
 * Reads Excel / CSV file and extracts mapping of Account Name -> Target Code
 */
function loadAccountMappingFromExcel(filePath: string): AccountCodeMapping {
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

  const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, {
    raw: false,
    defval: '',
  });

  if (rawRows.length === 0) {
    throw new Error(`Spreadsheet is empty.`);
  }

  const sampleRow = rawRows[0];
  const keys = Object.keys(sampleRow);

  const nameKey = keys.find(
    (k) =>
      /accountname/i.test(k.replace(/[\s_]/g, '')) ||
      /subaccount/i.test(k.replace(/[\s_]/g, '')) ||
      /name/i.test(k),
  );
  const codeKey = keys.find(
    (k) =>
      /newcode/i.test(k.replace(/[\s_]/g, '')) ||
      /accountcode/i.test(k.replace(/[\s_]/g, '')) ||
      /targetcode/i.test(k.replace(/[\s_]/g, '')) ||
      /code/i.test(k),
  );

  if (!nameKey || !codeKey) {
    throw new Error(
      `Could not determine 'Account Name' and 'Account Code' columns in file. Found columns: ${keys.join(', ')}`,
    );
  }

  console.log(`🎯 Using Columns -> Name: "${nameKey}", Code: "${codeKey}"`);

  const mapping: AccountCodeMapping = {};

  for (const row of rawRows) {
    const rawName = row[nameKey];
    const rawCode = row[codeKey];

    if (!rawName || !rawCode) continue;

    const name = String(rawName).trim();
    const targetCode = String(rawCode).trim();

    if (!name || !targetCode) continue;

    const normalizedName = name.toLowerCase();
    mapping[normalizedName] = {
      originalName: name,
      targetCode,
    };
  }

  return mapping;
}

/**
 * Updates account codes in database
 */
async function updateAccountCodes(
  prisma: PrismaClient,
  mapping: AccountCodeMapping,
  isDryRun: boolean = false,
) {
  const allAccounts = await prisma.chartOfAccount.findMany({
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      isGroup: true,
      parentId: true,
    },
  });

  console.log(`🔍 Total accounts found in database: ${allAccounts.length}`);

  let totalMatched = 0;
  let totalUpdated = 0;
  let totalAlreadyMatching = 0;

  for (const acc of allAccounts) {
    const normalizedDbName = acc.name.trim().toLowerCase();
    const mapMatch = mapping[normalizedDbName];

    if (mapMatch) {
      totalMatched++;
      const newCode = mapMatch.targetCode;

      if (acc.code === newCode) {
        totalAlreadyMatching++;
        console.log(
          `  ℹ️ [ALREADY SET] "${acc.name}" (ID: ${acc.id}) already has code "${acc.code}"`,
        );
        continue;
      }

      console.log(
        `  ${isDryRun ? '🔍 [DRY RUN]' : '✏️ [UPDATE]'} "${acc.name}" (ID: ${acc.id}): Code "${acc.code}" ➔ "${newCode}"`,
      );

      if (!isDryRun) {
        await prisma.chartOfAccount.update({
          where: { id: acc.id },
          data: { code: newCode },
        });
      }

      totalUpdated++;
    }
  }

  console.log(`\n--------------------------------------------------`);
  console.log(`📊 Matched Accounts    : ${totalMatched}`);
  console.log(
    `✏️ ${isDryRun ? 'Would Update' : 'Successfully Updated'} : ${totalUpdated}`,
  );
  console.log(`ℹ️ Already Up-to-Date  : ${totalAlreadyMatching}`);
  console.log(`--------------------------------------------------\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');

  // Check for Excel file argument
  const fileArgIdx = args.indexOf('--file');
  const filePath = fileArgIdx !== -1 ? args[fileArgIdx + 1] : null;

  // Custom single account override options
  const nameArgIdx = args.indexOf('--name');
  const targetName =
    nameArgIdx !== -1
      ? args[nameArgIdx + 1]
      : 'CORPORATE OFFICE-FASHION BRANDS';

  const codeArgIdx = args.indexOf('--code');
  const targetCode = codeArgIdx !== -1 ? args[codeArgIdx + 1] : 'C10004';

  let mapping: AccountCodeMapping = {};

  if (filePath) {
    console.log(`📁 Loading bulk account mapping from Excel file: ${filePath}`);
    mapping = loadAccountMappingFromExcel(filePath);
    console.log(
      `✔ Loaded ${Object.keys(mapping).length} account mapping(s) from Excel file.`,
    );
  } else {
    console.log(
      `📌 Using default target account mapping: "${targetName}" ➔ "${targetCode}"`,
    );
    mapping[targetName.trim().toLowerCase()] = {
      originalName: targetName.trim(),
      targetCode: targetCode.trim(),
    };
  }

  if (isDryRun) {
    console.log(
      `🔍 [DRY RUN MODE ENABLED] No actual database updates will be performed.\n`,
    );
  }

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  const directDbUrl = process.env.DATABASE_URL;

  // Single direct DB connection mode
  if (directDbUrl && (!managementUrl || args.includes('--single-db'))) {
    console.log(`🔗 Connecting directly via DATABASE_URL...`);
    const pool = new Pool({ connectionString: directDbUrl });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter });

    try {
      await prisma.$connect();
      await updateAccountCodes(prisma, mapping, isDryRun);
    } finally {
      await prisma.$disconnect();
      await pool.end();
    }
    return;
  }

  if (!managementUrl || !masterKey) {
    console.error(
      '❌ Neither DATABASE_URL nor DATABASE_URL_MANAGEMENT + MASTER_ENCRYPTION_KEY found in .env',
    );
    process.exit(1);
  }

  // Multi-tenant company databases connection mode
  console.log(
    `🏢 Connecting via Management DB to process company tenant databases...`,
  );
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
      console.log(
        `\n👉 Processing Company: ${company.name} (${company.code}) [DB: ${company.dbName}]`,
      );
      let connectionString = company.dbUrl;
      if (company.dbPassword) {
        try {
          const decPassword = encodeURIComponent(
            decrypt(company.dbPassword, masterKey),
          );
          connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
        } catch {
          console.warn(`  ⚠️ Password decryption failed, using stored dbUrl`);
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
        await updateAccountCodes(tenantPrisma, mapping, isDryRun);
      } catch (err: any) {
        console.error(
          `  ❌ Error processing company ${company.name}: ${err.message}`,
        );
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
