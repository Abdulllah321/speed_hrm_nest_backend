import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Decrypts AES-256-GCM encrypted database password for tenant connection.
 */
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

/**
 * Flexible date parser supporting:
 * - Excel date serial numbers (e.g. 46205.48210648148)
 * - DD/MM/YYYY or MM/DD/YYYY or YYYY-MM-DD
 * - ISO date strings
 */
export function parseFlexibleDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;

  // Handle Excel numeric serial dates
  if (typeof val === 'number' || (!isNaN(Number(val)) && !String(val).includes('/') && !String(val).includes('-'))) {
    const num = Number(val);
    if (num > 20000 && num < 70000) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      return new Date(excelEpoch.getTime() + num * 86400000);
    }
  }

  const str = String(val).trim();
  if (!str || str === 'null' || str === '-' || str === '0') return null;

  if (str.includes('/')) {
    const [datePart, timePart] = str.split(/\s+/);
    const parts = datePart.split('/').map(Number);
    if (parts.length === 3) {
      const [d, m, y] = parts;
      const [hh, mm, ss] = (timePart || '00:00:00').split(':').map(Number);
      const year = y < 100 ? 2000 + y : y;
      const parsed = new Date(Date.UTC(year, m - 1, d, hh || 0, mm || 0, ss || 0));
      if (!isNaN(parsed.getTime())) return parsed;
    }
  }

  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Parses customer name and contact phone number from TraderDetail field.
 */
export function parseTraderCustomer(raw: string): { name: string; phone: string | null } {
  const cleaned = (raw || '').trim();
  if (!cleaned) return { name: 'Walk-in Customer', phone: null };

  const phoneMatch = cleaned.match(/(?:(?:\+92|0092|92)|0)?(3\d{2}[-\s]?\d{7}|3\d{9}|2323[-\s]?\d{7}|\d{4}[-\s]?\d{7})/);
  let phone: string | null = null;
  let name = cleaned;

  if (phoneMatch) {
    phone = phoneMatch[0].replace(/[^0-9]/g, '');
    if (phone.startsWith('92')) phone = '0' + phone.slice(2);
    if (phone.length === 10 && phone.startsWith('3')) phone = '0' + phone;

    name = cleaned.replace(phoneMatch[0], '').replace(/[&\/\\,]/g, '').trim();
  }

  if (!name || name === '&' || name === '-') {
    name = phone ? `Customer ${phone}` : 'Walk-in Customer';
  }

  return { name, phone };
}

export interface ParsedGiftVoucherRow {
  rowNum: number;
  costCentre: string;
  locationCode: string;
  voucherNumber: number;
  voucherCode: string;
  docDate: Date;
  docDateStr: string;
  traderDetail: string;
  customerName: string;
  customerPhone: string | null;
  remarks: string;
  amount: number;
  discountAmount: number;
  afterDiscAmount: number;
  cashSale: number;
  cardSale: number;
  meezanBank: number;
  hbl: number;
  validTill: Date | null;
  settledCostCentre: string;
  settledInvoice: string;
  dateSettled: Date | null;
  isSettled: boolean;
}

/**
 * Parses markdown table data from GIFT.md handling escaped pipes and structure.
 */
export function readAndParseGiftVouchers(filePath: string, limit?: number): ParsedGiftVoucherRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Gift vouchers data file not found at: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('| CostCentre |') || lines[i].includes('| CostCentre|')) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    throw new Error(`Could not find header row "| CostCentre |" in ${filePath}`);
  }

  const rawHeaders = lines[headerIndex].split('|').map((h) => h.trim()).filter(Boolean);

  const colIdx = {
    costCentre: rawHeaders.findIndex((h) => h.toLowerCase().includes('costcentre')),
    locationCode: rawHeaders.findIndex((h) => h.toLowerCase().includes('location')),
    voucherNumber: rawHeaders.findIndex((h) => h.toLowerCase().includes('vouchernumber') || h.toLowerCase().includes('giftvouchernumber')),
    documentDate: rawHeaders.findIndex((h) => h.toLowerCase().includes('documentdate')),
    traderDetail: rawHeaders.findIndex((h) => h.toLowerCase().includes('traderdetail') || h.toLowerCase().includes('trader')),
    remarks: rawHeaders.findIndex((h) => h.toLowerCase().includes('remarks')),
    amount: rawHeaders.findIndex((h) => h.toLowerCase() === 'amount'),
    discountAmount: rawHeaders.findIndex((h) => h.toLowerCase().includes('discountamount') || h.toLowerCase().includes('discount')),
    afterDiscAmount: rawHeaders.findIndex((h) => h.toLowerCase().includes('after disc') || h.toLowerCase().includes('afterdisc')),
    cashSale: rawHeaders.findIndex((h) => h.toLowerCase().includes('cashsale') || h.toLowerCase().includes('cash')),
    cardSale: rawHeaders.findIndex((h) => h.toLowerCase().includes('cardsale') || h.toLowerCase().includes('card')),
    meezanBank: rawHeaders.findIndex((h) => h.toLowerCase().includes('meezan')),
    hbl: rawHeaders.findIndex((h) => h.toLowerCase().includes('hbl')),
    validTill: rawHeaders.findIndex((h) => h.toLowerCase().includes('validtill') || h.toLowerCase().includes('valid')),
    settledCostCentre: rawHeaders.findIndex((h) => h.toLowerCase().includes('settledinfkcostcentre') || h.toLowerCase().includes('settledcostcentre')),
    settledInvoice: rawHeaders.findIndex((h) => h.toLowerCase().includes('settledinfkinvoicenumber') || h.toLowerCase().includes('settledinvoice')),
    dateSettled: rawHeaders.findIndex((h) => h.toLowerCase().includes('date_settled') || h.toLowerCase().includes('datesettled')),
  };

  const parsedRows: ParsedGiftVoucherRow[] = [];
  const placeholder = '__PIPE_ESC__';

  for (let i = headerIndex + 2; i < lines.length; i++) {
    if (limit && parsedRows.length >= limit) break;

    const line = lines[i].trim();
    if (!line || !line.startsWith('|')) continue;

    const sanitizedLine = line.replace(/\\\|/g, placeholder);
    const cols = sanitizedLine.split('|').map((c) => c.replace(new RegExp(placeholder, 'g'), '|').trim());
    if (cols.length > 1 && cols[0] === '') cols.shift();
    if (cols.length > 0 && cols[cols.length - 1] === '') cols.pop();

    if (cols.length < 7) continue;

    const costCentre = cols[colIdx.costCentre] || '';
    const locCode = cols[colIdx.locationCode] || '';
    const vNumRaw = cols[colIdx.voucherNumber] || '';
    const vNum = parseInt(vNumRaw, 10);
    if (isNaN(vNum)) continue;

    const docDateStr = cols[colIdx.documentDate] || '';
    const docDate = parseFlexibleDate(docDateStr) || new Date('2026-07-01');

    const traderDetail = cols[colIdx.traderDetail] || '';
    const customer = parseTraderCustomer(traderDetail);

    const remarks = cols[colIdx.remarks] || '';
    const amount = parseFloat(cols[colIdx.amount] || '0') || 0;
    const discountAmount = parseFloat(cols[colIdx.discountAmount] || '0') || 0;
    const afterDiscAmount = parseFloat(cols[colIdx.afterDiscAmount] || '0') || (amount - discountAmount);
    const cashSale = parseFloat(cols[colIdx.cashSale] || '0') || 0;
    const cardSale = parseFloat(cols[colIdx.cardSale] || '0') || 0;
    const meezanBank = parseFloat(cols[colIdx.meezanBank] || '0') || 0;
    const hbl = parseFloat(cols[colIdx.hbl] || '0') || 0;

    const validTillStr = cols[colIdx.validTill] || '';
    const validTill = parseFlexibleDate(validTillStr);

    const settledCostCentre = (cols[colIdx.settledCostCentre] || '').trim();
    const settledInvoice = (cols[colIdx.settledInvoice] || '').trim();
    const dateSettledStr = cols[colIdx.dateSettled] || '';
    const dateSettled = parseFlexibleDate(dateSettledStr);

    const isSettled = Boolean(
      (settledInvoice && settledInvoice !== '0' && settledInvoice !== '-' && settledInvoice !== 'null') ||
      dateSettled
    );

    // Compute Fiscal Year (July-June): July 2025 - June 2026 = 2526, July 2026 - June 2027 = 2627
    const year = docDate.getFullYear();
    const month = docDate.getMonth();
    const fy = month >= 6
      ? `${String(year).slice(-2)}${String(year + 1).slice(-2)}`
      : `${String(year - 1).slice(-2)}${String(year).slice(-2)}`;

    const locPrefix = (locCode || costCentre.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6)).toUpperCase();
    const voucherCode = `GFT-${locPrefix}-${fy}-${String(vNum).padStart(4, '0')}`;

    parsedRows.push({
      rowNum: parsedRows.length + 1,
      costCentre,
      locationCode: locCode,
      voucherNumber: vNum,
      voucherCode,
      docDate,
      docDateStr,
      traderDetail,
      customerName: customer.name,
      customerPhone: customer.phone,
      remarks,
      amount,
      discountAmount,
      afterDiscAmount,
      cashSale,
      cardSale,
      meezanBank,
      hbl,
      validTill,
      settledCostCentre,
      settledInvoice,
      dateSettled,
      isSettled,
    });
  }

  return parsedRows;
}

/**
 * Cleans all existing GIFT vouchers and their related transactions, redemptions, and locations.
 */
export async function cleanExistingGiftVouchers(prisma: PrismaClient) {
  console.log(`🧹 Checking existing GIFT vouchers in database...`);

  const existingCount = await prisma.voucher.count({
    where: { voucherType: 'GIFT' },
  });

  if (existingCount === 0) {
    console.log(`ℹ️ No existing GIFT vouchers found in database.`);
    return;
  }

  console.log(`🗑️ Removing ${existingCount.toLocaleString()} existing GIFT vouchers and dependent records...`);

  // 1. Unlink PosClaim and PosReturn if any point to GIFT vouchers
  await prisma.posClaim.updateMany({
    where: { voucher: { voucherType: 'GIFT' } },
    data: { voucherId: null },
  });

  await prisma.posReturn.updateMany({
    where: { voucher: { voucherType: 'GIFT' } },
    data: { voucherId: null },
  });

  // 2. Delete VoucherRedemption records for GIFT vouchers
  const deletedRedemptions = await prisma.voucherRedemption.deleteMany({
    where: { voucher: { voucherType: 'GIFT' } },
  });

  // 3. Delete VoucherTransaction records for GIFT vouchers
  const deletedTransactions = await prisma.voucherTransaction.deleteMany({
    where: { voucher: { voucherType: 'GIFT' } },
  });

  // 4. Delete VoucherLocation records for GIFT vouchers
  const deletedLocations = await prisma.voucherLocation.deleteMany({
    where: { voucher: { voucherType: 'GIFT' } },
  });

  // 5. Delete Voucher records of type GIFT
  const deletedVouchers = await prisma.voucher.deleteMany({
    where: { voucherType: 'GIFT' },
  });

  console.log(
    `✅ Successfully cleaned ${deletedVouchers.count.toLocaleString()} GIFT vouchers (${deletedRedemptions.count.toLocaleString()} redemptions, ${deletedTransactions.count.toLocaleString()} transactions, ${deletedLocations.count.toLocaleString()} locations).`,
  );
}

/**
 * Synchronizes and verifies SalesOrder tender amounts and notes for all redeemed vouchers.
 */
export async function syncOrderTendersWithRedemptions(prisma: PrismaClient) {
  console.log(`\n🔗 Synchronizing and verifying SalesOrder tender amounts for redeemed vouchers...`);

  // 1. Fetch all redemptions with their voucher details
  const allRedemptions = await prisma.voucherRedemption.findMany({
    include: {
      voucher: {
        select: { code: true, voucherType: true, faceValue: true },
      },
      order: {
        select: {
          id: true,
          orderNumber: true,
          grandTotal: true,
          voucherAmount: true,
          cashAmount: true,
          cardAmount: true,
          tenderType: true,
          paymentMethod: true,
          notes: true,
        },
      },
    },
  });

  if (allRedemptions.length === 0) {
    console.log(`ℹ️ No voucher redemptions found to synchronize.`);
    return;
  }

  // 2. Group by order
  const orderMap = new Map<
    string,
    {
      order: typeof allRedemptions[0]['order'];
      totalRedeemed: number;
      vouchers: Array<{ code: string; amount: number; type: string }>;
    }
  >();

  for (const r of allRedemptions) {
    if (!r.order) continue;
    const existing = orderMap.get(r.orderId);
    const amt = Number(r.amountUsed);
    if (!existing) {
      orderMap.set(r.orderId, {
        order: r.order,
        totalRedeemed: amt,
        vouchers: [{ code: r.voucher.code, amount: amt, type: r.voucher.voucherType }],
      });
    } else {
      existing.totalRedeemed += amt;
      existing.vouchers.push({ code: r.voucher.code, amount: amt, type: r.voucher.voucherType });
    }
  }

  console.log(`🔍 Found ${orderMap.size.toLocaleString()} unique SalesOrders linked to voucher redemptions.`);

  let updatedCount = 0;
  const updates: any[] = [];

  for (const [orderId, { order, totalRedeemed, vouchers }] of orderMap.entries()) {
    const grandTotal = Number(order.grandTotal || 0);
    const voucherAmount = totalRedeemed;
    const remainingToPay = Math.max(0, grandTotal - voucherAmount);

    let cashAmount = Number(order.cashAmount || 0);
    let cardAmount = Number(order.cardAmount || 0);
    let tenderType = order.tenderType || 'CASH';
    let paymentMethod = order.paymentMethod || 'cash';

    if (remainingToPay === 0) {
      cashAmount = 0;
      cardAmount = 0;
      tenderType = 'VOUCHER';
      paymentMethod = 'voucher';
    } else {
      paymentMethod = 'split';
      if (cardAmount > 0) {
        cardAmount = remainingToPay;
        cashAmount = 0;
        if (!tenderType.includes('VOUCHER')) {
          tenderType = `${tenderType} + VOUCHER`;
        }
      } else if (cashAmount > 0) {
        cashAmount = remainingToPay;
        cardAmount = 0;
        if (!tenderType.includes('VOUCHER')) {
          tenderType = 'CASH + VOUCHER';
        }
      } else {
        cashAmount = remainingToPay;
        tenderType = 'CASH + VOUCHER';
      }
    }

    const vCodeStr = vouchers.map((v) => `${v.code} (PKR ${v.amount.toLocaleString()})`).join(', ');
    const noteTag = `[Voucher Redeemed: ${vCodeStr}]`;
    let newNotes = order.notes || '';
    if (!newNotes.includes(noteTag)) {
      newNotes = newNotes ? `${newNotes} | ${noteTag}` : noteTag;
    }

    updates.push({
      id: orderId,
      voucherAmount: new Prisma.Decimal(voucherAmount),
      cashAmount: cashAmount > 0 ? new Prisma.Decimal(cashAmount) : new Prisma.Decimal(0),
      cardAmount: cardAmount > 0 ? new Prisma.Decimal(cardAmount) : new Prisma.Decimal(0),
      tenderType,
      paymentMethod,
      paymentStatus: 'paid',
      notes: newNotes,
    });
  }

  // Execute in batches of 250
  const BATCH_SIZE = 250;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const chunk = updates.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      chunk.map((u) =>
        prisma.salesOrder.update({
          where: { id: u.id },
          data: {
            voucherAmount: u.voucherAmount,
            cashAmount: u.cashAmount,
            cardAmount: u.cardAmount,
            tenderType: u.tenderType,
            paymentMethod: u.paymentMethod,
            paymentStatus: u.paymentStatus,
            notes: u.notes,
          },
        }),
      ),
    );
    updatedCount += chunk.length;
  }

  console.log(`✅ Successfully verified and synchronized tender amounts on ${updatedCount.toLocaleString()} SalesOrders.`);
}

/**
 * Processes and imports Gift vouchers for a single tenant with full hierarchy mapping.
 */
async function processTenantGiftVouchers(
  prisma: PrismaClient,
  companyName: string,
  rows: ParsedGiftVoucherRow[],
  isDryRun: boolean,
  deleteOnly: boolean = false,
  keepExisting: boolean = false,
) {
  console.log(`\n======================================================`);
  console.log(`🏢 Processing Tenant: [${companyName}]`);
  console.log(`======================================================`);

  if (!keepExisting) {
    if (isDryRun) {
      const existingCount = await prisma.voucher.count({
        where: { voucherType: 'GIFT' },
      });
      console.log(`⚠️ [DRY-RUN] Would remove ${existingCount.toLocaleString()} existing GIFT vouchers.`);
    } else {
      await cleanExistingGiftVouchers(prisma);
    }
  }

  if (deleteOnly) {
    console.log(`✨ Cleanup completed for tenant [${companyName}] (--delete-only active).`);
    return;
  }

  // 1. Fetch Locations
  const locations = await prisma.location.findMany({
    where: { isDeleted: false },
    select: { id: true, name: true, code: true, shortCode: true },
  });
  console.log(`📍 Found ${locations.length} active locations in DB.`);

  const locByCode = new Map(locations.map((l) => [l.code.toUpperCase(), l]));
  const locByShortCode = new Map(
    locations.filter((l) => l.shortCode).map((l) => [l.shortCode!.toUpperCase(), l]),
  );
  const locByName = new Map(locations.map((l) => [l.name.toLowerCase().trim(), l]));

  function resolveLocation(locCode: string, costCentre: string) {
    if (locCode) {
      const codeKey = locCode.trim().toUpperCase();
      const byCode = locByCode.get(codeKey);
      if (byCode) return byCode;
      const byShort = locByShortCode.get(codeKey);
      if (byShort) return byShort;
    }

    if (costCentre) {
      const nameKey = costCentre.trim().toLowerCase();
      const byName = locByName.get(nameKey);
      if (byName) return byName;

      // Fuzzy matching for known outlet names
      const norm = nameKey.replace(/[^a-z0-9]/g, '');
      for (const loc of locations) {
        const locNorm = loc.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (locNorm && norm && (locNorm.includes(norm) || norm.includes(locNorm))) {
          return loc;
        }
      }
    }

    return null;
  }

  // 2. Fetch Merchant Configs (for Card Payments: Meezan, HBL, Allied, Al-Falah)
  const merchantConfigs = await prisma.merchantConfig.findMany({
    where: { isActive: true },
  });
  console.log(`💳 Found ${merchantConfigs.length} merchant configs in DB.`);

  function resolveMerchant(locationId: string | null, bank: 'HBL' | 'MEEZAN' | 'CARD') {
    if (!merchantConfigs.length) return null;
    const loc = locations.find((l) => l.id === locationId);
    const locCode = loc?.code?.toUpperCase() || '';

    if (bank === 'HBL') {
      const match = merchantConfigs.find(
        (m) =>
          m.bankName.toUpperCase().includes('HBL') &&
          (m.tagId.toUpperCase() === locCode || (loc && m.costCentreTag.toUpperCase().includes(loc.name.toUpperCase()))),
      );
      if (match) return match;
      return merchantConfigs.find((m) => m.bankName.toUpperCase().includes('HBL')) || null;
    }

    if (bank === 'MEEZAN') {
      const match = merchantConfigs.find(
        (m) =>
          m.bankName.toUpperCase().includes('MEEZAN') &&
          (m.tagId.toUpperCase() === locCode || (loc && m.costCentreTag.toUpperCase().includes(loc.name.toUpperCase()))),
      );
      if (match) return match;
      return merchantConfigs.find((m) => m.bankName.toUpperCase().includes('MEEZAN')) || null;
    }

    return merchantConfigs.find((m) => locCode && m.tagId.toUpperCase() === locCode) || null;
  }

  // 3. Customer Profile Sync / Linking
  console.log(`👥 Indexing and syncing POS Customer profiles...`);
  const existingCustomers = await prisma.customer.findMany({
    select: { id: true, name: true, contactNo: true },
  });
  const customerByPhone = new Map<string, typeof existingCustomers[0]>();
  const customerByName = new Map<string, typeof existingCustomers[0]>();

  for (const c of existingCustomers) {
    if (c.contactNo) {
      const cleanPhone = c.contactNo.replace(/[^0-9]/g, '');
      customerByPhone.set(cleanPhone, c);
    }
    customerByName.set(c.name.toLowerCase().trim(), c);
  }

  // Auto-create missing customers in bulk
  const newCustomersToCreate: any[] = [];
  const createdCustomerPhones = new Set<string>();

  for (const row of rows) {
    if (row.customerPhone && !customerByPhone.has(row.customerPhone) && !createdCustomerPhones.has(row.customerPhone)) {
      createdCustomerPhones.add(row.customerPhone);
      const newCust = {
        id: crypto.randomUUID(),
        name: row.customerName,
        contactNo: row.customerPhone,
        customerType: 'POS' as const,
        remarks: `Auto-registered via Gift Voucher Sale (#${row.voucherCode})`,
        createdAt: row.docDate,
        updatedAt: row.docDate,
      };
      newCustomersToCreate.push(newCust);
      customerByPhone.set(row.customerPhone, newCust as any);
      customerByName.set(row.customerName.toLowerCase().trim(), newCust as any);
    }
  }

  if (!isDryRun && newCustomersToCreate.length > 0) {
    console.log(`👤 Registering ${newCustomersToCreate.length} new POS customers in database...`);
    await prisma.customer.createMany({
      data: newCustomersToCreate,
      skipDuplicates: true,
    });
  }

  // 4. Fetch and Index SalesOrders for Redemption Linking
  console.log(`🔍 Loading SalesOrders to map voucher settlements...`);
  const orders = await prisma.salesOrder.findMany({
    select: {
      id: true,
      orderNumber: true,
      locationId: true,
      notes: true,
      voucherAmount: true,
      grandTotal: true,
      createdAt: true,
    },
  });
  console.log(`🧾 Indexed ${orders.length} SalesOrders from DB.`);

  const orderByLocAndOrigDoc = new Map<string, typeof orders[0]>();
  const orderByOrigDocOnly = new Map<string, typeof orders[0][]>();
  const orderByOrderNumber = new Map<string, typeof orders[0]>();

  for (const o of orders) {
    orderByOrderNumber.set(o.orderNumber.toUpperCase(), o);

    if (o.notes) {
      const match = o.notes.match(/Original DocNo:\s*([^\s\|]+)/i);
      if (match && match[1]) {
        const origDoc = match[1].trim();
        const key = `${o.locationId}:${origDoc}`;
        orderByLocAndOrigDoc.set(key, o);

        const list = orderByOrigDocOnly.get(origDoc) || [];
        list.push(o);
        orderByOrigDocOnly.set(origDoc, list);
      }
    }
  }

  // 5. Build and Prepare Gift Voucher Data
  let totalFaceValue = 0;
  let totalNetCollected = 0;
  let totalDiscount = 0;
  let settledCount = 0;
  let settledValue = 0;
  let unsettledCount = 0;
  let unsettledValue = 0;
  let dbOrderMatches = 0;
  let legacySettledMatches = 0;

  const voucherDataList: any[] = [];
  const locationDataList: any[] = [];
  const redemptionDataList: any[] = [];
  const transactionDataList: any[] = [];

  for (const row of rows) {
    totalFaceValue += row.amount;
    totalDiscount += row.discountAmount;
    totalNetCollected += row.afterDiscAmount;

    const loc = resolveLocation(row.locationCode, row.costCentre);
    const customer = (row.customerPhone ? customerByPhone.get(row.customerPhone) : null) ||
      customerByName.get(row.customerName.toLowerCase().trim()) || null;

    // Payment method & Merchant resolution
    let paymentMode: string = 'CASH';
    let merchantId: string | null = null;

    if (row.meezanBank > 0) {
      paymentMode = 'CARD';
      merchantId = resolveMerchant(loc?.id || null, 'MEEZAN')?.id || null;
    } else if (row.hbl > 0) {
      paymentMode = 'CARD';
      merchantId = resolveMerchant(loc?.id || null, 'HBL')?.id || null;
    } else if (row.cardSale > 0) {
      paymentMode = 'CARD';
      merchantId = resolveMerchant(loc?.id || null, 'CARD')?.id || null;
    } else if (row.cashSale > 0) {
      paymentMode = 'CASH';
    }

    const isRedeemed = row.isSettled;
    const isActive = !isRedeemed && (!row.validTill || row.validTill > new Date());

    let matchedOrder: typeof orders[0] | null = null;
    if (isRedeemed) {
      settledCount++;
      settledValue += row.amount;

      const settledLoc = resolveLocation('', row.settledCostCentre);
      if (settledLoc && row.settledInvoice) {
        matchedOrder = orderByLocAndOrigDoc.get(`${settledLoc.id}:${row.settledInvoice}`) || null;
      }
      if (!matchedOrder && row.settledInvoice) {
        const list = orderByOrigDocOnly.get(row.settledInvoice);
        if (list && list.length === 1) {
          matchedOrder = list[0];
        } else {
          matchedOrder = orderByOrderNumber.get(row.settledInvoice.toUpperCase()) || null;
        }
      }

      if (matchedOrder) {
        dbOrderMatches++;
      } else {
        legacySettledMatches++;
      }
    } else {
      unsettledCount++;
      unsettledValue += row.amount;
    }

    const voucherId = crypto.randomUUID();
    const desc = row.remarks
      ? `Gift Voucher #${row.voucherNumber} - ${row.remarks}`
      : `Gift Voucher #${row.voucherNumber} issued to ${row.customerName}`;

    voucherDataList.push({
      id: voucherId,
      code: row.voucherCode,
      voucherType: 'GIFT',
      faceValue: new Prisma.Decimal(row.amount),
      discount: new Prisma.Decimal(row.discountAmount),
      description: desc,
      customerId: customer?.id || null,
      companyName: row.customerName,
      issuedByLocationId: loc?.id || null,
      paymentMode,
      cardholderName: row.customerName,
      merchantId,
      isActive,
      isRedeemed,
      expiresAt: row.validTill,
      createdAt: row.docDate,
      updatedAt: row.dateSettled || row.docDate,
    });

    if (loc?.id) {
      locationDataList.push({
        id: crypto.randomUUID(),
        voucherId,
        locationId: loc.id,
      });
    }

    // Transactions & Redemptions
    if (isRedeemed) {
      if (matchedOrder) {
        redemptionDataList.push({
          id: crypto.randomUUID(),
          voucherId,
          orderId: matchedOrder.id,
          amountUsed: new Prisma.Decimal(row.amount),
          createdAt: row.dateSettled || matchedOrder.createdAt,
        });

        transactionDataList.push({
          id: crypto.randomUUID(),
          voucherId,
          orderId: matchedOrder.id,
          locationId: matchedOrder.locationId,
          action: 'REDEEMED',
          amountUsed: new Prisma.Decimal(row.amount),
          notes: `Redeemed in POS Order ${matchedOrder.orderNumber} (Memo #${row.settledInvoice} at ${row.settledCostCentre})`,
          createdAt: row.dateSettled || matchedOrder.createdAt,
        });
      } else {
        const settledLoc = resolveLocation('', row.settledCostCentre);
        transactionDataList.push({
          id: crypto.randomUUID(),
          voucherId,
          orderId: null,
          locationId: settledLoc?.id || loc?.id || null,
          action: 'REDEEMED',
          amountUsed: new Prisma.Decimal(row.amount),
          notes: `Settled in ${row.settledCostCentre || 'Store'} (Invoice #${row.settledInvoice || 'N/A'})${row.dateSettled ? ` on ${row.dateSettled.toISOString().slice(0, 10)}` : ''}`,
          createdAt: row.dateSettled || row.docDate,
        });
      }
    } else {
      // Unsettled / Active issuance transaction
      const payDesc = paymentMode === 'CARD'
        ? `Card Payment (${row.hbl > 0 ? 'HBL' : row.meezanBank > 0 ? 'Meezan' : 'POS Terminal'})`
        : `Cash Payment`;
      const discNote = row.discountAmount > 0 ? ` (Discount: PKR ${row.discountAmount.toLocaleString()}, Collected: PKR ${row.afterDiscAmount.toLocaleString()})` : '';

      transactionDataList.push({
        id: crypto.randomUUID(),
        voucherId,
        locationId: loc?.id || null,
        action: 'ISSUED',
        amountUsed: new Prisma.Decimal(row.afterDiscAmount),
        notes: `Gift Voucher purchased by ${row.customerName} via ${payDesc}${discNote}. ${row.remarks || ''}`.trim(),
        createdAt: row.docDate,
      });
    }
  }

  if (isDryRun) {
    console.log(`\n⚠️ [DRY-RUN] Simulated preparation for ${voucherDataList.length.toLocaleString()} Gift vouchers.`);
  } else {
    // Fast batch insertion in chunks of 500 records
    const CHUNK_SIZE = 500;
    const totalBatches = Math.ceil(voucherDataList.length / CHUNK_SIZE);

    console.log(`\n📥 Inserting ${voucherDataList.length.toLocaleString()} Gift vouchers in ${totalBatches} batch transactions...`);

    for (let b = 0; b < totalBatches; b++) {
      const vChunk = voucherDataList.slice(b * CHUNK_SIZE, (b + 1) * CHUNK_SIZE);
      const chunkVoucherIds = new Set(vChunk.map((v) => v.id));

      const locChunk = locationDataList.filter((l) => chunkVoucherIds.has(l.voucherId));
      const redChunk = redemptionDataList.filter((r) => chunkVoucherIds.has(r.voucherId));
      const txChunk = transactionDataList.filter((t) => chunkVoucherIds.has(t.voucherId));

      await prisma.$transaction(
        async (tx) => {
          await tx.voucher.createMany({ data: vChunk });
          if (locChunk.length > 0) {
            await tx.voucherLocation.createMany({ data: locChunk });
          }
          if (redChunk.length > 0) {
            await tx.voucherRedemption.createMany({ data: redChunk });
          }
          if (txChunk.length > 0) {
            await tx.voucherTransaction.createMany({ data: txChunk });
          }
        },
        { timeout: 60000 },
      );

      const progressPct = (((b + 1) / totalBatches) * 100).toFixed(1);
      process.stdout.write(`\r   ⚡ [IMPORTING] Batch ${b + 1}/${totalBatches} (${Math.min((b + 1) * CHUNK_SIZE, voucherDataList.length).toLocaleString()}/${voucherDataList.length.toLocaleString()} vouchers - ${progressPct}%)`);
    }
    console.log('\n');

    // Synchronize SalesOrder tender amounts with voucher redemptions
    await syncOrderTendersWithRedemptions(prisma);
  }

  console.log(`======================================================`);
  console.log(`✨ ${isDryRun ? '[DRY RUN SUMMARY]' : '[GIFT VOUCHERS IMPORT SUMMARY]'}`);
  console.log(`======================================================`);
  console.log(`   - Total Gift Vouchers      : ${rows.length.toLocaleString()}`);
  console.log(`   - Total Face Value (PKR)   : PKR ${totalFaceValue.toLocaleString()}`);
  console.log(`   - Total Discount (PKR)     : PKR ${totalDiscount.toLocaleString()}`);
  console.log(`   - Total Net Sale Value     : PKR ${totalNetCollected.toLocaleString()}`);
  console.log(`   - Unsettled / Active       : ${unsettledCount.toLocaleString()} (PKR ${unsettledValue.toLocaleString()})`);
  console.log(`   - Settled / Redeemed       : ${settledCount.toLocaleString()} (PKR ${settledValue.toLocaleString()})`);
  console.log(`     ├── Linked to POS Orders : ${dbOrderMatches.toLocaleString()}`);
  console.log(`     └── Historical Redemptions: ${legacySettledMatches.toLocaleString()}`);
  console.log(`======================================================\n`);
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('-d');
  const deleteOnly = process.argv.includes('--delete-only') || process.argv.includes('--wipe-only');
  const keepExisting = process.argv.includes('--keep-existing');

  let limit: number | undefined = undefined;
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  if (limitArg) {
    limit = parseInt(limitArg.split('=')[1], 10);
  }

  const tenantFilter = process.argv.find((arg) => arg.startsWith('--tenant='))?.split('=')[1];

  let filePath = path.join(__dirname, '..', 'data', 'GIFT.md');
  const fileArg = process.argv.find((arg) => arg.startsWith('--file=') || arg.startsWith('--path='));
  if (fileArg) {
    const customPath = fileArg.split('=')[1];
    filePath = path.isAbsolute(customPath) ? customPath : path.join(process.cwd(), customPath);
  }

  console.log(`\n======================================================`);
  console.log(`🎁 Gift Vouchers Import & Hierarchy Synchronization`);
  console.log(`======================================================`);
  console.log(`📄 Target Data File: ${filePath}`);
  if (isDryRun) {
    console.log(`⚠️ DRY RUN MODE: No database changes will be committed.`);
  }
  if (deleteOnly) {
    console.log(`🗑️ DELETE-ONLY MODE: All GIFT vouchers will be wiped without importing.`);
  }

  const rows = deleteOnly ? [] : readAndParseGiftVouchers(filePath, limit);
  if (!deleteOnly) {
    console.log(`📄 Successfully parsed ${rows.length.toLocaleString()} Gift voucher rows from file.`);

    if (rows.length > 0) {
      console.log(`\n🔍 Sample Gift Voucher (#${rows[0].voucherNumber}):`);
      console.log(`   - Code        : ${rows[0].voucherCode}`);
      console.log(`   - Store       : [${rows[0].locationCode}] ${rows[0].costCentre}`);
      console.log(`   - Customer    : ${rows[0].customerName} (Phone: ${rows[0].customerPhone || 'N/A'})`);
      console.log(`   - Face Value  : PKR ${rows[0].amount.toLocaleString()}`);
      console.log(`   - Net Sale    : PKR ${rows[0].afterDiscAmount.toLocaleString()} (Disc: PKR ${rows[0].discountAmount.toLocaleString()})`);
      console.log(`   - Date Issued : ${rows[0].docDate.toISOString().slice(0, 10)}`);
      console.log(`   - Valid Till  : ${rows[0].validTill ? rows[0].validTill.toISOString().slice(0, 10) : 'No Expiry'}`);
      console.log(`   - Status      : ${rows[0].isSettled ? `Settled in ${rows[0].settledCostCentre} (Inv #${rows[0].settledInvoice})` : 'Unsettled / Active'}`);
    }
  }

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT || process.env.DATABASE_URL;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (managementUrl && masterKey) {
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
          await processTenantGiftVouchers(prisma, company.name, rows, isDryRun, deleteOnly, keepExisting);
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
  console.log(`\n⚙️ Connecting directly via DATABASE_URL...`);
  const directPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const directAdapter = new PrismaPg(directPool);
  const prisma = new PrismaClient({ adapter: directAdapter } as any);

  try {
    await processTenantGiftVouchers(prisma, 'Direct Database', rows, isDryRun, deleteOnly, keepExisting);
  } finally {
    await prisma.$disconnect();
    await directPool.end();
  }
}

main().catch((err) => {
  console.error('❌ Fatal error in gift vouchers script:', err);
  process.exit(1);
});
