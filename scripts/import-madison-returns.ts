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

export interface ParsedReturnRow {
  rowNum: number;
  docNo: string;
  docDateStr: string;
  docDate: Date;
  type: string;
  subType: string;
  barCode: string;
  quantity: number;
  unitPrice: number;
  priceWOT: number;
  totalPriceWOT: number;
  discountAmount: number;
  valueExSalesTax: number;
  salesTax: number;
  totalSalesTax: number;
  valueInclSalesTax: number;
  costCentre: string;
  locationCode: string;
  posId: string;
  fbrInvoiceNumber: string;
  discountRateGiven: number;
  remarks: string;
  isAllianceDiscount: boolean;
  fkInvoiceNumberSale: string;
  docDateSaleStr: string;
  docDateSale: Date | null;
  fkInvoiceNumberSettle: string;
  docDateSettleStr: string;
  docDateSettle: Date | null;
}

export function parseCustomDate(dateStr: string): Date | null {
  if (!dateStr || !dateStr.trim()) return null;

  const trimmed = dateStr.trim();
  const spaceParts = trimmed.split(/\s+/);
  const datePart = spaceParts[0];
  const timePart = spaceParts[1] || '0:0';

  const dParts = datePart.split('/');
  if (dParts.length !== 3) return null;

  const month = parseInt(dParts[0], 10);
  const day = parseInt(dParts[1], 10);
  let year = parseInt(dParts[2], 10);

  if (year < 100) {
    year += 2000;
  }

  const tParts = timePart.split(':');
  const hours = parseInt(tParts[0] || '0', 10);
  const minutes = parseInt(tParts[1] || '0', 10);
  const seconds = parseInt(tParts[2] || '0', 10);

  return new Date(year, month - 1, day, hours, minutes, seconds);
}

export function readAndParseReturnData(filePath: string, maxRows?: number): ParsedReturnRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at path: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.trim().startsWith('---'));

  if (lines.length < 2) {
    console.warn(`⚠️ File ${filePath} contains no data rows.`);
    return [];
  }

  const headerLine = lines[0];
  const isTabSep = headerLine.includes('\t');
  const isPipeSep = headerLine.includes('|');

  const headers = isTabSep
    ? headerLine.split('\t').map((h) => h.trim().toLowerCase())
    : isPipeSep
    ? headerLine.split('|').map((h) => h.trim().toLowerCase()).filter(Boolean)
    : headerLine.split(',').map((h) => h.trim().toLowerCase());

  const findColIndex = (keywords: string[], defaultIdx: number): number => {
    const exactIdx = headers.findIndex((h) => keywords.some((k) => h === k));
    if (exactIdx !== -1) return exactIdx;
    const partialIdx = headers.findIndex((h) => keywords.some((k) => h.includes(k)));
    return partialIdx !== -1 ? partialIdx : defaultIdx;
  };

  const colDocNo = findColIndex(['documentnumber', 'docno', 'doc no'], 0);
  const colDocDate = findColIndex(['documentdate', 'docdate', 'date'], 1);
  const colType = findColIndex(['type'], 2);
  const colSubType = findColIndex(['sub type', 'subtype'], 3);
  const colBarcode = findColIndex(['barcode', 'sku', 'item'], 4);
  const colQty = findColIndex(['quantity', 'qty'], 5);
  const colUnitPrice = findColIndex(['unitprice', 'price'], 6);
  const colPriceWOT = findColIndex(['price_w_o_t', 'pricewot'], 7);
  const colTotalPriceWOT = findColIndex(['total_price_w_o_t', 'totalpricewot'], 8);
  const colDiscountAmount = findColIndex(['discountamount', 'discount_amount'], 9);
  const colValueExSalesTax = findColIndex(['value ex sales tax', 'valueexsalestax'], 10);
  const colSalesTax = findColIndex(['sales tax', 'salestax'], 11);
  const colTotalSalesTax = findColIndex(['total sales tax', 'totalsalestax'], 13);
  const colValueInclSalesTax = findColIndex(['value incl sales tax', 'valueinclsalestax', 'total'], 14);
  const colCostCentre = findColIndex(['costcentre', 'store'], 15);
  const colLocCode = findColIndex(['location code', 'locationcode'], 16);
  const colPosId = findColIndex(['pos id', 'posid'], 17);
  const colFbrInvoice = findColIndex(['fbr invoice#', 'fbrinvoice'], 18);
  const colDiscRateGiven = findColIndex(['discountrate_given'], 19);
  const colRemarks = findColIndex(['remarks'], 20);
  const colIsAlliance = findColIndex(['is alliance discount'], 21);
  const colSaleDocNo = findColIndex(['fkinvoicenumber_sale', 'sale doc'], 22);
  const colSaleDocDate = findColIndex(['documentdate_sale', 'sale date'], 23);
  const colSettleDocNo = findColIndex(['fkinvoicenumber_settle', 'settle doc'], 24);
  const colSettleDocDate = findColIndex(['documentdate_settle', 'settle date'], 25);

  const rawParsed: ParsedReturnRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine || rawLine.startsWith('---')) continue;

    let parts = isTabSep
      ? rawLine.split('\t').map((p) => p.trim())
      : isPipeSep
      ? rawLine.split('|').map((p) => p.trim()).filter(Boolean)
      : rawLine.split(',').map((p) => p.trim());

    if (parts.length < 5) continue;

    const docNo = parts[colDocNo] || '';
    const docDateStr = parts[colDocDate] || '';
    const type = parts[colType] || 'Return';
    const subType = parts[colSubType] || 'Exchange';
    const barCode = (parts[colBarcode] || '').replace(/['"]/g, '').trim();
    const quantity = parseFloat(parts[colQty] || '-1') || -1;
    const unitPrice = Math.abs(parseFloat(parts[colUnitPrice] || '0') || 0);
    const priceWOT = parseFloat(parts[colPriceWOT] || '0') || 0;
    const totalPriceWOT = parseFloat(parts[colTotalPriceWOT] || '0') || priceWOT;
    const discountAmount = parseFloat(parts[colDiscountAmount] || '0') || 0;
    const valueExSalesTax = parseFloat(parts[colValueExSalesTax] || '0') || 0;
    const salesTax = parseFloat(parts[colSalesTax] || '0') || 0;
    const totalSalesTax = parseFloat(parts[colTotalSalesTax] || '0') || salesTax;
    const valueInclSalesTax = parseFloat(parts[colValueInclSalesTax] || '0') || 0;
    const costCentre = parts[colCostCentre] || '';
    const locationCode = parts[colLocCode] || '';
    const posId = parts[colPosId] || '';
    const fbrInvoiceNumber = (parts[colFbrInvoice] || '').replace(/^['"]/, '').trim();
    const discountRateGiven = parseFloat(parts[colDiscRateGiven] || '0') || 0;
    const remarks = parts[colRemarks] || '';
    const isAllianceDiscount = (parts[colIsAlliance] || '').trim().toUpperCase() === 'Y';
    const fkInvoiceNumberSale = parts[colSaleDocNo] || '';
    const docDateSaleStr = parts[colSaleDocDate] || '';
    const fkInvoiceNumberSettle = parts[colSettleDocNo] || '';
    const docDateSettleStr = parts[colSettleDocDate] || '';

    if (!docNo || !barCode || !locationCode) continue;

    const docDate = parseCustomDate(docDateStr);
    if (!docDate || isNaN(docDate.getTime())) continue;

    const docDateSale = parseCustomDate(docDateSaleStr);
    const docDateSettle = parseCustomDate(docDateSettleStr);

    rawParsed.push({
      rowNum: 0,
      docNo,
      docDateStr,
      docDate,
      type,
      subType,
      barCode,
      quantity,
      unitPrice,
      priceWOT,
      totalPriceWOT,
      discountAmount,
      valueExSalesTax,
      salesTax,
      totalSalesTax,
      valueInclSalesTax,
      costCentre,
      locationCode,
      posId,
      fbrInvoiceNumber,
      discountRateGiven,
      remarks,
      isAllianceDiscount,
      fkInvoiceNumberSale,
      docDateSaleStr,
      docDateSale,
      fkInvoiceNumberSettle,
      docDateSettleStr,
      docDateSettle,
    });
  }

  rawParsed.sort((a, b) => a.docDate.getTime() - b.docDate.getTime());

  rawParsed.forEach((row, index) => {
    row.rowNum = index + 1;
  });

  return maxRows ? rawParsed.slice(0, maxRows) : rawParsed;
}

async function processReturnsForTenant(
  prisma: PrismaClient,
  rows: ParsedReturnRow[],
  isDryRun: boolean = false
) {
  console.log(`\n==================================================`);
  console.log(`📦 ${isDryRun ? '[DRY RUN MODE]' : '[LIVE COMMIT MODE]'} Processing ${rows.length} sales return rows...`);
  console.log(`==================================================\n`);

  if (!isDryRun) {
    console.log(`🧹 Cleaning up previously imported Return Vouchers & Stock Records...`);
    const existingVouchers = await prisma.voucher.findMany({
      where: {
        OR: [
          { code: { startsWith: 'EXC-' } },
          { code: { startsWith: 'CLM-' } },
          { code: { startsWith: 'REF-' } },
        ],
      },
      select: { id: true, code: true },
    });

    if (existingVouchers.length > 0) {
      const voucherIds = existingVouchers.map((v) => v.id);
      const voucherCodes = existingVouchers.map((v) => v.code);
      console.log(`  Found ${voucherIds.length} existing Return Vouchers to clean up.`);

      await prisma.stockMovement.deleteMany({
        where: {
          OR: [
            { referenceId: { in: voucherIds } },
            { notes: { contains: 'POS Return' } },
          ],
        },
      });

      await prisma.stockLedger.deleteMany({
        where: {
          OR: [
            { referenceId: { in: voucherIds } },
            { referenceType: 'POS_RETURN' },
          ],
        },
      });

      await prisma.salesOrder.updateMany({
        where: {
          OR: [
            { returnNumber: { in: voucherCodes } },
            { returnNumber: { startsWith: 'EXC-' } },
            { returnNumber: { startsWith: 'CLM-' } },
            { returnNumber: { startsWith: 'REF-' } },
          ],
        },
        data: {
          status: 'completed',
          returnNumber: null,
        },
      });

      await prisma.voucher.deleteMany({
        where: { id: { in: voucherIds } },
      });

      console.log(`  ✅ Successfully wiped ${voucherIds.length} old Return Vouchers and reset linked Sales Orders.`);
    }
  }

  let defaultWarehouse: any = null;
  if (!isDryRun) {
    defaultWarehouse = await prisma.warehouse.findFirst({
      where: { isDeleted: false },
    });

    if (!defaultWarehouse) {
      console.log(`🏭 Creating default Warehouse (C40001)...`);
      defaultWarehouse = await prisma.warehouse.create({
        data: {
          code: 'C40001',
          name: 'LOGISTIC AREA CENTRAL WAREHOUSE',
          type: 'GENERAL',
          isActive: true,
        },
      });
    }
  } else {
    defaultWarehouse = { id: 'dry-run-wh-id', code: 'C40001', name: 'LOGISTIC AREA CENTRAL WAREHOUSE' };
  }

  const locationCache = new Map<string, any>();
  const itemCache = new Map<string, any>();

  async function resolveLocation(code: string, name: string): Promise<any> {
    if (locationCache.has(code)) {
      return locationCache.get(code)!;
    }

    if (!isDryRun) {
      let loc = await prisma.location.findFirst({
        where: {
          OR: [
            { code: code },
            { shortCode: code },
            { name: name },
          ],
          isDeleted: false,
        },
        select: { id: true, code: true, shortCode: true, name: true, warehouseId: true },
      });

      if (!loc) {
        console.log(`📍 Creating Location [${code}]: ${name}`);
        loc = await prisma.location.create({
          data: {
            code: code,
            shortCode: code,
            name: name || `Location ${code}`,
            warehouseId: defaultWarehouse.id,
            status: 'active',
          },
          select: { id: true, code: true, shortCode: true, name: true, warehouseId: true },
        });
      }
      locationCache.set(code, loc);
      return loc;
    } else {
      const loc = { id: `loc-${code}`, code, shortCode: code, name: name || 'Location' };
      locationCache.set(code, loc);
      return loc;
    }
  }

  console.log(`⚙️ Pre-caching Locations and Item Barcodes...`);

  for (const row of rows) {
    await resolveLocation(row.locationCode, row.costCentre);

    if (!itemCache.has(row.barCode)) {
      if (!isDryRun) {
        let item = await prisma.item.findFirst({
          where: { barCode: row.barCode },
        });
        if (!item) {
          item = await prisma.item.create({
            data: {
              itemId: `ITEM-${row.barCode}`,
              sku: row.barCode,
              barCode: row.barCode,
              description: `POS Return Item (${row.barCode})`,
              unitPrice: row.unitPrice,
              unitCost: 0,
              status: 'active',
              isActive: true,
            },
          });
        }
        itemCache.set(row.barCode, item);
      } else {
        itemCache.set(row.barCode, { id: `item-${row.barCode}`, barCode: row.barCode, unitPrice: row.unitPrice });
      }
    }
  }

  // Group return rows by DocumentNumber + Date + Location + SubType
  const returnGroups = new Map<string, ParsedReturnRow[]>();
  for (const row of rows) {
    const groupKey = `${row.docNo}_${row.docDateStr}_${row.locationCode}_${row.subType}`;
    if (!returnGroups.has(groupKey)) {
      returnGroups.set(groupKey, []);
    }
    returnGroups.get(groupKey)!.push(row);
  }

  console.log(`📋 Grouped ${rows.length} total return rows into ${returnGroups.size} Return Documents.`);

  let processedLines = 0;
  let totalVoucherValue = 0;
  let linkedSalesOrders = 0;

  for (const [groupKey, groupRows] of returnGroups.entries()) {
    const sample = groupRows[0];
    const location = locationCache.get(sample.locationCode)!;

    const rawCode = location.shortCode?.trim() || location.code?.trim() || sample.locationCode;
    const cleanCode = rawCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

    // Format Voucher Code: EXC-ADIMS-0000(docNo) e.g. EXC-ADIMS-00001
    const subTypePrefix = sample.subType.toUpperCase() === 'CLAIM' ? 'CLM' :
                          sample.subType.toUpperCase() === 'REFUND' ? 'REF' : 'EXC';

    const padDocNo = String(sample.docNo).padStart(5, '0');
    const voucherCode = `${subTypePrefix}-${cleanCode}-${padDocNo}`;

    // Total return value (Absolute value including tax)
    const returnTotalValue = groupRows.reduce((acc, r) => acc + Math.abs(r.valueInclSalesTax), 0);
    totalVoucherValue += returnTotalValue;

    const isRedeemed = Boolean(sample.fkInvoiceNumberSettle && sample.fkInvoiceNumberSettle.trim() !== '');

    const voucherType = sample.subType.toUpperCase() === 'CLAIM' ? 'CLAIM' :
                        sample.subType.toUpperCase() === 'REFUND' ? 'REFUND' : 'EXCHANGE';

    const voucherDesc = `Exchange Voucher for Return Doc #${sample.docNo} (Sale #${sample.fkInvoiceNumberSale || 'N/A'})`;

    if (isDryRun) {
      console.log(`🔍 [DRY-RUN #${voucherCode}] Date:${sample.docDateStr} | Store:${location.name} | Type:${voucherType} | Value: PKR ${returnTotalValue.toLocaleString()} | Redeemed:${isRedeemed ? 'YES (Doc #' + sample.fkInvoiceNumberSettle + ')' : 'NO'}`);
      processedLines += groupRows.length;
      continue;
    }

    // 1. Locate original SalesOrder by exact sale doc number if present
    let originalSalesOrder: any = null;
    if (sample.fkInvoiceNumberSale && sample.fkInvoiceNumberSale.trim() !== '') {
      const saleDoc = sample.fkInvoiceNumberSale.trim();
      originalSalesOrder = await prisma.salesOrder.findFirst({
        where: {
          OR: [
            { notes: { startsWith: `Original DocNo: ${saleDoc} |` } },
            { notes: { contains: `Original DocNo: ${saleDoc} |` } },
            { notes: { equals: `Original DocNo: ${saleDoc}` } },
          ],
        },
        select: { id: true, orderNumber: true, status: true, notes: true, returnNumber: true },
      });
    }

    // 2. Create/Update Voucher in database
    const voucher = await prisma.voucher.upsert({
      where: { code: voucherCode },
      update: {
        voucherType,
        faceValue: returnTotalValue,
        description: voucherDesc,
        issuedByLocationId: location.id,
        sourceOrderId: originalSalesOrder ? originalSalesOrder.id : null,
        isActive: true,
        isRedeemed,
        createdAt: sample.docDate,
      },
      create: {
        code: voucherCode,
        voucherType,
        faceValue: returnTotalValue,
        description: voucherDesc,
        issuedByLocationId: location.id,
        sourceOrderId: originalSalesOrder ? originalSalesOrder.id : null,
        isActive: true,
        isRedeemed,
        createdAt: sample.docDate,
      },
    });

    // 3. Mark original SalesOrder as returned if found
    if (originalSalesOrder) {
      const updateData: any = {
        status: 'returned',
        notes: `${originalSalesOrder.notes || ''} | [Returned via ${voucherCode}]`,
      };

      if (!originalSalesOrder.returnNumber) {
        const existingOrderWithReturnNum = await prisma.salesOrder.findFirst({
          where: { returnNumber: voucherCode },
          select: { id: true },
        });

        if (!existingOrderWithReturnNum) {
          updateData.returnNumber = voucherCode;
        }
      }

      await prisma.salesOrder.update({
        where: { id: originalSalesOrder.id },
        data: updateData,
      });
      linkedSalesOrders++;
    }

    // 4. Restore Stock (INBOUND Ledger & Movements) for returned items
    for (const row of groupRows) {
      const item = itemCache.get(row.barCode);
      const absQty = Math.abs(row.quantity);

      // Restore InventoryItem stock at store location
      const outletInv = await prisma.inventoryItem.findFirst({
        where: { locationId: location.id, itemId: item.id },
      });

      if (outletInv) {
        await prisma.inventoryItem.update({
          where: { id: outletInv.id },
          data: { quantity: { increment: absQty } },
        });
      } else {
        await prisma.inventoryItem.create({
          data: {
            warehouseId: defaultWarehouse.id,
            locationId: location.id,
            itemId: item.id,
            quantity: absQty,
            status: 'AVAILABLE',
          },
        });
      }

      // Create StockLedger INBOUND entry for Return Stock Restoration
      await prisma.stockLedger.create({
        data: {
          itemId: item.id,
          warehouseId: location.warehouseId || defaultWarehouse.id,
          locationId: location.id,
          qty: absQty, // Positive for INBOUND return
          referenceType: 'POS_RETURN',
          referenceId: voucher.id,
          movementType: 'INBOUND',
          createdAt: sample.docDate,
        },
      });

      // Create StockMovement entry for audit trail
      const movNo = `MV-RET-${voucherCode}-${row.barCode}-${row.rowNum}`;
      await prisma.stockMovement.create({
        data: {
          movementNo: movNo,
          itemId: item.id,
          fromLocationId: null,
          toLocationId: location.id,
          quantity: absQty,
          type: 'POS_RETURN',
          referenceType: 'POS_RETURN',
          referenceId: voucher.id,
          movementDate: sample.docDate,
          createdAt: sample.docDate,
          notes: `POS Return: ${voucherCode} (Return Doc #${row.docNo})`,
        },
      });

      processedLines++;
    }
  }

  console.log(`\n==================================================`);
  console.log(`✨ ${isDryRun ? '[DRY RUN SUMMARY]' : '[IMPORT SUMMARY]'}`);
  console.log(`   - Total Return Documents: ${returnGroups.size}`);
  console.log(`   - Linked Sales Orders   : ${linkedSalesOrders}`);
  console.log(`   - Total Item Lines      : ${processedLines}`);
  console.log(`   - Total Voucher Value   : PKR ${totalVoucherValue.toLocaleString()}`);
  console.log(`   - Voucher Code Format   : EXC-{cleanCode}-XXXXX (e.g. EXC-ADIMS-00001)`);
  console.log(`==================================================\n`);
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('-d');

  let limit: number | undefined = undefined;
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  if (limitArg) {
    limit = parseInt(limitArg.split('=')[1], 10);
  }

  let filePath = path.join(__dirname, '..', 'data', 'A-madison-return.md');
  const fileArg = process.argv.find((arg) => arg.startsWith('--file=') || arg.startsWith('--path='));
  if (fileArg) {
    const customPath = fileArg.split('=')[1];
    filePath = path.isAbsolute(customPath) ? customPath : path.join(process.cwd(), customPath);
  }

  console.log(`🚀 Starting POS Return Import Script...`);
  console.log(`📄 Target Data File: ${filePath}`);
  if (isDryRun) {
    console.log(`⚠️ DRY RUN ACTIVATED: No database changes will be committed.`);
  }

  const rows = readAndParseReturnData(filePath, limit);

  console.log(`📄 Successfully parsed and sorted ${rows.length} return rows chronologically.`);
  if (rows.length > 0) {
    console.log('\n🔍 First Chronological Return Row (#1):');
    console.log(`   - Return Doc# : ${rows[0].docNo}`);
    console.log(`   - Doc Date   : ${rows[0].docDateStr}`);
    console.log(`   - SubType    : ${rows[0].subType}`);
    console.log(`   - Location   : ${rows[0].costCentre} (${rows[0].locationCode})`);
    console.log(`   - Barcode    : ${rows[0].barCode}`);
    console.log(`   - Qty        : ${rows[0].quantity}`);
    console.log(`   - Value      : PKR ${Math.abs(rows[0].valueInclSalesTax)}`);
    console.log(`   - Sale Doc#  : ${rows[0].fkInvoiceNumberSale || 'N/A'}`);
    console.log(`   - Settle Doc#: ${rows[0].fkInvoiceNumberSettle || 'N/A'}`);
  }

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (managementUrl && masterKey) {
    const pool = new Pool({ connectionString: managementUrl });
    const adapter = new PrismaPg(pool);
    const management = new ManagementClient({ adapter } as any);

    let companies: any[] = [];
    try {
      companies = await management.company.findMany({
        where: { status: 'active' },
      });
    } catch (err: any) {
      console.warn(`ℹ️ Multi-tenant check skipped (${err.message}).`);
    } finally {
      await management.$disconnect();
      await pool.end();
    }

    if (companies.length > 0) {
      console.log(`\n🏢 Found ${companies.length} tenant companies. Running return import for each...`);
      for (const company of companies) {
        console.log(`\n👉 Processing Tenant: ${company.name} (${company.code})`);
        let connectionString = company.dbUrl;
        if (company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch (e) {
            console.warn(`  ⚠️ Decryption failed, using default connectionUrl`);
          }
        }

        if (!connectionString) continue;

        const tenantPool = new Pool({ connectionString });
        const tenantAdapter = new PrismaPg(tenantPool);
        const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

        try {
          await tenantPrisma.$connect();
          await processReturnsForTenant(tenantPrisma, rows, isDryRun);
        } finally {
          await tenantPrisma.$disconnect();
          await tenantPool.end();
        }
      }
      return;
    }
  }

  console.log('\n🔗 Running on primary DATABASE_URL...');
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL environment variable is missing.');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: dbUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter: adapter as any });
  try {
    await prisma.$connect();
    await processReturnsForTenant(prisma, rows, isDryRun);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Error executing script:', err);
  process.exit(1);
});
