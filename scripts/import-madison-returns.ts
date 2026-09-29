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
  salesPersonName: string;
  barCode: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  priceWOT: number;
  totalPriceWOT: number;
  discountAmount: number;
  valueExSalesTax: number;
  salesTax: number;
  additionalSalesTax: number;
  totalSalesTax: number;
  valueInclSalesTax: number;
  costCentre: string;
  locationCode: string;
  posId: string;
  fbrInvoiceNumber: string;
  remarks: string;
  fkSaleDoc: string;
  docDateSaleStr: string;
  docDateSale: Date | null;
  fkRedeemDoc: string;
  docDateRedeemStr: string;
  docDateRedeem: Date | null;
}

/**
 * Calculates Fiscal Year 2-digit end-year suffix (e.g. July 2025 - June 2026 -> "26", July 2026 - June 2027 -> "27")
 */
export function getFySuffix(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed (6 = July)
  const fyEndYear = month >= 6 ? year + 1 : year;
  return String(fyEndYear).slice(-2);
}

/**
 * Robust date parser supporting:
 * - Excel date serial numbers (e.g. 46151.66388888889 -> ~May 2026, 46042 -> ~Jan 2026)
 * - M/D/YYYY or D/M/YYYY or YYYY-MM-DD
 * - ISO date strings
 */
export function parseCustomDate(dateVal: any): Date | null {
  if (!dateVal && dateVal !== 0) return null;

  // Handle Excel date serial numbers like 46151 or 46151.66388888889
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
    return (
      trimmed !== '' &&
      !trimmed.startsWith('#') &&
      !trimmed.startsWith('|-') &&
      !trimmed.startsWith('| ---') &&
      !trimmed.startsWith('|---')
    );
  });

  if (lines.length < 2) {
    console.warn(`⚠️ File ${filePath} contains no data rows.`);
    return [];
  }

  const headerLine = lines[0];
  const isTabSep = headerLine.includes('\t');
  const isPipeSep = headerLine.includes('|');

  const headers = parseMarkdownLine(headerLine, isTabSep, isPipeSep).map((h) => h.toLowerCase().trim());

  const findExactColIndex = (keywords: string[]): number => {
    return headers.findIndex((h) => keywords.some((k) => h === k));
  };

  const findColIndex = (keywords: string[], defaultIdx: number): number => {
    const exactIdx = findExactColIndex(keywords);
    if (exactIdx !== -1) return exactIdx;
    const partialIdx = headers.findIndex((h) => keywords.some((k) => h.includes(k)));
    return partialIdx !== -1 ? partialIdx : defaultIdx;
  };

  const colCostCentre = findColIndex(['costcentre', 'cost centre', 'store'], 0);
  const colLocCode = findColIndex(['location id', 'location code', 'locationcode', 'loc code'], 1);
  const colSubType = findExactColIndex(['sub type', 'subtype', 'return sub type']) !== -1 
    ? findExactColIndex(['sub type', 'subtype', 'return sub type']) 
    : 3;
  const colDocDate = findExactColIndex(['documentdate', 'docdate', 'doc date', 'date']) !== -1
    ? findExactColIndex(['documentdate', 'docdate', 'doc date', 'date'])
    : 4;
  const colDocNo = findExactColIndex(['documentnumber', 'docno', 'doc no', 'doc number', 'document no']) !== -1
    ? findExactColIndex(['documentnumber', 'docno', 'doc no', 'doc number', 'document no'])
    : 5;
  const colSalesPerson = findColIndex(['salespersonname', 'salesperson', 'sales person', 'cashier', 'fksalespersonid'], -1);
  const colBarcode = findColIndex(['barcode', 'bar code', 'sku', 'item'], 7);
  const colQty = findColIndex(['quantity', 'qty'], 8);
  const colUnitPrice = findExactColIndex(['unitprice', 'unit price', 'price']) !== -1
    ? findExactColIndex(['unitprice', 'unit price', 'price'])
    : 9;
  const colTaxRate = findColIndex(['taxrate1', 'taxrate', 'tax rate', 'vat rate'], -1);
  const colPriceWOT = findColIndex(['price_w_o_t', 'pricewot', 'price w/o tax', 'price wost'], 11);
  const colTotalPriceWOT = findColIndex(['total_price_w_o_t', 'totalpricewot', 'total price w/o tax', 'total price wost'], 12);
  const colDiscountAmount = findExactColIndex(['discountamount', 'discount_amount', 'discount amount', 'discount']) !== -1
    ? findExactColIndex(['discountamount', 'discount_amount', 'discount amount', 'discount'])
    : 14;
  const colValueExSalesTax = findColIndex(['value ex sales tax', 'valueexsalestax', 'discounted value', 'taxable value'], 15);
  const colSalesTax = findExactColIndex(['sales tax', 'salestax', 'tax amount']) !== -1
    ? findExactColIndex(['sales tax', 'salestax', 'tax amount'])
    : 16;
  const colAddSalesTax = findColIndex(['additional sales tax', 'additionalsalestax', 'add sales tax'], 17);
  const colTotalSalesTax = findColIndex(['total sales tax', 'totalsalestax', 'tot sales tax'], 18);
  const colValueInclSalesTax = findColIndex(['value incl sales tax', 'valueinclsalestax', 'total value', 'net return value', 'value incl tax'], 19);
  const colSaleDocNo = findColIndex(
    ['fkinvoicenumber_sale', 'fkdocumentnumber_sale', 'sale invoice', 'sale doc', 'fkexchangevouchernumber', 'fk exchange voucher number', 'exchange voucher number'],
    -1,
  );
  const colSaleDocDate = findColIndex(['documentdate_sale', 'sale date'], -1);
  const colRedeemDocNo = findColIndex(
    [
      'fkinvoicenumber_exchange',
      'fkdocumentnumber_sale_redeem',
      'fkdocumentnumer_sale_redeem',
      'fkinvoicenumber_settle',
      'settle doc',
      'redeem doc',
      'fkexchangevouchernumber',
      'fk exchange voucher number',
      'exchange voucher number',
    ],
    -1,
  );
  const colRedeemDocDate = findColIndex(
    ['documentdate_exchange', 'documentdate_sale_redeem', 'documentdate_settle', 'settle date', 'redeem date'],
    -1,
  );
  const colPosId = findColIndex(['pos id', 'posid'], 24);
  const colFbrInvoice = findColIndex(['fbr invoice#', 'fbrinvoice'], 25);
  const colRemarks = findColIndex(['remarks', 'reason', 'note'], 26);

  const rawParsed: ParsedReturnRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;

    const parts = parseMarkdownLine(rawLine, isTabSep, isPipeSep);
    if (parts.length < 10) continue;

    const costCentre = parts[colCostCentre] || '';
    const locationCode = parts[colLocCode] || '';
    const docNo = (parts[colDocNo] || '').replace(/['"]/g, '').trim();
    const docDateStr = parts[colDocDate] || '';
    let subType = (parts[colSubType] || '').trim();
    if (!subType || subType.toLowerCase() === 'return') {
      subType = 'Exchange';
    }
    const salesPersonName = colSalesPerson !== -1 ? parts[colSalesPerson] || '' : '';
    const barCode = (parts[colBarcode] || '').replace(/[\t\r\n'"]/g, '').trim();
    const quantity = parseFloat(parts[colQty] || '1') || 1;
    const unitPrice = Math.abs(parseFloat(parts[colUnitPrice] || '0') || 0);
    const taxRate = colTaxRate !== -1 ? parseFloat(parts[colTaxRate] || '0') || 0 : 0;
    const priceWOT = parseFloat(parts[colPriceWOT] || '0') || 0;
    const totalPriceWOT = parseFloat(parts[colTotalPriceWOT] || '0') || (priceWOT ? priceWOT * Math.abs(quantity) : unitPrice);
    const discountAmount = parseFloat(parts[colDiscountAmount] || '0') || 0;
    const valueExSalesTax = parseFloat(parts[colValueExSalesTax] || '0') || (totalPriceWOT - discountAmount);
    const salesTax = parseFloat(parts[colSalesTax] || '0') || 0;
    const additionalSalesTax = parseFloat(parts[colAddSalesTax] || '0') || 0;
    const totalSalesTax = parseFloat(parts[colTotalSalesTax] || '0') || (salesTax + additionalSalesTax);
    const valueInclSalesTax = parseFloat(parts[colValueInclSalesTax] || '0') || (valueExSalesTax + totalSalesTax);
    const posId = colPosId !== -1 ? parts[colPosId] || '' : '';
    const fbrInvoiceNumber = colFbrInvoice !== -1 ? (parts[colFbrInvoice] || '').replace(/^['"]/, '').trim() : '';
    const remarks = colRemarks !== -1 ? parts[colRemarks] || '' : '';
    const rawSaleDoc = colSaleDocNo !== -1 ? (parts[colSaleDocNo] || '').replace(/['"]/g, '').trim() : '';
    const fkSaleDoc = rawSaleDoc === '0' ? '' : rawSaleDoc;
    const docDateSaleStr = colSaleDocDate !== -1 ? parts[colSaleDocDate] || '' : '';
    const rawRedeemDoc = colRedeemDocNo !== -1 ? (parts[colRedeemDocNo] || '').replace(/['"]/g, '').trim() : '';
    const fkRedeemDoc = rawRedeemDoc === '0' ? '' : rawRedeemDoc;
    const docDateRedeemStr = colRedeemDocDate !== -1 ? parts[colRedeemDocDate] || '' : '';

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
      salesPersonName,
      barCode,
      quantity,
      unitPrice,
      taxRate,
      priceWOT,
      totalPriceWOT,
      discountAmount,
      valueExSalesTax,
      salesTax,
      additionalSalesTax,
      totalSalesTax,
      valueInclSalesTax,
      costCentre,
      locationCode,
      posId,
      fbrInvoiceNumber,
      remarks,
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
  console.log(`\n========================================================================================`);
  console.log(`📦 ${isDryRun ? '[DRY RUN MODE]' : '[LIVE COMMIT MODE]'} Processing ${rows.length.toLocaleString()} sales return rows...`);
  console.log(`========================================================================================\n`);

  const isWipeAll = process.argv.includes('--wipe-all');

  const minDocDate = new Date(Math.min(...rows.map((r) => r.docDate.getTime())));
  const maxDocDate = new Date(Math.max(...rows.map((r) => r.docDate.getTime())));
  const maxDocDateEnd = new Date(maxDocDate);
  maxDocDateEnd.setHours(23, 59, 59, 999);

  console.log(`📅 Incoming Returns Batch Date Range: ${minDocDate.toISOString().slice(0, 10)} to ${maxDocDate.toISOString().slice(0, 10)}`);

  if (!isDryRun) {
    if (isWipeAll) {
      console.log(`⚠️ WIPE ALL FLAG DETECTED: Performing complete cleanup of existing return records, exchange vouchers & return stock logs...`);

      // 1. Delete Return Stock Movements
      const delMovements = await prisma.stockMovement.deleteMany({
        where: {
          OR: [
            { type: 'POS_RETURN' },
            { referenceType: 'POS_RETURN' },
            { movementNo: { startsWith: 'MV-RET-' } },
          ],
        },
      });
      console.log(`  ✅ Wiped ${delMovements.count.toLocaleString()} Return Stock Movements.`);

      // 2. Delete Return Stock Ledgers
      const delLedgers = await prisma.stockLedger.deleteMany({
        where: {
          referenceType: 'POS_RETURN',
        },
      });
      console.log(`  ✅ Wiped ${delLedgers.count.toLocaleString()} Return Stock Ledgers.`);

      // 3. Delete PosReturnItems & PosReturns
      const delReturnItems = await prisma.posReturnItem.deleteMany({});
      const delReturns = await prisma.posReturn.deleteMany({});
      console.log(`  ✅ Wiped ${delReturns.count.toLocaleString()} PosReturns and ${delReturnItems.count.toLocaleString()} PosReturnItems.`);

      // 4. Delete Voucher Redemptions linked to Return/Exchange Vouchers
      const delVoucherRedemptions = await prisma.voucherRedemption.deleteMany({
        where: {
          voucher: {
            OR: [
              { voucherType: { in: ['EXCHANGE', 'CLAIM', 'REFUND'] } },
              { code: { startsWith: 'SR-' } },
              { code: { startsWith: 'EXC-' } },
              { code: { startsWith: 'CLM-' } },
              { code: { startsWith: 'REF-' } },
              { code: { startsWith: 'RF-' } },
            ],
          },
        },
      });
      console.log(`  ✅ Wiped ${delVoucherRedemptions.count.toLocaleString()} Voucher Redemptions.`);

      // 5. Delete Voucher Transactions linked to Return/Exchange Vouchers
      const delVoucherTx = await prisma.voucherTransaction.deleteMany({
        where: {
          voucher: {
            OR: [
              { voucherType: { in: ['EXCHANGE', 'CLAIM', 'REFUND'] } },
              { code: { startsWith: 'SR-' } },
              { code: { startsWith: 'EXC-' } },
              { code: { startsWith: 'CLM-' } },
              { code: { startsWith: 'REF-' } },
              { code: { startsWith: 'RF-' } },
            ],
          },
        },
      });
      console.log(`  ✅ Wiped ${delVoucherTx.count.toLocaleString()} Voucher Transactions.`);

      // 6. Clear PosClaim voucher links if any
      await prisma.posClaim.updateMany({
        where: {
          voucher: {
            OR: [
              { voucherType: { in: ['EXCHANGE', 'CLAIM', 'REFUND'] } },
              { code: { startsWith: 'SR-' } },
              { code: { startsWith: 'EXC-' } },
              { code: { startsWith: 'CLM-' } },
              { code: { startsWith: 'REF-' } },
              { code: { startsWith: 'RF-' } },
            ],
          },
        },
        data: { voucherId: null },
      });

      // 7. Reset returnNumber on sales orders
      await prisma.salesOrder.updateMany({
        where: {
          OR: [
            { returnNumber: { startsWith: 'SR-' } },
            { returnNumber: { startsWith: 'EXC-' } },
            { returnNumber: { startsWith: 'CLM-' } },
            { returnNumber: { startsWith: 'REF-' } },
            { returnNumber: { startsWith: 'RF-' } },
          ],
        },
        data: {
          returnNumber: null,
        },
      });

      // 8. Delete Voucher Locations
      await prisma.voucherLocation.deleteMany({
        where: {
          voucher: {
            OR: [
              { voucherType: { in: ['EXCHANGE', 'CLAIM', 'REFUND'] } },
              { code: { startsWith: 'SR-' } },
              { code: { startsWith: 'EXC-' } },
              { code: { startsWith: 'CLM-' } },
              { code: { startsWith: 'REF-' } },
              { code: { startsWith: 'RF-' } },
            ],
          },
        },
      });

      // 9. Delete Return/Exchange Vouchers
      const delVouchers = await prisma.voucher.deleteMany({
        where: {
          OR: [
            { voucherType: { in: ['EXCHANGE', 'CLAIM', 'REFUND'] } },
            { code: { startsWith: 'SR-' } },
            { code: { startsWith: 'EXC-' } },
            { code: { startsWith: 'CLM-' } },
            { code: { startsWith: 'REF-' } },
            { code: { startsWith: 'RF-' } },
          ],
        },
      });
      console.log(`  ✅ Wiped ${delVouchers.count.toLocaleString()} Return / Exchange Vouchers.`);

      // 10. Delete previous fallback RET- Sales Orders
      const delRetOrderItems = await prisma.salesOrderItem.deleteMany({
        where: {
          salesOrder: {
            orderNumber: { startsWith: 'RET-' },
          },
        },
      });
      const delRetOrders = await prisma.salesOrder.deleteMany({
        where: {
          orderNumber: { startsWith: 'RET-' },
        },
      });
      console.log(`  ✅ Wiped ${delRetOrders.count.toLocaleString()} previous fallback RET- Sales Orders.`);
    } else {
      console.log(`🧹 Checking for existing returns in incoming date range (${minDocDate.toISOString().slice(0, 10)} to ${maxDocDate.toISOString().slice(0, 10)})...`);
      const existingRangeReturns = await prisma.posReturn.findMany({
        where: {
          createdAt: {
            gte: minDocDate,
            lte: maxDocDateEnd,
          },
        },
        select: { id: true, returnNumber: true, voucherId: true },
      });

      if (existingRangeReturns.length > 0) {
        const retIds = existingRangeReturns.map((r) => r.id);
        const voucherIds = existingRangeReturns.map((r) => r.voucherId).filter(Boolean) as string[];
        console.log(`  Found ${retIds.length} existing PosReturns in date range to replace.`);

        await prisma.posReturnItem.deleteMany({ where: { posReturnId: { in: retIds } } });
        await prisma.stockMovement.deleteMany({
          where: { referenceId: { in: retIds }, referenceType: 'POS_RETURN' },
        });
        await prisma.stockLedger.deleteMany({
          where: { referenceId: { in: retIds }, referenceType: 'POS_RETURN' },
        });
        await prisma.posReturn.deleteMany({ where: { id: { in: retIds } } });

        if (voucherIds.length > 0) {
          await prisma.voucherRedemption.deleteMany({ where: { voucherId: { in: voucherIds } } });
          await prisma.voucherTransaction.deleteMany({ where: { voucherId: { in: voucherIds } } });
          await prisma.voucherLocation.deleteMany({ where: { voucherId: { in: voucherIds } } });
          await prisma.voucher.deleteMany({ where: { id: { in: voucherIds } } });
        }
        console.log(`  ✅ Successfully cleaned up ${retIds.length} existing range PosReturns & Vouchers.`);
      } else {
        console.log(`  ✨ No overlapping PosReturns found in target date range. Appending cleanly.`);
      }

      // Also clean up any fallback RET- orders in this date range
      const existingRangeFallbackOrders = await prisma.salesOrder.findMany({
        where: {
          createdAt: {
            gte: minDocDate,
            lte: maxDocDateEnd,
          },
          orderNumber: { startsWith: 'RET-' },
        },
        select: { id: true },
      });

      if (existingRangeFallbackOrders.length > 0) {
        const fallbackIds = existingRangeFallbackOrders.map((o) => o.id);
        console.log(`  Cleaning up ${fallbackIds.length} fallback RET- Sales Orders in date range...`);
        await prisma.posReturnItem.deleteMany({ where: { salesOrderItem: { salesOrderId: { in: fallbackIds } } } });
        await prisma.salesOrderItem.deleteMany({ where: { salesOrderId: { in: fallbackIds } } });
        await prisma.salesOrder.deleteMany({ where: { id: { in: fallbackIds } } });
        console.log(`  ✅ Successfully cleaned up ${fallbackIds.length} fallback RET- Sales Orders.`);
      }
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
      const loc = {
        id: `loc-${cleanCode || cleanName}`,
        code: cleanCode,
        shortCode: cleanCode,
        name: name || 'Location',
        warehouseId: defaultWarehouse.id,
      };
      if (cleanCode) locationCache.set(cleanCode, loc);
      return loc;
    }
  }

  // Pre-cache Items in memory & batch create missing items
  console.log(`⚙️ Pre-caching Locations, Items, and Sales Orders in memory...`);
  const itemCache = new Map<string, any>();
  const allDbItems = await prisma.item.findMany({
    select: { id: true, barCode: true, sku: true, unitPrice: true, unitCost: true },
  });
  for (const it of allDbItems) {
    if (it.barCode) itemCache.set(it.barCode.trim(), it);
    if (it.sku) itemCache.set(it.sku.trim(), it);
  }
  console.log(`✔ Cached ${itemCache.size.toLocaleString()} items from database.`);

  // Ensure default fallback item exists
  let defaultItem: any = null;
  if (!isDryRun) {
    defaultItem = await prisma.item.findFirst({ where: { itemId: 'ITEM-GENERAL-RETURN' } });
    if (!defaultItem) {
      defaultItem = await prisma.item.create({
        data: {
          itemId: 'ITEM-GENERAL-RETURN',
          sku: 'GENERAL-RETURN',
          barCode: 'GENERAL-RETURN',
          description: 'General Return Item Fallback',
          unitPrice: 0,
          unitCost: 0,
          status: 'active',
          isActive: true,
        },
      });
    }
    itemCache.set('DEFAULT_RETURN_ITEM', defaultItem);
  } else {
    defaultItem = { id: 'dry-item-general-return', unitPrice: 0, unitCost: 0 };
    itemCache.set('DEFAULT_RETURN_ITEM', defaultItem);
  }

  // Find unique missing barcodes across dataset
  const uniqueMissingBarcodes = new Map<string, { barCode: string; unitPrice: number }>();
  for (const row of rows) {
    const cleanBar = (row.barCode || '').trim();
    if (cleanBar && !itemCache.has(cleanBar) && !uniqueMissingBarcodes.has(cleanBar)) {
      uniqueMissingBarcodes.set(cleanBar, { barCode: cleanBar, unitPrice: row.unitPrice });
    }
  }

  if (uniqueMissingBarcodes.size > 0) {
    console.log(`✨ Found ${uniqueMissingBarcodes.size.toLocaleString()} missing items. Batch creating in database...`);
    if (!isDryRun) {
      const missingItemData = Array.from(uniqueMissingBarcodes.values()).map((it) => ({
        id: crypto.randomUUID(),
        itemId: `ITEM-${it.barCode}`,
        sku: it.barCode,
        barCode: it.barCode,
        description: `POS Item (${it.barCode})`,
        unitPrice: it.unitPrice,
        unitCost: Math.round(it.unitPrice * 0.7 * 100) / 100,
        status: 'active',
        isActive: true,
      }));

      for (let i = 0; i < missingItemData.length; i += 1000) {
        const chunk = missingItemData.slice(i, i + 1000);
        await prisma.item.createMany({ data: chunk, skipDuplicates: true });
      }

      // Re-fetch created items into cache
      const reFetched = await prisma.item.findMany({
        where: { barCode: { in: Array.from(uniqueMissingBarcodes.keys()) } },
        select: { id: true, barCode: true, sku: true, unitPrice: true, unitCost: true },
      });
      for (const it of reFetched) {
        if (it.barCode) itemCache.set(it.barCode.trim(), it);
        if (it.sku) itemCache.set(it.sku.trim(), it);
      }
      console.log(`✔ Bulk created & indexed ${reFetched.length.toLocaleString()} missing items.`);
    }
  }

  // Pre-cache all Sales Orders in memory for instant original sale matching
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

  const usedFallbackOrderNumbers = new Set<string>();
  for (const order of dbSalesOrders) {
    salesOrderByOrderNum.set(order.orderNumber.toUpperCase(), order);
    usedFallbackOrderNumbers.add(order.orderNumber.toUpperCase());

    // 1. Match from notes: "Original DocNo: 523 |"
    if (order.notes) {
      const match = order.notes.match(/Original DocNo:\s*(\d+)/i);
      if (match && match[1]) {
        const docKey = `${order.locationId}::${match[1]}`;
        salesOrderByLocAndDoc.set(docKey, order);
      }
    }

    // 2. Match from orderNumber suffix: SI-ADIJI26-00076 -> locationId::76
    const parts = order.orderNumber.split('-');
    if (parts.length >= 3) {
      const numPart = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(numPart)) {
        const docKey = `${order.locationId}::${numPart}`;
        if (!salesOrderByLocAndDoc.has(docKey)) {
          salesOrderByLocAndDoc.set(docKey, order);
        }
      }
    }
  }
  console.log(`✔ Indexed ${dbSalesOrders.length.toLocaleString()} sales orders in memory.`);

  const existingPosReturns = await prisma.posReturn.findMany({ select: { returnNumber: true } });
  const usedReturnNumbers = new Set<string>(existingPosReturns.map((r) => r.returnNumber.toUpperCase()));

  const existingVouchers = await prisma.voucher.findMany({ select: { code: true } });
  const usedVoucherCodes = new Set<string>(existingVouchers.map((v) => v.code.toUpperCase()));

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

  // Batches for bulk database insertion
  const fallbackSalesOrdersBatch: any[] = [];
  const fallbackSalesOrderItemsBatch: any[] = [];
  const voucherBatch: any[] = [];
  const voucherLocationBatch: any[] = [];
  const voucherTransactionBatch: any[] = [];
  const posReturnBatch: any[] = [];
  const posReturnItemBatch: any[] = [];
  const voucherRedemptionBatch: any[] = [];
  const stockLedgerBatch: any[] = [];
  const stockMovementBatch: any[] = [];
  const inventoryRestorations = new Map<string, { warehouseId: string; locationId: string; itemId: string; qty: number }>();
  const salesOrdersToUpdateStatus = new Map<string, { id: string; voucherCode: string; returnNumber: string }>();

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

  let groupIndex = 0;
  for (const [groupKey, groupRows] of returnGroups.entries()) {
    groupIndex++;
    const sample = groupRows[0];
    const location = await resolveLocation(sample.locationCode, sample.costCentre);

    const rawCode = location.shortCode?.trim() || location.code?.trim() || sample.locationCode || 'LOC';
    const cleanCode = rawCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const fySuffix = getFySuffix(sample.docDate);
    const padDocNo = String(sample.docNo).padStart(5, '0');

    const subTypeUpper = sample.subType.toUpperCase();
    const returnPrefix = subTypeUpper === 'CLAIM' ? 'CLM' : subTypeUpper === 'REFUND' ? 'REF' : 'SR';
    const voucherPrefix = subTypeUpper === 'CLAIM' ? 'CLM' : subTypeUpper === 'REFUND' ? 'REF' : 'EXC';

    // 1. Return Memo / Invoice Number: SR-ADIJI27-00001
    const baseReturnNumber = `${returnPrefix}-${cleanCode}${fySuffix}-${padDocNo}`;
    let returnNumber = baseReturnNumber;
    let retDupSuffix = 1;
    while (usedReturnNumbers.has(returnNumber)) {
      retDupSuffix++;
      returnNumber = `${baseReturnNumber}-${retDupSuffix}`;
    }
    usedReturnNumbers.add(returnNumber);

    // 2. Issued Voucher Code: EXC-ADIJI27-00001
    const baseVoucherCode = `${voucherPrefix}-${cleanCode}${fySuffix}-${padDocNo}`;
    let voucherCode = baseVoucherCode;
    let dupSuffix = 1;
    while (usedVoucherCodes.has(voucherCode)) {
      dupSuffix++;
      voucherCode = `${baseVoucherCode}-${dupSuffix}`;
    }
    usedVoucherCodes.add(voucherCode);

    const voucherId = isDryRun ? `dry-vouch-${voucherCode}` : crypto.randomUUID();
    const posReturnId = isDryRun ? `dry-ret-${returnNumber}` : crypto.randomUUID();

    const returnMemoQty = groupRows.reduce((acc, r) => acc + Math.abs(r.quantity), 0);
    const returnSubtotalWost = groupRows.reduce((acc, r) => acc + Math.abs(r.totalPriceWOT || r.priceWOT || r.unitPrice), 0);
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
    const voucherDesc = `${voucherType} Voucher for Return #${returnNumber} (Sale #${sample.fkSaleDoc || 'N/A'})`;

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
        returnNumber,
        voucherCode,
      });
    } else {
      // Fallback SalesOrder if original sale invoice was not in current dataset
      fallbackSalesOrderCount++;
      const baseFallbackOrderNumber = `RET-${cleanCode}${fySuffix}-${padDocNo}`;
      let fallbackOrderNumber = baseFallbackOrderNumber;
      let orderDup = 1;
      while (usedFallbackOrderNumbers.has(fallbackOrderNumber.toUpperCase())) {
        orderDup++;
        fallbackOrderNumber = `${baseFallbackOrderNumber}-${orderDup}`;
      }
      usedFallbackOrderNumbers.add(fallbackOrderNumber.toUpperCase());

      targetOrderId = isDryRun ? `dry-order-${fallbackOrderNumber}` : crypto.randomUUID();

      const fallbackOrderObj = {
        id: targetOrderId,
        orderNumber: fallbackOrderNumber,
        returnNumber: returnNumber,
        posId: sample.posId || null,
        terminalId: sample.posId || null,
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
        updatedAt: sample.docDate,
        items: [] as any[],
      };
      fallbackSalesOrdersBatch.push(fallbackOrderObj);
      salesOrderByOrderNum.set(fallbackOrderNumber.toUpperCase(), fallbackOrderObj);
    }

    if (isDryRun) {
      if (groupIndex <= 5) {
        console.log(
          `🔍 [DRY-RUN Ret:#${returnNumber} | Vouch:#${voucherCode}] Date:${sample.docDate.toISOString().slice(0, 10)} | Store:${location.name} | Type:${voucherType} | Value: PKR ${returnTotalValue.toLocaleString()} | SaleDoc:${sample.fkSaleDoc || 'N/A'} (Matched:${Boolean(originalSalesOrder)}) | Redeemed:${isRedeemed ? 'YES (Doc #' + sample.fkRedeemDoc + ')' : 'NO'}`,
        );
      }
      continue;
    }

    // 2. Prepare Voucher Record (Code: EXC-...)
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

    // 3. Prepare VoucherLocation
    voucherLocationBatch.push({
      id: crypto.randomUUID(),
      voucherId,
      locationId: location.id,
    });

    // 4. Prepare VoucherTransaction (Audit Trail)
    voucherTransactionBatch.push({
      id: crypto.randomUUID(),
      voucherId,
      orderId: targetOrderId,
      locationId: location.id,
      action: 'ISSUED',
      amountUsed: Math.round(returnTotalValue * 100) / 100,
      notes: `Auto-issued for Return #${returnNumber} (Doc #${sample.docNo})`,
      createdAt: sample.docDate,
    });

    // 5. Prepare PosReturn Record (ReturnNumber: SR-..., VoucherId: links to EXC- voucher)
    posReturnBatch.push({
      id: posReturnId,
      returnNumber: returnNumber,
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

    // 6. Prepare PosReturnItems & Stock Logs
    let itemIdx = 0;
    for (const row of groupRows) {
      itemIdx++;
      const cleanBar = (row.barCode || '').trim();
      const item = itemCache.get(cleanBar) || defaultItem;

      // Match SalesOrderItem if original order has it
      let matchedOrderItemId: string | null = null;
      const effectiveOrder = originalSalesOrder || fallbackSalesOrdersBatch.find((o) => o.id === targetOrderId);
      if (effectiveOrder && effectiveOrder.items && effectiveOrder.items.length > 0) {
        const found = effectiveOrder.items.find((it: any) => it.itemId === item.id);
        if (found) {
          matchedOrderItemId = found.id;
        } else {
          matchedOrderItemId = effectiveOrder.items[0].id;
        }
      }

      // If no matching sales order item found, create one in fallback batch
      if (!matchedOrderItemId) {
        const fallbackOrderItemId = crypto.randomUUID();
        const fallbackItemObj = {
          id: fallbackOrderItemId,
          salesOrderId: targetOrderId,
          itemId: item.id,
          quantity: Math.abs(row.quantity),
          unitPrice: Math.round(row.unitPrice * 100) / 100,
          discountAmount: Math.round(Math.abs(row.discountAmount) * 100) / 100,
          taxAmount: Math.round(Math.abs(row.totalSalesTax) * 100) / 100,
          lineTotal: Math.round(Math.abs(row.valueInclSalesTax) * 100) / 100,
          createdAt: sample.docDate,
        };
        fallbackSalesOrderItemsBatch.push(fallbackItemObj);
        if (effectiveOrder) {
          if (!effectiveOrder.items) effectiveOrder.items = [];
          effectiveOrder.items.push(fallbackItemObj);
        }
        matchedOrderItemId = fallbackOrderItemId;
      }

      const absQty = Math.abs(row.quantity);
      const lineTaxAmount = Math.abs(row.totalSalesTax || row.salesTax);
      const lineValueExTax = Math.abs(row.valueExSalesTax);
      const taxPercent = lineValueExTax > 0 ? Math.round((lineTaxAmount / lineValueExTax) * 100 * 100) / 100 : (row.taxRate || 18);

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
        discountPercent: Math.min(100, Math.max(0, Math.round(Math.abs((row.discountAmount / (row.totalPriceWOT || 1)) * 100) * 100) / 100)),
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
        qty: absQty,
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

    // 7. Check if redeemed in a sales order
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

        voucherTransactionBatch.push({
          id: crypto.randomUUID(),
          voucherId,
          orderId: redeemOrder.id,
          locationId: location.id,
          action: 'REDEEMED',
          amountUsed: Math.round(returnTotalValue * 100) / 100,
          notes: `Redeemed in Sale Doc #${sample.fkRedeemDoc}`,
          createdAt: sample.docDateRedeem || sample.docDate,
        });
      }
    }
  }

  // ── High-Speed Chunked Database Ingestion (If live) ──
  if (!isDryRun) {
    console.log(`\n🚀 Executing High-Speed Chunked Return DB Commits...`);

    // 1. Insert Fallback Sales Orders
    if (fallbackSalesOrdersBatch.length > 0) {
      console.log(`💾 Inserting ${fallbackSalesOrdersBatch.length.toLocaleString()} Fallback Sales Orders...`);
      for (let i = 0; i < fallbackSalesOrdersBatch.length; i += 1000) {
        const chunk = fallbackSalesOrdersBatch.slice(i, i + 1000).map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          returnNumber: o.returnNumber,
          posId: o.posId,
          terminalId: o.terminalId,
          locationId: o.locationId,
          subtotal: o.subtotal,
          discountAmount: o.discountAmount,
          taxAmount: o.taxAmount,
          grandTotal: o.grandTotal,
          paymentMethod: o.paymentMethod,
          paymentStatus: o.paymentStatus,
          status: o.status,
          notes: o.notes,
          fbrInvoiceNumber: o.fbrInvoiceNumber,
          createdAt: o.createdAt,
          updatedAt: o.updatedAt,
        }));
        await prisma.salesOrder.createMany({ data: chunk });
      }
      console.log(`   ✔ Fallback Sales Orders inserted.`);
    }

    // 2. Insert Fallback Sales Order Items
    if (fallbackSalesOrderItemsBatch.length > 0) {
      console.log(`💾 Inserting ${fallbackSalesOrderItemsBatch.length.toLocaleString()} Fallback Sales Order Items...`);
      for (let i = 0; i < fallbackSalesOrderItemsBatch.length; i += 2000) {
        const chunk = fallbackSalesOrderItemsBatch.slice(i, i + 2000).map((it) => ({
          id: it.id,
          salesOrderId: it.salesOrderId,
          itemId: it.itemId,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          discountAmount: it.discountAmount,
          taxAmount: it.taxAmount,
          lineTotal: it.lineTotal,
          createdAt: it.createdAt,
        }));
        await prisma.salesOrderItem.createMany({ data: chunk });
      }
      console.log(`   ✔ Fallback Sales Order Items inserted.`);
    }

    // 3. Insert Vouchers (chunk size 1,000)
    console.log(`💾 Inserting ${voucherBatch.length.toLocaleString()} Vouchers in chunks of 1,000...`);
    const VOUCHER_CHUNK = 1000;
    for (let i = 0; i < voucherBatch.length; i += VOUCHER_CHUNK) {
      const chunk = voucherBatch.slice(i, i + VOUCHER_CHUNK);
      await prisma.voucher.createMany({ data: chunk, skipDuplicates: true });
      const pct = Math.round(((i + chunk.length) / voucherBatch.length) * 100);
      process.stdout.write(`\r   Vouchers Progress: ${i + chunk.length}/${voucherBatch.length} (${pct}%)`);
    }
    console.log(`\n   ✔ Vouchers inserted successfully.`);

    // 4. Insert Voucher Locations
    if (voucherLocationBatch.length > 0) {
      console.log(`💾 Inserting ${voucherLocationBatch.length.toLocaleString()} Voucher Locations...`);
      for (let i = 0; i < voucherLocationBatch.length; i += 2000) {
        const chunk = voucherLocationBatch.slice(i, i + 2000);
        await prisma.voucherLocation.createMany({ data: chunk, skipDuplicates: true });
      }
      console.log(`   ✔ Voucher Locations inserted.`);
    }

    // 5. Insert Voucher Transactions
    if (voucherTransactionBatch.length > 0) {
      console.log(`💾 Inserting ${voucherTransactionBatch.length.toLocaleString()} Voucher Transactions...`);
      for (let i = 0; i < voucherTransactionBatch.length; i += 2000) {
        const chunk = voucherTransactionBatch.slice(i, i + 2000);
        await prisma.voucherTransaction.createMany({ data: chunk, skipDuplicates: true });
      }
      console.log(`   ✔ Voucher Transactions inserted.`);
    }

    // 6. Insert PosReturns (chunk size 1,000)
    console.log(`💾 Inserting ${posReturnBatch.length.toLocaleString()} PosReturn records in chunks of 1,000...`);
    for (let i = 0; i < posReturnBatch.length; i += VOUCHER_CHUNK) {
      const chunk = posReturnBatch.slice(i, i + VOUCHER_CHUNK);
      await prisma.posReturn.createMany({ data: chunk, skipDuplicates: true });
      const pct = Math.round(((i + chunk.length) / posReturnBatch.length) * 100);
      process.stdout.write(`\r   PosReturns Progress: ${i + chunk.length}/${posReturnBatch.length} (${pct}%)`);
    }
    console.log(`\n   ✔ PosReturns inserted successfully.`);

    // 7. Insert PosReturnItems (chunk size 2,000)
    console.log(`💾 Inserting ${posReturnItemBatch.length.toLocaleString()} PosReturn Items in chunks of 2,000...`);
    const ITEM_CHUNK = 2000;
    for (let i = 0; i < posReturnItemBatch.length; i += ITEM_CHUNK) {
      const chunk = posReturnItemBatch.slice(i, i + ITEM_CHUNK);
      await prisma.posReturnItem.createMany({ data: chunk, skipDuplicates: true });
      const pct = Math.round(((i + chunk.length) / posReturnItemBatch.length) * 100);
      process.stdout.write(`\r   Return Items Progress: ${i + chunk.length}/${posReturnItemBatch.length} (${pct}%)`);
    }
    console.log(`\n   ✔ PosReturn Items inserted successfully.`);

    // 8. Insert Voucher Redemptions
    if (voucherRedemptionBatch.length > 0) {
      console.log(`💾 Inserting ${voucherRedemptionBatch.length.toLocaleString()} Voucher Redemptions...`);
      for (let i = 0; i < voucherRedemptionBatch.length; i += 1000) {
        const chunk = voucherRedemptionBatch.slice(i, i + 1000);
        await prisma.voucherRedemption.createMany({ data: chunk, skipDuplicates: true });
      }
      console.log(`   ✔ Voucher Redemptions inserted successfully.`);
    }

    // 9. Update linked SalesOrder status & returnNumber
    console.log(`🔄 Updating ${salesOrdersToUpdateStatus.size.toLocaleString()} linked Sales Orders...`);
    const updateEntries = Array.from(salesOrdersToUpdateStatus.values());
    for (let i = 0; i < updateEntries.length; i += 200) {
      const chunk = updateEntries.slice(i, i + 200);
      await Promise.all(
        chunk.map((entry) =>
          prisma.salesOrder.update({
            where: { id: entry.id },
            data: { returnNumber: entry.returnNumber },
          }),
        ),
      );
    }
    console.log(`   ✔ Linked Sales Orders updated.`);

    // 10. Insert StockLedgers (chunk size 2,000)
    console.log(`💾 Inserting ${stockLedgerBatch.length.toLocaleString()} Inbound Stock Ledgers...`);
    for (let i = 0; i < stockLedgerBatch.length; i += ITEM_CHUNK) {
      const chunk = stockLedgerBatch.slice(i, i + ITEM_CHUNK);
      await prisma.stockLedger.createMany({ data: chunk });
      const pct = Math.round(((i + chunk.length) / stockLedgerBatch.length) * 100);
      process.stdout.write(`\r   Stock Ledgers Progress: ${i + chunk.length}/${stockLedgerBatch.length} (${pct}%)`);
    }
    console.log(`\n   ✔ Stock Ledgers inserted successfully.`);

    // 11. Insert StockMovements (chunk size 2,000)
    console.log(`💾 Inserting ${stockMovementBatch.length.toLocaleString()} Stock Movements...`);
    for (let i = 0; i < stockMovementBatch.length; i += ITEM_CHUNK) {
      const chunk = stockMovementBatch.slice(i, i + ITEM_CHUNK);
      await prisma.stockMovement.createMany({ data: chunk });
      const pct = Math.round(((i + chunk.length) / stockMovementBatch.length) * 100);
      process.stdout.write(`\r   Stock Movements Progress: ${i + chunk.length}/${stockMovementBatch.length} (${pct}%)`);
    }
    console.log(`\n   ✔ Stock Movements inserted successfully.`);

    // 12. Restore Inventory Item balances
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

  const defaultReturnsFile = path.join(__dirname, '..', 'data', 'sales_return_1_24_sep.md');
  const julyAugFile = path.join(__dirname, '..', 'data', 'ST_july_aug.md');
  const fallbackFile = path.join(__dirname, '..', 'data', 'sales-return-converted.md');

  let filePath = fs.existsSync(defaultReturnsFile) && fs.statSync(defaultReturnsFile).size > 0
    ? defaultReturnsFile
    : fs.existsSync(julyAugFile)
    ? julyAugFile
    : fallbackFile;
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

