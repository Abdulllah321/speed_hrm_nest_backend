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
  hblSale: number;
  alliedBankSale: number;
  meezanBankSale: number;
  alfalahAmexSale: number;
  keenuSale: number;
  ublSale: number;
  mcbSale: number;
  alfalahSale: number;
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
 * - Excel date serial numbers (e.g. 46204 -> 2026-07-01)
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

  // Handle strings with spaces e.g. "7/1/2026 14:30:00"
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
    const protectedLine = line.replace(/\\\|/g, '__ESCAPED_PIPE__');
    let parts = protectedLine.split('|').map((p) => p.replace(/__ESCAPED_PIPE__/g, '|').trim());
    if (parts[0] === '') parts.shift();
    if (parts[parts.length - 1] === '') parts.pop();
    return parts;
  }
  return line.split(',').map((p) => p.trim());
}

export function readAndParseSalesData(
  filePath: string,
  maxRows?: number,
  locationFilter?: string,
): ParsedSalesRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at path: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.trim().startsWith('---'));

  if (lines.length < 2) {
    console.warn(`⚠️ File ${filePath} contains no data rows.`);
    return [];
  }

  // Find the header line
  let headerIndex = lines.findIndex((l) => l.includes('|') && (l.toLowerCase().includes('documentnumber') || l.toLowerCase().includes('costcentre') || l.toLowerCase().includes('barcode')));
  if (headerIndex === -1) headerIndex = 0;

  const headerLine = lines[headerIndex];
  const isTabSep = headerLine.includes('\t');
  const isPipeSep = headerLine.includes('|');

  const headers = parseMarkdownLine(headerLine, isTabSep, isPipeSep).map((h) => h.toLowerCase());

  const findColIndex = (keywords: string[], defaultIdx: number): number => {
    const exactIdx = headers.findIndex((h) => keywords.some((k) => h === k));
    if (exactIdx !== -1) return exactIdx;
    const partialIdx = headers.findIndex((h) => keywords.some((k) => h.includes(k)));
    return partialIdx !== -1 ? partialIdx : defaultIdx;
  };

  const colDocNo = findColIndex(['documentnumber', 'docno', 'doc no', 'document number'], 2);
  const colDocDate = findColIndex(['documentdate', 'docdate', 'date', 'document date'], 3);
  const colBarcode = findColIndex(['barcode', 'sku', 'item'], 4);
  const colQty = findColIndex(['quantity', 'qty'], 5);
  const colUnitPrice = findColIndex(['unitprice', 'price', 'unit price'], 6);
  const colPriceWOT = findColIndex(['price_w_o_t', 'pricewot', 'price w/o tax', 'price w o t'], 7);
  const colTotalPriceWOT = findColIndex(['total_price_w_o_t', 'totalpricewot'], 8);
  const colDiscountAmount = findColIndex(['discountamount', 'discount_amount', 'discount amount'], 9);
  const colValueExSalesTax = findColIndex(['value ex sales tax', 'valueexsalestax', 'value ex tax'], 10);
  const colSalesTax = findColIndex(['sales tax', 'salestax'], 11);
  const colTotalSalesTax = findColIndex(['total sales tax', 'totalsalestax'], 13);
  const colValueInclSalesTax = findColIndex(['value incl sales tax', 'valueinclsalestax', 'grandtotal'], 14);
  const colCashSale = findColIndex(['cashsale', 'cash'], 22);
  const colCashReturn = findColIndex(['cashretrun', 'cashreturn'], 23);
  const colCardSale = findColIndex(['cardsale', 'card'], 33);
  const colCreditSale = findColIndex(['creditsale'], 24);
  const colGiftVoucher = findColIndex(['giftvoucheramount'], 25);
  const colCreditVoucher = findColIndex(['creditvoucheramount'], 26);
  const colExchangeVoucher = findColIndex(['exchangevoucheramount'], 27);
  const colClaimVoucher = findColIndex(['claimvoucheramount'], 28);
  const colGiftVoucherCorp = findColIndex(['giftvoucheramount_corporate'], 29);
  const colCreditVoucherIssued = findColIndex(['creditvoucherissuedamount'], 30);
  const colRewardVoucher = findColIndex(['rewardvoucheramount'], 31);
  const colOnCredit = findColIndex(['oncreditamount'], 32);

  // Bank columns
  const colHbl = findColIndex(['hbl'], 34);
  const colAllied = findColIndex(['allied bank', 'allied'], 35);
  const colMeezan = findColIndex(['meezan bank', 'meezan'], 36);
  const colAmex = findColIndex(['al-falah | amex', 'amex'], 37);
  const colKeenu = findColIndex(['keenu'], 38);
  const colUbl = findColIndex(['ubl'], 39);
  const colMcb = findColIndex(['mcb'], 40);
  const colAlfalah = findColIndex(['al-falah', 'alfalah'], 41);

  const colCostCentre = findColIndex(['costcentre', 'store', 'location name', 'cost centre'], 0);
  const colLocCode = findColIndex(['location id', 'location code', 'locationcode', 'loc code', 'locationid'], 1);
  const colPosId = findColIndex(['pos id', 'posid'], 15);
  const colFbrInvoice = findColIndex(['fbr invoice#', 'fbrinvoice', 'fbr'], 16);
  const colExchangeVoucherNo = findColIndex(['fkexchangevouchernumber', 'exchange voucher'], 17);
  const colDiscRateGiven = findColIndex(['discountrate_given', 'discount rate given'], 18);
  const colDiscRateDefault = findColIndex(['discountrate_default_current', 'discount rate default'], 19);
  const colRemarks = findColIndex(['remarks', 'remark'], 19);
  const colIsAlliance = findColIndex(['is alliance discount'], 20);
  const colSalesPerson = findColIndex(['salesperson', 'cashier', 'sales person'], 21);

  const rawParsed: ParsedSalesRow[] = [];
  const locFilterUpper = locationFilter ? locationFilter.trim().toUpperCase() : null;

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine || rawLine.startsWith('---') || rawLine.startsWith('|-') || rawLine.startsWith('| -') || rawLine.includes('CostCentre')) continue;

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
    const discountRateDefault = parseFloat(parts[colDiscRateDefault] || '0') || 0;
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

    // Bank breakdowns
    const hblSale = parseFloat(parts[colHbl] || '0') || 0;
    const alliedBankSale = parseFloat(parts[colAllied] || '0') || 0;
    const meezanBankSale = parseFloat(parts[colMeezan] || '0') || 0;
    const alfalahAmexSale = parseFloat(parts[colAmex] || '0') || 0;
    const keenuSale = parseFloat(parts[colKeenu] || '0') || 0;
    const ublSale = parseFloat(parts[colUbl] || '0') || 0;
    const mcbSale = parseFloat(parts[colMcb] || '0') || 0;
    const alfalahSale = parseFloat(parts[colAlfalah] || '0') || 0;

    const costCentre = parts[colCostCentre] || '';
    const locationCode = parts[colLocCode] || '';
    const posId = parts[colPosId] || '1';
    const fbrInvoiceNumber = (parts[colFbrInvoice] || '').replace(/^['"]/, '').trim();
    const fkExchangeVoucherNumber = (parts[colExchangeVoucherNo] || '').replace(/^['"]/, '').trim();
    const remarks = parts[colRemarks] || '';
    const isAllianceDiscount = (parts[colIsAlliance] || '').trim().toUpperCase() === 'Y';
    const salesPerson = parts[colSalesPerson] || '';

    if (!docNo || !barCode || !locationCode) continue;

    if (locFilterUpper) {
      if (locationCode.toUpperCase() !== locFilterUpper && !costCentre.toUpperCase().includes(locFilterUpper)) {
        continue;
      }
    }

    const docDate = parseCustomDate(docDateStr);
    if (!docDate || isNaN(docDate.getTime())) continue;

    // ── Calculate WOST, Discount, Tax according to POS Sales Creation Formula ──
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
      hblSale,
      alliedBankSale,
      meezanBankSale,
      alfalahAmexSale,
      keenuSale,
      ublSale,
      mcbSale,
      alfalahSale,
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

  rawParsed.sort((a, b) => a.docDate.getTime() - b.docDate.getTime());

  rawParsed.forEach((row, index) => {
    row.rowNum = index + 1;
  });

  return maxRows ? rawParsed.slice(0, maxRows) : rawParsed;
}

function getMerchantPriorityCode(bankName: string): number {
  switch (bankName) {
    case 'HBL': return 1;
    case 'AL-Falah': return 2;
    case 'Keenu': return 3;
    case 'AL-Falah | AMEX': return 4;
    case 'Allied Bank': return 5;
    case 'Meezan': return 6;
    case 'HBL IPG': return 7;
    case 'BAFL IPG': return 8;
    case 'UBL': return 9;
    case 'MCB': return 10;
    default: return 99;
  }
}

function getBankGlCode(bankName: string): string {
  switch (bankName) {
    case 'HBL': return '31100005';
    case 'AL-Falah': return '31100002';
    case 'Keenu': return '31100008';
    case 'AL-Falah | AMEX': return '31100003';
    case 'Allied Bank': return '31100001';
    case 'Meezan': return '31100006';
    case 'UBL': return '31100007';
    case 'MCB': return '31100009';
    default: return '31100010';
  }
}

async function processSalesForTenant(
  prisma: PrismaClient,
  rows: ParsedSalesRow[],
  isDryRun: boolean = false,
) {
  console.log(`\n==================================================`);
  console.log(`📦 ${isDryRun ? '[DRY RUN MODE]' : '[LIVE COMMIT MODE]'} Processing ${rows.length.toLocaleString()} sales rows...`);
  console.log(`==================================================\n`);

  // FY27 starts on July 1, 2026 UTC
  const currentFyStart = new Date(Date.UTC(2026, 6, 1, 0, 0, 0, 0));

  if (!isDryRun) {
    console.log(`🧹 Cleaning up previously imported current-year (FY27) Sales Orders & Return Vouchers...`);

    // 1. Return vouchers created in current fiscal year
    const existingVouchers = await prisma.voucher.findMany({
      where: {
        createdAt: { gte: currentFyStart },
        OR: [
          { code: { startsWith: 'EXC-' } },
          { code: { startsWith: 'CLM-' } },
          { code: { startsWith: 'REF-' } },
        ],
      },
      select: { id: true },
    });

    if (existingVouchers.length > 0) {
      const voucherIds = existingVouchers.map((v) => v.id);
      await prisma.stockMovement.deleteMany({
        where: {
          OR: [
            { referenceId: { in: voucherIds } },
            { notes: { contains: 'POS Return' }, movementDate: { gte: currentFyStart } },
          ],
        },
      });
      await prisma.stockLedger.deleteMany({
        where: { referenceId: { in: voucherIds } },
      });
      await prisma.voucher.deleteMany({
        where: { id: { in: voucherIds } },
      });
      console.log(`  ✅ Successfully wiped ${existingVouchers.length} old FY27 Return Vouchers.`);
    }

    // 2. PosReturns created in current fiscal year
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
      await prisma.stockMovement.deleteMany({
        where: { referenceId: { in: returnIds } },
      });
      await prisma.stockLedger.deleteMany({
        where: { referenceId: { in: returnIds } },
      });
      await prisma.posReturn.deleteMany({
        where: { id: { in: returnIds } },
      });
      console.log(`  ✅ Successfully wiped ${existingReturns.length} old FY27 PosReturn records.`);
    }

    // 3. Sales orders for current fiscal year (FY27)
    // IMPORTANT: Scoped to FY27 so all 187,000+ historical FY26 sales remain protected!
    const existingOrders = await prisma.salesOrder.findMany({
      where: {
        OR: [
          { createdAt: { gte: currentFyStart } },
          { orderNumber: { contains: '27-' } },
        ],
      },
      select: { id: true },
    });

    if (existingOrders.length > 0) {
      const orderIds = existingOrders.map((o) => o.id);
      console.log(`  Found ${orderIds.length} existing FY27 Sales Orders to clean up.`);

      for (let i = 0; i < orderIds.length; i += 5000) {
        const chunk = orderIds.slice(i, i + 5000);
        await prisma.voucherRedemption.deleteMany({
          where: { orderId: { in: chunk } },
        });
        await prisma.salesOrderItem.deleteMany({
          where: { salesOrderId: { in: chunk } },
        });
        await prisma.stockMovement.deleteMany({
          where: {
            OR: [
              { referenceId: { in: chunk } },
              { notes: { contains: 'POS Sale' }, movementDate: { gte: currentFyStart } },
            ],
          },
        });
        await prisma.stockLedger.deleteMany({
          where: {
            referenceId: { in: chunk },
            referenceType: 'POS_SALE',
          },
        });
        await prisma.salesOrder.deleteMany({
          where: { id: { in: chunk } },
        });
      }

      console.log(`  ✅ Successfully wiped ${orderIds.length} old FY27 Sales Order records.`);
    }
  }

  // Pre-load default Warehouse
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

  // Pre-load all Locations into memory
  const locationCache = new Map<string, any>();
  const dbLocations = isDryRun
    ? []
    : await prisma.location.findMany({
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

    if (locationCache.has(cleanCode)) return locationCache.get(cleanCode);
    if (locationCache.has(cleanName)) return locationCache.get(cleanName);

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
      locationCache.set(cleanCode, loc);
      return loc;
    } else {
      const loc = { id: `loc-${cleanCode}`, code: cleanCode, shortCode: cleanCode, name: name || 'Location', warehouseId: defaultWarehouse.id };
      locationCache.set(cleanCode, loc);
      return loc;
    }
  }

  // Pre-load all Items into memory
  console.log(`⚙️ Pre-caching Locations, Items, and Merchant Configs in memory...`);
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

  // Pre-load Merchant Configs
  const allDbMerchants: any[] = isDryRun
    ? []
    : await prisma.merchantConfig.findMany({
        select: { id: true, tagId: true, bankName: true, description: true, costCentreTag: true },
      });
  const merchantCache = new Map<string, any>();

  async function resolveMerchant(tagId: string, locationName: string, locationId: string, bankName: string): Promise<any> {
    const normBank = bankName.trim().toLowerCase();
    const cleanTag = tagId.trim().toUpperCase();
    const cacheKey = `${cleanTag}::${normBank}`;

    if (merchantCache.has(cacheKey)) return merchantCache.get(cacheKey);

    let config = allDbMerchants.find((m) => {
      if (m.tagId.toUpperCase() !== cleanTag) return false;
      const b = m.bankName.trim().toLowerCase();
      return b === normBank || b.includes(normBank) || normBank.includes(b);
    });

    if (!config && !isDryRun) {
      try {
        config = await prisma.merchantConfig.create({
          data: {
            tagId: cleanTag,
            costCentreTag: locationName,
            description: `${locationName} | ${bankName.toUpperCase()}`,
            bankName: bankName,
            merchantCode: getMerchantPriorityCode(bankName),
            commissionRate: 0.015,
            bankGlCode: getBankGlCode(bankName),
            isActive: true,
            locations: {
              create: { locationId },
            },
          },
          select: { id: true, tagId: true, bankName: true, description: true, costCentreTag: true },
        });
        allDbMerchants.push(config);
      } catch (err: any) {
        // Fallback search in case created concurrently
        config = await prisma.merchantConfig.findFirst({
          where: { tagId: cleanTag, bankName: { equals: bankName, mode: 'insensitive' } },
          select: { id: true, tagId: true, bankName: true, description: true, costCentreTag: true },
        });
      }
    } else if (!config && isDryRun) {
      config = { id: `dry-merch-${cleanTag}-${bankName}`, tagId: cleanTag, bankName };
    }

    if (config) {
      merchantCache.set(cacheKey, config);
    }
    return config;
  }

  // Verify and ensure all locations are resolved
  const uniqueStores = new Set<string>();
  for (const row of rows) {
    uniqueStores.add(`${row.locationCode}|||${row.costCentre}`);
  }
  for (const storeKey of uniqueStores) {
    const [lCode, cCentre] = storeKey.split('|||');
    await resolveLocation(lCode, cCentre);
  }
  console.log(`✔ Verified ${uniqueStores.size} store locations.`);

  // Group sales rows into Cash Memos (SalesOrders)
  const salesGroups = new Map<string, ParsedSalesRow[]>();
  for (const row of rows) {
    const groupKey = `${row.locationCode}_${row.docNo}_${row.docDateStr}_${row.posId}`;
    if (!salesGroups.has(groupKey)) {
      salesGroups.set(groupKey, []);
    }
    salesGroups.get(groupKey)!.push(row);
  }

  console.log(`📋 Grouped ${rows.length.toLocaleString()} total rows into ${salesGroups.size.toLocaleString()} Cash Memo Sales Orders.`);

  const locSeqMap = new Map<string, number>();

  const salesOrderBatch: any[] = [];
  const salesOrderItemBatch: any[] = [];
  const stockLedgerBatch: any[] = [];
  const stockMovementBatch: any[] = [];
  const inventoryDeductions = new Map<string, { warehouseId: string; locationId: string; itemId: string; qty: number }>();

  // Tracking Grand Totals
  let totalQtySum = 0;
  let totalWostSum = 0;
  let totalDiscountSum = 0;
  let totalValueExTaxSum = 0;
  let totalSalesTaxSum = 0;
  let totalValueInclTaxSum = 0;
  let totalCashSaleSum = 0;
  let totalCashReturnSum = 0;
  let totalCreditSaleSum = 0;
  let totalGiftVoucherSum = 0;
  let totalCreditVoucherSum = 0;
  let totalExchangeVoucherSum = 0;
  let totalClaimVoucherSum = 0;
  let totalGiftVoucherCorpSum = 0;
  let totalCreditVoucherIssuedSum = 0;
  let totalRewardVoucherSum = 0;
  let totalOnCreditSum = 0;
  let totalCardSaleSum = 0;

  // Tracking Card Merchant Breakdown
  const merchantTotals: Record<string, { label: string; count: number; amount: number }> = {
    hbl: { label: 'HBL', count: 0, amount: 0 },
    allied: { label: 'Allied Bank', count: 0, amount: 0 },
    meezan: { label: 'Meezan Bank', count: 0, amount: 0 },
    amex: { label: 'AL-Falah | AMEX', count: 0, amount: 0 },
    keenu: { label: 'KEENU', count: 0, amount: 0 },
    ubl: { label: 'UBL', count: 0, amount: 0 },
    mcb: { label: 'MCB', count: 0, amount: 0 },
    alfalah: { label: 'AL-Falah', count: 0, amount: 0 },
  };

  let processedLines = 0;

  for (const [groupKey, groupRows] of salesGroups.entries()) {
    const sample = groupRows[0];
    const location = await resolveLocation(sample.locationCode, sample.costCentre);

    const rawCode = location.shortCode?.trim() || location.code?.trim() || sample.locationCode;
    const cleanCode = rawCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const fySuffix = getFySuffix(sample.docDate);
    const seqKey = `${cleanCode}_${fySuffix}`;

    const seq = (locSeqMap.get(seqKey) || 0) + 1;
    locSeqMap.set(seqKey, seq);

    const orderNumber = `SI-${cleanCode}${fySuffix}-${String(seq).padStart(5, '0')}`;
    const orderId = isDryRun ? `dry-order-${orderNumber}` : crypto.randomUUID();

    const orderQty = groupRows.reduce((acc, r) => acc + r.quantity, 0);
    const subtotal = groupRows.reduce((acc, r) => acc + (r.totalPriceWOT || (r.priceWOT * r.quantity)), 0);
    const discountAmount = groupRows.reduce((acc, r) => acc + r.discountAmount, 0);
    const valueExTax = groupRows.reduce((acc, r) => acc + r.valueExSalesTax, 0);
    const taxAmount = groupRows.reduce((acc, r) => acc + r.totalSalesTax, 0);
    const grandTotal = groupRows.reduce((acc, r) => acc + r.valueInclSalesTax, 0);

    totalQtySum += orderQty;
    totalWostSum += subtotal;
    totalDiscountSum += discountAmount;
    totalValueExTaxSum += valueExTax;
    totalSalesTaxSum += taxAmount;
    totalValueInclTaxSum += grandTotal;

    const cashAmount = groupRows.reduce((acc, r) => acc + (r.cashSale || 0), 0);
    const cashReturnAmount = groupRows.reduce((acc, r) => acc + (r.cashReturn || 0), 0);
    const cardAmount = groupRows.reduce((acc, r) => acc + (r.cardSale || 0), 0);
    const creditAmount = groupRows.reduce((acc, r) => acc + (r.creditSale || 0), 0);
    const giftAmount = groupRows.reduce((acc, r) => acc + (r.giftVoucherAmount || 0), 0);
    const creditVoucherAmount = groupRows.reduce((acc, r) => acc + (r.creditVoucherAmount || 0), 0);
    const exchangeAmount = groupRows.reduce((acc, r) => acc + (r.exchangeVoucherAmount || 0), 0);
    const claimAmount = groupRows.reduce((acc, r) => acc + (r.claimVoucherAmount || 0), 0);
    const giftVoucherCorp = groupRows.reduce((acc, r) => acc + (r.giftVoucherCorporate || 0), 0);
    const creditVoucherIssued = groupRows.reduce((acc, r) => acc + (r.creditVoucherIssuedAmount || 0), 0);
    const rewardVoucherAmount = groupRows.reduce((acc, r) => acc + (r.rewardVoucherAmount || 0), 0);
    const onCreditAmount = groupRows.reduce((acc, r) => acc + (r.onCreditAmount || 0), 0);

    totalCashSaleSum += cashAmount;
    totalCashReturnSum += cashReturnAmount;
    totalCardSaleSum += cardAmount;
    totalCreditSaleSum += creditAmount;
    totalGiftVoucherSum += giftAmount;
    totalCreditVoucherSum += creditVoucherAmount;
    totalExchangeVoucherSum += exchangeAmount;
    totalClaimVoucherSum += claimAmount;
    totalGiftVoucherCorpSum += giftVoucherCorp;
    totalCreditVoucherIssuedSum += creditVoucherIssued;
    totalRewardVoucherSum += rewardVoucherAmount;
    totalOnCreditSum += onCreditAmount;

    // Bank breakdown aggregated across all lines in this cash memo
    const hblVal = groupRows.reduce((acc, r) => acc + (r.hblSale || 0), 0);
    const alliedVal = groupRows.reduce((acc, r) => acc + (r.alliedBankSale || 0), 0);
    const meezanVal = groupRows.reduce((acc, r) => acc + (r.meezanBankSale || 0), 0);
    const amexVal = groupRows.reduce((acc, r) => acc + (r.alfalahAmexSale || 0), 0);
    const keenuVal = groupRows.reduce((acc, r) => acc + (r.keenuSale || 0), 0);
    const ublVal = groupRows.reduce((acc, r) => acc + (r.ublSale || 0), 0);
    const mcbVal = groupRows.reduce((acc, r) => acc + (r.mcbSale || 0), 0);
    const alfalahVal = groupRows.reduce((acc, r) => acc + (r.alfalahSale || 0), 0);

    if (hblVal > 0) {
      merchantTotals.hbl.count++;
      merchantTotals.hbl.amount += hblVal;
    }
    if (alliedVal > 0) {
      merchantTotals.allied.count++;
      merchantTotals.allied.amount += alliedVal;
    }
    if (meezanVal > 0) {
      merchantTotals.meezan.count++;
      merchantTotals.meezan.amount += meezanVal;
    }
    if (amexVal > 0) {
      merchantTotals.amex.count++;
      merchantTotals.amex.amount += amexVal;
    }
    if (keenuVal > 0) {
      merchantTotals.keenu.count++;
      merchantTotals.keenu.amount += keenuVal;
    }
    if (ublVal > 0) {
      merchantTotals.ubl.count++;
      merchantTotals.ubl.amount += ublVal;
    }
    if (mcbVal > 0) {
      merchantTotals.mcb.count++;
      merchantTotals.mcb.amount += mcbVal;
    }
    if (alfalahVal > 0) {
      merchantTotals.alfalah.count++;
      merchantTotals.alfalah.amount += alfalahVal;
    }

    const bankCandidates = [
      { name: 'HBL', val: hblVal },
      { name: 'Allied Bank', val: alliedVal },
      { name: 'Meezan', val: meezanVal },
      { name: 'AL-Falah | AMEX', val: amexVal },
      { name: 'Keenu', val: keenuVal },
      { name: 'UBL', val: ublVal },
      { name: 'MCB', val: mcbVal },
      { name: 'AL-Falah', val: alfalahVal },
    ];
    const topBank = bankCandidates.reduce((max, b) => b.val > max.val ? b : max, { name: '', val: 0 });
    const cardBankName: string | null = topBank.val > 0 ? topBank.name : null;

    let merchantConfig: any = null;
    if (cardAmount > 0 && cardBankName) {
      merchantConfig = await resolveMerchant(cleanCode, location.name, location.id, cardBankName);
    }

    const voucherAmount = giftAmount + creditVoucherAmount + exchangeAmount + claimAmount + giftVoucherCorp + rewardVoucherAmount;

    let paymentMethod = 'cash';
    if ((cardAmount > 0 && cashAmount > 0) || (cardAmount > 0 && voucherAmount > 0) || (cashAmount > 0 && voucherAmount > 0)) {
      paymentMethod = 'split';
    } else if (cardAmount > 0) {
      paymentMethod = 'card';
    } else if (voucherAmount > 0) {
      paymentMethod = 'voucher';
    } else if (creditAmount > 0) {
      paymentMethod = 'credit_account';
    }

    const fbrInvoiceNumber = groupRows.find((r) => r.fbrInvoiceNumber)?.fbrInvoiceNumber || sample.fbrInvoiceNumber || null;
    const salesPerson = groupRows.find((r) => r.salesPerson)?.salesPerson || sample.salesPerson;
    const remarks = groupRows.find((r) => r.remarks && r.remarks.trim() !== ';')?.remarks || sample.remarks;

    const notesParts = [`Original DocNo: ${sample.docNo}`];
    if (salesPerson) notesParts.push(`SalesPerson: ${salesPerson}`);
    if (remarks && remarks.trim() !== ';') notesParts.push(`Remarks: ${remarks.trim()}`);
    if (cardBankName) notesParts.push(`[Card Sale] Bank: ${cardBankName} (PKR ${cardAmount.toLocaleString()})`);

    const orderNotes = notesParts.join(' | ');

    if (isDryRun) {
      if (seq <= 5 || seq === 50 || seq === 100) {
        console.log(`🔍 [DRY-RUN #${orderNumber}] Date:${sample.docDate.toISOString().slice(0, 10)} | Store:${location.name} | Bank:${cardBankName || 'N/A'} | Total: PKR ${grandTotal.toLocaleString()} | Items:${groupRows.length}`);
      }
      processedLines += groupRows.length;
      continue;
    }

    salesOrderBatch.push({
      id: orderId,
      orderNumber,
      posId: sample.posId || null,
      terminalId: sample.posId || null,
      locationId: location.id,
      merchantId: merchantConfig ? merchantConfig.id : null,
      tenderType: cardBankName || (cardAmount > 0 ? 'CARD' : 'CASH'),
      subtotal: Math.round(subtotal * 100) / 100,
      discountAmount: Math.round(discountAmount * 100) / 100,
      taxAmount: Math.round(taxAmount * 100) / 100,
      grandTotal: Math.round(grandTotal * 100) / 100,
      paymentMethod,
      paymentStatus: 'paid',
      status: 'completed',
      notes: orderNotes,
      fbrInvoiceNumber: fbrInvoiceNumber || null,
      fbrStatus: fbrInvoiceNumber ? 'COMPLETED' : 'PENDING',
      cashAmount: cashAmount > 0 ? Math.round(cashAmount * 100) / 100 : null,
      cardAmount: cardAmount > 0 ? Math.round(cardAmount * 100) / 100 : null,
      voucherAmount: voucherAmount > 0 ? Math.round(voucherAmount * 100) / 100 : null,
      createdAt: sample.docDate,
      updatedAt: sample.docDate,
    });

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
              description: `POS Item (${row.barCode})`,
              unitPrice: row.unitPrice,
              unitCost: Math.round(row.unitPrice * 0.7 * 100) / 100,
              status: 'active',
              isActive: true,
            },
          });
        }
        itemCache.set(row.barCode, item);
      }

      const qty = row.quantity;
      const rawLineTaxPercent = row.valueExSalesTax > 0
        ? Math.round((row.totalSalesTax / row.valueExSalesTax) * 100 * 100) / 100
        : 0;

      // Ensure Decimal(5,2) safety (0 to 999.99)
      const safeDiscountPercent = Math.min(100, Math.max(0, Math.round(row.discountRateGiven * 100) / 100));
      const safeTaxPercent = Math.min(100, Math.max(0, rawLineTaxPercent));

      salesOrderItemBatch.push({
        id: crypto.randomUUID(),
        salesOrderId: orderId,
        itemId: item.id,
        quantity: Math.round(qty),
        unitPrice: Math.round(row.unitPrice * 100) / 100,
        discountPercent: safeDiscountPercent,
        discountAmount: Math.round(row.discountAmount * 100) / 100,
        taxPercent: safeTaxPercent,
        taxAmount: Math.round(row.totalSalesTax * 100) / 100,
        lineTotal: Math.round(row.valueInclSalesTax * 100) / 100,
        createdAt: sample.docDate,
      });

      const whId = location.warehouseId || defaultWarehouse.id;

      stockLedgerBatch.push({
        itemId: item.id,
        warehouseId: whId,
        locationId: location.id,
        qty: -qty, // Outbound negative
        referenceType: 'POS_SALE',
        referenceId: orderId,
        movementType: MovementType.OUTBOUND,
        unitCost: Number(item.unitCost) || row.unitPrice,
        rate: row.priceWOT || row.unitPrice,
        createdAt: sample.docDate,
      });

      const movNo = `MV-SALE-${orderNumber}-${row.barCode}-${itemIdx}`;
      stockMovementBatch.push({
        id: crypto.randomUUID(),
        movementNo: movNo,
        itemId: item.id,
        fromLocationId: location.id,
        toLocationId: null,
        quantity: qty,
        type: 'POS_SALE',
        referenceType: 'POS_SALE',
        referenceId: orderId,
        movementDate: sample.docDate,
        createdAt: sample.docDate,
        updatedAt: sample.docDate,
        notes: `POS Sale: ${orderNumber} (Doc #${row.docNo})`,
      });

      // Aggregate inventory deduction
      const invKey = `${location.id}:${item.id}`;
      const existingDeduction = inventoryDeductions.get(invKey);
      if (existingDeduction) {
        existingDeduction.qty += qty;
      } else {
        inventoryDeductions.set(invKey, {
          warehouseId: whId,
          locationId: location.id,
          itemId: item.id,
          qty,
        });
      }

      processedLines++;
    }
  }

  // ── High-Speed Chunked Database Insertions (If live) ──
  if (!isDryRun) {
    console.log(`\n🚀 Executing High-Speed Chunked DB Commits...`);

    // 1. Insert SalesOrders (chunk size 1,000)
    console.log(`💾 Inserting ${salesOrderBatch.length.toLocaleString()} Sales Orders in chunks of 1,000...`);
    const ORDER_CHUNK = 1000;
    for (let i = 0; i < salesOrderBatch.length; i += ORDER_CHUNK) {
      const chunk = salesOrderBatch.slice(i, i + ORDER_CHUNK);
      await prisma.salesOrder.createMany({ data: chunk });
      const pct = Math.round(((i + chunk.length) / salesOrderBatch.length) * 100);
      process.stdout.write(`\r   Orders Progress: ${i + chunk.length}/${salesOrderBatch.length} (${pct}%)`);
    }
    console.log(`\n   ✔ Sales Orders inserted successfully.`);

    // 2. Insert SalesOrderItems (chunk size 2,000)
    console.log(`💾 Inserting ${salesOrderItemBatch.length.toLocaleString()} Sales Order Items in chunks of 2,000...`);
    const ITEM_CHUNK = 2000;
    for (let i = 0; i < salesOrderItemBatch.length; i += ITEM_CHUNK) {
      const chunk = salesOrderItemBatch.slice(i, i + ITEM_CHUNK);
      await prisma.salesOrderItem.createMany({ data: chunk });
      const pct = Math.round(((i + chunk.length) / salesOrderItemBatch.length) * 100);
      process.stdout.write(`\r   Items Progress: ${i + chunk.length}/${salesOrderItemBatch.length} (${pct}%)`);
    }
    console.log(`\n   ✔ Sales Order Items inserted successfully.`);

    // 3. Insert StockLedgers (chunk size 2,000)
    console.log(`💾 Inserting ${stockLedgerBatch.length.toLocaleString()} Stock Ledgers in chunks of 2,000...`);
    for (let i = 0; i < stockLedgerBatch.length; i += ITEM_CHUNK) {
      const chunk = stockLedgerBatch.slice(i, i + ITEM_CHUNK);
      await prisma.stockLedger.createMany({ data: chunk });
      const pct = Math.round(((i + chunk.length) / stockLedgerBatch.length) * 100);
      process.stdout.write(`\r   Stock Ledgers Progress: ${i + chunk.length}/${stockLedgerBatch.length} (${pct}%)`);
    }
    console.log(`\n   ✔ Stock Ledgers inserted successfully.`);

    // 4. Insert StockMovements (chunk size 2,000)
    console.log(`💾 Inserting ${stockMovementBatch.length.toLocaleString()} Stock Movements in chunks of 2,000...`);
    for (let i = 0; i < stockMovementBatch.length; i += ITEM_CHUNK) {
      const chunk = stockMovementBatch.slice(i, i + ITEM_CHUNK);
      await prisma.stockMovement.createMany({ data: chunk });
      const pct = Math.round(((i + chunk.length) / stockMovementBatch.length) * 100);
      process.stdout.write(`\r   Stock Movements Progress: ${i + chunk.length}/${stockMovementBatch.length} (${pct}%)`);
    }
    console.log(`\n   ✔ Stock Movements inserted successfully.`);

    // 5. Apply Inventory Item Deductions
    console.log(`🔄 Applying ${inventoryDeductions.size.toLocaleString()} unique Inventory Item balance updates...`);
    const invEntries = Array.from(inventoryDeductions.values());
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
              data: { quantity: { decrement: entry.qty } },
            });
          } else {
            await prisma.inventoryItem.create({
              data: {
                warehouseId: entry.warehouseId,
                locationId: entry.locationId,
                itemId: entry.itemId,
                quantity: -entry.qty,
                status: 'AVAILABLE',
              },
            });
          }
        })
      );
      updatedInv += chunk.length;
      const pct = Math.round((updatedInv / invEntries.length) * 100);
      process.stdout.write(`\r   Inventory Progress: ${updatedInv}/${invEntries.length} (${pct}%)`);
    }
    console.log(`\n   ✔ Inventory balances updated successfully.`);
  }

  // ── FINAL GRAND SUMMARY REPORT ──
  console.log(`\n========================================================================================`);
  console.log(`📊 ${isDryRun ? '[DRY RUN TOTALS & AUDIT SUMMARY]' : '[FINAL POST-IMPORT RECONCILIATION AUDIT]'}`);
  console.log(`========================================================================================`);
  console.log(`1. DOCUMENT & LINE ITEM TOTALS:`);
  console.log(`   - Total Cash Memos (Orders) : ${salesGroups.size.toLocaleString()}`);
  console.log(`   - Total Lines Uploaded      : ${rows.length.toLocaleString()}`);
  console.log(`   - Uploaded QTY              : ${totalQtySum.toLocaleString()}`);
  console.log(`   - Total WOST (Price W/O Tax): PKR ${totalWostSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   - Total Discount            : PKR ${totalDiscountSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   - Value Ex Sales Tax        : PKR ${totalValueExTaxSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   - Total Sales Tax           : PKR ${totalSalesTaxSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   - Value Including Sales Tax : PKR ${totalValueInclTaxSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`----------------------------------------------------------------------------------------`);
  console.log(`2. PAYMENT TENDERS BREAKDOWN:`);
  console.log(`   - CashSale                  : PKR ${totalCashSaleSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   - CashReturn                : PKR ${totalCashReturnSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   - CreditSale                : PKR ${totalCreditSaleSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   - GiftVoucherAmount         : PKR ${totalGiftVoucherSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   - CreditVoucherAmount       : PKR ${totalCreditVoucherSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   - ExchangeVoucherAmount     : PKR ${totalExchangeVoucherSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   - ClaimVoucherAmount        : PKR ${totalClaimVoucherSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   - GiftVoucher_Corporate     : PKR ${totalGiftVoucherCorpSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   - CreditVoucherIssuedAmount : PKR ${totalCreditVoucherIssuedSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   - RewardVoucherAmount       : PKR ${totalRewardVoucherSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   - OnCreditAmount            : PKR ${totalOnCreditSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`   - CardSale (Total)          : PKR ${totalCardSaleSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`----------------------------------------------------------------------------------------`);
  console.log(`3. CARD MERCHANT & BANK TOTALS (Linked to MerchantConfig & POS Cards):`);
  let sumOfAllBankBreakdown = 0;
  for (const [k, data] of Object.entries(merchantTotals)) {
    sumOfAllBankBreakdown += data.amount;
    const paddedLabel = data.label.padEnd(20);
    console.log(`   - ${paddedLabel}: PKR ${data.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(16)}  (${data.count.toLocaleString()} orders)`);
  }
  console.log(`   - Total Bank Cards Mapped   : PKR ${sumOfAllBankBreakdown.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
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

  const defaultSalesFile = path.join(__dirname, '..', 'data', 'sales-july-&-aug.md');
  const fallbackFile = path.join(__dirname, '..', 'data', 'A-madison-sales.md');

  let filePath = fs.existsSync(defaultSalesFile) ? defaultSalesFile : fallbackFile;
  const fileArg = process.argv.find((arg) => arg.startsWith('--file=') || arg.startsWith('--path='));
  if (fileArg) {
    const customPath = fileArg.split('=')[1];
    filePath = path.isAbsolute(customPath) ? customPath : path.join(process.cwd(), customPath);
  }

  console.log(`\n🚀 Starting POS Sales Import Pipeline...`);
  console.log(`📄 Target Data File: ${filePath}`);
  if (locationFilter) {
    console.log(`🏬 Filter Location: ${locationFilter}`);
  }
  if (isDryRun) {
    console.log(`⚠️ DRY RUN ACTIVATED: No database changes will be committed.`);
  }

  const rows = readAndParseSalesData(filePath, limit, locationFilter);

  console.log(`📄 Successfully parsed and sorted ${rows.length.toLocaleString()} sales rows chronologically.`);
  if (rows.length > 0) {
    console.log('\n🔍 First Chronological Sales Row (#1):');
    console.log(`   - Doc No    : ${rows[0].docNo}`);
    console.log(`   - Doc Date  : ${rows[0].docDate.toISOString().slice(0, 10)}`);
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

        const tenantPool = new Pool({ connectionString, max: 25, idleTimeoutMillis: 30000 });
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

// Only execute main when run directly from CLI
if (require.main === module || !process.env.NODE_ENV || process.argv[1]?.includes('import-madison-sales')) {
  main().catch((err) => {
    console.error('❌ Error executing script:', err);
    process.exit(1);
  });
}
