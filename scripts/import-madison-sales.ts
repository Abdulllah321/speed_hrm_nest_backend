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

export interface ParsedSalesRow {
  rowNum: number;
  docNo: string;
  docDateStr: string;
  docDate: Date;
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
  cashSale: number;
  cashReturn: number;
  cardSale: number;
  creditSale: number;
  giftVoucherAmount: number;
  creditVoucherAmount: number;
  exchangeVoucherAmount: number;
  claimVoucherAmount: number;
  giftVoucherCorporate: number;
  creditVoucherIssuedAmount: number;
  rewardVoucherAmount: number;
  onCreditAmount: number;
  costCentre: string;
  locationCode: string;
  posId: string;
  fbrInvoiceNumber: string;
  fkExchangeVoucherNumber: string;
  discountRateGiven: number;
  discountRateDefault: number;
  remarks: string;
  isAllianceDiscount: boolean;
  salesPerson: string;
}

/**
 * Calculates Fiscal Year suffix (e.g. July 2026 -> "26")
 */
export function getFySuffix(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed (6 = July)
  const fyStartYear = month >= 6 ? year : year - 1;
  return String(fyStartYear).slice(-2);
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

export function readAndParseSalesData(filePath: string, maxRows?: number): ParsedSalesRow[] {
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
    const idx = headers.findIndex((h) => keywords.some((k) => h.includes(k)));
    return idx !== -1 ? idx : defaultIdx;
  };

  const colDocNo = findColIndex(['documentnumber', 'docno', 'doc no'], 0);
  const colDocDate = findColIndex(['documentdate', 'docdate', 'date'], 1);
  const colBarcode = findColIndex(['barcode', 'sku', 'item'], 2);
  const colQty = findColIndex(['quantity', 'qty'], 3);
  const colUnitPrice = findColIndex(['unitprice', 'price'], 4);
  const colPriceWOT = findColIndex(['price_w_o_t', 'pricewot'], 5);
  const colTotalPriceWOT = findColIndex(['total_price_w_o_t', 'totalpricewot'], 6);
  const colDiscountAmount = findColIndex(['discountamount', 'discount_amount', 'discount'], 7);
  const colValueExSalesTax = findColIndex(['value ex sales tax', 'valueexsalestax'], 8);
  const colSalesTax = findColIndex(['sales tax', 'salestax'], 9);
  const colTotalSalesTax = findColIndex(['total sales tax', 'totalsalestax'], 11);
  const colValueInclSalesTax = findColIndex(['value incl sales tax', 'valueinclsalestax', 'grandtotal', 'total'], 12);
  const colCashSale = findColIndex(['cashsale', 'cash'], 13);
  const colCashReturn = findColIndex(['cashretrun', 'cashreturn'], 14);
  const colCardSale = findColIndex(['cardsale', 'card'], 15);
  const colCreditSale = findColIndex(['creditsale'], 16);
  const colGiftVoucher = findColIndex(['giftvoucheramount'], 17);
  const colCreditVoucher = findColIndex(['creditvoucheramount'], 18);
  const colExchangeVoucher = findColIndex(['exchangevoucheramount'], 19);
  const colClaimVoucher = findColIndex(['claimvoucheramount'], 20);
  const colGiftVoucherCorp = findColIndex(['giftvoucheramount_corporate'], 21);
  const colCreditVoucherIssued = findColIndex(['creditvoucherissuedamount'], 22);
  const colRewardVoucher = findColIndex(['rewardvoucheramount'], 23);
  const colOnCredit = findColIndex(['oncreditamount'], 24);
  const colCostCentre = findColIndex(['costcentre', 'store', 'location name'], 25);
  const colLocCode = findColIndex(['location code', 'locationcode', 'loc code'], 26);
  const colPosId = findColIndex(['pos id', 'posid'], 27);
  const colFbrInvoice = findColIndex(['fbr invoice#', 'fbrinvoice', 'fbr'], 28);
  const colExchangeVoucherNo = findColIndex(['fkexchangevouchernumber'], 29);
  const colDiscRateGiven = findColIndex(['discountrate_given'], 30);
  const colDiscRateDefault = findColIndex(['discountrate_default_current'], 31);
  const colRemarks = findColIndex(['remarks'], 32);
  const colIsAlliance = findColIndex(['is alliance discount'], 33);
  const colSalesPerson = findColIndex(['salesperson', 'cashier'], 34);

  const rawParsed: ParsedSalesRow[] = [];

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
    const barCode = (parts[colBarcode] || '').replace(/['"]/g, '').trim();
    const quantity = parseFloat(parts[colQty] || '1') || 1;
    const unitPrice = parseFloat(parts[colUnitPrice] || '0') || 0;
    const priceWOT = parseFloat(parts[colPriceWOT] || '0') || 0;
    const totalPriceWOT = parseFloat(parts[colTotalPriceWOT] || '0') || (priceWOT * quantity);
    const discountAmount = parseFloat(parts[colDiscountAmount] || '0') || 0;
    const valueExSalesTax = parseFloat(parts[colValueExSalesTax] || '0') || (totalPriceWOT - discountAmount);
    const salesTax = parseFloat(parts[colSalesTax] || '0') || 0;
    const totalSalesTax = parseFloat(parts[colTotalSalesTax] || '0') || salesTax;
    const valueInclSalesTax = parseFloat(parts[colValueInclSalesTax] || '0') || (valueExSalesTax + totalSalesTax);
    const cashSale = parseFloat(parts[colCashSale] || '0') || 0;
    const cashReturn = parseFloat(parts[colCashReturn] || '0') || 0;
    const cardSale = parseFloat(parts[colCardSale] || '0') || 0;
    const creditSale = parseFloat(parts[colCreditSale] || '0') || 0;
    const giftVoucherAmount = parseFloat(parts[colGiftVoucher] || '0') || 0;
    const creditVoucherAmount = parseFloat(parts[colCreditVoucher] || '0') || 0;
    const exchangeVoucherAmount = parseFloat(parts[colExchangeVoucher] || '0') || 0;
    const claimVoucherAmount = parseFloat(parts[colClaimVoucher] || '0') || 0;
    const giftVoucherCorporate = parseFloat(parts[colGiftVoucherCorp] || '0') || 0;
    const creditVoucherIssuedAmount = parseFloat(parts[colCreditVoucherIssued] || '0') || 0;
    const rewardVoucherAmount = parseFloat(parts[colRewardVoucher] || '0') || 0;
    const onCreditAmount = parseFloat(parts[colOnCredit] || '0') || 0;
    const costCentre = parts[colCostCentre] || '';
    const locationCode = parts[colLocCode] || '';
    const posId = parts[colPosId] || '';
    const fbrInvoiceNumber = (parts[colFbrInvoice] || '').replace(/^['"]/, '').trim();
    const fkExchangeVoucherNumber = (parts[colExchangeVoucherNo] || '').replace(/^['"]/, '').trim();
    const discountRateGiven = parseFloat(parts[colDiscRateGiven] || '0') || 0;
    const discountRateDefault = parseFloat(parts[colDiscRateDefault] || '0') || 0;
    const remarks = parts[colRemarks] || '';
    const isAllianceDiscount = (parts[colIsAlliance] || '').trim().toUpperCase() === 'Y';
    const salesPerson = parts[colSalesPerson] || '';

    if (!docNo || !barCode || !locationCode) continue;

    const docDate = parseCustomDate(docDateStr);
    if (!docDate || isNaN(docDate.getTime())) continue;

    rawParsed.push({
      rowNum: 0,
      docNo,
      docDateStr,
      docDate,
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
      cashSale,
      cashReturn,
      cardSale,
      creditSale,
      giftVoucherAmount,
      creditVoucherAmount,
      exchangeVoucherAmount,
      claimVoucherAmount,
      giftVoucherCorporate,
      creditVoucherIssuedAmount,
      rewardVoucherAmount,
      onCreditAmount,
      costCentre,
      locationCode,
      posId,
      fbrInvoiceNumber,
      fkExchangeVoucherNumber,
      discountRateGiven,
      discountRateDefault,
      remarks,
      isAllianceDiscount,
      salesPerson,
    });
  }

  // Sort ALL parsed rows chronologically by docDate ascending (oldest first)
  rawParsed.sort((a, b) => a.docDate.getTime() - b.docDate.getTime());

  rawParsed.forEach((row, index) => {
    row.rowNum = index + 1;
  });

  return maxRows ? rawParsed.slice(0, maxRows) : rawParsed;
}

async function processSalesForTenant(
  prisma: PrismaClient,
  rows: ParsedSalesRow[],
  isDryRun: boolean = false
) {
  console.log(`\n==================================================`);
  console.log(`📦 ${isDryRun ? '[DRY RUN MODE]' : '[LIVE COMMIT MODE]'} Processing ${rows.length} sales rows...`);
  console.log(`==================================================\n`);

  // Step 1: Cleanup previous imported Sales Orders in live mode
  if (!isDryRun) {
    console.log(`🧹 Cleaning up previously imported Sales Order records...`);
    const existingOrders = await prisma.salesOrder.findMany({
      where: {
        OR: [
          { orderNumber: { startsWith: 'SI-' } },
          { notes: { contains: 'Original DocNo:' } },
        ],
      },
      select: { id: true },
    });

    if (existingOrders.length > 0) {
      const orderIds = existingOrders.map((o) => o.id);
      console.log(`  Found ${orderIds.length} existing Sales Orders to clean up.`);

      await prisma.salesOrderItem.deleteMany({
        where: { salesOrderId: { in: orderIds } },
      });

      await prisma.stockMovement.deleteMany({
        where: {
          OR: [
            { referenceId: { in: orderIds } },
            { notes: { contains: 'POS Sale' } },
          ],
        },
      });

      await prisma.stockLedger.deleteMany({
        where: { referenceId: { in: orderIds } },
      });

      await prisma.salesOrder.deleteMany({
        where: { id: { in: orderIds } },
      });

      console.log(`  ✅ Successfully wiped ${orderIds.length} old Sales Order records.`);
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
              description: `POS Item (${row.barCode})`,
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

  // Group sales rows into Cash Memos (SalesOrders) by DocumentNumber + Date + Location + POS ID
  const salesGroups = new Map<string, ParsedSalesRow[]>();
  for (const row of rows) {
    const groupKey = `${row.docNo}_${row.docDateStr}_${row.locationCode}_${row.posId}`;
    if (!salesGroups.has(groupKey)) {
      salesGroups.set(groupKey, []);
    }
    salesGroups.get(groupKey)!.push(row);
  }

  console.log(`📋 Grouped ${rows.length} total rows into ${salesGroups.size} Cash Memo Sales Orders.`);

  // Sequential counters per Location & Fiscal Year (SI-{cleanCode}{fySuffix}-{seq})
  const locSeqMap = new Map<string, number>();

  let processedLines = 0;
  let totalRevenue = 0;

  for (const [groupKey, groupRows] of salesGroups.entries()) {
    const sample = groupRows[0];
    const location = locationCache.get(sample.locationCode)!;

    const cleanCode = (location.shortCode || location.code || sample.locationCode).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const fySuffix = getFySuffix(sample.docDate);
    const seqKey = `${cleanCode}_${fySuffix}`;

    const seq = (locSeqMap.get(seqKey) || 0) + 1;
    locSeqMap.set(seqKey, seq);

    const orderNumber = `SI-${cleanCode}${fySuffix}-${String(seq).padStart(5, '0')}`;

    // Order level header financial calculations
    const subtotal = groupRows.reduce((acc, r) => acc + (r.totalPriceWOT || (r.priceWOT * r.quantity)), 0);
    const discountAmount = groupRows.reduce((acc, r) => acc + r.discountAmount, 0);
    const taxAmount = groupRows.reduce((acc, r) => acc + r.totalSalesTax, 0);
    const grandTotal = groupRows.reduce((acc, r) => acc + r.valueInclSalesTax, 0);

    totalRevenue += grandTotal;

    // Payment methods breakdown from file
    const cashAmount = sample.cashSale || 0;
    const cardAmount = sample.cardSale || 0;
    const voucherAmount = (sample.giftVoucherAmount || 0) + (sample.creditVoucherAmount || 0) +
                          (sample.exchangeVoucherAmount || 0) + (sample.claimVoucherAmount || 0) +
                          (sample.giftVoucherCorporate || 0) + (sample.rewardVoucherAmount || 0);

    let paymentMethod = 'cash';
    if ((cardAmount > 0 && cashAmount > 0) || (cardAmount > 0 && voucherAmount > 0) || (cashAmount > 0 && voucherAmount > 0)) {
      paymentMethod = 'split';
    } else if (cardAmount > 0) {
      paymentMethod = 'card';
    } else if (voucherAmount > 0) {
      paymentMethod = 'voucher';
    }

    const orderNotes = `Original DocNo: ${sample.docNo} | SalesPerson: ${sample.salesPerson || 'N/A'} | Remarks: ${sample.remarks || 'N/A'}`;

    if (isDryRun) {
      if (seq <= 10 || seq % 20 === 0) {
        console.log(`🔍 [DRY-RUN #${orderNumber}] Date:${sample.docDateStr} | Store:${location.name} | GrandTotal: PKR ${grandTotal.toLocaleString()} | Items:${groupRows.length} | FBR:${sample.fbrInvoiceNumber || 'N/A'}`);
      }
      processedLines += groupRows.length;
      continue;
    }

    // Live Execution: Save SalesOrder
    const salesOrder = await prisma.salesOrder.create({
      data: {
        orderNumber,
        posId: sample.posId || null,
        terminalId: sample.posId || null,
        locationId: location.id,
        subtotal: subtotal,
        discountAmount: discountAmount,
        taxAmount: taxAmount,
        grandTotal: grandTotal,
        paymentMethod: paymentMethod,
        paymentStatus: 'paid',
        status: 'completed',
        notes: orderNotes,
        fbrInvoiceNumber: sample.fbrInvoiceNumber || null,
        fbrStatus: sample.fbrInvoiceNumber ? 'COMPLETED' : 'PENDING',
        cashAmount: cashAmount || null,
        cardAmount: cardAmount || null,
        voucherAmount: voucherAmount || null,
        createdAt: sample.docDate,
        updatedAt: sample.docDate,
      },
    });

    for (const row of groupRows) {
      const item = itemCache.get(row.barCode);
      const qty = row.quantity;

      // 1. Create SalesOrderItem
      const lineTaxPercent = row.valueExSalesTax > 0
        ? Math.round((row.totalSalesTax / row.valueExSalesTax) * 100 * 100) / 100
        : 0;

      await prisma.salesOrderItem.create({
        data: {
          salesOrderId: salesOrder.id,
          itemId: item.id,
          quantity: qty,
          unitPrice: row.unitPrice,
          discountPercent: row.discountRateGiven,
          discountAmount: row.discountAmount,
          taxPercent: lineTaxPercent,
          taxAmount: row.totalSalesTax,
          lineTotal: row.valueInclSalesTax,
          createdAt: sample.docDate,
        },
      });

      // 2. Decrement InventoryItem stock at outlet location
      const outletInv = await prisma.inventoryItem.findFirst({
        where: { locationId: location.id, itemId: item.id },
      });

      if (outletInv) {
        await prisma.inventoryItem.update({
          where: { id: outletInv.id },
          data: { quantity: { decrement: qty } },
        });
      } else {
        await prisma.inventoryItem.create({
          data: {
            warehouseId: defaultWarehouse.id,
            locationId: location.id,
            itemId: item.id,
            quantity: -qty,
            status: 'AVAILABLE',
          },
        });
      }

      // 3. Create StockLedger OUTBOUND entry for POS Sale
      await prisma.stockLedger.create({
        data: {
          itemId: item.id,
          warehouseId: location.warehouseId || defaultWarehouse.id,
          locationId: location.id,
          qty: -qty, // Negative for OUTBOUND sale
          referenceType: 'POS_SALE',
          referenceId: salesOrder.id,
          movementType: 'OUTBOUND',
          createdAt: sample.docDate,
        },
      });

      // 4. Create StockMovement entry for audit
      const movNo = `MV-SALE-${orderNumber}-${row.barCode}-${row.rowNum}`;
      await prisma.stockMovement.create({
        data: {
          movementNo: movNo,
          itemId: item.id,
          fromLocationId: location.id,
          toLocationId: null,
          quantity: qty,
          type: 'POS_SALE',
          referenceType: 'POS_SALE',
          referenceId: salesOrder.id,
          movementDate: sample.docDate,
          createdAt: sample.docDate,
          notes: `POS Sale: ${orderNumber} (Doc #${row.docNo})`,
        },
      });

      processedLines++;
    }
  }

  console.log(`\n==================================================`);
  console.log(`✨ ${isDryRun ? '[DRY RUN SUMMARY]' : '[IMPORT SUMMARY]'}`);
  console.log(`   - Total Cash Memos Processed: ${salesGroups.size}`);
  console.log(`   - Total Item Lines           : ${processedLines}`);
  console.log(`   - Total Revenue (PKR)        : ${totalRevenue.toLocaleString()}`);
  console.log(`   - Order Number Format        : SI-{cleanCode}{fySuffix}-{seq}`);
  console.log(`==================================================\n`);
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('-d');

  let limit: number | undefined = undefined;
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  if (limitArg) {
    limit = parseInt(limitArg.split('=')[1], 10);
  }

  let filePath = path.join(__dirname, '..', 'data', 'A-madison-sales.md');
  const fileArg = process.argv.find((arg) => arg.startsWith('--file=') || arg.startsWith('--path='));
  if (fileArg) {
    const customPath = fileArg.split('=')[1];
    filePath = path.isAbsolute(customPath) ? customPath : path.join(process.cwd(), customPath);
  }

  console.log(`🚀 Starting POS Sales Import Script...`);
  console.log(`📄 Target Data File: ${filePath}`);
  if (isDryRun) {
    console.log(`⚠️ DRY RUN ACTIVATED: No database changes will be committed.`);
  }

  const rows = readAndParseSalesData(filePath, limit);

  console.log(`📄 Successfully parsed and sorted ${rows.length} sales rows chronologically.`);
  if (rows.length > 0) {
    console.log('\n🔍 First Chronological Sales Row (#1):');
    console.log(`   - Doc No    : ${rows[0].docNo}`);
    console.log(`   - Doc Date  : ${rows[0].docDateStr}`);
    console.log(`   - Location  : ${rows[0].costCentre} (${rows[0].locationCode})`);
    console.log(`   - Barcode   : ${rows[0].barCode}`);
    console.log(`   - Qty       : ${rows[0].quantity}`);
    console.log(`   - Price     : PKR ${rows[0].unitPrice}`);
    console.log(`   - Total Incl Tax: PKR ${rows[0].valueInclSalesTax}`);
    console.log(`   - FBR Inv#  : ${rows[0].fbrInvoiceNumber || 'N/A'}`);
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
      console.log(`\n🏢 Found ${companies.length} tenant companies. Running sales import for each...`);
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
          await processSalesForTenant(tenantPrisma, rows, isDryRun);
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
    await processSalesForTenant(prisma, rows, isDryRun);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Error executing script:', err);
  process.exit(1);
});
