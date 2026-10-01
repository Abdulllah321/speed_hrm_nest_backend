import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient, Prisma } from '@prisma/client';
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

function cleanLocCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function parseExcelSerialDate(val: string | number): Date {
  const num = typeof val === 'number' ? val : parseFloat(String(val));
  if (isNaN(num) || num <= 0) return new Date();
  const excelEpoch = new Date(Date.UTC(1899, 11, 30));
  return new Date(excelEpoch.getTime() + num * 86400000);
}

export async function processTenantRefundVouchers(prisma: PrismaClient, rows: any[], tenantName: string) {
  console.log(`\n======================================================`);
  console.log(`🏢 Processing Tenant: ${tenantName}`);
  console.log(`======================================================`);

  // Group items by (Location ID, DocumentNumber)
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.locId.toUpperCase()}::${r.docNo}`;
    const list = groups.get(key) || [];
    list.push(r);
    groups.set(key, list);
  }

  console.log(`📑 Identified ${groups.size} unique Refund voucher memos.`);

  // Load locations
  const locations = await prisma.location.findMany({
    select: { id: true, code: true, shortCode: true, name: true },
  });
  const locMap = new Map<string, typeof locations[0]>();
  for (const l of locations) {
    if (l.code) locMap.set(l.code.toUpperCase(), l);
    if (l.shortCode) locMap.set(cleanLocCode(l.shortCode), l);
  }

  // Load existing REFUND vouchers
  const existingRefundVouchers = await prisma.voucher.findMany({
    where: { voucherType: 'REFUND' },
    select: { id: true, code: true, faceValue: true, isRedeemed: true, isActive: true },
  });
  const voucherByCode = new Map(existingRefundVouchers.map((v) => [v.code, v]));
  console.log(`🔍 Found ${existingRefundVouchers.length} existing REFUND vouchers in database.`);

  // Load PosReturns for linking
  const posReturns = await prisma.posReturn.findMany({
    where: { returnType: 'REFUND' },
    select: { id: true, returnNumber: true, voucherId: true },
  });
  const posReturnByNumber = new Map(posReturns.map((r) => [r.returnNumber, r]));

  let updatedCount = 0;
  let createdCount = 0;
  let linkedReturnCount = 0;
  let totalFaceValue = 0;

  for (const [key, groupRows] of groups.entries()) {
    const sample = groupRows[0];
    const loc = locMap.get(sample.locId.toUpperCase());
    if (!loc) {
      throw new Error(`Location not found for code: ${sample.locId}`);
    }

    const shortCode = loc.shortCode ? cleanLocCode(loc.shortCode) : cleanLocCode(loc.code);
    const padDoc = String(sample.docNo).padStart(5, '0');
    const voucherCode = `REF-${shortCode}27-${padDoc}`;

    const groupNetTotal = groupRows.reduce((acc, r) => acc + r.totalNet, 0);
    const roundedNetTotal = Math.round(groupNetTotal * 100) / 100;
    totalFaceValue += roundedNetTotal;

    const docDate = parseExcelSerialDate(sample.docDateRaw);

    const descParts = [
      `REFUND Voucher for Return #${voucherCode}`,
      sample.fkSaleDoc ? `(Sale #${sample.fkSaleDoc})` : '',
      sample.remarks ? `- ${sample.remarks}` : '',
    ].filter(Boolean);
    const description = descParts.join(' ');

    let voucher = voucherByCode.get(voucherCode);

    if (voucher) {
      // Update existing voucher with accurate face value, date, description, and location
      await prisma.voucher.update({
        where: { id: voucher.id },
        data: {
          faceValue: roundedNetTotal,
          description,
          issuedByLocationId: loc.id,
          createdAt: docDate,
        },
      });

      // Ensure VoucherLocation exists
      const existingLoc = await prisma.voucherLocation.findFirst({
        where: { voucherId: voucher.id, locationId: loc.id },
      });
      if (!existingLoc) {
        await prisma.voucherLocation.create({
          data: { voucherId: voucher.id, locationId: loc.id },
        });
      }

      // Ensure ISSUED VoucherTransaction exists
      const existingTx = await prisma.voucherTransaction.findFirst({
        where: { voucherId: voucher.id, action: 'ISSUED' },
      });
      if (!existingTx) {
        await prisma.voucherTransaction.create({
          data: {
            voucherId: voucher.id,
            locationId: loc.id,
            action: 'ISSUED',
            amountUsed: roundedNetTotal,
            notes: description,
            createdAt: docDate,
          },
        });
      } else {
        await prisma.voucherTransaction.update({
          where: { id: existingTx.id },
          data: {
            amountUsed: roundedNetTotal,
            notes: description,
            createdAt: docDate,
          },
        });
      }

      // Re-link PosReturn if needed
      const ret = posReturnByNumber.get(voucherCode);
      if (ret && ret.voucherId !== voucher.id) {
        await prisma.posReturn.update({
          where: { id: ret.id },
          data: { voucherId: voucher.id },
        });
        linkedReturnCount++;
      } else if (ret && ret.voucherId === voucher.id) {
        linkedReturnCount++;
      }

      updatedCount++;
    } else {
      // Create new voucher (e.g. REF-SSONLINE27-00521 and 00522)
      const newVoucher = await prisma.voucher.create({
        data: {
          code: voucherCode,
          voucherType: 'REFUND',
          faceValue: roundedNetTotal,
          description,
          issuedByLocationId: loc.id,
          isRedeemed: false,
          isActive: true,
          createdAt: docDate,
          updatedAt: docDate,
        },
      });

      await prisma.voucherLocation.create({
        data: {
          voucherId: newVoucher.id,
          locationId: loc.id,
        },
      });

      await prisma.voucherTransaction.create({
        data: {
          voucherId: newVoucher.id,
          locationId: loc.id,
          action: 'ISSUED',
          amountUsed: roundedNetTotal,
          notes: description,
          createdAt: docDate,
        },
      });

      // Link PosReturn
      const ret = posReturnByNumber.get(voucherCode);
      if (ret) {
        await prisma.posReturn.update({
          where: { id: ret.id },
          data: { voucherId: newVoucher.id },
        });
        linkedReturnCount++;
      }

      createdCount++;
    }
  }

  console.log(`\n======================================================`);
  console.log(`✨ [REFUND VOUCHERS SYNCHRONIZATION SUMMARY]`);
  console.log(`======================================================`);
  console.log(`1. TOTAL UNIQUE REFUND MEMOS : ${groups.size}`);
  console.log(`2. UPDATED EXISTING VOUCHERS  : ${updatedCount}`);
  console.log(`3. NEWLY CREATED VOUCHERS     : ${createdCount}`);
  console.log(`4. TOTAL FACE VALUE (PKR)     : PKR ${totalFaceValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`5. LINKED POS RETURNS         : ${linkedReturnCount} / ${groups.size}`);
  console.log(`======================================================\n`);

  // Final verification from database
  const finalRefundCount = await prisma.voucher.count({
    where: { voucherType: 'REFUND' },
  });
  const finalFaceValueSum = await prisma.voucher.aggregate({
    where: { voucherType: 'REFUND' },
    _sum: { faceValue: true },
  });
  const finalRedemptionsCount = await prisma.voucherRedemption.count({
    where: { voucher: { voucherType: 'REFUND' } },
  });
  const finalUnlinkedReturns = await prisma.posReturn.count({
    where: { returnType: 'REFUND', voucherId: null },
  });

  console.log(`Verification from DB:`);
  console.log(`- Total REFUND Vouchers in DB       : ${finalRefundCount}`);
  console.log(`- Total REFUND Face Value in DB     : PKR ${Number(finalFaceValueSum._sum.faceValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`- Preserved Redemptions in DB       : ${finalRedemptionsCount}`);
  console.log(`- Unlinked REFUND PosReturns in DB : ${finalUnlinkedReturns}`);
}

async function main() {
  const filePath = path.join(__dirname, '../data/converted.md');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Refund register file not found: ${filePath}`);
  }

  console.log(`📖 Reading refund register from ${filePath}...`);
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content
    .split('\n')
    .filter(
      (l) =>
        l.trim().startsWith('|') &&
        !l.includes('---') &&
        !l.includes('| Location |'),
    );

  const rows = lines.map((line, idx) => {
    const parts = line.split('|').map((s) => s.trim());
    return {
      lineIdx: idx + 1,
      costCentre: parts[1],
      locId: parts[2],
      docNo: parts[3],
      docDateRaw: parts[4],
      fkSaleDoc: parts[5] && parts[5] !== '0' && parts[5] !== '-' ? parts[5] : '',
      docDateSaleRaw: parts[6],
      totalNet: parseFloat(parts[7]) || 0,
      remarks: parts[8] && parts[8] !== '-' ? parts[8] : '',
    };
  });

  console.log(`📦 Loaded ${rows.length} total refund item rows.`);

  const explicitDb = process.argv.find(a => a.startsWith('--db='))?.split('=')[1];
  const managementUrl = process.env.DATABASE_URL_MANAGEMENT || process.env.DATABASE_URL;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  const tenantFilter = process.argv.find(arg => arg.startsWith('--tenant='))?.split('=')[1];

  if (!explicitDb && managementUrl && masterKey) {
    const pool = new Pool({ connectionString: managementUrl });
    const adapter = new PrismaPg(pool);
    const management = new ManagementClient({ adapter } as any);

    let companies: any[] = [];
    try {
      const where: any = { status: 'active' };
      if (tenantFilter) {
        where.OR = [
          { name: { contains: tenantFilter, mode: 'insensitive' } },
          { dbName: { contains: tenantFilter, mode: 'insensitive' } },
          { code: { contains: tenantFilter, mode: 'insensitive' } },
        ];
      }
      companies = await management.company.findMany({ where });
    } catch (err: any) {
      console.warn(`ℹ️ Multi-tenant lookup skipped: ${err.message}`);
    } finally {
      await management.$disconnect();
      await pool.end();
    }

    if (companies.length > 0) {
      console.log(`\n🏢 Found ${companies.length} active tenant companies. Executing...`);
      for (const company of companies) {
        let connectionString = company.dbUrl;
        if (company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch (e: any) {
            console.warn(`⚠️ Could not decrypt password for company ${company.name}, using dbUrl directly.`);
          }
        }
        const tenantPool = new Pool({ connectionString });
        const tenantAdapter = new PrismaPg(tenantPool);
        const prisma = new PrismaClient({ adapter: tenantAdapter } as any);

        try {
          await processTenantRefundVouchers(prisma, rows, company.name);
        } catch (err: any) {
          console.error(`❌ Error processing tenant ${company.name}:`, err);
        } finally {
          await prisma.$disconnect();
          await tenantPool.end();
        }
      }
      return;
    }
  }

  // Fallback to direct DATABASE_URL
  const directConn =
    explicitDb ||
    process.env.DATABASE_URL_TENANT ||
    'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi';
  console.log(`\n⚙️ Connecting directly via database (${directConn})...`);
  const directPool = new Pool({ connectionString: directConn });
  const directAdapter = new PrismaPg(directPool);
  const prisma = new PrismaClient({ adapter: directAdapter } as any);

  try {
    await processTenantRefundVouchers(prisma, rows, 'Direct Database');
  } finally {
    await prisma.$disconnect();
    await directPool.end();
  }
}

main().catch((err) => {
  console.error('Fatal error synchronizing refund vouchers:', err);
  process.exit(1);
});
