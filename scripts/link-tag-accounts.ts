// @ts-nocheck
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

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

export async function auditTagAccounts(prisma: PrismaClient, tenantLabel = 'MAIN') {
  console.log(`\n========================================`);
  console.log(`🔍 Auditing & Linking Tag Accounts for Tenant: ${tenantLabel}`);
  console.log(`========================================`);

  async function safeFindMany(modelName: string, queryOptions: any = {}) {
    try {
      return await (prisma as any)[modelName].findMany(queryOptions);
    } catch (e: any) {
      return [];
    }
  }

  // 1. Load all COA accounts with hierarchy (parent)
  const allAccounts = await safeFindMany('chartOfAccount', {
    include: { parent: true },
    orderBy: { code: 'asc' },
  });

  const parentMap = new Map<string, { id: string; code: string; name: string }>();
  allAccounts.forEach((acc: any) => {
    parentMap.set(acc.id, {
      id: acc.id,
      code: acc.code || '',
      name: acc.name || '',
    });
  });

  // 2. Build parent accounts set (accounts that have children underneath them)
  const parentAccountIds = new Set<string>();
  allAccounts.forEach((acc: any) => {
    if (acc.parentId) {
      parentAccountIds.add(acc.parentId);
    }
  });

  // Identify candidate Tag Accounts (sub-account leaf nodes, explicitly tagged accounts, or voucher tag references)
  const jvTags = await safeFindMany('journalVoucherDetail', { where: { tagAccountId: { not: null } }, select: { tagAccountId: true } });
  const pvTags = await safeFindMany('paymentVoucherDetail', { where: { tagAccountId: { not: null } }, select: { tagAccountId: true } });
  const rvTags = await safeFindMany('receiptVoucherDetail', { where: { tagAccountId: { not: null } }, select: { tagAccountId: true } });
  const atTags = await safeFindMany('accountTransaction', { where: { tagAccountId: { not: null } }, select: { tagAccountId: true } });

  const referencedTagIds = new Set<string>();
  jvTags.forEach((t: any) => t.tagAccountId && referencedTagIds.add(t.tagAccountId));
  pvTags.forEach((t: any) => t.tagAccountId && referencedTagIds.add(t.tagAccountId));
  rvTags.forEach((t: any) => t.tagAccountId && referencedTagIds.add(t.tagAccountId));
  atTags.forEach((t: any) => t.tagAccountId && referencedTagIds.add(t.tagAccountId));

  const candidateAccounts = allAccounts.filter((a: any) => {
    // If account has children underneath it, it is a Control/Parent Account (e.g. Authorized Capital), NOT a tag sub-account
    if (parentAccountIds.has(a.id) && !referencedTagIds.has(a.id)) {
      return false;
    }
    return a.isTagAccount || referencedTagIds.has(a.id) || (Boolean(a.parentId) && !a.isGroup);
  });

  console.log(`📌 Found ${candidateAccounts.length} total tag / sub-account(s) for audit (excluding control header accounts).`);

  // 3. Load Master entities for matching
  const customers = await safeFindMany('customer');
  const suppliers = await safeFindMany('supplier');
  const employees = await safeFindMany('employee');
  const payeeDirectors = await safeFindMany('payeeDirector');
  const payeeSalaries = await safeFindMany('payeeSalary');
  const payeeTaxes = await safeFindMany('payeeTax');
  const locations = await safeFindMany('location');
  const brands = await safeFindMany('brand');

  console.log(`\n📋 Master Entities Summary:`);
  console.log(`  • Customers: ${customers.length}`);
  console.log(`  • Suppliers/Vendors: ${suppliers.length}`);
  console.log(`  • Employees: ${employees.length}`);
  console.log(`  • Payee Directors: ${payeeDirectors.length}`);
  console.log(`  • Payee Salaries: ${payeeSalaries.length}`);
  console.log(`  • Payee Taxes: ${payeeTaxes.length}`);
  console.log(`  • Locations: ${locations.length}`);
  console.log(`  • Brands: ${brands.length}`);

  const codeToEntityMap = new Map<string, { type: string; code: string; name: string }>();
  const nameToEntityMap = new Map<string, { type: string; code: string; name: string }>();

  function registerEntity(type: string, code?: string | null, name?: string | null) {
    if (!name && !code) return;
    const item = { type, code: (code || '').trim(), name: (name || '').trim() };
    if (item.code) codeToEntityMap.set(item.code.toLowerCase(), item);
    if (item.name) nameToEntityMap.set(item.name.toLowerCase(), item);
  }

  customers.forEach((c: any) => registerEntity('Customer', c.subCode || c.traderId || c.code, c.name || c.company));
  suppliers.forEach((s: any) => registerEntity('Supplier', s.code, s.name));
  employees.forEach((e: any) => registerEntity('Employee', e.employeeId, e.employeeName));
  payeeDirectors.forEach((pd: any) => registerEntity('PayeeDirector', pd.code, pd.name));
  payeeSalaries.forEach((ps: any) => registerEntity('PayeeSalary', ps.code, ps.name));
  payeeTaxes.forEach((pt: any) => registerEntity('PayeeTax', pt.code, pt.name));
  locations.forEach((l: any) => registerEntity('Location', l.code, l.name));
  brands.forEach((b: any) => registerEntity('Brand', b.code, b.name));

  // 4. Perform identification and classification
  const exactMatches: any[] = [];
  const codeMatchedNameMismatch: any[] = [];
  const nameMatchedCodeMismatch: any[] = [];
  const unmatchedAccounts: any[] = [];

  for (const acc of candidateAccounts) {
    const accCode = (acc.code || '').trim();
    const accName = (acc.name || '').trim();
    const accCodeKey = accCode.toLowerCase();
    const accNameKey = accName.toLowerCase();

    const parentInfo = acc.parent
      ? { parentCode: acc.parent.code || '', parentName: acc.parent.name || '' }
      : (acc.parentId && parentMap.get(acc.parentId))
        ? { parentCode: parentMap.get(acc.parentId)?.code || '', parentName: parentMap.get(acc.parentId)?.name || '' }
        : { parentCode: 'N/A', parentName: 'No Parent' };

    const codeMatch = codeToEntityMap.get(accCodeKey);
    const nameMatch = nameToEntityMap.get(accNameKey);

    if (codeMatch && nameMatch && (codeMatch.code.toLowerCase() === accCodeKey && nameMatch.name.toLowerCase() === accNameKey)) {
      // Exact match
      exactMatches.push({
        accountId: acc.id,
        accountCode: accCode,
        accountName: accName,
        entityType: codeMatch.type,
        parentCode: parentInfo.parentCode,
        parentName: parentInfo.parentName,
      });
    } else if (codeMatch && (!nameMatch || codeMatch.name.toLowerCase() !== accNameKey)) {
      // Code matched -> report expected entity name
      codeMatchedNameMismatch.push({
        accountId: acc.id,
        accountCode: accCode,
        accountName: accName,
        matchedEntityType: codeMatch.type,
        expectedEntityName: codeMatch.name,
        parentCode: parentInfo.parentCode,
        parentName: parentInfo.parentName,
      });
    } else if (nameMatch && (!codeMatch || nameMatch.code.toLowerCase() !== accCodeKey)) {
      // Name matched -> report expected entity code
      nameMatchedCodeMismatch.push({
        accountId: acc.id,
        accountName: accName,
        accountCode: accCode,
        matchedEntityType: nameMatch.type,
        expectedEntityCode: nameMatch.code,
        parentCode: parentInfo.parentCode,
        parentName: parentInfo.parentName,
      });
    } else {
      // Unmatched account -> report with parent account info
      unmatchedAccounts.push({
        accountId: acc.id,
        accountCode: accCode,
        accountName: accName,
        parentCode: parentInfo.parentCode,
        parentName: parentInfo.parentName,
      });
    }
  }

  console.log(`\n========================================`);
  console.log(`📊 AUDIT RESULTS SUMMARY (${tenantLabel})`);
  console.log(`========================================`);
  console.log(`  ✅ Exact Matches (Code & Name): ${exactMatches.length}`);
  console.log(`  ⚠️ Code Matched (Name Mismatched): ${codeMatchedNameMismatch.length}`);
  console.log(`  ⚠️ Name Matched (Code Mismatched): ${nameMatchedCodeMismatch.length}`);
  console.log(`  ❌ Unmatched Accounts (with Parent): ${unmatchedAccounts.length}`);

  if (codeMatchedNameMismatch.length > 0) {
    console.log(`\n📌 Code Matched - Name Mismatched (Sample 10):`);
    console.table(codeMatchedNameMismatch.slice(0, 10));
  }

  if (nameMatchedCodeMismatch.length > 0) {
    console.log(`\n📌 Name Matched - Code Mismatched (Sample 10):`);
    console.table(nameMatchedCodeMismatch.slice(0, 10));
  }

  if (unmatchedAccounts.length > 0) {
    console.log(`\n📌 Unmatched Accounts with Parent (Sample 10):`);
    console.table(unmatchedAccounts.slice(0, 10));
  }

  // 5. Generate Excel Audit Report
  const workbook = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.json_to_sheet([
    { Metric: 'Tenant', Value: tenantLabel },
    { Metric: 'Audit Timestamp', Value: new Date().toISOString() },
    { Metric: 'Total Tag Accounts Inspected', Value: candidateAccounts.length },
    { Metric: 'Exact Matches (Code & Name)', Value: exactMatches.length },
    { Metric: 'Code Matched (Name Mismatched)', Value: codeMatchedNameMismatch.length },
    { Metric: 'Name Matched (Code Mismatched)', Value: nameMatchedCodeMismatch.length },
    { Metric: 'Unmatched Accounts', Value: unmatchedAccounts.length },
  ]);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  if (codeMatchedNameMismatch.length > 0) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(codeMatchedNameMismatch), 'Code Match - Name Mismatch');
  }

  if (nameMatchedCodeMismatch.length > 0) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(nameMatchedCodeMismatch), 'Name Match - Code Mismatch');
  }

  if (unmatchedAccounts.length > 0) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(unmatchedAccounts), 'Unmatched (with Parent)');
  }

  if (exactMatches.length > 0) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(exactMatches), 'Exact Matches');
  }

  const reportFileName = `tag-account-audit-${tenantLabel.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`;
  const reportPath = path.join(process.cwd(), reportFileName);
  XLSX.writeFile(workbook, reportPath);
  console.log(`\n💾 Audit report successfully written to: ${reportPath}`);

  return {
    exactMatches,
    codeMatchedNameMismatch,
    nameMatchedCodeMismatch,
    unmatchedAccounts,
    reportPath,
  };
}

async function main() {
  const managementUrl = process.env.DATABASE_URL_MANAGEMENT || process.env.MASTER_DATABASE_URL;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  const singleDbUrl = process.env.DATABASE_URL;

  let processedTenantsCount = 0;

  if (managementUrl && masterKey) {
    console.log('📡 Connecting to Master DB to query active companies/tenants...');
    const pool = new Pool({ connectionString: managementUrl });
    const adapter = new PrismaPg(pool);
    const management = new ManagementClient({ adapter } as any);

    try {
      await management.$connect();

      let companies: any[] = [];
      try {
        companies = await management.company.findMany({ where: { status: 'active' } });
      } catch {
        try {
          companies = await management.tenant.findMany({ where: { isDeleted: false } });
        } catch {
          companies = [];
        }
      }

      if (companies.length > 0) {
        console.log(`📡 Found ${companies.length} active company/tenant database(s). Running audit...`);
        for (const company of companies) {
          const cCode = company.code || company.dbName || 'TENANT';
          const cName = company.name || company.code || 'Tenant';
          console.log(`\n👉 Auditing tenant: ${cName} (${cCode})`);

          let connectionString = company.dbUrl;
          const rawPassword = company.dbPassword || company.dbPasswordEnc;
          const dbUser = company.dbUser || company.dbUsername;

          if (rawPassword) {
            try {
              const decPassword = encodeURIComponent(decrypt(rawPassword, masterKey));
              connectionString = `postgresql://${dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
            } catch {
              console.warn(`  ⚠️ Decryption failed for ${cCode}, using stored dbUrl...`);
            }
          }

          if (!connectionString) {
            console.error(`  ❌ No connection details for ${cCode}`);
            continue;
          }

          try {
            const tenantPool = new Pool({ connectionString });
            const tenantAdapter = new PrismaPg(tenantPool);
            const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

            try {
              await tenantPrisma.$connect();
              await auditTagAccounts(tenantPrisma, `${cName} (${cCode})`);
              processedTenantsCount++;
            } finally {
              await tenantPrisma.$disconnect();
              await tenantPool.end();
            }
          } catch (err: any) {
            console.error(`  ❌ Failed processing tenant ${cCode}: ${err.message}`);
          }
        }
      } else {
        console.log('ℹ️ No active companies/tenants found in Master DB.');
      }
    } catch (mErr: any) {
      console.warn(`⚠️ Master DB connection failed: ${mErr.message}`);
    } finally {
      await management.$disconnect().catch(() => {});
      await pool.end().catch(() => {});
    }
  }

  if (processedTenantsCount === 0 && singleDbUrl) {
    console.log('📡 Running audit script in Single Database Mode (using DATABASE_URL)...');
    const tenantPool = new Pool({ connectionString: singleDbUrl });
    const tenantAdapter = new PrismaPg(tenantPool);
    const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

    try {
      await tenantPrisma.$connect();
      await auditTagAccounts(tenantPrisma, 'MAIN');
    } finally {
      await tenantPrisma.$disconnect();
      await tenantPool.end();
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal script error:', err);
    process.exit(1);
  });
}
