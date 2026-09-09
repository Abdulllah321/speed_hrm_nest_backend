import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Pool } from 'pg';
import { PrismaClient, MovementType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';

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

// Parse command line arguments
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
========================================================================
🚀 Multi-Store POS Sales & Returns/Exchanges Importer
========================================================================

Usage:
  bun scripts/import-sslg-sales-and-returns.ts [options]

Options:
  --location=<code|all>    Target store code or shortCode (e.g. SS1010, SS1002, all) [default: all]
  --sales-file=<path>      Path to sales markdown (.md) or JSON file [default: data/sales.md]
  --returns-file=<path>    Path to returns markdown (.md) or JSON file [default: data/sales-return-converted.md]
  --dry-run                Simulate import without writing to database
  --sales-only             Only import sales orders
  --returns-only           Only import returns & exchanges
  --limit=<number>         Limit number of orders/returns per location (for testing)
  --batch-size=<number>    Progress batch logging size [default: 100]
  --tenant=<dbName>        Tenant DB name [default: tenant_speed_main_mox1gfsi]
  --single-db              Connect directly via DATABASE_URL without management DB
  --help, -h               Show this help message
  `);
  process.exit(0);
}

const isDryRun = args.includes('--dry-run');
const salesOnly = args.includes('--sales-only');
const returnsOnly = args.includes('--returns-only');
const limitArg = args.find((a) => a.startsWith('--limit='));
const recordLimit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;
const batchSizeArg = args.find((a) => a.startsWith('--batch-size='));
const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1], 10) : 100;
const tenantArg = args.find((a) => a.startsWith('--tenant='));
const targetTenantDb = tenantArg ? tenantArg.split('=')[1] : 'tenant_speed_main_mox1gfsi';
const locationArg = args.find((a) => a.startsWith('--location=') || a.startsWith('-l='));
const targetLocationFilter = locationArg ? locationArg.split('=')[1].trim() : 'all';

// File paths
const salesFileArg = args.find((a) => a.startsWith('--sales-file=') || a.startsWith('--sales='));
const returnsFileArg = args.find((a) => a.startsWith('--returns-file=') || a.startsWith('--returns='));

const defaultSalesMd = path.join(__dirname, '../data/sales.md');
const defaultSalesJson = path.join(__dirname, '../data/SS_LG_2526_SALES.json');
const salesFilePath = salesFileArg
  ? path.resolve(salesFileArg.split('=')[1])
  : fs.existsSync(defaultSalesMd)
    ? defaultSalesMd
    : defaultSalesJson;

const defaultReturnsMd = path.join(__dirname, '../data/sales-return-converted.md');
const defaultReturnsJson = path.join(__dirname, '../data/SS_LG2526_Sales_return.json');
const returnsFilePath = returnsFileArg
  ? path.resolve(returnsFileArg.split('=')[1])
  : fs.existsSync(defaultReturnsMd)
    ? defaultReturnsMd
    : defaultReturnsJson;

if (!returnsOnly && !fs.existsSync(salesFilePath)) {
  console.error(`❌ Sales file not found at ${salesFilePath}`);
  process.exit(1);
}
if (!salesOnly && !fs.existsSync(returnsFilePath)) {
  console.error(`❌ Returns file not found at ${returnsFilePath}`);
  process.exit(1);
}

/**
 * Parses Excel serial numbers (e.g. 45839 or 46151.6638...) or string dates (e.g. "7/1/25" or "10/26/25 19:10")
 */
function parseCustomDate(val?: string | number | null): Date {
  if (val === null || val === undefined || val === '') return new Date();
  const sVal = String(val).trim();
  const num = Number(sVal);
  if (!isNaN(num) && !sVal.includes('/') && !sVal.includes('-') && !sVal.includes(':')) {
    if (num > 20000 && num < 80000) {
      // Excel serial date: days since 1899-12-30
      const ms = Math.round((num - 25569) * 86400 * 1000);
      return new Date(ms);
    }
  }

  const parts = sVal.split(' ');
  const dateParts = parts[0].split('/');
  if (dateParts.length === 3) {
    const month = parseInt(dateParts[0], 10) - 1;
    const day = parseInt(dateParts[1], 10);
    let year = parseInt(dateParts[2], 10);
    if (year < 100) year += 2000;

    let hours = 0;
    let minutes = 0;
    if (parts[1]) {
      const timeParts = parts[1].split(':');
      hours = parseInt(timeParts[0], 10) || 0;
      minutes = parseInt(timeParts[1], 10) || 0;
    }
    return new Date(year, month, day, hours, minutes);
  }

  const d = new Date(sVal);
  return isNaN(d.getTime()) ? new Date() : d;
}

interface RawSaleRow {
  'Location ID'?: string;
  DocumentNumber: string | number;
  DocumentDate: string | number;
  BarCode: string;
  Quantity: string | number;
  UnitPrice: string | number;
  Price_W_O_T?: string | number;
  Total_Price_W_O_T?: string | number;
  DiscountAmount?: string | number;
  'Value Ex Sales Tax'?: string | number;
  'Sales Tax'?: string | number;
  'Additional Sales Tax'?: string | number;
  'Total Sales Tax'?: string | number;
  'Value Incl Sales Tax'?: string | number;
  CashSale?: string | number;
  CashRetrun?: string | number;
  CardSale?: string | number;
  CreditSale?: string | number;
  GiftVoucherAmount?: string | number;
  CreditVoucherAmount?: string | number;
  ExchangeVoucherAmount?: string | number;
  ClaimVoucherAmount?: string | number;
  GiftVoucherAmount_Corporate?: string | number;
  CreditVoucherIssuedAmount?: string | number;
  RewardVoucherAmount?: string | number;
  OnCreditAmount?: string | number;
  CostCentre?: string;
  'POS ID'?: string | number;
  'FBR Invoice#'?: string;
  FKExchangeVoucherNumber?: string;
  DiscountRate_Given?: string | number;
  Remarks?: string;
  'Is Alliance Discount'?: string;
  FKSalesPersonID?: string;
  SalesPerson?: string;
  _sourceSection?: string;
}

interface RawReturnRow {
  CostCentre?: string;
  'Location id'?: string;
  'Location ID'?: string;
  Type?: string;
  'Sub Type'?: string;
  'SUB Type'?: string;
  DocumentDate: string | number;
  DocumentNumber: string | number;
  SalesPersonName?: string;
  Barcode?: string;
  Quantity?: string | number;
  UnitPrice?: string | number;
  TaxRate1?: string | number;
  Price_W_O_T?: string | number;
  Total_Price_W_O_T?: string | number;
  'Discounted Value'?: string | number;
  DiscountAmount?: string | number;
  'Value Ex Sales Tax'?: string | number;
  'Sales Tax'?: string | number;
  'Additional Sales Tax'?: string | number;
  'Total Sales Tax'?: string | number;
  'Value Incl Sales Tax'?: string | number;
  FKInvoiceNumber_Sale?: string | number;
  DocumentDate_Sale?: string | number;
  FKInvoiceNumber_Exchange?: string | number;
  DocumentDate_Exchange?: string | number;
  _sourceSection?: string;
}

const KNOWN_LOCATION_ALIASES: Record<string, string> = {
  'SS-DMC': 'SS1002',
  'SPEED SPORTS-DOLMEN CLIFTON': 'SS1002',
  'ADIDAS JINNAH ICON': 'A10002',
  'ADIDAS-JINNAH ICON MALL': 'A10002',
  'SS-ONLINE': 'SS1011',
  'SPEED SPORTS-ONLINE': 'SS1011',
  'SS-LOM': 'SS1001',
  'SPEED SPORTS-LUCKY ONE MALL': 'SS1001',
  'SS-MOM': 'SS1009',
  'SPEED SPORTS-MALL OF MULTAN': 'SS1009',
  'SS-SGM': 'SS1007',
  'SPEED SPORTS-SAFA MALL': 'SS1007',
  'SPEED SPORTS-SAFA GOLD MALL': 'SS1007',
  'SS-TF': 'SS1012',
  'SPEED SPORTS-THE FORUM': 'SS1012',
  'SM-BTQ': 'W10004',
  'TAG HEUER-SAFA MALL': 'W10004',
  'WATCH OUTLET-SAFA GOLD MALL': 'W10004',
  'SS-DML': 'SS1006',
  'SPEED SPORTS-DOLMEN LAHORE': 'SS1006',
  'SS-EM': 'SS1005',
  'SPEED SPORTS-EMPORIUM MALL': 'SS1005',
  'SS-FA': 'SS1004',
  'SPEED SPORTS-FOUNTAIN AVENUE': 'SS1004',
  'SS-GIGA': 'SS1008',
  'SPEED SPORTS-GIGA MALL': 'SS1008',
  'NCM': 'N10004',
  'NIKE-CENTAURUS MALL': 'N10004',
  'NDMC': 'N10001',
  'NIKE-DOLMEN CLIFTON': 'N10001',
  'NPM': 'N10003',
  'NIKE-PACKAGES MALL': 'N10003',
  'NSGM': 'N10005',
  'NIKE-SAFA MALL': 'N10005',
  'NIKE-SAFA GOLD MALL': 'N10005',
  'NXM': 'N10002',
  'NIKE-XINHUA MALL': 'N10002',
  'PDMC': 'P10001',
  'PEDRO-DOLMEN CLIFTON': 'P10001',
  'PDML': 'P10003',
  'PEDRO-DOLMEN LAHORE': 'P10003',
  'PM-BTQ': 'W10003',
  'TAG HEUER-PACKAGES MALL': 'W10003',
  'WATCH OUTLET-PACKAGES MALL': 'W10003',
  'P-ONLINE': 'P10004',
  'PEDRO-ONLINE': 'P10004',
  'POS-CORPORATE': 'W10012',
  'POINT OF SALES - CORPORATE': 'W10012',
  'PPM': 'P10002',
  'PEDRO-PACKAGES MALL': 'P10002',
  'PUMA-DML': 'PU1001',
  'PUMA - DOLMEN MALL LAHORE': 'PU1001',
  'PUMA-DOLMEN LAHORE': 'PU1001',
  'ADIDAS LUCKY MALL': 'A10001',
  'ADIDAS-LUCKY ONE MALL': 'A10001',
  'ADIDAS MADISON MALL': 'A10003',
  'ADIDAS - MADISON SQUARE': 'A10003',
  'ADIDAS-MADISON SQUARE': 'A10003',
  'ADIDAS-MADISON SQUARE MALL': 'A10003',
  'CK-CM': 'CK1006',
  'CHARLES & KEITH-CENTAURUS MALL': 'CK1006',
  'C&K-CENTAURUS MALL': 'CK1006',
  'CK-DMC': 'CK1001',
  'CHARLES & KEITH-DOLMEN CLIFTON': 'CK1001',
  'C&K-DOLMEN CLIFTON': 'CK1001',
  'CK-DML': 'CK1005',
  'CHARLES & KEITH-DOLMEN LAHORE': 'CK1005',
  'C&K-DOLMEN LAHORE': 'CK1005',
  'CK-EM': 'CK1003',
  'CHARLES & KEITH-EMPORIUM MALL': 'CK1003',
  'C&K-EMPORIUM MALL': 'CK1003',
  'CK-LOM': 'CK1002',
  'CHARLES & KEITH-LUCKY ONE': 'CK1002',
  'C&K-LUCKY ONE MALL': 'CK1002',
  'CK-PM': 'CK1004',
  'CHARLES & KEITH-PACKAGES MALL': 'CK1004',
  'C&K-PACKAGES MALL': 'CK1004',
  'DMC-BTQ': 'W10001',
  'TAG HEUER-DOLMEN CLIFTON': 'W10001',
  'WATCH OUTLET-DOLMEN CLIFTON': 'W10001',
  'EM-BTQ': 'W10002',
  'TAG HEUER-EMPORIUM MALL': 'W10002',
  'WATCH OUTLET-EMPORIUM MALL': 'W10002',
  'GIGA-BTQ': 'W10005',
  'TAG HEUER-GIGA MALL': 'W10005',
  'WATCH OUTLET-GIGA MALL': 'W10005',
  'IWC-DML': 'W10009',
  'SPL POS-IWC DOLMEN LAHORE': 'W10009',
  'IWC-DMTR': 'W10007',
  'SPL POS-IWC DOLMEN TARIQ ROAD': 'W10007',
  'IWC-KINGSON': 'W10008',
  'SPL POS-IWC KINGSON': 'W10008',
  'SPL POS-IWC KINGSONG MALL': 'W10008',
  'IWC-LOM': 'W10006',
  'SPL POS-IWC LUCKY ONE': 'W10006',
  'IWC-RAWALPINDI': 'W10010',
  'SPL POS-IWC RAWALPINDI': 'W10010',
  'IWC-SIALKOT': 'W10011',
  'SPL POS-IWC SIALKOT': 'W10011',
  'SS-LG': 'SS1010',
  'SPEED SPORTS-LYALLPUR GALLERIA': 'SS1010',
};

const resolutionCache = new Map<string, { location: any; warehouse: any } | null>();

function resolveLocation(
  rawIdentifier: string,
  dbLocations: any[],
  dbWarehouses: any[],
): { location: any; warehouse: any } | null {
  if (!rawIdentifier) return null;
  const q = rawIdentifier.trim();
  if (resolutionCache.has(q)) {
    return resolutionCache.get(q)!;
  }

  const upperQ = q.toUpperCase();
  const cleanQ = upperQ.replace(/[^A-Z0-9]/g, '');

  // 1. Direct code or shortCode match
  let loc = dbLocations.find(
    (l) =>
      l.code.toUpperCase() === upperQ ||
      (l.shortCode && l.shortCode.toUpperCase() === upperQ) ||
      l.code.toUpperCase().replace(/[^A-Z0-9]/g, '') === cleanQ ||
      (l.shortCode && l.shortCode.toUpperCase().replace(/[^A-Z0-9]/g, '') === cleanQ),
  );

  // 2. Direct name match
  if (!loc) {
    loc = dbLocations.find((l) => l.name.toUpperCase() === upperQ);
  }

  // 3. Known aliases match
  if (!loc && KNOWN_LOCATION_ALIASES[upperQ]) {
    const aliasCode = KNOWN_LOCATION_ALIASES[upperQ];
    loc = dbLocations.find((l) => l.code === aliasCode);
  }

  // 4. Substring contains match
  if (!loc) {
    loc = dbLocations.find(
      (l) =>
        l.name.toUpperCase().includes(upperQ) ||
        upperQ.includes(l.name.toUpperCase()),
    );
  }

  if (!loc) {
    resolutionCache.set(q, null);
    return null;
  }

  // Resolve warehouse
  let warehouse = dbWarehouses.find((w) => w.id === loc.warehouseId);
  if (!warehouse) {
    warehouse =
      dbWarehouses.find((w) => w.code === 'C40001') ||
      dbWarehouses.find((w) => w.isActive) ||
      dbWarehouses[0];
  }

  const result = { location: loc, warehouse };
  resolutionCache.set(q, result);
  return result;
}

/**
 * Streams and parses a markdown table line-by-line
 */
async function* streamMarkdownRows(filePath: string): AsyncGenerator<{
  section: string;
  row: Record<string, string>;
}> {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let currentSection = '';
  let headers: string[] = [];

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('#')) {
      currentSection = trimmed.replace(/^#+\s*/, '').trim();
      headers = [];
      continue;
    }

    if (trimmed.includes('---')) continue;

    let cleanLine = trimmed;
    if (cleanLine.startsWith('|')) cleanLine = cleanLine.slice(1);
    if (cleanLine.endsWith('|')) cleanLine = cleanLine.slice(0, -1);

    const cells = cleanLine.split('|').map((c) => c.trim());
    if (cells.length === 0) continue;

    if (
      cells.includes('DocumentNumber') ||
      cells.includes('Location id') ||
      cells.includes('Location ID') ||
      cells.includes('CostCentre') ||
      cells.includes('BarCode') ||
      cells.includes('Barcode')
    ) {
      headers = cells;
      continue;
    }

    if (headers.length > 0) {
      const rowObj: Record<string, string> = {};
      for (let i = 0; i < headers.length; i++) {
        rowObj[headers[i]] = cells[i] !== undefined ? cells[i] : '';
      }
      yield { section: currentSection, row: rowObj };
    }
  }
}

async function loadSalesRows(
  filePath: string,
  predicate?: (section: string, row: Record<string, string>) => boolean,
): Promise<RawSaleRow[]> {
  if (filePath.endsWith('.json')) {
    const all: RawSaleRow[] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return predicate ? all.filter((r) => predicate(r._sourceSection || '', r as any)) : all;
  }

  const rows: RawSaleRow[] = [];
  for await (const { section, row } of streamMarkdownRows(filePath)) {
    if (predicate && !predicate(section, row)) continue;
    rows.push({
      ...(row as any),
      _sourceSection: section,
    });
  }
  return rows;
}

async function loadReturnRows(
  filePath: string,
  predicate?: (section: string, row: Record<string, string>) => boolean,
): Promise<RawReturnRow[]> {
  if (filePath.endsWith('.json')) {
    const all: RawReturnRow[] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return predicate ? all.filter((r) => predicate(r._sourceSection || '', r as any)) : all;
  }

  const rows: RawReturnRow[] = [];
  for await (const { section, row } of streamMarkdownRows(filePath)) {
    if (predicate && !predicate(section, row)) continue;
    rows.push({
      ...(row as any),
      _sourceSection: section,
    });
  }
  return rows;
}

async function main() {
  console.log(`========================================================================`);
  console.log(`🚀 Multi-Store POS Sales & Returns/Exchanges Importer`);
  console.log(`========================================================================`);
  console.log(`⚙️ Target Location: ${targetLocationFilter}`);
  console.log(`⚙️ Sales File     : ${salesFilePath}`);
  console.log(`⚙️ Returns File   : ${returnsFilePath}`);
  console.log(`⚙️ Options        : Dry-Run: ${isDryRun} | Sales-Only: ${salesOnly} | Returns-Only: ${returnsOnly}`);

  // 1. Connect to Tenant DB
  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  const directDbUrl = process.env.DATABASE_URL;

  let tenantConnStr = '';
  if (directDbUrl && (!managementUrl || args.includes('--single-db'))) {
    console.log(`🔗 Connecting directly via DATABASE_URL...`);
    tenantConnStr = directDbUrl;
  } else if (managementUrl) {
    console.log(`🏢 Resolving tenant DB '${targetTenantDb}' via Management DB...`);
    const mgmtPool = new Pool({ connectionString: managementUrl });
    const compRes = await mgmtPool.query(`
      SELECT id, name, code, "dbName", "dbUser", "dbPassword", "dbHost", "dbPort", "dbUrl"
      FROM "Company"
      WHERE status = 'active' AND "dbName" = '${targetTenantDb}'
    `);
    await mgmtPool.end();

    if (!compRes.rows[0]) {
      console.error(`❌ Could not find tenant company for db: ${targetTenantDb}`);
      process.exit(1);
    }
    const company = compRes.rows[0];
    tenantConnStr = company.dbUrl;
    if (company.dbPassword && masterKey) {
      try {
        const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
        tenantConnStr = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
      } catch {
        console.warn(`  ⚠️ Decryption failed, using default dbUrl`);
      }
    }
  } else if (directDbUrl) {
    tenantConnStr = directDbUrl;
  } else {
    console.error('❌ Neither DATABASE_URL nor DATABASE_URL_MANAGEMENT found in .env');
    process.exit(1);
  }

  const tenantPool = new Pool({ connectionString: tenantConnStr });
  const adapter = new PrismaPg(tenantPool);
  const prisma = new PrismaClient({ adapter });

  // 2. Pre-fetch all Locations and Warehouses
  const dbLocations = await prisma.location.findMany({
    select: { id: true, code: true, name: true, shortCode: true, warehouseId: true },
  });
  const dbWarehouses = await prisma.warehouse.findMany({
    select: { id: true, code: true, name: true, isActive: true },
  });
  console.log(`✔ Loaded ${dbLocations.length} locations and ${dbWarehouses.length} warehouses from DB.`);

  // 3. Cache Items in memory
  console.log(`📦 Pre-caching items in memory...`);
  const allDbItems = await prisma.item.findMany({
    select: { id: true, barCode: true, unitPrice: true, unitCost: true },
  });
  const itemCache = new Map<string, any>();
  for (const it of allDbItems) {
    if (it.barCode) itemCache.set(it.barCode.trim(), it);
  }
  console.log(`✔ Cached ${itemCache.size} items from database.`);

  const fySuffix = '26'; // FY2025-26

  // Helper to resolve or create missing item
  async function getOrCreateItem(rawBarcode: string, unitPrice: number): Promise<any> {
    const cleanBc = String(rawBarcode || '').replace(/^['"\s]+|['"\s]+$/g, '');
    if (!cleanBc) {
      throw new Error(`Empty barcode encountered in data!`);
    }

    let it = itemCache.get(cleanBc);
    if (it) return it;

    // Check DB in case it wasn't pre-cached
    it = await prisma.item.findFirst({
      where: { OR: [{ barCode: cleanBc }, { sku: cleanBc }] },
      select: { id: true, barCode: true, unitPrice: true, unitCost: true },
    });
    if (it) {
      itemCache.set(cleanBc, it);
      return it;
    }

    if (isDryRun) {
      const mockItem = { id: `mock-${cleanBc}`, barCode: cleanBc, unitPrice, unitCost: unitPrice * 0.7 };
      itemCache.set(cleanBc, mockItem);
      return mockItem;
    }

    console.warn(`  ⚠️ Barcode '${cleanBc}' not found in Item catalog. Creating placeholder item...`);
    it = await prisma.item.create({
      data: {
        itemId: `ITEM-${cleanBc}`,
        sku: `SKU-${cleanBc}`,
        barCode: cleanBc,
        description: `Imported Item (${cleanBc})`,
        unitPrice: unitPrice,
        unitCost: Math.round(unitPrice * 0.7 * 100) / 100,
        status: 'active',
        isActive: true,
      },
      select: { id: true, barCode: true, unitPrice: true, unitCost: true },
    });
    itemCache.set(cleanBc, it);
    return it;
  }

  // Location filter set
  const allowedLocationFilters =
    targetLocationFilter.toLowerCase() === 'all'
      ? null
      : targetLocationFilter.split(',').map((s) => s.trim().toUpperCase());

  const salesPredicate = allowedLocationFilters
    ? (sec: string, row: Record<string, string>) => {
        const locKey = sec || row.CostCentre || row['Location ID'] || '';
        const resolved = resolveLocation(locKey, dbLocations, dbWarehouses);
        if (!resolved) return false;
        const loc = resolved.location;
        return (
          allowedLocationFilters.includes(loc.code.toUpperCase()) ||
          (loc.shortCode && allowedLocationFilters.includes(loc.shortCode.toUpperCase())) ||
          allowedLocationFilters.includes(loc.name.toUpperCase())
        );
      }
    : undefined;

  const returnsPredicate = allowedLocationFilters
    ? (sec: string, row: Record<string, string>) => {
        const locKey = row['Location id'] || row['Location ID'] || row.CostCentre || sec || '';
        const resolved = resolveLocation(locKey, dbLocations, dbWarehouses);
        if (!resolved) return false;
        const loc = resolved.location;
        return (
          allowedLocationFilters.includes(loc.code.toUpperCase()) ||
          (loc.shortCode && allowedLocationFilters.includes(loc.shortCode.toUpperCase())) ||
          allowedLocationFilters.includes(loc.name.toUpperCase())
        );
      }
    : undefined;

  // 4. Load Sales Data
  let rawSales: RawSaleRow[] = [];
  if (!returnsOnly) {
    console.log(`\n📥 Loading Sales Data from ${salesFilePath}...`);
    rawSales = await loadSalesRows(salesFilePath, salesPredicate);
    console.log(`✔ Loaded ${rawSales.length.toLocaleString()} raw sales rows.`);
  }

  // 5. Load Returns Data
  let rawReturns: RawReturnRow[] = [];
  if (!salesOnly) {
    console.log(`\n📥 Loading Returns Data from ${returnsFilePath}...`);
    rawReturns = await loadReturnRows(returnsFilePath, returnsPredicate);
    console.log(`✔ Loaded ${rawReturns.length.toLocaleString()} raw return rows.`);
  }

  // Group Sales by Location
  const salesByLocationId = new Map<string, { location: any; warehouse: any; rows: RawSaleRow[] }>();
  if (!returnsOnly) {
    for (const r of rawSales) {
      const locKey = r._sourceSection || r.CostCentre || r['Location ID'] || '';
      const resolved = resolveLocation(locKey, dbLocations, dbWarehouses);
      if (!resolved) {
        console.warn(`⚠️ Could not resolve location for sale row with key: "${locKey}"`);
        continue;
      }
      const loc = resolved.location;
      if (allowedLocationFilters) {
        const matches =
          allowedLocationFilters.includes(loc.code.toUpperCase()) ||
          (loc.shortCode && allowedLocationFilters.includes(loc.shortCode.toUpperCase())) ||
          allowedLocationFilters.includes(loc.name.toUpperCase());
        if (!matches) continue;
      }

      if (!salesByLocationId.has(loc.id)) {
        salesByLocationId.set(loc.id, { location: loc, warehouse: resolved.warehouse, rows: [] });
      }
      salesByLocationId.get(loc.id)!.rows.push(r);
    }
  }

  // Group Returns by Location
  const returnsByLocationId = new Map<string, { location: any; warehouse: any; rows: RawReturnRow[] }>();
  if (!salesOnly) {
    for (const r of rawReturns) {
      const locKey = r['Location id'] || r['Location ID'] || r.CostCentre || r._sourceSection || '';
      const resolved = resolveLocation(locKey, dbLocations, dbWarehouses);
      if (!resolved) {
        console.warn(`⚠️ Could not resolve location for return row with key: "${locKey}"`);
        continue;
      }
      const loc = resolved.location;
      if (allowedLocationFilters) {
        const matches =
          allowedLocationFilters.includes(loc.code.toUpperCase()) ||
          (loc.shortCode && allowedLocationFilters.includes(loc.shortCode.toUpperCase())) ||
          allowedLocationFilters.includes(loc.name.toUpperCase());
        if (!matches) continue;
      }

      if (!returnsByLocationId.has(loc.id)) {
        returnsByLocationId.set(loc.id, { location: loc, warehouse: resolved.warehouse, rows: [] });
      }
      returnsByLocationId.get(loc.id)!.rows.push(r);
    }
  }

  // Identify all target locations to process
  const targetLocationIds = Array.from(
    new Set([...salesByLocationId.keys(), ...returnsByLocationId.keys()]),
  );

  console.log(`\n🏢 Found ${targetLocationIds.length} store location(s) to process.`);
  for (const locId of targetLocationIds) {
    const locMeta = salesByLocationId.get(locId) || returnsByLocationId.get(locId)!;
    const sCount = salesByLocationId.get(locId)?.rows.length || 0;
    const rCount = returnsByLocationId.get(locId)?.rows.length || 0;
    console.log(`   - ${locMeta.location.code.padEnd(8)} | ${(locMeta.location.shortCode || '').padEnd(12)} | ${locMeta.location.name} (Sales: ${sCount.toLocaleString()} rows, Returns: ${rCount.toLocaleString()} rows)`);
  }

  let grandTotalSalesOrders = 0;
  let grandTotalSalesRevenue = 0;
  let grandTotalReturnsCount = 0;
  let grandTotalReturnValue = 0;

  // Process Each Location
  for (const locId of targetLocationIds) {
    const locData = salesByLocationId.get(locId) || returnsByLocationId.get(locId)!;
    const location = locData.location;
    const warehouse = locData.warehouse;
    const cleanLocationCode = (location.shortCode || location.code).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

    console.log(`\n========================================================================`);
    console.log(`🏢 Processing Store: ${location.name} (${location.code}, Short: ${location.shortCode})`);
    console.log(`🏭 Central Warehouse: ${warehouse.name} (${warehouse.code})`);
    console.log(`========================================================================`);

    // Pre-cache InventoryItems for this store
    const initialInvItems = await prisma.inventoryItem.findMany({
      where: { locationId: location.id, status: 'AVAILABLE' },
      select: { id: true, itemId: true, quantity: true },
    });
    const invMap = new Map<string, any>();
    for (const inv of initialInvItems) {
      invMap.set(inv.itemId, inv);
    }
    console.log(`✔ Pre-cached ${invMap.size} inventory items for store ${location.code}.`);

    const salesOrderByDocNum = new Map<string, any>();
    const salesOrderItemsByOrderId = new Map<string, any[]>();

    // --------------------------------------------------------------------
    // PHASE 1: SALES ORDERS
    // --------------------------------------------------------------------
    const storeSalesRows = salesByLocationId.get(locId)?.rows || [];
    if (!returnsOnly && storeSalesRows.length > 0) {
      console.log(`\n📥 [PHASE 1] Processing ${storeSalesRows.length.toLocaleString()} Sales Rows...`);

      // Group sales by DocumentNumber
      const salesGroups = new Map<string, RawSaleRow[]>();
      for (const s of storeSalesRows) {
        const docNo = String(s.DocumentNumber).trim();
        if (!salesGroups.has(docNo)) salesGroups.set(docNo, []);
        salesGroups.get(docNo)!.push(s);
      }

      console.log(`📋 Grouped into ${salesGroups.size.toLocaleString()} distinct Cash Memo sales orders.`);

      let processedOrders = 0;
      let totalSalesLines = 0;
      let totalSalesRevenue = 0;
      let totalSalesQty = 0;

      const groupEntries = Array.from(salesGroups.entries());
      const groupsToProcess = recordLimit ? groupEntries.slice(0, recordLimit) : groupEntries;

      for (let b = 0; b < groupsToProcess.length; b += batchSize) {
        const batch = groupsToProcess.slice(b, b + batchSize);

        for (const [docNoStr, groupRows] of batch) {
          const sample = groupRows[0];
          const docNum = parseInt(docNoStr, 10);
          const docDate = parseCustomDate(sample.DocumentDate);
          const padDoc = String(docNum).padStart(5, '0');
          const orderNumber = `SI-${cleanLocationCode}${fySuffix}-${padDoc}`;

          // Compute totals from lines
          const subtotal = groupRows.reduce(
            (acc, r) =>
              acc +
              (parseFloat(String(r.Total_Price_W_O_T)) ||
                parseFloat(String(r.Price_W_O_T)) * parseFloat(String(r.Quantity)) ||
                0),
            0,
          );
          const discountAmount = groupRows.reduce(
            (acc, r) => acc + (parseFloat(String(r.DiscountAmount)) || 0),
            0,
          );
          const taxAmount = groupRows.reduce(
            (acc, r) => acc + (parseFloat(String(r['Total Sales Tax'])) || 0),
            0,
          );
          const grandTotal = groupRows.reduce(
            (acc, r) =>
              acc +
              (parseFloat(String(r['Value Incl Sales Tax'])) ||
                parseFloat(String(r.UnitPrice)) * parseFloat(String(r.Quantity)) ||
                0),
            0,
          );

          totalSalesRevenue += grandTotal;

          // Payment tenders
          const cashAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.CashSale)) || 0), 0);
          const cardAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.CardSale)) || 0), 0);
          const creditAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.CreditSale)) || 0), 0);
          const exchangeAmount = groupRows.reduce(
            (acc, r) => acc + (parseFloat(String(r.ExchangeVoucherAmount)) || 0),
            0,
          );
          const giftAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.GiftVoucherAmount)) || 0), 0);
          const claimAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.ClaimVoucherAmount)) || 0), 0);
          const corpAmount = groupRows.reduce(
            (acc, r) => acc + (parseFloat(String(r.GiftVoucherAmount_Corporate)) || 0),
            0,
          );
          const creditVoucherAmount = groupRows.reduce(
            (acc, r) => acc + (parseFloat(String(r.CreditVoucherAmount)) || 0),
            0,
          );
          const rewardAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.RewardVoucherAmount)) || 0), 0);
          const creditIssuedAmount = groupRows.reduce(
            (acc, r) => acc + (parseFloat(String(r.CreditVoucherIssuedAmount)) || 0),
            0,
          );
          const cashReturnAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.CashRetrun)) || 0), 0);

          const totalVoucherAmount =
            exchangeAmount + giftAmount + claimAmount + corpAmount + creditVoucherAmount + rewardAmount;

          let paymentMethod = 'cash';
          const tendersCount = [cashAmount > 0, cardAmount > 0, totalVoucherAmount > 0, creditAmount > 0].filter(
            Boolean,
          ).length;
          if (tendersCount > 1) {
            paymentMethod = 'split';
          } else if (cardAmount > 0) {
            paymentMethod = 'card';
          } else if (totalVoucherAmount > 0) {
            paymentMethod = 'voucher';
          } else if (creditAmount > 0) {
            paymentMethod = 'credit_account';
          }

          const notesParts = [`Original DocNo: ${docNoStr}`, `POS ID: ${sample['POS ID'] || '1'}`];
          const sp = sample.SalesPerson || sample.FKSalesPersonID;
          if (sp) notesParts.push(`SalesPerson: ${sp}`);
          if (sample.Remarks && sample.Remarks.trim() !== ';') notesParts.push(`Remarks: ${sample.Remarks.trim()}`);
          if (sample.FKExchangeVoucherNumber && sample.FKExchangeVoucherNumber.trim()) {
            notesParts.push(`ExVoucherRef: ${sample.FKExchangeVoucherNumber.trim()}`);
          }

          if (cashAmount > 0) notesParts.push(`[Cash Sale] Amount: ${cashAmount.toFixed(2)}`);
          if (cardAmount > 0) notesParts.push(`[Card Sale] Amount: ${cardAmount.toFixed(2)}`);
          if (exchangeAmount > 0) notesParts.push(`[Exchange Voucher] Amount: ${exchangeAmount.toFixed(2)}`);
          if (claimAmount > 0) notesParts.push(`[Claim Voucher] Amount: ${claimAmount.toFixed(2)}`);
          if (corpAmount > 0) notesParts.push(`[Corporate Voucher] Amount: ${corpAmount.toFixed(2)}`);
          if (giftAmount > 0) notesParts.push(`[Gift Voucher] Amount: ${giftAmount.toFixed(2)}`);
          if (creditVoucherAmount > 0) notesParts.push(`[Credit Voucher] Amount: ${creditVoucherAmount.toFixed(2)}`);
          if (rewardAmount > 0) notesParts.push(`[Reward Voucher] Amount: ${rewardAmount.toFixed(2)}`);
          if (creditAmount > 0) notesParts.push(`[Credit Sale] Balance: ${creditAmount.toFixed(2)}`);
          if (creditIssuedAmount > 0)
            notesParts.push(`[Credit Voucher Issued] Amount: ${creditIssuedAmount.toFixed(2)}`);
          if (cashReturnAmount > 0) notesParts.push(`[Cash Return] Amount: ${cashReturnAmount.toFixed(2)}`);

          const fbrInv = sample['FBR Invoice#'] ? sample['FBR Invoice#'].replace(/^'/, '').trim() : null;

          if (isDryRun) {
            processedOrders++;
            totalSalesLines += groupRows.length;
            totalSalesQty += groupRows.reduce((acc, r) => acc + (parseFloat(String(r.Quantity)) || 0), 0);
            salesOrderByDocNum.set(docNoStr, { id: `dry-${orderNumber}`, orderNumber, posId: sample['POS ID'] });
            continue;
          }

          // Check if order already exists
          const existingOrder = await prisma.salesOrder.findFirst({
            where: { orderNumber },
            select: { id: true },
          });

          if (existingOrder) {
            await prisma.voucherRedemption.deleteMany({ where: { orderId: existingOrder.id } });
            await prisma.stockMovement.deleteMany({ where: { referenceId: existingOrder.id } });
            await prisma.stockLedger.deleteMany({ where: { referenceId: existingOrder.id } });
            await prisma.salesOrderItem.deleteMany({ where: { salesOrderId: existingOrder.id } });
            await prisma.salesOrder.delete({ where: { id: existingOrder.id } });
          }
          await prisma.stockMovement.deleteMany({
            where: { movementNo: { startsWith: `MV-SALE-${orderNumber}-` } },
          });

          const salesOrder = await prisma.salesOrder.create({
            data: {
              orderNumber,
              posId: String(sample['POS ID'] || '1'),
              locationId: location.id,
              subtotal: Math.round(subtotal * 100) / 100,
              discountAmount: Math.round(discountAmount * 100) / 100,
              taxAmount: Math.round(taxAmount * 100) / 100,
              grandTotal: Math.round(grandTotal * 100) / 100,
              paymentMethod,
              paymentStatus: 'paid',
              status: 'completed',
              notes: notesParts.join(' | '),
              fbrInvoiceNumber: fbrInv,
              cashAmount: cashAmount > 0 ? Math.round(cashAmount * 100) / 100 : undefined,
              cardAmount: cardAmount > 0 ? Math.round(cardAmount * 100) / 100 : undefined,
              voucherAmount: totalVoucherAmount > 0 ? Math.round(totalVoucherAmount * 100) / 100 : undefined,
              createdAt: docDate,
            },
          });

          salesOrderByDocNum.set(docNoStr, salesOrder);

          const createdItems: any[] = [];
          let sIdx = 0;

          for (const row of groupRows) {
            sIdx++;
            const bc = String(row.BarCode).trim();
            const unitPrice = parseFloat(String(row.UnitPrice)) || 0;
            const item = await getOrCreateItem(bc, unitPrice);

            const qty = Math.abs(parseFloat(String(row.Quantity)) || 1);
            const lineDiscount = parseFloat(String(row.DiscountAmount)) || 0;
            const lineTax = parseFloat(String(row['Total Sales Tax'])) || 0;
            const lineValExTax = parseFloat(String(row['Value Ex Sales Tax'])) || 0;
            const calculatedTaxPct =
              lineValExTax > 0 ? Math.round((lineTax / lineValExTax) * 100 * 100) / 100 : 18;
            const lineTotal =
              parseFloat(String(row['Value Incl Sales Tax'])) ||
              Math.round((unitPrice * qty - lineDiscount + lineTax) * 100) / 100;

            totalSalesQty += qty;

            const orderItem = await prisma.salesOrderItem.create({
              data: {
                salesOrderId: salesOrder.id,
                itemId: item.id,
                quantity: Math.round(qty),
                unitPrice: Math.round(unitPrice * 100) / 100,
                discountAmount: Math.round(lineDiscount * 100) / 100,
                taxAmount: Math.round(lineTax * 100) / 100,
                taxPercent: calculatedTaxPct,
                lineTotal: Math.round(lineTotal * 100) / 100,
                createdAt: docDate,
              },
            });
            createdItems.push(orderItem);

            // 1. StockLedger Outbound entry
            await prisma.stockLedger.create({
              data: {
                itemId: item.id,
                warehouseId: warehouse.id,
                locationId: location.id,
                qty: -qty, // Negative for OUTBOUND sale
                referenceType: 'POS_SALE',
                referenceId: salesOrder.id,
                movementType: MovementType.OUTBOUND,
                unitCost: Number(item.unitCost) || unitPrice,
                createdAt: docDate,
              },
            });

            // 2. StockMovement audit log
            const movNo = `MV-SALE-${orderNumber}-${bc}-${sIdx}`;
            await prisma.stockMovement.upsert({
              where: { movementNo: movNo },
              update: {
                itemId: item.id,
                fromLocationId: location.id,
                quantity: qty,
                type: 'SALE',
                referenceType: 'POS_SALE',
                referenceId: salesOrder.id,
                movementDate: docDate,
                notes: `POS Sale #${orderNumber}`,
              },
              create: {
                movementNo: movNo,
                itemId: item.id,
                fromLocationId: location.id,
                quantity: qty,
                type: 'SALE',
                referenceType: 'POS_SALE',
                referenceId: salesOrder.id,
                movementDate: docDate,
                createdAt: docDate,
                notes: `POS Sale #${orderNumber}`,
              },
            });

            // 3. Decrement InventoryItem stock
            let invItem = invMap.get(item.id);
            if (invItem) {
              await prisma.inventoryItem.update({
                where: { id: invItem.id },
                data: { quantity: { decrement: qty } },
              });
              invItem.quantity = Number(invItem.quantity) - qty;
            } else {
              invItem = await prisma.inventoryItem.create({
                data: {
                  locationId: location.id,
                  warehouseId: warehouse.id,
                  itemId: item.id,
                  quantity: -qty,
                  status: 'AVAILABLE',
                },
              });
              invMap.set(item.id, invItem);
            }

            totalSalesLines++;
          }

          salesOrderItemsByOrderId.set(salesOrder.id, createdItems);
          processedOrders++;
        }

        console.log(`  ⏳ Sales: Processed ${processedOrders}/${groupsToProcess.length} orders (${totalSalesLines.toLocaleString()} item lines)...`);
      }

      grandTotalSalesOrders += processedOrders;
      grandTotalSalesRevenue += totalSalesRevenue;

      console.log(`✅ [PHASE 1 COMPLETE] Imported ${processedOrders} Sales Orders for ${location.name}:`);
      console.log(`   - Sequence: SI-${cleanLocationCode}${fySuffix}-00001 to SI-${cleanLocationCode}${fySuffix}-${String(processedOrders).padStart(5, '0')}`);
      console.log(`   - Revenue : PKR ${totalSalesRevenue.toLocaleString()}`);
    }

    // --------------------------------------------------------------------
    // PHASE 2: RETURNS & EXCHANGES
    // --------------------------------------------------------------------
    const storeReturnRows = returnsByLocationId.get(locId)?.rows || [];
    if (!salesOnly && storeReturnRows.length > 0) {
      console.log(`\n📥 [PHASE 2] Processing ${storeReturnRows.length.toLocaleString()} Return Rows...`);

      // Group returns by SubType and DocumentNumber
      const returnGroups = new Map<string, RawReturnRow[]>();
      for (const r of storeReturnRows) {
        const subType = (r['Sub Type'] || r['SUB Type'] || 'Exchange').trim();
        const docNo = String(r.DocumentNumber).trim();
        const key = `${subType}_${docNo}`;
        if (!returnGroups.has(key)) returnGroups.set(key, []);
        returnGroups.get(key)!.push(r);
      }

      console.log(`📋 Grouped into ${returnGroups.size.toLocaleString()} Return Documents.`);

      let processedReturns = 0;
      let totalReturnLines = 0;
      let totalReturnQty = 0;
      let totalVoucherValue = 0;
      let linkedReturnsToSales = 0;
      let redeemedVouchersCount = 0;

      const groupEntries = Array.from(returnGroups.entries());
      const groupsToProcess = recordLimit ? groupEntries.slice(0, recordLimit) : groupEntries;

      for (const [groupKey, groupRows] of groupsToProcess) {
        const sample = groupRows[0];
        const subType = (sample['Sub Type'] || sample['SUB Type'] || 'Exchange').trim();
        const subTypePrefix = subType.toUpperCase() === 'CLAIM' ? 'CLM' : 'EXC';
        const voucherType = subType.toUpperCase() === 'CLAIM' ? 'CLAIM' : 'EXCHANGE';
        const docNum = parseInt(String(sample.DocumentNumber).trim(), 10);
        const padDoc = String(docNum).padStart(5, '0');
        const voucherCode = `${subTypePrefix}-${cleanLocationCode}-${padDoc}`;
        const docDate = parseCustomDate(sample.DocumentDate);

        // Normalize item rows with auto-detection of direct vs shifted columns
        const parsedItems = groupRows.map((r) => {
          const isDirectFormat = Boolean(
            r.Barcode &&
              String(r.Barcode).trim().length > 0 &&
              ((!isNaN(Number(r.UnitPrice)) && Number(r.UnitPrice) > 50) ||
                (!isNaN(Number(r.Quantity)) && Number(r.Quantity) <= 20)),
          );

          if (isDirectFormat) {
            const bc = String(r.Barcode || '').replace(/^['"\s]+|['"\s]+$/g, '');
            const qty = parseFloat(String(r.Quantity)) || 1;
            const retailUnitPrice = parseFloat(String(r.UnitPrice)) || 0;
            const taxRate = parseFloat(String(r.TaxRate1)) || 18;
            const priceWot = parseFloat(String(r.Price_W_O_T)) || 0;
            const totalPriceWot = parseFloat(String(r.Total_Price_W_O_T)) || 0;
            const discountAmt = parseFloat(String(r.DiscountAmount)) || 0;
            const valExTax = parseFloat(String(r['Value Ex Sales Tax'])) || 0;
            const salesTax = parseFloat(String(r['Sales Tax'])) || 0;
            const totalSalesTax = parseFloat(String(r['Total Sales Tax'])) || 0;
            const valInclTax = parseFloat(String(r['Value Incl Sales Tax'])) || retailUnitPrice * qty;
            const originalSaleDocNo = String(r.FKInvoiceNumber_Sale || '').trim();
            const settlementExchangeDocNo = String(r.FKInvoiceNumber_Exchange || '').trim();

            return {
              bc,
              qty,
              retailUnitPrice,
              taxRate,
              priceWot,
              totalPriceWot,
              discountAmt,
              valExTax,
              salesTax,
              totalSalesTax,
              valInclTax,
              originalSaleDocNo,
              settlementExchangeDocNo,
              salesPerson: r.SalesPersonName,
            };
          } else {
            // Legacy shifted format
            const bc = (r.Barcode && r.Barcode.trim()) || String(r.Quantity || '').replace(/['"\s]/g, '').trim();
            const qty = parseFloat(String(r.UnitPrice)) || 1;
            const retailUnitPrice = parseFloat(String(r.TaxRate1)) || 0;
            const taxRate = parseFloat(String(r.Price_W_O_T)) || 18;
            const priceWot = parseFloat(String(r.Total_Price_W_O_T)) || 0;
            const totalPriceWot = parseFloat(String(r['Discounted Value'])) || 0;
            const discountAmt = parseFloat(String(r['Value Ex Sales Tax'])) || 0;
            const valExTax = parseFloat(String(r['Sales Tax'])) || 0;
            const salesTax = parseFloat(String(r['Additional Sales Tax'])) || 0;
            const totalSalesTax = parseFloat(String(r['Value Incl Sales Tax'])) || 0;
            const valInclTax = parseFloat(String(r.FKInvoiceNumber_Sale)) || retailUnitPrice * qty;
            const originalSaleDocNo = String(r.DocumentDate_Sale || '').trim();
            const settlementExchangeDocNo = String(r.DocumentDate_Exchange || '').trim();

            return {
              bc,
              qty,
              retailUnitPrice,
              taxRate,
              priceWot,
              totalPriceWot,
              discountAmt,
              valExTax,
              salesTax,
              totalSalesTax,
              valInclTax,
              originalSaleDocNo,
              settlementExchangeDocNo,
              salesPerson: r.SalesPersonName,
            };
          }
        });

        const returnTotalValue = parsedItems.reduce((acc, it) => acc + it.valInclTax, 0);
        const returnTotalWost = parsedItems.reduce((acc, it) => acc + it.totalPriceWot, 0);
        const returnTotalDiscount = parsedItems.reduce((acc, it) => acc + it.discountAmt, 0);
        const returnTotalTax = parsedItems.reduce((acc, it) => acc + it.totalSalesTax, 0);

        totalVoucherValue += returnTotalValue;
        const originalSaleDocNo = parsedItems[0].originalSaleDocNo;
        const settlementExchangeDocNo = parsedItems[0].settlementExchangeDocNo;
        const isRedeemed = Boolean(settlementExchangeDocNo && settlementExchangeDocNo !== '0');

        if (isDryRun) {
          processedReturns++;
          totalReturnLines += groupRows.length;
          totalReturnQty += parsedItems.reduce((acc, it) => acc + it.qty, 0);
          if (originalSaleDocNo) linkedReturnsToSales++;
          if (isRedeemed) redeemedVouchersCount++;
          continue;
        }

        // 1. Locate original SalesOrder
        let originalSalesOrder = salesOrderByDocNum.get(originalSaleDocNo);
        if (!originalSalesOrder && originalSaleDocNo) {
          const padSaleDoc = String(parseInt(originalSaleDocNo, 10)).padStart(5, '0');
          const targetOrderNumber = `SI-${cleanLocationCode}${fySuffix}-${padSaleDoc}`;
          originalSalesOrder = await prisma.salesOrder.findFirst({
            where: { orderNumber: targetOrderNumber, locationId: location.id },
            include: { items: true },
          });
        }

        let targetOrderId: string;

        if (originalSalesOrder) {
          targetOrderId = originalSalesOrder.id;
          linkedReturnsToSales++;

          await prisma.salesOrder.update({
            where: { id: originalSalesOrder.id },
            data: {
              status: 'returned',
              returnNumber: voucherCode,
            },
          });
        } else {
          const fallbackOrderNumber = `RET-${cleanLocationCode}-${padDoc}`;
          const fallbackOrder = await prisma.salesOrder.upsert({
            where: { orderNumber: fallbackOrderNumber },
            update: {
              returnNumber: voucherCode,
              status: 'returned',
            },
            create: {
              orderNumber: fallbackOrderNumber,
              returnNumber: voucherCode,
              locationId: location.id,
              subtotal: Math.round(returnTotalWost * 100) / 100,
              discountAmount: Math.round(returnTotalDiscount * 100) / 100,
              taxAmount: Math.round(returnTotalTax * 100) / 100,
              grandTotal: Math.round(returnTotalValue * 100) / 100,
              paymentMethod: 'voucher',
              paymentStatus: 'paid',
              status: 'returned',
              notes: `Standalone Return #${voucherCode} (Original Sale Doc #${originalSaleDocNo})`,
              createdAt: docDate,
            },
          });
          targetOrderId = fallbackOrder.id;
        }

        // 2. Create / Upsert Voucher
        const voucher = await prisma.voucher.upsert({
          where: { code: voucherCode },
          update: {
            voucherType,
            faceValue: Math.round(returnTotalValue * 100) / 100,
            description: `${voucherType} Voucher for Return Doc #${docNum} (Sale #${originalSaleDocNo || 'N/A'})`,
            issuedByLocationId: location.id,
            sourceOrderId: targetOrderId,
            isActive: true,
            isRedeemed,
            createdAt: docDate,
          },
          create: {
            code: voucherCode,
            voucherType,
            faceValue: Math.round(returnTotalValue * 100) / 100,
            description: `${voucherType} Voucher for Return Doc #${docNum} (Sale #${originalSaleDocNo || 'N/A'})`,
            issuedByLocationId: location.id,
            sourceOrderId: targetOrderId,
            isActive: true,
            isRedeemed,
            createdAt: docDate,
          },
        });

        // 3. Clean existing PosReturn if re-running
        const existingPosReturn = await prisma.posReturn.findUnique({
          where: { returnNumber: voucherCode },
          select: { id: true },
        });
        if (existingPosReturn) {
          await prisma.posReturnItem.deleteMany({ where: { posReturnId: existingPosReturn.id } });
          await prisma.stockMovement.deleteMany({ where: { referenceId: existingPosReturn.id } });
          await prisma.stockLedger.deleteMany({ where: { referenceId: existingPosReturn.id } });
          await prisma.posReturn.delete({ where: { id: existingPosReturn.id } });
        }
        await prisma.stockMovement.deleteMany({
          where: { movementNo: { startsWith: `MV-RET-${voucherCode}-` } },
        });

        // 4. Create PosReturn
        const posReturn = await prisma.posReturn.create({
          data: {
            returnNumber: voucherCode,
            salesOrderId: targetOrderId,
            returnType: voucherType,
            refundMode: 'VOUCHER',
            locationId: location.id,
            posId: originalSalesOrder?.posId || null,
            subtotalWost: Math.round(returnTotalWost * 100) / 100,
            discountWost: Math.round(returnTotalDiscount * 100) / 100,
            taxAmount: Math.round(returnTotalTax * 100) / 100,
            totalRefundAmount: Math.round(returnTotalValue * 100) / 100,
            voucherId: voucher.id,
            reason: sample.SalesPersonName ? `SalesPerson: ${sample.SalesPersonName}` : `Return ${subType}`,
            createdAt: docDate,
          },
        });

        const orderItems = originalSalesOrder
          ? salesOrderItemsByOrderId.get(originalSalesOrder.id) ||
            (await prisma.salesOrderItem.findMany({ where: { salesOrderId: originalSalesOrder.id } }))
          : [];

        let rIdx = 0;
        for (const itemRow of parsedItems) {
          rIdx++;
          const item = await getOrCreateItem(itemRow.bc, itemRow.retailUnitPrice);

          totalReturnQty += itemRow.qty;

          const matchingOrderItem = orderItems.find((oi: any) => oi.itemId === item.id);
          let salesOrderItemId = matchingOrderItem?.id;

          if (!salesOrderItemId) {
            const existingSoItem = await prisma.salesOrderItem.findFirst({
              where: { salesOrderId: targetOrderId, itemId: item.id },
              select: { id: true },
            });
            if (existingSoItem) {
              salesOrderItemId = existingSoItem.id;
            } else {
              // Create corresponding sales order item on targetOrder so FK constraint is satisfied
              const createdSoItem = await prisma.salesOrderItem.create({
                data: {
                  salesOrderId: targetOrderId,
                  itemId: item.id,
                  quantity: Math.round(itemRow.qty),
                  unitPrice: Math.round(itemRow.retailUnitPrice * 100) / 100,
                  discountAmount: Math.round(itemRow.discountAmt * 100) / 100,
                  taxAmount: Math.round(itemRow.totalSalesTax * 100) / 100,
                  taxPercent: itemRow.taxRate,
                  lineTotal: Math.round(itemRow.valInclTax * 100) / 100,
                  createdAt: docDate,
                },
                select: { id: true, itemId: true },
              });
              salesOrderItemId = createdSoItem.id;
              orderItems.push(createdSoItem);
            }
          }

          await prisma.posReturnItem.create({
            data: {
              posReturnId: posReturn.id,
              salesOrderItemId: salesOrderItemId,
              itemId: item.id,
              quantity: Math.round(itemRow.qty),
              originalUnitPrice: Math.round(itemRow.retailUnitPrice * 100) / 100,
              originalPaidPerUnit:
                itemRow.qty > 0 ? Math.round((itemRow.valInclTax / itemRow.qty) * 100) / 100 : itemRow.retailUnitPrice,
              refundPerUnit:
                itemRow.qty > 0 ? Math.round((itemRow.valInclTax / itemRow.qty) * 100) / 100 : itemRow.retailUnitPrice,
              priceAdjusted: false,
              unitPriceWost: Math.round(itemRow.priceWot * 10000) / 10000,
              lineTotalWost: Math.round(itemRow.totalPriceWot * 100) / 100,
              discountPercent:
                itemRow.totalPriceWot > 0
                  ? Math.round((itemRow.discountAmt / itemRow.totalPriceWot) * 100 * 100) / 100
                  : 0,
              discountWost: Math.round(itemRow.discountAmt * 100) / 100,
              taxPercent: itemRow.taxRate,
              taxAmount: Math.round(itemRow.totalSalesTax * 100) / 100,
              lineTotal: Math.round(itemRow.valInclTax * 100) / 100,
              reason: itemRow.salesPerson ? `SalesPerson: ${itemRow.salesPerson}` : undefined,
              createdAt: docDate,
            },
          });

          // 5. Stock Restoration (INBOUND Ledger + InventoryItem increment)
          await prisma.stockLedger.create({
            data: {
              itemId: item.id,
              warehouseId: warehouse.id,
              locationId: location.id,
              qty: itemRow.qty, // Positive for INBOUND return
              referenceType: 'POS_RETURN',
              referenceId: posReturn.id,
              movementType: MovementType.INBOUND,
              unitCost: Number(item.unitCost) || itemRow.retailUnitPrice,
              createdAt: docDate,
            },
          });

          const retMovNo = `MV-RET-${voucherCode}-${itemRow.bc}-${rIdx}`;
          await prisma.stockMovement.upsert({
            where: { movementNo: retMovNo },
            update: {
              itemId: item.id,
              toLocationId: location.id,
              quantity: itemRow.qty,
              type: 'RETURN',
              referenceType: 'POS_RETURN',
              referenceId: posReturn.id,
              movementDate: docDate,
              notes: `Sales Return Stock Restoration #${voucherCode}`,
            },
            create: {
              movementNo: retMovNo,
              itemId: item.id,
              toLocationId: location.id,
              quantity: itemRow.qty,
              type: 'RETURN',
              referenceType: 'POS_RETURN',
              referenceId: posReturn.id,
              movementDate: docDate,
              createdAt: docDate,
              notes: `Sales Return Stock Restoration #${voucherCode}`,
            },
          });

          // Increment InventoryItem available stock
          let invItem = invMap.get(item.id);
          if (invItem) {
            await prisma.inventoryItem.update({
              where: { id: invItem.id },
              data: { quantity: { increment: itemRow.qty } },
            });
            invItem.quantity = Number(invItem.quantity) + itemRow.qty;
          } else {
            invItem = await prisma.inventoryItem.create({
              data: {
                locationId: location.id,
                warehouseId: warehouse.id,
                itemId: item.id,
                quantity: itemRow.qty,
                status: 'AVAILABLE',
              },
            });
            invMap.set(item.id, invItem);
          }

          totalReturnLines++;
        }

        // 6. Link VoucherRedemption if settled in an exchange sales order
        if (isRedeemed) {
          const padExDoc = String(parseInt(settlementExchangeDocNo, 10)).padStart(5, '0');
          const exchangeOrderNumber = `SI-${cleanLocationCode}${fySuffix}-${padExDoc}`;
          let exchangeOrder = salesOrderByDocNum.get(settlementExchangeDocNo);
          if (!exchangeOrder) {
            exchangeOrder = await prisma.salesOrder.findFirst({
              where: { orderNumber: exchangeOrderNumber, locationId: location.id },
              select: { id: true, createdAt: true },
            });
          }

          if (exchangeOrder) {
            await prisma.voucherRedemption.upsert({
              where: {
                voucherId_orderId: {
                  voucherId: voucher.id,
                  orderId: exchangeOrder.id,
                },
              },
              update: {
                amountUsed: Math.round(returnTotalValue * 100) / 100,
                createdAt: exchangeOrder.createdAt,
              },
              create: {
                voucherId: voucher.id,
                orderId: exchangeOrder.id,
                amountUsed: Math.round(returnTotalValue * 100) / 100,
                createdAt: exchangeOrder.createdAt,
              },
            });
            redeemedVouchersCount++;
          }
        }

        processedReturns++;
      }

      grandTotalReturnsCount += processedReturns;
      grandTotalReturnValue += totalVoucherValue;

      console.log(`✅ [PHASE 2 COMPLETE] Imported ${processedReturns} Returns for ${location.name}:`);
      console.log(`   - Voucher Codes: EXC-${cleanLocationCode}-XXXXX / CLM-${cleanLocationCode}-XXXXX`);
      console.log(`   - Value        : PKR ${totalVoucherValue.toLocaleString()}`);
      console.log(`   - Linked Sales : ${linkedReturnsToSales}/${processedReturns}`);
      console.log(`   - Redeemed     : ${redeemedVouchersCount}/${processedReturns}`);
    }

    // --------------------------------------------------------------------
    // RECONCILIATION SUMMARY
    // --------------------------------------------------------------------
    const invItems = await prisma.inventoryItem.findMany({
      where: { locationId: location.id, status: 'AVAILABLE' },
      select: { quantity: true },
    });
    const netQty = invItems.reduce((acc, it) => acc + Number(it.quantity), 0);
    console.log(`📊 Store Ending Inventory: ${invItems.length.toLocaleString()} items tracked, Net Stock: ${netQty.toLocaleString()} units.`);
  }

  console.log(`\n========================================================================`);
  console.log(`🏁 GRAND IMPORT SUMMARY across ${targetLocationIds.length} Store Location(s):`);
  console.log(`   - Total Sales Orders Imported : ${grandTotalSalesOrders.toLocaleString()}`);
  console.log(`   - Total Sales Revenue         : PKR ${grandTotalSalesRevenue.toLocaleString()}`);
  console.log(`   - Total Return Docs Imported  : ${grandTotalReturnsCount.toLocaleString()}`);
  console.log(`   - Total Return Value          : PKR ${grandTotalReturnValue.toLocaleString()}`);
  console.log(`========================================================================`);

  await prisma.$disconnect();
  await tenantPool.end();
  console.log(`✨ Done!`);
}

main().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
