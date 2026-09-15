import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient, MovementType } from '@prisma/client';
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
  fkExchVoucher: string;
  discountRateGiven: number;
  remarks: string;
  isAllianceDiscount: boolean;
  fkSaleDoc: string;
  docDateSaleStr: string;
  docDateSale: Date | null;
  fkRedeemDoc: string;
  docDateRedeemStr: string;
  docDateRedeem: Date | null;
}

/**
 * Calculates Fiscal Year 2-digit end-year suffix (e.g. July 2026 - June 2027 -> "27")
 */
export function getFySuffix(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed (6 = July)
  const fyEndYear = month >= 6 ? year + 1 : year;
  return String(fyEndYear).slice(-2);
}

/**
 * Robust date parser supporting:
 * - Excel date serial numbers (e.g. 46204 -> 2026-07-01, 46204.64965277778)
 * - M/D/YYYY or D/M/YYYY or YYYY-MM-DD
 * - ISO date strings
 */
export function parseCustomDate(dateVal: any): Date | null {
  if (!dateVal) return null;

  // Handle Excel date serial numbers like 46204 (7/1/2026)
  if (typeof dateVal === 'number' || (!isNaN(Number(dateVal)) && !String(dateVal).includes('/') && !String(dateVal).includes('-'))) {
    const num = Number(dateVal);
    if (num > 30000 && num < 70000) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      return new Date(excelEpoch.getTime() + num * 86400000);
    }
  }

  const trimmed = String(dateVal).trim();
  if (!trimmed) return null;

  const spaceParts = trimmed.split(/\s+/);
  const datePart = spaceParts[0];
  const timePart = spaceParts[1] || '0:0:0';

  const dParts = datePart.split(/[/.\-]/);
  if (dParts.length === 3) {
    let p1 = parseInt(dParts[0], 10);
    let p2 = parseInt(dParts[1], 10);
    let p3 = parseInt(dParts[2], 10);

    const tParts = timePart.split(':');
    const hours = parseInt(tParts[0] || '0', 10);
    const minutes = parseInt(tParts[1] || '0', 10);
    const seconds = parseInt(tParts[2] || '0', 10);

    if (p3 < 100) p3 += 2000;

    // YYYY-MM-DD
    if (p1 > 1900 && p1 < 2100) {
      return new Date(p1, p2 - 1, p3, hours, minutes, seconds);
    }

    // M/D/YYYY (standard US / Excel POS export format)
    if (p3 > 1900 && p3 < 2100) {
      return new Date(p3, p1 - 1, p2, hours, minutes, seconds);
    }
  }

  const fallback = new Date(trimmed);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function parseMarkdownLine(line: string, isTabSep: boolean, isPipeSep: boolean): string[] {
  if (isTabSep) {
    return line.split('\t').map((p) => p.trim());
  }
  if (isPipeSep) {
    // Protect escaped pipes \| (found in remarks like "1134;")
    const sanitized = line.replace(/\\\|/g, '__ESCAPED_PIPE__').trim();
    let stripped = sanitized;
    if (stripped.startsWith('|')) stripped = stripped.substring(1);
    if (stripped.endsWith('|')) stripped = stripped.substring(0, stripped.length - 1);
    return stripped.split('|').map((p) => p.replace(/__ESCAPED_PIPE__/g, '|').trim());
  }
  return line.split(',').map((p) => p.trim());
}

export function readAndParseReturnData(
  filePath: string,
  maxRows?: number,
  locationFilter?: string,
): ParsedReturnRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at path: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter((l) => {
    const trimmed = l.trim();
    return trimmed !== '' && !trimmed.startsWith('#') && !trimmed.startsWith('|-') && !trimmed.startsWith('| ---');
  });

  if (lines.length < 2) {
    console.warn(`⚠️ File ${filePath} contains no data rows.`);
    return [];
  }

  const headerLine = lines[0];
  const isTabSep = headerLine.includes('\t');
  const isPipeSep = headerLine.includes('|');

  const headers = parseMarkdownLine(headerLine, isTabSep, isPipeSep).map((h) => h.toLowerCase());

  const findColIndex = (keywords: string[], defaultIdx: number): number => {
    const exactIdx = headers.findIndex((h) => keywords.some((k) => h === k));
    if (exactIdx !== -1) return exactIdx;
    const partialIdx = headers.findIndex((h) => keywords.some((k) => h.includes(k)));
    return partialIdx !== -1 ? partialIdx : defaultIdx;
  };

  const colCostCentre = findColIndex(['costcentre', 'store'], 0);
  const colLocCode = findColIndex(['location id', 'location code', 'locationcode', 'loc code'], 1);
  const colDocNo = findColIndex(['documentnumber', 'docno', 'doc no'], 2);
  const colDocDate = findColIndex(['documentdate', 'docdate', 'date'], 3);
  const colSubType = findColIndex(['sub type', 'subtype', 'type'], 4);
  const colBarcode = findColIndex(['barcode', 'sku', 'item'], 5);
  const colQty = findColIndex(['quantity', 'qty'], 6);
  const colUnitPrice = findColIndex(['unitprice', 'price'], 7);
  const colPriceWOT = findColIndex(['price_w_o_t', 'pricewot'], 8);
  const colTotalPriceWOT = findColIndex(['total_price_w_o_t', 'totalpricewot'], 9);
  const colDiscountAmount = findColIndex(['discountamount', 'discount_amount'], 10);
  const colValueExSalesTax = findColIndex(['value ex sales tax', 'valueexsalestax'], 11);
  const colSalesTax = findColIndex(['sales tax', 'salestax'], 12);
  const colTotalSalesTax = findColIndex(['total sales tax', 'totalsalestax'], 14);
  const colValueInclSalesTax = findColIndex(['value incl sales tax', 'valueinclsalestax', 'total'], 15);
  const colPosId = findColIndex(['pos id', 'posid'], 17);
  const colFbrInvoice = findColIndex(['fbr invoice#', 'fbrinvoice'], 18);
  const colExchVoucher = findColIndex(['fkexchangevouchernumber', 'voucher'], 19);
  const colDiscRateGiven = findColIndex(['discountrate_given'], 20);
  const colRemarks = findColIndex(['remarks'], 21);
  const colIsAlliance = findColIndex(['is alliance discount'], 22);
  const colSaleDocNo = findColIndex(['fkdocumentnumber_sale', 'fkinvoicenumber_sale', 'sale doc'], 23);
  const colSaleDocDate = findColIndex(['documentdate_sale', 'sale date'], 24);
  const colRedeemDocNo = findColIndex(
    ['fkdocumentnumer_sale_redeem', 'fkdocumentnumber_sale_redeem', 'fkinvoicenumber_settle', 'settle doc', 'redeem doc'],
    25,
  );
  const colRedeemDocDate = findColIndex(
    ['documentdate_sale_redeem', 'documentdate_settle', 'settle date', 'redeem date'],
    26,
  );

  const rawParsed: ParsedReturnRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;

    const parts = parseMarkdownLine(rawLine, isTabSep, isPipeSep);
    if (parts.length < 15) continue;

    const costCentre = parts[colCostCentre] || '';
    const locationCode = parts[colLocCode] || '';
    const docNo = parts[colDocNo] || '';
    const docDateStr = parts[colDocDate] || '';
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
    const posId = parts[colPosId] || '';
    const fbrInvoiceNumber = (parts[colFbrInvoice] || '').replace(/^['"]/, '').trim();
    const fkExchVoucher = parts[colExchVoucher] || '';
    const discountRateGiven = parseFloat(parts[colDiscRateGiven] || '0') || 0;
    const remarks = parts[colRemarks] || '';
    const isAllianceDiscount = (parts[colIsAlliance] || '').trim().toUpperCase() === 'Y';
    const fkSaleDoc = (parts[colSaleDocNo] || '').trim();
    const docDateSaleStr = parts[colSaleDocDate] || '';
    const fkRedeemDoc = (parts[colRedeemDocNo] || '').trim();
    const docDateRedeemStr = parts[colRedeemDocDate] || '';

    if (!docNo || !barCode) continue;

    const docDate = parseCustomDate(docDateStr);
    if (!docDate || isNaN(docDate.getTime())) continue;

    if (locationFilter) {
      const locMatch =
        locationCode.toLowerCase() === locationFilter.toLowerCase() ||
        costCentre.toLowerCase().includes(locationFilter.toLowerCase());
      if (!locMatch) continue;
    }

    const docDateSale = parseCustomDate(docDateSaleStr);
    const docDateRedeem = parseCustomDate(docDateRedeemStr);

    rawParsed.push({
      rowNum: 0,
      docNo,
      docDateStr,
      docDate,
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
      fkExchVoucher,
      discountRateGiven,
      remarks,
      isAllianceDiscount,
      fkSaleDoc,
      docDateSaleStr,
      docDateSale,
      fkRedeemDoc,
      docDateRedeemStr,
      docDateRedeem,
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
  isDryRun: boolean = false,
) {
  console.log(`\n==================================================`);
  console.log(`📦 ${isDryRun ? '[DRY RUN MODE]' : '[LIVE COMMIT MODE]'} Processing ${rows.length.toLocaleString()} sales return rows...`);
  console.log(`==================================================\n`);

  // FY27 starts on July 1, 2026 UTC
  const currentFyStart = new Date(Date.UTC(2026, 6, 1, 0, 0, 0, 0));

  if (!isDryRun) {
    console.log(`🧹 Cleaning up previously imported current-year (FY27) Return Records & Stock Logs...`);

    // 1. Delete Return Stock Movements in FY27
    await prisma.stockMovement.deleteMany({
      where: {
        OR: [
          { type: 'POS_RETURN', movementDate: { gte: currentFyStart } },
          { referenceType: 'POS_RETURN', movementDate: { gte: currentFyStart } },
          { movementNo: { startsWith: 'MV-RET-' }, createdAt: { gte: currentFyStart } },
        ],
      },
    });

    // 2. Delete Return Stock Ledgers in FY27
    await prisma.stockLedger.deleteMany({
      where: {
        referenceType: 'POS_RETURN',
        createdAt: { gte: currentFyStart },
      },
    });

    // 3. Delete PosReturnItem and PosReturn in FY27
    const existingReturns = await prisma.posReturn.findMany({
      where: {
        OR: [
          { createdAt: { gte: currentFyStart } },
          { returnNumber: { contains: '27-' } },
        ],
      },
      select: { id: true },
    });

    if (existingReturns.length > 0) {
      const returnIds = existingReturns.map((r) => r.id);
      await prisma.posReturnItem.deleteMany({
        where: { posReturnId: { in: returnIds } },
      });
      await prisma.posReturn.deleteMany({
        where: { id: { in: returnIds } },
      });
      console.log(`  ✅ Successfully wiped ${existingReturns.length} old FY27 PosReturn records.`);
    }

    // 4. Delete Voucher Redemptions in FY27
    await prisma.voucherRedemption.deleteMany({
      where: {
        createdAt: { gte: currentFyStart },
      },
    });

    // 5. Delete Return Vouchers in FY27
    const existingVouchers = await prisma.voucher.findMany({
      where: {
        createdAt: { gte: currentFyStart },
        OR: [
          { code: { contains: '27-' } },
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

      // Reset returnNumber on sales orders if linked
      await prisma.salesOrder.updateMany({
        where: {
          returnNumber: { in: voucherCodes },
        },
        data: {
          returnNumber: null,
          status: 'completed',
        },
      });

      await prisma.voucher.deleteMany({
        where: { id: { in: voucherIds } },
      });
      console.log(`  ✅ Successfully wiped ${voucherIds.length} old FY27 Return Vouchers.`);
    }

    // 6. Delete previous fallback RET- SalesOrders in FY27
    const existingRetOrders = await prisma.salesOrder.findMany({
      where: {
        orderNumber: { startsWith: 'RET-' },
        createdAt: { gte: currentFyStart },
      },
      select: { id: true },
    });
    if (existingRetOrders.length > 0) {
      const retOrderIds = existingRetOrders.map((o) => o.id);
      await prisma.salesOrderItem.deleteMany({
        where: { salesOrderId: { in: retOrderIds } },
      });
      await prisma.salesOrder.deleteMany({
        where: { id: { in: retOrderIds } },
      });
      console.log(`  ✅ Successfully wiped ${existingRetOrders.length} previous fallback RET- SalesOrders.`);
    }
  }

  // Pre-load default Warehouse
  let defaultWarehouse: any = null;
  if (!isDryRun) {
    defaultWarehouse = await prisma.warehouse.findFirst({
      where: { isDeleted: false },
    });
    if (!defaultWarehouse) {
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

  // Pre-cache all Locations in memory
  const locationCache = new Map<string, any>();
  const dbLocations = await prisma.location.findMany({
    where: { isDeleted: false },
    select: { id: true, code: true, shortCode: true, name: true, warehouseId: true },
  });

  for (const loc of dbLocations) {
    if (loc.code) locationCache.set(loc.code.toUpperCase(), loc);
    if (loc.shortCode) locationCache.set(loc.shortCode.toUpperCase(), loc);
    if (loc.name) locationCache.set(loc.name.toUpperCase(), loc);
  }

  async function resolveLocation(code: string, name: string): Promise<any> {
    const cleanCode = (code || '').trim().toUpperCase();
    const cleanName = (name || '').trim().toUpperCase();

    if (cleanCode && locationCache.has(cleanCode)) return locationCache.get(cleanCode);
    if (cleanName && locationCache.has(cleanName)) return locationCache.get(cleanName);

    for (const [key, loc] of locationCache.entries()) {
      if (cleanCode && key.includes(cleanCode)) return loc;
      if (cleanName && key.includes(cleanName)) return loc;
    }

    if (!isDryRun) {
      let loc = await prisma.location.findFirst({
        where: {
          OR: [
            { code: { equals: code, mode: 'insensitive' } },
            { shortCode: { equals: code, mode: 'insensitive' } },
            { name: { equals: name, mode: 'insensitive' } },
          ],
          isDeleted: false,
        },
        select: { id: true, code: true, shortCode: true, name: true, warehouseId: true },
      });

      if (!loc) {
        loc = await prisma.location.create({
          data: {
            code: code || `LOC-${cleanName.substring(0, 8)}`,
            shortCode: code || cleanName.substring(0, 8),
            name: name || `Location ${code}`,
            warehouseId: defaultWarehouse.id,
            status: 'active',
          },
          select: { id: true, code: true, shortCode: true, name: true, warehouseId: true },
        });
      }
      if (cleanCode) locationCache.set(cleanCode, loc);
      if (cleanName) locationCache.set(cleanName, loc);
      return loc;
    } else {
      const loc = { id: `loc-${cleanCode || cleanName}`, code: cleanCode, shortCode: cleanCode, name: name || 'Location', warehouseId: defaultWarehouse.id };
      if (cleanCode) locationCache.set(cleanCode, loc);
      return loc;
    }
  }

  // Pre-cache Items in memory
  console.log(`⚙️ Pre-caching Locations, Items, and Sales Orders in memory...`);
  const itemCache = new Map<string, any>();
  if (!isDryRun) {
    const allDbItems = await prisma.item.findMany({
      select: { id: true, barCode: true, sku: true, unitPrice: true, unitCost: true },
    });
    for (const it of allDbItems) {
      if (it.barCode) itemCache.set(it.barCode.trim(), it);
      if (it.sku) itemCache.set(it.sku.trim(), it);
    }
    console.log(`✔ Cached ${itemCache.size.toLocaleString()} items from database.`);
  }

  // Pre-cache all Sales Orders in memory for lightning-fast matching
  // Key format: `${locationId}::${docNo}` and `${orderNumber}`
  const salesOrderByLocAndDoc = new Map<string, any>();
  const salesOrderByOrderNum = new Map<string, any>();

  console.log(`📥 Loading existing Sales Orders into memory for instant original sale matching...`);
  const dbSalesOrders = await prisma.salesOrder.findMany({
    select: {
      id: true,
      orderNumber: true,
      locationId: true,
      notes: true,
      status: true,
      items: {
        select: {
          id: true,
          itemId: true,
          quantity: true,
          unitPrice: true,
          discountAmount: true,
          taxAmount: true,
          lineTotal: true,
        },
      },
    },
  });

  for (const order of dbSalesOrders) {
    salesOrderByOrderNum.set(order.orderNumber.toUpperCase(), order);

    // Extract Original DocNo from notes: "Original DocNo: 523 |"
    if (order.notes) {
      const match = order.notes.match(/Original DocNo:\s*(\d+)/i);
      if (match && match[1]) {
        const docKey = `${order.locationId}::${match[1]}`;
        salesOrderByLocAndDoc.set(docKey, order);
      }
    }
  }
  console.log(`✔ Indexed ${dbSalesOrders.length.toLocaleString()} sales orders in memory.`);

  // Group return rows by Location + DocumentNumber + Date + SubType
  const returnGroups = new Map<string, ParsedReturnRow[]>();
  for (const row of rows) {
    const groupKey = `${row.locationCode || row.costCentre}_${row.docNo}_${row.docDateStr}_${row.subType}`;
    if (!returnGroups.has(groupKey)) {
      returnGroups.set(groupKey, []);
    }
    returnGroups.get(groupKey)!.push(row);
  }

  console.log(`📋 Grouped ${rows.length.toLocaleString()} total return rows into ${returnGroups.size.toLocaleString()} Return Documents.`);

  // Batches for high-speed database creation
  const voucherBatch: any[] = [];
  const posReturnBatch: any[] = [];
  const posReturnItemBatch: any[] = [];
  const voucherRedemptionBatch: any[] = [];
  const stockLedgerBatch: any[] = [];
  const stockMovementBatch: any[] = [];
  const inventoryRestorations = new Map<string, { warehouseId: string; locationId: string; itemId: string; qty: number }>();
  const salesOrdersToUpdateStatus = new Map<string, { id: string; voucherCode: string }>();

  // Audit Accumulators
  let totalReturnLines = 0;
  let totalReturnQty = 0;
  let totalWostSum = 0;
  let totalDiscountSum = 0;
  let totalValueExTaxSum = 0;
  let totalTaxSum = 0;
  let totalValueInclTaxSum = 0;

  const subTypeStats = {
    exchange: { count: 0, amount: 0 },
    claim: { count: 0, amount: 0 },
    refund: { count: 0, amount: 0 },
  };

  let matchedSalesOrderCount = 0;
  let fallbackSalesOrderCount = 0;
  let redeemedCount = 0;
  let redeemedAmount = 0;
  let openCount = 0;
  let openAmount = 0;

  const usedVoucherCodes = new Set<string>();

  for (const [groupKey, groupRows] of returnGroups.entries()) {
    const sample = groupRows[0];
    const location = await resolveLocation(sample.locationCode, sample.costCentre);

    const rawCode = location.shortCode?.trim() || location.code?.trim() || sample.locationCode || 'LOC';
    const cleanCode = rawCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const fySuffix = getFySuffix(sample.docDate);
    const padDocNo = String(sample.docNo).padStart(5, '0');

    const subTypeUpper = sample.subType.toUpperCase();
    const subTypePrefix = subTypeUpper === 'CLAIM' ? 'CLM' : subTypeUpper === 'REFUND' ? 'REF' : 'EXC';

    // Format Voucher Code: EXC-ADIJI27-00001 (FY27 scoped to prevent FY26 collision, deduplicated)
    const baseVoucherCode = `${subTypePrefix}-${cleanCode}${fySuffix}-${padDocNo}`;
    let voucherCode = baseVoucherCode;
    let dupSuffix = 1;
    while (usedVoucherCodes.has(voucherCode)) {
      dupSuffix++;
      voucherCode = `${baseVoucherCode}-${dupSuffix}`;
    }
    usedVoucherCodes.add(voucherCode);

    const voucherId = isDryRun ? `dry-vouch-${voucherCode}` : crypto.randomUUID();
    const posReturnId = isDryRun ? `dry-ret-${voucherCode}` : crypto.randomUUID();

    const returnMemoQty = groupRows.reduce((acc, r) => acc + Math.abs(r.quantity), 0);
    const returnSubtotalWost = groupRows.reduce((acc, r) => acc + Math.abs(r.totalPriceWOT || r.priceWOT), 0);
    const returnDiscountAmount = groupRows.reduce((acc, r) => acc + Math.abs(r.discountAmount), 0);
    const returnValueExTax = groupRows.reduce((acc, r) => acc + Math.abs(r.valueExSalesTax), 0);
    const returnTaxAmount = groupRows.reduce((acc, r) => acc + Math.abs(r.totalSalesTax || r.salesTax), 0);
    const returnTotalValue = groupRows.reduce((acc, r) => acc + Math.abs(r.valueInclSalesTax), 0);

    totalReturnLines += groupRows.length;
    totalReturnQty += returnMemoQty;
    totalWostSum += returnSubtotalWost;
    totalDiscountSum += returnDiscountAmount;
    totalValueExTaxSum += returnValueExTax;
    totalTaxSum += returnTaxAmount;
    totalValueInclTaxSum += returnTotalValue;

    if (subTypeUpper === 'CLAIM') {
      subTypeStats.claim.count++;
      subTypeStats.claim.amount += returnTotalValue;
    } else if (subTypeUpper === 'REFUND') {
      subTypeStats.refund.count++;
      subTypeStats.refund.amount += returnTotalValue;
    } else {
      subTypeStats.exchange.count++;
      subTypeStats.exchange.amount += returnTotalValue;
    }

    const isRedeemed = Boolean(sample.fkRedeemDoc && sample.fkRedeemDoc.trim() !== '' && sample.fkRedeemDoc !== '0');
    if (isRedeemed) {
      redeemedCount++;
      redeemedAmount += returnTotalValue;
    } else {
      openCount++;
      openAmount += returnTotalValue;
    }

    const voucherType = subTypeUpper === 'CLAIM' ? 'CLAIM' : subTypeUpper === 'REFUND' ? 'REFUND' : 'EXCHANGE';
    const voucherDesc = `${voucherType} Voucher for Return Doc #${sample.docNo} (Sale #${sample.fkSaleDoc || 'N/A'}) [Ref: 26-27-${sample.docNo}]`;

    // 1. Locate Original Sales Order in memory
    let originalSalesOrder: any = null;
    if (sample.fkSaleDoc && sample.fkSaleDoc.trim() !== '' && sample.fkSaleDoc !== '0') {
      const saleDoc = sample.fkSaleDoc.trim();
      const locDocKey = `${location.id}::${saleDoc}`;
      originalSalesOrder = salesOrderByLocAndDoc.get(locDocKey);

      if (!originalSalesOrder) {
        const paddedDoc = saleDoc.padStart(5, '0');
        const candidate1 = `SI-${cleanCode}26-${paddedDoc}`;
        const candidate2 = `SI-${cleanCode}27-${paddedDoc}`;
        const candidate3 = `SI-${cleanCode}-${paddedDoc}`;
        originalSalesOrder =
          salesOrderByOrderNum.get(candidate1) ||
          salesOrderByOrderNum.get(candidate2) ||
          salesOrderByOrderNum.get(candidate3);
      }
    }

    let targetOrderId: string;

    if (originalSalesOrder) {
      targetOrderId = originalSalesOrder.id;
      matchedSalesOrderCount++;
      salesOrdersToUpdateStatus.set(originalSalesOrder.id, {
        id: originalSalesOrder.id,
        voucherCode,
      });
    } else {
      // Fallback SalesOrder if original sale invoice was not in current/previous dataset
      fallbackSalesOrderCount++;
      const fallbackOrderNumber = `RET-${cleanCode}${fySuffix}-${padDocNo}`;
      targetOrderId = isDryRun ? `dry-order-${fallbackOrderNumber}` : crypto.randomUUID();

      if (!isDryRun) {
        // Fallback order will be created if needed
        const existingRetOrder = await prisma.salesOrder.findUnique({
          where: { orderNumber: fallbackOrderNumber },
          select: { id: true },
        });
        if (existingRetOrder) {
          targetOrderId = existingRetOrder.id;
        } else {
          const retSalesOrder = await prisma.salesOrder.create({
            data: {
              id: targetOrderId,
              orderNumber: fallbackOrderNumber,
              returnNumber: voucherCode,
              posId: sample.posId || null,
              locationId: location.id,
              subtotal: Math.round(returnSubtotalWost * 100) / 100,
              discountAmount: Math.round(returnDiscountAmount * 100) / 100,
              taxAmount: Math.round(returnTaxAmount * 100) / 100,
              grandTotal: Math.round(returnTotalValue * 100) / 100,
              paymentMethod: 'VOUCHER',
              paymentStatus: 'paid',
              status: 'returned',
              notes: sample.remarks || `Imported Return Doc #${sample.docNo} (Sale #${sample.fkSaleDoc || 'N/A'})`,
              fbrInvoiceNumber: sample.fbrInvoiceNumber || null,
              createdAt: sample.docDate,
            },
          });
          targetOrderId = retSalesOrder.id;
        }
      }
    }

    if (isDryRun) {
      if (returnGroups.size <= 10 || Array.from(returnGroups.keys()).indexOf(groupKey) < 5) {
        console.log(
          `🔍 [DRY-RUN #${voucherCode}] Date:${sample.docDate.toISOString().slice(0, 10)} | Store:${location.name} | Type:${voucherType} | Value: PKR ${returnTotalValue.toLocaleString()} | SaleDoc:${sample.fkSaleDoc || 'N/A'} (Matched:${Boolean(originalSalesOrder)}) | Redeemed:${isRedeemed ? 'YES (Doc #' + sample.fkRedeemDoc + ')' : 'NO'}`,
        );
      }
      continue;
    }

    // 2. Prepare Voucher Record
    voucherBatch.push({
      id: voucherId,
      code: voucherCode,
      voucherType,
      faceValue: Math.round(returnTotalValue * 100) / 100,
      description: voucherDesc,
      issuedByLocationId: location.id,
      sourceOrderId: targetOrderId,
      isActive: true,
      isRedeemed,
      createdAt: sample.docDate,
      updatedAt: sample.docDate,
    });

    // 3. Prepare PosReturn Record
    posReturnBatch.push({
      id: posReturnId,
      returnNumber: voucherCode,
      salesOrderId: targetOrderId,
      voucherId: voucherId,
      locationId: location.id,
      posId: sample.posId || null,
      terminalId: sample.posId || null,
      returnType: subTypeUpper === 'REFUND' ? 'REFUND' : 'RETURN',
      refundMode: subTypeUpper === 'REFUND' ? 'CASH' : 'VOUCHER',
      subtotalWost: Math.round(returnSubtotalWost * 100) / 100,
      discountWost: Math.round(returnDiscountAmount * 100) / 100,
      taxAmount: Math.round(returnTaxAmount * 100) / 100,
      totalRefundAmount: Math.round(returnTotalValue * 100) / 100,
      reason: sample.remarks || `Return Doc #${sample.docNo} (Sale #${sample.fkSaleDoc || 'N/A'})`,
      createdAt: sample.docDate,
      updatedAt: sample.docDate,
    });

    // 4. Prepare PosReturnItems & Stock Logs
    let itemIdx = 0;
    for (const row of groupRows) {
      itemIdx++;
      let item = itemCache.get(row.barCode);
      if (!item) {
        item = await prisma.item.findFirst({ where: { barCode: row.barCode } });
        if (!item) {
          item = await prisma.item.create({
            data: {
              itemId: `ITEM-${row.barCode}`,
              sku: row.barCode,
              barCode: row.barCode,
              description: `POS Return Item (${row.barCode})`,
              unitPrice: row.unitPrice,
              unitCost: Math.round(row.unitPrice * 0.7 * 100) / 100,
              status: 'active',
              isActive: true,
            },
          });
        }
        itemCache.set(row.barCode, item);
      }

      // Match SalesOrderItem if original order has it
      let matchedOrderItemId: string | null = null;
      if (originalSalesOrder && originalSalesOrder.items) {
        const found = originalSalesOrder.items.find((it: any) => it.itemId === item.id);
        if (found) {
          matchedOrderItemId = found.id;
        } else if (originalSalesOrder.items.length > 0) {
          matchedOrderItemId = originalSalesOrder.items[0].id;
        }
      }

      // If no matching sales order item found, create one on the target order
      if (!matchedOrderItemId) {
        const dummyItem = await prisma.salesOrderItem.create({
          data: {
            salesOrderId: targetOrderId,
            itemId: item.id,
            quantity: Math.abs(row.quantity),
            unitPrice: Math.round(row.unitPrice * 100) / 100,
            discountAmount: Math.round(Math.abs(row.discountAmount) * 100) / 100,
            taxAmount: Math.round(Math.abs(row.totalSalesTax) * 100) / 100,
            lineTotal: Math.round(Math.abs(row.valueInclSalesTax) * 100) / 100,
            createdAt: sample.docDate,
          },
          select: { id: true },
        });
        matchedOrderItemId = dummyItem.id;
      }

      const absQty = Math.abs(row.quantity);
      const lineTaxAmount = Math.abs(row.totalSalesTax || row.salesTax);
      const lineValueExTax = Math.abs(row.valueExSalesTax);
      const taxPercent = lineValueExTax > 0 ? Math.round((lineTaxAmount / lineValueExTax) * 100 * 100) / 100 : 18;

      posReturnItemBatch.push({
        id: crypto.randomUUID(),
        posReturnId: posReturnId,
        salesOrderItemId: matchedOrderItemId,
        itemId: item.id,
        quantity: Math.round(absQty),
        originalUnitPrice: Math.round(row.unitPrice * 100) / 100,
        originalPaidPerUnit: Math.round((Math.abs(row.valueInclSalesTax) / absQty) * 100) / 100,
        refundPerUnit: Math.round((Math.abs(row.valueInclSalesTax) / absQty) * 100) / 100,
        priceAdjusted: false,
        unitPriceWost: Math.round(Math.abs(row.priceWOT) * 100) / 100,
        lineTotalWost: Math.round(Math.abs(row.totalPriceWOT) * 100) / 100,
        discountPercent: Math.min(100, Math.max(0, Math.round(Math.abs(row.discountRateGiven) * 100) / 100)),
        discountWost: Math.round(Math.abs(row.discountAmount) * 100) / 100,
        taxPercent: Math.min(100, Math.max(0, taxPercent)),
        taxAmount: Math.round(lineTaxAmount * 100) / 100,
        couponDeduction: 0,
        lineTotal: Math.round(Math.abs(row.valueInclSalesTax) * 100) / 100,
        reason: sample.remarks || null,
        createdAt: sample.docDate,
        updatedAt: sample.docDate,
      });

      // StockLedger Inbound entry (Returned stock increases inventory)
      const whId = location.warehouseId || defaultWarehouse.id;
      stockLedgerBatch.push({
        itemId: item.id,
        warehouseId: whId,
        locationId: location.id,
        qty: absQty, // Positive for INBOUND return
        referenceType: 'POS_RETURN',
        referenceId: posReturnId,
        movementType: MovementType.INBOUND,
        unitCost: Number(item.unitCost) || row.unitPrice,
        rate: row.priceWOT || row.unitPrice,
        createdAt: sample.docDate,
      });

      // StockMovement Inbound log
      const movNo = `MV-RET-${voucherCode}-${row.barCode}-${itemIdx}`;
      stockMovementBatch.push({
        id: crypto.randomUUID(),
        movementNo: movNo,
        itemId: item.id,
        fromLocationId: null,
        toLocationId: location.id,
        quantity: absQty,
        type: 'POS_RETURN',
        referenceType: 'POS_RETURN',
        referenceId: posReturnId,
        movementDate: sample.docDate,
        createdAt: sample.docDate,
        updatedAt: sample.docDate,
        notes: `POS Return: ${voucherCode} (Doc #${row.docNo})`,
      });

      // Aggregate inventory restoration
      const invKey = `${location.id}:${item.id}`;
      const existingRestoration = inventoryRestorations.get(invKey);
      if (existingRestoration) {
        existingRestoration.qty += absQty;
      } else {
        inventoryRestorations.set(invKey, {
          warehouseId: whId,
          locationId: location.id,
          itemId: item.id,
          qty: absQty,
        });
      }
    }

    // 5. Check if redeemed in a sales order
    if (isRedeemed) {
      const redeemDoc = sample.fkRedeemDoc.trim();
      const redeemOrder = salesOrderByLocAndDoc.get(`${location.id}::${redeemDoc}`);
      if (redeemOrder) {
        voucherRedemptionBatch.push({
          id: crypto.randomUUID(),
          voucherId: voucherId,
          orderId: redeemOrder.id,
          amountUsed: Math.round(returnTotalValue * 100) / 100,
          createdAt: sample.docDateRedeem || sample.docDate,
        });
      }
    }
  }

  // ── High-Speed Chunked Database Ingestion (If live) ──
  if (!isDryRun) {
    console.log(`\n🚀 Executing High-Speed Chunked Return DB Commits...`);

    // 1. Insert Vouchers (chunk size 1,000)
    console.log(`💾 Inserting ${voucherBatch.length.toLocaleString()} Vouchers in chunks of 1,000...`);
    const VOUCHER_CHUNK = 1000;
    for (let i = 0; i < voucherBatch.length; i += VOUCHER_CHUNK) {
      const chunk = voucherBatch.slice(i, i + VOUCHER_CHUNK);
      await prisma.voucher.createMany({ data: chunk, skipDuplicates: true });
      const pct = Math.round(((i + chunk.length) / voucherBatch.length) * 100);
      process.stdout.write(`\r   Vouchers Progress: ${i + chunk.length}/${voucherBatch.length} (${pct}%)`);
    }
    console.log(`\n   ✔ Vouchers inserted successfully.`);

    // 2. Insert PosReturns (chunk size 1,000)
    console.log(`💾 Inserting ${posReturnBatch.length.toLocaleString()} PosReturn records in chunks of 1,000...`);
    for (let i = 0; i < posReturnBatch.length; i += VOUCHER_CHUNK) {
      const chunk = posReturnBatch.slice(i, i + VOUCHER_CHUNK);
      await prisma.posReturn.createMany({ data: chunk, skipDuplicates: true });
      const pct = Math.round(((i + chunk.length) / posReturnBatch.length) * 100);
      process.stdout.write(`\r   PosReturns Progress: ${i + chunk.length}/${posReturnBatch.length} (${pct}%)`);
    }
    console.log(`\n   ✔ PosReturns inserted successfully.`);

    // 3. Insert PosReturnItems (chunk size 2,000)
    console.log(`💾 Inserting ${posReturnItemBatch.length.toLocaleString()} PosReturn Items in chunks of 2,000...`);
    const ITEM_CHUNK = 2000;
    for (let i = 0; i < posReturnItemBatch.length; i += ITEM_CHUNK) {
      const chunk = posReturnItemBatch.slice(i, i + ITEM_CHUNK);
      await prisma.posReturnItem.createMany({ data: chunk, skipDuplicates: true });
      const pct = Math.round(((i + chunk.length) / posReturnItemBatch.length) * 100);
      process.stdout.write(`\r   Return Items Progress: ${i + chunk.length}/${posReturnItemBatch.length} (${pct}%)`);
    }
    console.log(`\n   ✔ PosReturn Items inserted successfully.`);

    // 4. Insert Voucher Redemptions
    if (voucherRedemptionBatch.length > 0) {
      console.log(`💾 Inserting ${voucherRedemptionBatch.length.toLocaleString()} Voucher Redemptions...`);
      for (let i = 0; i < voucherRedemptionBatch.length; i += 1000) {
        const chunk = voucherRedemptionBatch.slice(i, i + 1000);
        await prisma.voucherRedemption.createMany({ data: chunk, skipDuplicates: true });
      }
      console.log(`   ✔ Voucher Redemptions inserted successfully.`);
    }

    // 5. Update linked SalesOrder status & returnNumber
    console.log(`🔄 Updating ${salesOrdersToUpdateStatus.size.toLocaleString()} linked Sales Orders...`);
    const updateEntries = Array.from(salesOrdersToUpdateStatus.values());
    for (let i = 0; i < updateEntries.length; i += 200) {
      const chunk = updateEntries.slice(i, i + 200);
      await Promise.all(
        chunk.map((entry) =>
          prisma.salesOrder.update({
            where: { id: entry.id },
            data: { returnNumber: entry.voucherCode },
          }),
        ),
      );
    }
    console.log(`   ✔ Linked Sales Orders updated.`);

    // 6. Insert StockLedgers (chunk size 2,000)
    console.log(`💾 Inserting ${stockLedgerBatch.length.toLocaleString()} Inbound Stock Ledgers...`);
    for (let i = 0; i < stockLedgerBatch.length; i += ITEM_CHUNK) {
      const chunk = stockLedgerBatch.slice(i, i + ITEM_CHUNK);
      await prisma.stockLedger.createMany({ data: chunk });
      const pct = Math.round(((i + chunk.length) / stockLedgerBatch.length) * 100);
      process.stdout.write(`\r   Stock Ledgers Progress: ${i + chunk.length}/${stockLedgerBatch.length} (${pct}%)`);
    }
    console.log(`\n   ✔ Stock Ledgers inserted successfully.`);

    // 7. Insert StockMovements (chunk size 2,000)
    console.log(`💾 Inserting ${stockMovementBatch.length.toLocaleString()} Stock Movements...`);
    for (let i = 0; i < stockMovementBatch.length; i += ITEM_CHUNK) {
      const chunk = stockMovementBatch.slice(i, i + ITEM_CHUNK);
      await prisma.stockMovement.createMany({ data: chunk });
      const pct = Math.round(((i + chunk.length) / stockMovementBatch.length) * 100);
      process.stdout.write(`\r   Stock Movements Progress: ${i + chunk.length}/${stockMovementBatch.length} (${pct}%)`);
    }
    console.log(`\n   ✔ Stock Movements inserted successfully.`);

    // 8. Restore Inventory Item balances
    console.log(`🔄 Restoring stock on ${inventoryRestorations.size.toLocaleString()} unique Inventory Items...`);
    const invEntries = Array.from(inventoryRestorations.values());
    const INV_CONCURRENCY = 50;
    let updatedInv = 0;

    for (let i = 0; i < invEntries.length; i += INV_CONCURRENCY) {
      const chunk = invEntries.slice(i, i + INV_CONCURRENCY);
      await Promise.all(
        chunk.map(async (entry) => {
          const existingInv = await prisma.inventoryItem.findFirst({
            where: { locationId: entry.locationId, itemId: entry.itemId, status: 'AVAILABLE' },
            select: { id: true },
          });

          if (existingInv) {
            await prisma.inventoryItem.update({
              where: { id: existingInv.id },
              data: { quantity: { increment: entry.qty } },
            });
          } else {
            await prisma.inventoryItem.create({
              data: {
                warehouseId: entry.warehouseId,
                locationId: entry.locationId,
                itemId: entry.itemId,
                quantity: entry.qty,
                status: 'AVAILABLE',
              },
            });
          }
        }),
      );
      updatedInv += chunk.length;
      const pct = Math.round((updatedInv / invEntries.length) * 100);
      process.stdout.write(`\r   Inventory Progress: ${updatedInv}/${invEntries.length} (${pct}%)`);
    }
    console.log(`\n   ✔ Inventory balances restored successfully.`);
  }

  // ── FINAL GRAND SUMMARY REPORT ──
  console.log(`\n========================================================================================`);
  console.log(`📊 ${isDryRun ? '[DRY RUN TOTALS & AUDIT SUMMARY]' : '[FINAL POST-RETURN RECONCILIATION AUDIT]'}`);
  console.log(`========================================================================================`);
  console.log(`1. RETURN DOCUMENT & LINE ITEM TOTALS:`);
  console.log(`   - Total Return Documents (Memos): ${returnGroups.size.toLocaleString()}`);
  console.log(`   - Total Return Lines Uploaded   : ${totalReturnLines.toLocaleString()}`);
  console.log(`   - Total Returned QTY            : ${totalReturnQty.toLocaleString()}`);
  console.log(`   - Total WOST (Price W/O Tax)    : PKR ${totalWostSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   - Total Discount                : PKR ${totalDiscountSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   - Value Ex Sales Tax            : PKR ${totalValueExTaxSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   - Total Sales Tax               : PKR ${totalTaxSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   - Value Including Sales Tax     : PKR ${totalValueInclTaxSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`----------------------------------------------------------------------------------------`);
  console.log(`2. SUB-TYPE BREAKDOWN:`);
  console.log(`   - Exchange Returns              : PKR ${subTypeStats.exchange.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(16)}  (${subTypeStats.exchange.count.toLocaleString()} memos)`);
  console.log(`   - Claim Returns                 : PKR ${subTypeStats.claim.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(16)}  (${subTypeStats.claim.count.toLocaleString()} memos)`);
  console.log(`   - Cash/Direct Refund Returns    : PKR ${subTypeStats.refund.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(16)}  (${subTypeStats.refund.count.toLocaleString()} memos)`);
  console.log(`----------------------------------------------------------------------------------------`);
  console.log(`3. VOUCHER REDEMPTION STATUS:`);
  console.log(`   - Redeemed Vouchers             : PKR ${redeemedAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(16)}  (${redeemedCount.toLocaleString()} vouchers)`);
  console.log(`   - Open / Unredeemed Vouchers    : PKR ${openAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(16)}  (${openCount.toLocaleString()} vouchers)`);
  console.log(`----------------------------------------------------------------------------------------`);
  console.log(`4. ORIGINAL SALES ORDER MATCHING:`);
  console.log(`   - Directly Matched to Sale Order: ${matchedSalesOrderCount.toLocaleString()} memos (${Math.round((matchedSalesOrderCount / returnGroups.size) * 100)}%)`);
  console.log(`   - Standalone / Fallback Memos   : ${fallbackSalesOrderCount.toLocaleString()} memos (${Math.round((fallbackSalesOrderCount / returnGroups.size) * 100)}%)`);
  console.log(`========================================================================================\n`);
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('-d');

  let limit: number | undefined = undefined;
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  if (limitArg) {
    limit = parseInt(limitArg.split('=')[1], 10);
  }

  const locArg = process.argv.find((arg) => arg.startsWith('--location=') || arg.startsWith('-l='));
  const locationFilter = locArg ? locArg.split('=')[1] : undefined;

  const defaultReturnsFile = path.join(__dirname, '..', 'data', 'ST_july_aug.md');
  const fallbackFile = path.join(__dirname, '..', 'data', 'A-madison-return.md');

  let filePath = fs.existsSync(defaultReturnsFile) ? defaultReturnsFile : fallbackFile;
  const fileArg = process.argv.find((arg) => arg.startsWith('--file=') || arg.startsWith('--path='));
  if (fileArg) {
    const customPath = fileArg.split('=')[1];
    filePath = path.isAbsolute(customPath) ? customPath : path.join(process.cwd(), customPath);
  }

  console.log(`\n🚀 Starting POS Returns Import Pipeline...`);
  console.log(`📄 Target Data File: ${filePath}`);
  if (locationFilter) {
    console.log(`🏬 Filter Location: ${locationFilter}`);
  }
  if (isDryRun) {
    console.log(`⚠️ DRY RUN ACTIVATED: No database changes will be committed.`);
  }

  const rows = readAndParseReturnData(filePath, limit, locationFilter);

  console.log(`📄 Successfully parsed and sorted ${rows.length.toLocaleString()} return rows chronologically.`);
  if (rows.length > 0) {
    console.log('\n🔍 First Chronological Return Row (#1):');
    console.log(`   - Doc No    : ${rows[0].docNo}`);
    console.log(`   - Doc Date  : ${rows[0].docDate.toISOString().slice(0, 10)}`);
    console.log(`   - SubType   : ${rows[0].subType}`);
    console.log(`   - Location  : ${rows[0].costCentre} (${rows[0].locationCode})`);
    console.log(`   - Barcode   : ${rows[0].barCode}`);
    console.log(`   - Qty       : ${rows[0].quantity}`);
    console.log(`   - Price     : PKR ${rows[0].unitPrice}`);
    console.log(`   - Total Incl Tax: PKR ${Math.abs(rows[0].valueInclSalesTax)}`);
    console.log(`   - Sale Doc# : ${rows[0].fkSaleDoc || 'N/A'}`);
    console.log(`   - Redeem Doc#: ${rows[0].fkRedeemDoc || 'N/A'}`);
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

        const tenantPool = new Pool({ connectionString, max: 25, idleTimeoutMillis: 30000 });
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
  const pool = new Pool({ connectionString: dbUrl, max: 25, idleTimeoutMillis: 30000 });
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

// Only execute main when run directly from CLI
if (require.main === module || !process.env.NODE_ENV || process.argv[1]?.includes('import-madison-returns')) {
  main().catch((err) => {
    console.error('❌ Error executing script:', err);
    process.exit(1);
  });
}
