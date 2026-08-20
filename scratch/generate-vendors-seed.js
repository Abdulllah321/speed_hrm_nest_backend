const fs = require('fs');
const path = require('path');

const supplierMdPath = path.join(__dirname, '..', 'supplier.md');
const seedVendorsPath = path.join(__dirname, '..', 'scripts', 'seed-vendors.ts');

const content = fs.readFileSync(supplierMdPath, 'utf8');
const lines = content.split('\n').map(l => l.trim()).filter(Boolean);

const localVendors = [];
const codeSeen = new Set();

for (let i = 1; i < lines.length; i++) {
  const parts = lines[i].split('\t');
  let code = parts[0]?.trim() || '';
  const name = parts[1]?.trim() || '';
  let nature = parts[2]?.trim() || '';
  const address = parts[3]?.trim() || '';
  const contactNo = parts[4]?.trim() || '';
  const cnic = parts[5]?.trim() || '';
  const ntn = parts[6]?.trim() || '';
  const strn = parts[7]?.trim() || '';
  const srb = parts[8]?.trim() || '';
  const pra = parts[9]?.trim() || '';
  const ict = parts[10]?.trim() || '';

  if (codeSeen.has(code)) {
    if (code === '120160' && name.includes('WATEEN')) {
      code = '120161';
    } else {
      code = code + '_DUP';
    }
  }
  codeSeen.add(code);

  if (!nature) {
    if (code === '120159') nature = 'GOODS';
    else nature = 'SERVICES';
  }

  let brands = undefined;
  if (code === '120159') brands = ['TAG HEUER'];
  if (code === '120095') brands = ['TISSOT', 'RADO'];
  if (code === '120107') brands = ['GUESS'];

  const obj = { code, name, nature, address };
  if (brands) obj.brands = brands;
  if (contactNo) obj.contactNo = contactNo;
  if (cnic) obj.cnic = cnic;
  if (ntn) obj.ntn = ntn;
  if (strn) obj.strn = strn;
  if (srb) obj.srb = srb;
  if (pra) obj.pra = pra;
  if (ict) obj.ict = ict;

  localVendors.push(obj);
}

const fileHeader = `import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';

type VendorNature = 'GOODS' | 'SERVICES' | 'RENT' | 'GOODS / SERVICES' | 'SERVICES/GOODS' | 'RENT / SERVICES';
type ImportBrandCategory = 'SPORTS' | 'FASHION' | 'WATCHES';

interface VendorSeed {
  code: string;
  name: string;
  brands?: string[];
  nature: VendorNature;
  address: string;
  contactNo?: string;
  cnic?: string;
  ntn?: string;
  strn?: string;
  srb?: string;
  pra?: string;
  ict?: string;
  accountCodes: string[];
}

function getAccountCodes(nature: VendorNature | string): string[] {
  switch (nature) {
    case 'GOODS':            return ['12010004'];
    case 'SERVICES':         return ['12030001'];
    case 'RENT':             return ['12030001'];
    case 'GOODS / SERVICES': return ['12010004', '12030001'];
    case 'SERVICES/GOODS':  return ['12010004', '12030001'];
    case 'RENT / SERVICES':  return ['12030001'];
    default:                 return ['12030001'];
  }
}

function getImportAccountCodes(category: ImportBrandCategory): string[] {
  switch (category) {
    case 'SPORTS':  return ['12010001'];
    case 'FASHION': return ['12010002'];
    case 'WATCHES': return ['12010003'];
  }
}

const rawLocalVendors: Array<Omit<VendorSeed, 'accountCodes'>> = ${JSON.stringify(localVendors, null, 2)};

const vendorsLocal: VendorSeed[] = rawLocalVendors.map(v => ({
  ...v,
  accountCodes: getAccountCodes(v.nature),
}));

const vendorsImport: VendorSeed[] = [
  // Sports Brands → 12010001
  { code: 'IMP001', brands: ['NIKE'],         name: 'NIKE GLOBAL TRADING BV SINGAPORE BRANCH', nature: 'GOODS', address: '30 Pasir Panjang Road No. 10-31/32, Mapletree Business City, Singapore 117440', accountCodes: getImportAccountCodes('SPORTS') },
  { code: 'IMP002', brands: ['NIKE'],         name: 'OD360 PTE LTD',                            nature: 'GOODS', address: '119 Genting Lane, #03-00, HB@ 119 Genting, Singapore, 349570', accountCodes: getImportAccountCodes('SPORTS') },
  { code: 'IMP003', brands: ['ADIDAS'],       name: 'ADIDAS EMERGING MARKETS FZE',              nature: 'GOODS', address: 'Dubai Design District (d3), Building No.2 4th Floor 32512 Dubai, UAE', contactNo: '971-4-5123500', accountCodes: getImportAccountCodes('SPORTS') },
  { code: 'IMP004', brands: ['ASICS'],        name: 'ASICS ARABIA FZE',                         nature: 'GOODS', address: 'ASICS Middle East Trading L.L.C. Unit 307B, Building No. 5, P.O. Box 49774 Dubai Design District, Dubai, UAE', accountCodes: getImportAccountCodes('SPORTS') },
  { code: 'IMP005', brands: ['BIRKENSTOCK'],  name: 'BIRKENSTOCK GLOBAL SALES GMBH',            nature: 'GOODS', address: 'Birkenstock Logistics GmbH Burg Ockenfels 53545 Linz am Rhein Germany', contactNo: '+49 2683 9359 0', accountCodes: getImportAccountCodes('SPORTS') },
  { code: 'IMP006', brands: ['PUMA'],         name: 'PUMA SOUTH EAST ASIA PTE LTD',             nature: 'GOODS', address: 'PUMA MIDDLE EAST FZ-LLC P.O. BOX 500626 DUBAI, UAE', contactNo: '971-4-5621222', accountCodes: getImportAccountCodes('SPORTS') },
  { code: 'IMP007', brands: ['UNDER ARMOUR'], name: 'UA SPORTS (S.E.A.) PTE. LTD.',             nature: 'GOODS', address: '7 Temasek Boulevard, #25-01, Suntec Tower One Singapore 038987 SGP', contactNo: '+65 6225 2881', accountCodes: getImportAccountCodes('SPORTS') },
  
  // Fashion Brands → 12010002
  { code: 'IMP008', brands: ['CHARLES & KEITH', 'PEDRO'], name: 'CHARLES & KEITH INTERNATIONAL PTE LTD', nature: 'GOODS', address: '6 Tai Seng Link, Level 8 Charles & Keith Group Headquarters Singapore 534101', contactNo: '+65 6488 2688', accountCodes: getImportAccountCodes('FASHION') },
  { code: 'IMP009', brands: ['USPA'],         name: 'SAAT VE SAAT SAN.VETİC.A.Ş.', nature: 'GOODS', address: 'Büyükdere Cad. Noramin İş Merkezi No:237/D Kat:B2 Maslak, İstanbul/Türkiye', contactNo: '+90 (212) 232 7 228', accountCodes: getImportAccountCodes('FASHION') },
  { code: 'IMP010', brands: ['DANISH DESIGN'], name: 'WEISZ GROUP',               nature: 'GOODS', address: 'Weisz Group Heijermanslaan 47A 1422 GV Uithoorn The Netherlands', contactNo: '+31 (0)20 679 46 33', accountCodes: getImportAccountCodes('FASHION') },
  { code: 'IMP011', brands: ['GUESS'],        name: 'PARAMOUNT ENTERPRISES PVT LTD.', nature: 'GOODS', address: '1 Dean Arcade Khy-Jami Block 8 Clifton Karachi Pakistan', accountCodes: getImportAccountCodes('FASHION') },

  // Watch Brands → 12010003
  { code: 'IMP012', brands: ['TAG HEUER'],    name: 'TAG HEUER',              nature: 'GOODS', address: 'Tag Heuer Branch of LVMH Swiss Manufactures SA Av. Luis-Joseph Chevrolet 4-6A CH-2300 La Chaux-de-Fond', accountCodes: getImportAccountCodes('WATCHES') },
  { code: 'IMP013', brands: ['TIMEX', 'NAUTICA'], name: 'TIMEX NEDERLAND B.V.',   nature: 'GOODS', address: 'TIMEX NEDERLAND B.V. TAURUSAVENUE 17A, 2132 LS HOOFDDORP, THE NETHERLANDS.', contactNo: '+31 23 556 3664', accountCodes: getImportAccountCodes('WATCHES') },
  { code: 'IMP014', brands: ['TIMBERLAND', 'POLICE'], name: 'ILG EMEA DWC LLC',       nature: 'GOODS', address: 'Plot No: WB27-WB28, Logistics District Dubai World Central, DUBAI, UNITED ARAB EMIRATES', contactNo: '+971 4 803 2222', accountCodes: getImportAccountCodes('WATCHES') },
  { code: 'IMP015', brands: ['TISSOT', 'RADO'], name: 'THE LEGEND',             nature: 'GOODS', address: '1-C Street 7A, Badar Commercial Area, DHA Ph V ext., Karachi.', contactNo: '021 35205108', accountCodes: getImportAccountCodes('WATCHES') },
];

const allVendors: VendorSeed[] = [...vendorsLocal, ...vendorsImport];

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

async function seedVendors(prisma: PrismaClient) {
  console.log('  Resolving chart of account IDs...');

  const uniqueCodes = Array.from(new Set(allVendors.flatMap(v => v.accountCodes)));
  const accounts = await prisma.chartOfAccount.findMany({
    where: { code: { in: uniqueCodes } },
    select: { id: true, code: true },
  });
  const accountMap = new Map(accounts.map(a => [a.code, a.id]));

  for (const code of uniqueCodes) {
    if (!accountMap.has(code)) {
      console.warn(\`  ⚠️  Chart of account not found for code: \${code} — run chart-of-account seed first\`);
    }
  }

  let created = 0, updated = 0, skipped = 0;

  for (const v of allVendors) {
    const chartOfAccountIds = v.accountCodes
      .map(c => accountMap.get(c))
      .filter(Boolean) as string[];

    const existing = await (prisma as any).supplier?.findFirst?.({ where: { code: v.code } })
      ?? await (prisma as any).vendor?.findFirst?.({ where: { code: v.code } });

    let normalizedNature = v.nature as string;
    if (normalizedNature === 'GOODS / SERVICES' || normalizedNature === 'SERVICES/GOODS') {
      normalizedNature = 'GOODS';
    } else if (normalizedNature === 'RENT / SERVICES') {
      normalizedNature = 'SERVICES';
    } else if (!normalizedNature) {
      normalizedNature = 'SERVICES';
    }

    const brandDisplay = v.brands ? v.brands.join(' / ') : null;

    const data = {
      code: v.code,
      name: v.name,
      brand: brandDisplay,
      type: v.code.startsWith('IMP') ? 'IMPORT' : 'LOCAL',
      nature: normalizedNature,
      address: v.address || null,
      contactNo: v.contactNo || null,
      cnicNo: v.cnic || null,
      ntnNo: v.ntn || null,
      strnNo: v.strn || null,
      srbNo: v.srb || null,
      praNo: v.pra || null,
      ictNo: v.ict || null,
    };

    try {
      const model = (prisma as any).supplier ?? (prisma as any).vendor;
      if (!model) {
        console.error('  ❌ No supplier model found in Prisma client');
        break;
      }

      let supplierId = existing?.id;

      if (existing) {
        await model.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        const createdSupplier = await model.create({ data });
        supplierId = createdSupplier.id;
        created++;
      }

      if (supplierId && v.brands && v.brands.length > 0) {
        await (prisma as any).supplierBrand?.deleteMany?.({ where: { supplierId } });
        for (const brandName of v.brands) {
          const brandRecord = await (prisma as any).brand.findFirst({
            where: { name: { equals: brandName.trim(), mode: 'insensitive' } }
          });
          if (brandRecord) {
            await (prisma as any).supplierBrand?.create?.({
              data: { supplierId, brandId: brandRecord.id },
            });
          }
        }
      }
    } catch (err: any) {
      console.warn(\`  ⚠️  Failed \${v.code}: \${err.message}\`);
      skipped++;
    }
  }

  console.log(\`  ✅ Vendors: \${created} created, \${updated} updated, \${skipped} skipped\`);
}

async function main() {
  console.log('🚀 Starting Vendor Seeding (Local & Import)...');

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
        companies = await management.company.findMany({ where: { status: 'active' } as any });
      } catch {
        try {
          companies = await (management as any).tenant.findMany({ where: { isDeleted: false } });
        } catch {
          companies = [];
        }
      }

      if (companies.length > 0) {
        console.log(\`📡 Found \${companies.length} active company/tenant database(s). Seeding vendors...\`);
        for (const company of companies) {
          const cCode = company.code || company.dbName || 'TENANT';
          const cName = company.name || company.code || 'Tenant';
          console.log(\`\\n👉 Seeding vendors for: \${cName} (\${cCode})\`);

          let connectionString = company.dbUrl;
          const rawPassword = company.dbPassword || company.dbPasswordEnc;
          const dbUser = company.dbUser || company.dbUsername;

          if (rawPassword) {
            try {
              const decPassword = encodeURIComponent(decrypt(rawPassword, masterKey));
              connectionString = \`postgresql://\${dbUser}:\${decPassword}@\${company.dbHost || 'localhost'}:\${company.dbPort || 5432}/\${company.dbName}?schema=public\`;
            } catch {
              console.warn(\`  ⚠️ Decryption failed, using stored dbUrl...\`);
            }
          }

          if (!connectionString) {
            console.error(\`  ❌ No connection details for \${cCode}\`);
            continue;
          }

          try {
            const tenantPool = new Pool({ connectionString });
            const tenantAdapter = new PrismaPg(tenantPool);
            const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

            try {
              await tenantPrisma.$connect();
              await seedVendors(tenantPrisma);
              processedTenantsCount++;
            } finally {
              await tenantPrisma.$disconnect();
              await tenantPool.end();
            }
          } catch (err: any) {
            console.error(\`  ❌ Failed processing tenant \${cCode}: \${err.message}\`);
          }
        }
      }
    } finally {
      await management.$disconnect().catch(() => {});
      await pool.end().catch(() => {});
    }
  }

  if (processedTenantsCount === 0 && singleDbUrl) {
    console.log('📡 Running vendor seed in Single Database Mode (using DATABASE_URL)...');
    const tenantPool = new Pool({ connectionString: singleDbUrl });
    const tenantAdapter = new PrismaPg(tenantPool);
    const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

    try {
      await tenantPrisma.$connect();
      await seedVendors(tenantPrisma);
    } finally {
      await tenantPrisma.$disconnect();
      await tenantPool.end();
    }
  }

  console.log('\\n✨ Vendor Seeding Complete.');
}

if (require.main === module) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
`;

fs.writeFileSync(seedVendorsPath, fileHeader, 'utf8');
console.log('Successfully generated updated scripts/seed-vendors.ts with consolidated import suppliers!');
