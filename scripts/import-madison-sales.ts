import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

function decrypt(encryptedText: string, masterKeyString: string): string {
  if (!encryptedText || !masterKeyString || masterKeyString.length < 32) {
    return '';
  }
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const algorithm = 'aes-256-gcm';

  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    return '';
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
  creditSale: number;
  giftVoucherAmount: number;
  creditVoucherAmount: number;
  exchangeVoucherAmount: number;
  claimVoucherAmount: number;
  giftVoucherCorporate: number;
  creditVoucherIssuedAmount: number;
  rewardVoucherAmount: number;
  onCreditAmount: number;
  cardSale: number;
  hbl: number;
  alliedBank: number;
  meezanBank: number;
  alfalahAmex: number;
  keenu: number;
  ubl: number;
  mcb: number;
  alfalah: number;
  costCentre: string;
  locationCode: string;
  posId: string;
  fbrInvoiceNumber: string;
  fkExchangeVoucherNumber: string;
  discountRateGiven: number;
  remarks: string;
  isAllianceDiscount: boolean;
  salesPerson: string;
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
    // Protect escaped pipes \|
    const sanitized = line.replace(/\\\\\|/g, '__ESCAPED_PIPE__').replace(/\\\|/g, '__ESCAPED_PIPE__').trim();
    let stripped = sanitized;
    if (stripped.startsWith('|')) stripped = stripped.substring(1);
    if (stripped.endsWith('|')) stripped = stripped.substring(0, stripped.length - 1);
    return stripped.split('|').map((p) => p.replace(/__ESCAPED_PIPE__/g, '|').trim());
  }
  return line.split(',').map((p) => p.trim());
}

export function readAndParseSalesData(filePath: string, maxRows?: number): ParsedSalesRow[] {
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

  const colCostCentre = findColIndex(['costcentre', 'location name', 'store'], 0);
  const colLocCode = findColIndex(['location id', 'location code', 'locationcode', 'loc code'], 1);
  const colDocNo = findColIndex(['documentnumber', 'docno', 'doc no'], 2);
  const colDocDate = findColIndex(['documentdate', 'docdate', 'date'], 3);
  const colBarcode = findColIndex(['barcode', 'sku', 'item'], 4);
  const colQty = findColIndex(['quantity', 'qty'], 5);
  const colUnitPrice = findColIndex(['unitprice', 'price'], 6);
  const colPriceWOT = findColIndex(['price_w_o_t', 'pricewot', 'price w/o tax'], 7);
  const colTotalPriceWOT = findColIndex(['total_price_w_o_t', 'totalpricewot'], 8);
  const colDiscountAmount = findColIndex(['discountamount', 'discount_amount', 'discount amount'], 9);
  const colValueExSalesTax = findColIndex(['value ex sales tax', 'valueexsalestax'], 10);
  const colSalesTax = findColIndex(['sales tax', 'salestax'], 11);
  const colAdditionalTax = findColIndex(['additional sales tax', 'additionalsalestax'], 12);
  const colTotalSalesTax = findColIndex(['total sales tax', 'totalsalestax'], 13);
  const colValueInclSalesTax = findColIndex(['value incl sales tax', 'valueinclsalestax', 'grandtotal'], 14);
  const colCashSale = findColIndex(['cashsale', 'cash'], 15);
  const colExchangeVoucher = findColIndex(['exchangevoucheramount', 'exchange voucher'], 16);
  const colCreditVoucher = findColIndex(['creditvoucheramount', 'credit voucher'], 17);
  const colGiftVoucher = findColIndex(['giftvoucheramount', 'gift voucher'], -1);
  const colClaimVoucher = findColIndex(['claimvoucheramount', 'claim voucher'], -1);
  const colGiftVoucherCorp = findColIndex(['corporate voucher', 'corporatevoucher', 'giftvoucheramount_corporate', 'gift voucher corporate'], -1);
  const colOnCredit = findColIndex(['on credit', 'oncreditamount', 'oncredit'], -1);
  const colRewardVoucher = findColIndex(['reward voucher', 'rewardvoucheramount', 'rewardvoucher'], -1);
  const colCreditVoucherIssued = findColIndex(['creditvoucherissuedamount', 'credit voucher issued', 'creditvoucherissued'], -1);
  const colCardSale = findColIndex(['cardsale', 'card sale', 'card'], -1);
  const colHbl = findColIndex(['hbl'], -1);
  const colAllied = findColIndex(['allied bank', 'allied'], -1);
  const colMeezan = findColIndex(['meezan bank', 'meezan'], -1);
  const colAlfalahAmex = findColIndex(['al-falah | amex', 'alfalah | amex', 'amex'], -1);
  const colKeenu = findColIndex(['keenu'], -1);
  const colAlfalah = findColIndex(['al-falah', 'alfalah'], -1);
  const colUbl = findColIndex(['ubl'], -1);
  const colMcb = findColIndex(['mcb'], -1);
  const colPosId = findColIndex(['pos id', 'posid'], 31);
  const colFbrInvoice = findColIndex(['fbr invoice#', 'fbr invoice', 'fbrinvoice', 'fbr'], 32);
  const colExchangeVoucherNo = findColIndex(['fkexchangevouchernumber', 'exchange voucher no'], 33);
  const colDiscRateGiven = findColIndex(['discountrate_given', 'discount rate'], 34);
  const colRemarks = findColIndex(['remarks'], 35);
  const colIsAlliance = findColIndex(['is alliance discount', 'is alliance'], 36);
  const colSalesPerson = findColIndex(['salesperson', 'cashier', 'fksalespersonid'], 37);
  const colCashReturn = findColIndex(['cashretrun', 'cashreturn', 'cash return'], -1);
  const colCreditSale = colOnCredit;

  const rawParsed: ParsedSalesRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine || rawLine.startsWith('---')) continue;

    const parts = parseMarkdownLine(rawLine, isTabSep, isPipeSep);
    if (parts.length < 5) continue;

    const docNo = parts[colDocNo] || '';
    const docDateStr = parts[colDocDate] || '';
    const barCode = (parts[colBarcode] || '').replace(/['"]/g, '').trim();
    const quantity = parseFloat(parts[colQty] || '1') || 1;
    const unitPrice = parseFloat(parts[colUnitPrice] || '0') || 0;
    const rawPriceWOT = parseFloat(parts[colPriceWOT] || '0') || 0;
    const rawTotalPriceWOT = parseFloat(parts[colTotalPriceWOT] || '0') || (rawPriceWOT * quantity);
    const rawDiscountAmount = parseFloat(parts[colDiscountAmount] || '0') || 0;
    const rawValueExSalesTax = parseFloat(parts[colValueExSalesTax] || '0') || 0;
    const rawSalesTax = parseFloat(parts[colSalesTax] || '0') || 0;
    const rawTotalSalesTax = parseFloat(parts[colTotalSalesTax] || '0') || rawSalesTax;
    const rawValueInclSalesTax = parseFloat(parts[colValueInclSalesTax] || '0') || 0;
    const discountRateGiven = parseFloat(parts[colDiscRateGiven] || '0') || 0;
    const cashSale = parseFloat(parts[colCashSale] || '0') || 0;
    const cashReturn = colCashReturn >= 0 ? parseFloat(parts[colCashReturn] || '0') || 0 : 0;
    const exchangeVoucherAmount = parseFloat(parts[colExchangeVoucher] || '0') || 0;
    const creditVoucherAmount = parseFloat(parts[colCreditVoucher] || '0') || 0;
    const giftVoucherAmount = parseFloat(parts[colGiftVoucher] || '0') || 0;
    const claimVoucherAmount = parseFloat(parts[colClaimVoucher] || '0') || 0;
    const giftVoucherCorporate = parseFloat(parts[colGiftVoucherCorp] || '0') || 0;
    const creditVoucherIssuedAmount = parseFloat(parts[colCreditVoucherIssued] || '0') || 0;
    const rewardVoucherAmount = parseFloat(parts[colRewardVoucher] || '0') || 0;
    const onCreditAmount = parseFloat(parts[colOnCredit] || '0') || 0;
    const creditSale = onCreditAmount;
    const cardSale = parseFloat(parts[colCardSale] || '0') || 0;
    const hbl = colHbl >= 0 ? parseFloat(parts[colHbl] || '0') || 0 : 0;
    const alliedBank = colAllied >= 0 ? parseFloat(parts[colAllied] || '0') || 0 : 0;
    const meezanBank = colMeezan >= 0 ? parseFloat(parts[colMeezan] || '0') || 0 : 0;
    const alfalahAmex = colAlfalahAmex >= 0 ? parseFloat(parts[colAlfalahAmex] || '0') || 0 : 0;
    const keenu = colKeenu >= 0 ? parseFloat(parts[colKeenu] || '0') || 0 : 0;
    const ubl = colUbl >= 0 ? parseFloat(parts[colUbl] || '0') || 0 : 0;
    const mcb = colMcb >= 0 ? parseFloat(parts[colMcb] || '0') || 0 : 0;
    const alfalah = colAlfalah >= 0 ? parseFloat(parts[colAlfalah] || '0') || 0 : 0;
    const costCentre = parts[colCostCentre] || '';
    const locationCode = parts[colLocCode] || '';
    const posId = parts[colPosId] || '';
    const fbrInvoiceNumber = (parts[colFbrInvoice] || '').replace(/^['"]/, '').trim();
    const fkExchangeVoucherNumber = (parts[colExchangeVoucherNo] || '').replace(/^['"]/, '').trim();
    const remarks = parts[colRemarks] || '';
    const isAllianceDiscount = (parts[colIsAlliance] || '').trim().toUpperCase() === 'Y';
    const salesPerson = parts[colSalesPerson] || '';

    if (!docNo || !barCode || !locationCode) continue;

    const docDate = parseCustomDate(docDateStr);
    if (!docDate || isNaN(docDate.getTime())) continue;

    // Calculate WOST, Discount, Tax according to POS Sales Formula
    let taxPercent = 0;
    if (rawTotalSalesTax > 0 && rawValueExSalesTax > 0) {
      taxPercent = Math.round((rawTotalSalesTax / rawValueExSalesTax) * 100 * 100) / 100;
    } else if (rawValueInclSalesTax > 0 && rawValueExSalesTax > 0 && rawValueInclSalesTax > rawValueExSalesTax) {
      const calcTax = rawValueInclSalesTax - rawValueExSalesTax;
      taxPercent = Math.round((calcTax / rawValueExSalesTax) * 100 * 100) / 100;
    } else if (unitPrice > 0 && rawPriceWOT > 0 && unitPrice > rawPriceWOT) {
      taxPercent = Math.round(((unitPrice / rawPriceWOT) - 1) * 100 * 100) / 100;
    }

    const taxDivisor = 1 + taxPercent / 100;

    let priceWOT = rawPriceWOT;
    if (priceWOT <= 0 && unitPrice > 0) {
      priceWOT = Math.round((unitPrice / taxDivisor) * 100) / 100;
    }

    let totalPriceWOT = rawTotalPriceWOT;
    if (totalPriceWOT <= 0) {
      totalPriceWOT = Math.round(priceWOT * quantity * 100) / 100;
    }

    let discountAmount = rawDiscountAmount;
    if (discountAmount <= 0 && discountRateGiven > 0) {
      discountAmount = Math.round(totalPriceWOT * (discountRateGiven / 100) * 100) / 100;
    }

    let valueExSalesTax = rawValueExSalesTax;
    if (valueExSalesTax <= 0) {
      valueExSalesTax = Math.round((totalPriceWOT - discountAmount) * 100) / 100;
    }

    let totalSalesTax = rawTotalSalesTax;
    if (totalSalesTax <= 0 && valueExSalesTax > 0 && taxPercent > 0) {
      totalSalesTax = Math.round((valueExSalesTax * (taxPercent / 100)) * 100) / 100;
    }

    let valueInclSalesTax = rawValueInclSalesTax;
    if (valueInclSalesTax <= 0) {
      valueInclSalesTax = Math.round((valueExSalesTax + totalSalesTax) * 100) / 100;
    }

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
      salesTax: rawSalesTax || totalSalesTax,
      totalSalesTax,
      valueInclSalesTax,
      cashSale,
      cashReturn,
      creditSale,
      giftVoucherAmount,
      creditVoucherAmount,
      exchangeVoucherAmount,
      claimVoucherAmount,
      giftVoucherCorporate,
      creditVoucherIssuedAmount,
      rewardVoucherAmount,
      onCreditAmount,
      cardSale,
      hbl,
      alliedBank,
      meezanBank,
      alfalahAmex,
      keenu,
      ubl,
      mcb,
      alfalah,
      costCentre,
      locationCode,
      posId,
      fbrInvoiceNumber,
      fkExchangeVoucherNumber,
      discountRateGiven,
      remarks,
      isAllianceDiscount,
      salesPerson,
    });
  }

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

  const isWipeAll = process.argv.includes('--wipe-all');

  const minDocDate = new Date(Math.min(...rows.map((r) => r.docDate.getTime())));
  const maxDocDate = new Date(Math.max(...rows.map((r) => r.docDate.getTime())));
  // End of max day
  const maxDocDateEnd = new Date(maxDocDate);
  maxDocDateEnd.setHours(23, 59, 59, 999);

  console.log(`📅 Incoming Sales Batch Date Range: ${minDocDate.toISOString().slice(0, 10)} to ${maxDocDate.toISOString().slice(0, 10)}`);

  if (!isDryRun) {
    if (isWipeAll) {
      console.log(`⚠️ WIPE ALL FLAG DETECTED: Cleaning up ALL previously imported Sales Order records & Redemptions...`);
      await prisma.voucherRedemption.deleteMany({});
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
        await prisma.salesOrderItem.deleteMany({ where: { salesOrderId: { in: orderIds } } });
        await prisma.stockMovement.deleteMany({
          where: { OR: [{ referenceId: { in: orderIds } }, { notes: { contains: 'POS Sale' } }] },
        });
        await prisma.stockLedger.deleteMany({ where: { referenceId: { in: orderIds } } });
        await prisma.salesOrder.deleteMany({ where: { id: { in: orderIds } } });
        console.log(`  ✅ Successfully wiped ${orderIds.length} old Sales Order records.`);
      }
    } else {
      console.log(`🧹 Checking for existing records in incoming date range (${minDocDate.toISOString().slice(0, 10)} to ${maxDocDate.toISOString().slice(0, 10)})...`);
      const existingRangeOrders = await prisma.salesOrder.findMany({
        where: {
          createdAt: {
            gte: minDocDate,
            lte: maxDocDateEnd,
          },
          OR: [
            { orderNumber: { startsWith: 'SI-' } },
            { notes: { contains: 'Original DocNo:' } },
          ],
        },
        select: { id: true },
      });

      if (existingRangeOrders.length > 0) {
        const orderIds = existingRangeOrders.map((o) => o.id);
        console.log(`  Found ${orderIds.length} existing Sales Orders in date range to replace.`);
        await prisma.voucherRedemption.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.salesOrderItem.deleteMany({ where: { salesOrderId: { in: orderIds } } });
        await prisma.stockMovement.deleteMany({
          where: { referenceId: { in: orderIds } },
        });
        await prisma.stockLedger.deleteMany({ where: { referenceId: { in: orderIds } } });
        await prisma.salesOrder.deleteMany({ where: { id: { in: orderIds } } });
        console.log(`  ✅ Successfully cleaned up ${orderIds.length} existing range Sales Orders.`);
      } else {
        console.log(`  ✨ No overlapping sales orders found in target date range. Appending cleanly.`);
      }
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
  const merchantCache = new Map<string, any>();

  // Pre-cache all locations in single query
  if (!isDryRun) {
    const allLocations = await prisma.location.findMany({
      where: { isDeleted: false },
      select: { id: true, code: true, shortCode: true, name: true, warehouseId: true },
    });
    for (const loc of allLocations) {
      if (loc.code) locationCache.set(loc.code, loc);
      if (loc.shortCode) locationCache.set(loc.shortCode, loc);
      if (loc.name) locationCache.set(loc.name, loc);
    }
  }

  async function resolveLocation(code: string, name: string): Promise<any> {
    if (locationCache.has(code)) {
      return locationCache.get(code)!;
    }
    if (locationCache.has(name)) {
      return locationCache.get(name)!;
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
      if (name) locationCache.set(name, loc);
      return loc;
    } else {
      const loc = { id: `loc-${code}`, code, shortCode: code, name: name || 'Location', warehouseId: 'wh-default' };
      locationCache.set(code, loc);
      if (name) locationCache.set(name, loc);
      return loc;
    }
  }

  // Pre-cache merchants
  if (!isDryRun) {
    const merchants = await prisma.merchantConfig.findMany();
    for (const m of merchants) {
      const nameKey = (m.bankName || m.description || '').toLowerCase();
      if (nameKey) merchantCache.set(nameKey, m);
    }
  }

  console.log(`⚙️ Pre-caching Locations and Item Barcodes...`);

  // Fast Bulk Resolution of Locations
  const uniqueLocMap = new Map<string, string>();
  for (const row of rows) {
    if (!uniqueLocMap.has(row.locationCode)) {
      uniqueLocMap.set(row.locationCode, row.costCentre);
    }
  }
  for (const [code, name] of uniqueLocMap.entries()) {
    await resolveLocation(code, name);
  }

  // Fast Bulk Resolution of Items (1-query read + bulk create missing)
  const uniqueBarcodes = Array.from(new Set(rows.map((r) => r.barCode)));
  console.log(`  Found ${uniqueBarcodes.length.toLocaleString()} unique barcodes in sales data.`);

  if (!isDryRun) {
    const CHUNK_SIZE = 5000;
    for (let i = 0; i < uniqueBarcodes.length; i += CHUNK_SIZE) {
      const batchCodes = uniqueBarcodes.slice(i, i + CHUNK_SIZE);
      const existingItems = await prisma.item.findMany({
        where: { barCode: { in: batchCodes } },
        select: { id: true, barCode: true, sku: true, unitPrice: true },
      });
      for (const it of existingItems) {
        if (it.barCode) itemCache.set(it.barCode, it);
      }
    }

    const missingBarcodes: { barCode: string; unitPrice: number }[] = [];
    const seenMissing = new Set<string>();
    for (const row of rows) {
      if (!itemCache.has(row.barCode) && !seenMissing.has(row.barCode)) {
        seenMissing.add(row.barCode);
        missingBarcodes.push({ barCode: row.barCode, unitPrice: row.unitPrice });
      }
    }

    if (missingBarcodes.length > 0) {
      console.log(`  📦 Creating ${missingBarcodes.length.toLocaleString()} missing items in bulk...`);
      for (let i = 0; i < missingBarcodes.length; i += CHUNK_SIZE) {
        const batch = missingBarcodes.slice(i, i + CHUNK_SIZE);
        await prisma.item.createMany({
          data: batch.map((b) => ({
            itemId: `ITEM-${b.barCode}`,
            sku: b.barCode,
            barCode: b.barCode,
            description: `POS Item (${b.barCode})`,
            unitPrice: b.unitPrice,
            unitCost: 0,
            status: 'active',
            isActive: true,
          })),
          skipDuplicates: true,
        });
      }

      for (let i = 0; i < missingBarcodes.length; i += CHUNK_SIZE) {
        const batchCodes = missingBarcodes.slice(i, i + CHUNK_SIZE).map((b) => b.barCode);
        const createdItems = await prisma.item.findMany({
          where: { barCode: { in: batchCodes } },
          select: { id: true, barCode: true, sku: true, unitPrice: true },
        });
        for (const it of createdItems) {
          if (it.barCode) itemCache.set(it.barCode, it);
        }
      }
    }
  } else {
    for (const code of uniqueBarcodes) {
      itemCache.set(code, { id: `item-${code}`, barCode: code, unitPrice: 0 });
    }
  }

  console.log(`  ✅ Successfully cached ${itemCache.size.toLocaleString()} items.`);

  const salesGroups = new Map<string, ParsedSalesRow[]>();
  for (const row of rows) {
    const groupKey = `${row.docNo}_${row.docDateStr}_${row.locationCode}_${row.posId}`;
    if (!salesGroups.has(groupKey)) {
      salesGroups.set(groupKey, []);
    }
    salesGroups.get(groupKey)!.push(row);
  }

  console.log(`📋 Grouped ${rows.length.toLocaleString()} total rows into ${salesGroups.size.toLocaleString()} Cash Memo Sales Orders.`);

  const locSeqMap = new Map<string, number>();

  if (!isDryRun) {
    const existingOrders = await prisma.salesOrder.findMany({
      select: { orderNumber: true },
    });
    for (const ord of existingOrders) {
      if (!ord.orderNumber) continue;
      // Match SI-{CODE}{FY}-{SEQ}, e.g. SI-ADILOM27-00866 or SI-A1000227-00001
      const m = ord.orderNumber.match(/^SI-([A-Za-z0-9]+?)(2\d)-(\d+)$/);
      if (m) {
        const code = m[1].toUpperCase();
        const fy = m[2];
        const seq = parseInt(m[3], 10);
        const seqKey = `${code}_${fy}`;
        const currentMax = locSeqMap.get(seqKey) || 0;
        if (seq > currentMax) {
          locSeqMap.set(seqKey, seq);
        }
      } else {
        const m2 = ord.orderNumber.match(/^SI-([A-Za-z0-9]+)-(\d+)$/);
        if (m2) {
          const key = m2[1].toUpperCase();
          const seq = parseInt(m2[2], 10);
          const currentMax = locSeqMap.get(key) || 0;
          if (seq > currentMax) {
            locSeqMap.set(key, seq);
          }
        }
      }
    }
    console.log(`  🔢 Initialized sequence counters from ${existingOrders.length.toLocaleString()} existing database orders across ${locSeqMap.size} location counters.`);
  }

  let processedLines = 0;
  let totalRevenue = 0;
  let linkedVouchersCount = 0;

  // Batch accumulation buffers for 100x bulk throughput
  const BATCH_FLUSH_SIZE = 1000;
  let salesOrdersBatch: any[] = [];
  let salesOrderItemsBatch: any[] = [];
  let stockLedgerBatch: any[] = [];
  let stockMovementBatch: any[] = [];
  let voucherRedemptionsBatch: any[] = [];

  let ordersCount = 0;

  const flushBatches = async () => {
    if (salesOrdersBatch.length === 0) return;

    await prisma.salesOrder.createMany({ data: salesOrdersBatch });
    await prisma.salesOrderItem.createMany({ data: salesOrderItemsBatch });
    await prisma.stockLedger.createMany({ data: stockLedgerBatch });
    await prisma.stockMovement.createMany({ data: stockMovementBatch });
    if (voucherRedemptionsBatch.length > 0) {
      await prisma.voucherRedemption.createMany({
        data: voucherRedemptionsBatch,
        skipDuplicates: true,
      });
    }

    salesOrdersBatch = [];
    salesOrderItemsBatch = [];
    stockLedgerBatch = [];
    stockMovementBatch = [];
    voucherRedemptionsBatch = [];
  };

  for (const [groupKey, groupRows] of salesGroups.entries()) {
    const sample = groupRows[0];
    const location = locationCache.get(sample.locationCode)!;

    const rawCode = location.shortCode?.trim() || location.code?.trim() || sample.locationCode;
    const cleanCode = rawCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const fySuffix = getFySuffix(sample.docDate);
    const seqKey = `${cleanCode}_${fySuffix}`;

    const seq = (locSeqMap.get(seqKey) || 0) + 1;
    locSeqMap.set(seqKey, seq);

    const orderNumber = `SI-${cleanCode}${fySuffix}-${String(seq).padStart(5, '0')}`;
    const orderId = crypto.randomUUID();

    const subtotal = groupRows.reduce((acc, r) => acc + (r.totalPriceWOT || (r.priceWOT * r.quantity)), 0);
    const discountAmount = groupRows.reduce((acc, r) => acc + r.discountAmount, 0);
    const taxAmount = groupRows.reduce((acc, r) => acc + r.totalSalesTax, 0);
    const grandTotal = groupRows.reduce((acc, r) => acc + r.valueInclSalesTax, 0);

    totalRevenue += grandTotal;

    // Full row-by-row aggregation of all tender channels across group
    const cashSale = groupRows.reduce((acc, r) => acc + r.cashSale, 0);
    const cashReturn = groupRows.reduce((acc, r) => acc + r.cashReturn, 0);
    const cardSale = groupRows.reduce((acc, r) => acc + r.cardSale, 0);
    const creditSale = groupRows.reduce((acc, r) => acc + r.creditSale, 0);
    const giftVoucherAmount = groupRows.reduce((acc, r) => acc + r.giftVoucherAmount, 0);
    const creditVoucherAmount = groupRows.reduce((acc, r) => acc + r.creditVoucherAmount, 0);
    const exchangeVoucherAmount = groupRows.reduce((acc, r) => acc + r.exchangeVoucherAmount, 0);
    const claimVoucherAmount = groupRows.reduce((acc, r) => acc + r.claimVoucherAmount, 0);
    const giftVoucherCorporate = groupRows.reduce((acc, r) => acc + r.giftVoucherCorporate, 0);
    const creditVoucherIssuedAmount = groupRows.reduce((acc, r) => acc + r.creditVoucherIssuedAmount, 0);
    const rewardVoucherAmount = groupRows.reduce((acc, r) => acc + r.rewardVoucherAmount, 0);
    const onCreditAmount = groupRows.reduce((acc, r) => acc + r.onCreditAmount, 0);

    // Bank card breakdown sums
    const totalHbl = groupRows.reduce((acc, r) => acc + r.hbl, 0);
    const totalAllied = groupRows.reduce((acc, r) => acc + r.alliedBank, 0);
    const totalMeezan = groupRows.reduce((acc, r) => acc + r.meezanBank, 0);
    const totalAlfalahAmex = groupRows.reduce((acc, r) => acc + r.alfalahAmex, 0);
    const totalKeenu = groupRows.reduce((acc, r) => acc + r.keenu, 0);
    const totalUbl = groupRows.reduce((acc, r) => acc + r.ubl, 0);
    const totalMcb = groupRows.reduce((acc, r) => acc + r.mcb, 0);
    const totalAlfalah = groupRows.reduce((acc, r) => acc + r.alfalah, 0);

    let cardBankName = '';
    if (totalMeezan > 0) cardBankName = 'Meezan Bank';
    else if (totalAllied > 0) cardBankName = 'Allied Bank';
    else if (totalHbl > 0) cardBankName = 'HBL';
    else if (totalAlfalahAmex > 0) cardBankName = 'AL-Falah | AMEX';
    else if (totalAlfalah > 0) cardBankName = 'AL-Falah';
    else if (totalKeenu > 0) cardBankName = 'KEENU';
    else if (totalUbl > 0) cardBankName = 'UBL';
    else if (totalMcb > 0) cardBankName = 'MCB';

    const voucherAmount = giftVoucherAmount + creditVoucherAmount + exchangeVoucherAmount +
                          claimVoucherAmount + giftVoucherCorporate + rewardVoucherAmount;

    const activeTendersCount = [cashSale > 0, cardSale > 0, voucherAmount > 0, creditSale > 0].filter(Boolean).length;

    let paymentMethod = 'cash';
    if (activeTendersCount > 1) {
      paymentMethod = 'split';
    } else if (cardSale > 0) {
      paymentMethod = 'card';
    } else if (voucherAmount > 0) {
      paymentMethod = 'voucher';
    } else if (creditSale > 0) {
      paymentMethod = 'credit_account';
    }

    const fkExchangeRef = groupRows.map((r) => r.fkExchangeVoucherNumber).find((v) => Boolean(v && v.trim())) || '';

    // Build structured notes
    const notesParts: string[] = [
      `Original DocNo: ${sample.docNo}`,
      `POS ID: ${sample.posId || 'N/A'}`,
    ];

    if (sample.salesPerson && sample.salesPerson.trim()) {
      notesParts.push(`SalesPerson: ${sample.salesPerson.trim()}`);
    }
    if (sample.remarks && sample.remarks.trim() && sample.remarks.trim() !== ';') {
      notesParts.push(`Remarks: ${sample.remarks.trim()}`);
    }
    if (fkExchangeRef) {
      notesParts.push(`ExVoucherRef: ${fkExchangeRef}`);
    }
    if (cardBankName) {
      notesParts.push(`Bank: ${cardBankName}`);
    }

    // Standardized structured tags for 100% exact parsing across all services
    if (cashSale > 0) notesParts.push(`[Cash Sale] Amount: ${cashSale.toFixed(2)}`);
    if (cardSale > 0) {
      if (cardBankName) {
        notesParts.push(`[Card Sale] Bank: ${cardBankName} (PKR ${cardSale.toFixed(2)})`);
      }
      notesParts.push(`[Card Sale] Amount: ${cardSale.toFixed(2)}`);
    }
    if (exchangeVoucherAmount > 0) notesParts.push(`[Exchange Voucher] Amount: ${exchangeVoucherAmount.toFixed(2)}`);
    if (claimVoucherAmount > 0) notesParts.push(`[Claim Voucher] Amount: ${claimVoucherAmount.toFixed(2)}`);
    if (giftVoucherCorporate > 0) notesParts.push(`[Corporate Voucher] Amount: ${giftVoucherCorporate.toFixed(2)}`);
    if (giftVoucherAmount > 0) notesParts.push(`[Gift Voucher] Amount: ${giftVoucherAmount.toFixed(2)}`);
    if (creditVoucherAmount > 0) notesParts.push(`[Credit Voucher] Amount: ${creditVoucherAmount.toFixed(2)}`);
    if (rewardVoucherAmount > 0) notesParts.push(`[Reward Voucher] Amount: ${rewardVoucherAmount.toFixed(2)}`);
    if (creditSale > 0) notesParts.push(`[Credit Sale] Balance: ${creditSale.toFixed(2)}`);
    if (creditVoucherIssuedAmount > 0) notesParts.push(`[Credit Voucher Issued] Amount: ${creditVoucherIssuedAmount.toFixed(2)}`);
    if (cashReturn > 0) notesParts.push(`[Cash Return] Amount: ${cashReturn.toFixed(2)}`);

    const orderNotes = notesParts.join(' | ');

    if (isDryRun) {
      if (seq <= 5 || seq % 1000 === 0) {
        console.log(`🔍 [DRY-RUN #${orderNumber}] Date:${sample.docDate.toISOString().slice(0, 10)} | Store:${location.name} | Total: PKR ${grandTotal.toLocaleString()} | Cash:${cashSale} Card:${cardSale} Exch:${exchangeVoucherAmount} Credit:${creditSale} Bank:${cardBankName || 'N/A'}`);
      }
      processedLines += groupRows.length;
      continue;
    }

    // Resolve merchant ID if applicable
    let merchantId: string | null = null;
    if (cardBankName) {
      const bankLower = cardBankName.toLowerCase();
      for (const [k, m] of merchantCache.entries()) {
        if (k.includes(bankLower) || bankLower.includes(k)) {
          merchantId = m.id;
          break;
        }
      }
    }

    salesOrdersBatch.push({
      id: orderId,
      orderNumber,
      posId: sample.posId || null,
      terminalId: sample.posId || null,
      locationId: location.id,
      merchantId: merchantId || null,
      subtotal: subtotal,
      discountAmount: discountAmount,
      taxAmount: taxAmount,
      grandTotal: grandTotal,
      paymentMethod: paymentMethod,
      tenderType: activeTendersCount > 1 ? 'split' : paymentMethod,
      paymentStatus: 'paid',
      status: 'completed',
      notes: orderNotes,
      fbrInvoiceNumber: sample.fbrInvoiceNumber || null,
      fbrStatus: sample.fbrInvoiceNumber ? 'COMPLETED' : 'PENDING',
      cashAmount: cashSale > 0 ? cashSale : null,
      cardAmount: cardSale > 0 ? cardSale : null,
      voucherAmount: voucherAmount > 0 ? voucherAmount : null,
      createdAt: sample.docDate,
      updatedAt: sample.docDate,
    });

    for (const row of groupRows) {
      const item = itemCache.get(row.barCode) || { id: 'item-fallback' };
      const qty = row.quantity;

      const lineTaxPercent = row.valueExSalesTax > 0
        ? Math.round((row.totalSalesTax / row.valueExSalesTax) * 100 * 100) / 100
        : 0;

      const itemId = item.id;
      const salesOrderItemId = crypto.randomUUID();

      salesOrderItemsBatch.push({
        id: salesOrderItemId,
        salesOrderId: orderId,
        itemId: itemId,
        quantity: qty,
        unitPrice: row.unitPrice,
        discountPercent: row.discountRateGiven,
        discountAmount: row.discountAmount,
        taxPercent: lineTaxPercent,
        taxAmount: row.totalSalesTax,
        lineTotal: row.valueInclSalesTax,
        createdAt: sample.docDate,
      });

      stockLedgerBatch.push({
        itemId: itemId,
        warehouseId: location.warehouseId || defaultWarehouse.id,
        locationId: location.id,
        qty: -qty,
        referenceType: 'POS_SALE',
        referenceId: orderId,
        movementType: 'OUTBOUND',
        createdAt: sample.docDate,
      });

      const movNo = `MV-SALE-${orderNumber}-${row.barCode}-${row.rowNum}`;
      stockMovementBatch.push({
        id: crypto.randomUUID(),
        movementNo: movNo,
        itemId: itemId,
        fromLocationId: location.id,
        toLocationId: null,
        quantity: qty,
        type: 'POS_SALE',
        referenceType: 'POS_SALE',
        referenceId: orderId,
        movementDate: sample.docDate,
        createdAt: sample.docDate,
        notes: `POS Sale: ${orderNumber} (Doc #${row.docNo})`,
      });

      processedLines++;
    }

    ordersCount++;
    if (salesOrdersBatch.length >= BATCH_FLUSH_SIZE) {
      await flushBatches();
      console.log(`  💾 Committed ${ordersCount.toLocaleString()} / ${salesGroups.size.toLocaleString()} orders (${processedLines.toLocaleString()} item lines)...`);
    }
  }

  // Flush remaining records
  if (!isDryRun && salesOrdersBatch.length > 0) {
    await flushBatches();
    console.log(`  💾 Final flush: committed all ${ordersCount.toLocaleString()} orders (${processedLines.toLocaleString()} item lines).`);
  }

  console.log(`\n==================================================`);
  console.log(`✨ ${isDryRun ? '[DRY RUN SUMMARY]' : '[IMPORT SUMMARY]'}`);
  console.log(`   - Total Cash Memos Processed: ${salesGroups.size.toLocaleString()}`);
  console.log(`   - Total Item Lines           : ${processedLines.toLocaleString()}`);
  console.log(`   - Total Revenue (PKR)        : ${totalRevenue.toLocaleString()}`);
  console.log(`   - Linked Voucher Redemptions : ${linkedVouchersCount.toLocaleString()}`);
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

  let filePath = path.join(__dirname, '..', 'data', 'sales_1_24_sep.md');
  const fileArg = process.argv.find((arg) => arg.startsWith('--file=') || arg.startsWith('--path='));
  if (fileArg) {
    const customPath = fileArg.split('=')[1];
    filePath = path.isAbsolute(customPath) ? customPath : path.join(process.cwd(), customPath);
  } else if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, '..', 'data', 'sales-july-&-aug.md');
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
    console.log(`   - Doc Date  : ${rows[0].docDate.toISOString().slice(0, 10)}`);
    console.log(`   - Location  : ${rows[0].costCentre} (${rows[0].locationCode})`);
    console.log(`   - Barcode   : ${rows[0].barCode}`);
    console.log(`   - Qty       : ${rows[0].quantity}`);
    console.log(`   - Price     : PKR ${rows[0].unitPrice}`);
    console.log(`   - Total Incl Tax: PKR ${rows[0].valueInclSalesTax}`);
    console.log(`   - Card Sale : PKR ${rows[0].cardSale}`);
    console.log(`   - Cash Sale : PKR ${rows[0].cashSale}`);
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

if (process.argv[1]?.endsWith('import-madison-sales.ts') || process.argv[1]?.endsWith('import-madison-sales.js')) {
  main().catch((err) => {
    console.error('❌ Error executing script:', err);
    process.exit(1);
  });
}
