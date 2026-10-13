import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient, MovementType, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Decrypts AES-256-GCM encrypted database password for multi-tenant connection.
 */
function decrypt(encryptedText: string, masterKeyString: string): string {
  if (!encryptedText || !masterKeyString || masterKeyString.length < 32) return '';
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const parts = encryptedText.split(':');
  if (parts.length !== 3) return '';
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
 * Robust date parser supporting MM/DD/YY, MM/DD/YYYY, and optional time.
 */
export function parseCustomDate(dateVal: any): Date | null {
  if (!dateVal && dateVal !== 0) return null;
  const str = String(dateVal).trim();
  if (!str || str === 'null' || str === '-' || str === ';') return null;

  const parts = str.split(/\s+/);
  const datePart = parts[0];
  const timePart = parts[1] || '00:00:00';

  const dParts = datePart.split(/[/.\-]/).map((p) => parseInt(p, 10));
  if (dParts.length === 3 && !isNaN(dParts[0]) && !isNaN(dParts[1]) && !isNaN(dParts[2])) {
    let [m, d, y] = dParts;
    if (y < 100) y += 2000;
    const tParts = timePart.split(':').map((p) => parseInt(p, 10) || 0);
    const [hh, mm, ss] = [tParts[0] || 0, tParts[1] || 0, tParts[2] || 0];
    const parsed = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
    if (!isNaN(parsed.getTime())) return parsed;
  }

  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function parseMarkdownLine(line: string): string[] {
  const sanitized = line.replace(/\\\\\|/g, '__ESCAPED_PIPE__').replace(/\\\|/g, '__ESCAPED_PIPE__').trim();
  let stripped = sanitized;
  if (stripped.startsWith('|')) stripped = stripped.substring(1);
  if (stripped.endsWith('|')) stripped = stripped.substring(0, stripped.length - 1);
  return stripped.split('|').map((p) => p.replace(/__ESCAPED_PIPE__/g, '|').trim());
}

export function parseTraderCustomer(raw: string): { name: string; phone: string | null } {
  const cleaned = (raw || '').trim();
  if (!cleaned) return { name: 'Online Customer', phone: null };

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
    name = phone ? `Customer ${phone}` : 'Online Customer';
  }

  return { name, phone };
}

async function processSsOnlineOctober(prisma: PrismaClient, isDryRun: boolean, cleanOctober: boolean) {
  console.log(`\n======================================================================`);
  console.log(`🚀 ${isDryRun ? '[DRY RUN MODE]' : '[LIVE COMMIT MODE]'} Processing SS-ONLINE October Data Import`);
  console.log(`======================================================================\n`);

  const dataDir = path.join(__dirname, '..', 'data');
  const fileSales = path.join(dataDir, 'SS1011-1-10-oct-sales copy.md');
  const fileReturns = path.join(dataDir, 'SS1011-1-10-oct-sales-return copy.md');
  const fileExchangeVouchers = path.join(dataDir, 'SS1011-1-10-oct-exchange-voucher copy.md');
  const fileGiftVouchers = path.join(dataDir, 'SS1011-1-10-oct-exchange-voucher copy 2.md');
  const fileRefundVouchers = path.join(dataDir, 'SS1011-1-10-oct-refund-voucher.md');

  // Verify file existence
  for (const [name, p] of Object.entries({
    Sales: fileSales,
    Returns: fileReturns,
    'Exchange Vouchers': fileExchangeVouchers,
    'Gift Vouchers': fileGiftVouchers,
    'Refund Vouchers': fileRefundVouchers,
  })) {
    if (!fs.existsSync(p)) {
      throw new Error(`Required file for ${name} not found at: ${p}`);
    }
  }

  // 1. Resolve SS-ONLINE Location & Central Warehouse
  const ssLocation = await prisma.location.findFirst({
    where: {
      OR: [
        { code: 'SS1011' },
        { shortCode: 'SS-ONLINE' },
        { name: { contains: 'SPEED SPORTS-ONLINE', mode: 'insensitive' } },
      ],
      isDeleted: false,
    },
    select: { id: true, code: true, shortCode: true, name: true, warehouseId: true },
  });

  if (!ssLocation) {
    throw new Error('SS-ONLINE location (SS1011) was not found in database.');
  }

  console.log(`📍 Found SS-ONLINE Location: [${ssLocation.code}] ${ssLocation.name} (ID: ${ssLocation.id})`);

  let defaultWarehouse = await prisma.warehouse.findFirst({
    where: {
      OR: [{ code: 'C40001' }, { name: { contains: 'LOGISTIC AREA', mode: 'insensitive' } }],
      isDeleted: false,
    },
  });

  if (!defaultWarehouse) {
    defaultWarehouse = await prisma.warehouse.findFirst({ where: { isDeleted: false } });
  }

  if (!defaultWarehouse) {
    throw new Error('No active warehouse found in database to associate with inventory ledger.');
  }

  const warehouseId = ssLocation.warehouseId || defaultWarehouse.id;
  console.log(`🏭 Active Warehouse for Stock Ledger: [${defaultWarehouse.code}] ${defaultWarehouse.name} (ID: ${warehouseId})`);

  // Merchant for HBL
  const hblMerchant = await prisma.merchantConfig.findFirst({
    where: {
      OR: [
        { bankName: { contains: 'HBL', mode: 'insensitive' } },
        { description: { contains: 'HBL', mode: 'insensitive' } },
      ],
    },
    select: { id: true, bankName: true },
  });
  console.log(`💳 HBL Merchant Config: ${hblMerchant ? hblMerchant.bankName + ' (' + hblMerchant.id + ')' : 'Default'}`);

  // 2. Optional Cleaning of Previously Imported October Records for SS1011
  if (cleanOctober && !isDryRun) {
    console.log(`\n🧹 Clean-October flag detected. Removing existing October 1–10 records for SS1011...`);
    const octStart = new Date('2026-10-01T00:00:00.000Z');
    const octEnd = new Date('2026-10-10T23:59:59.999Z');

    const salesRawForClean = fs.readFileSync(fileSales, 'utf-8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('|-') && !l.startsWith('| ---'));
    const returnRawForClean = fs.readFileSync(fileReturns, 'utf-8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('|-') && !l.startsWith('| ---'));

    const octSalesDocNos = new Set<string>();
    for (let i = 1; i < salesRawForClean.length; i++) {
      const p = parseMarkdownLine(salesRawForClean[i]);
      if (p[2]) octSalesDocNos.add(p[2].trim());
    }

    const octReturnDocNos = new Set<string>();
    for (let i = 1; i < returnRawForClean.length; i++) {
      const p = parseMarkdownLine(returnRawForClean[i]);
      if (p[2]) octReturnDocNos.add(p[2].trim());
    }

    const existingSales = await prisma.salesOrder.findMany({
      where: {
        locationId: ssLocation.id,
        orderNumber: { in: Array.from(octSalesDocNos) },
      },
      select: { id: true },
    });

    const existingReturns = await prisma.posReturn.findMany({
      where: {
        locationId: ssLocation.id,
        returnNumber: { in: Array.from(octReturnDocNos) },
      },
      select: { id: true, voucherId: true },
    });

    const sIds = existingSales.map((s) => s.id);
    const rIds = existingReturns.map((r) => r.id);
    const returnVoucherIds = existingReturns.map((r) => r.voucherId).filter(Boolean) as string[];

    // Read old invalid barcodes from non-copy files if they exist to catch any invalid items
    const oldInvalidBarcodes = new Set<string>();
    const oldSalesFile = path.join(dataDir, 'SS1011-1-10-oct-sales.md');
    const oldReturnsFile = path.join(dataDir, 'SS1011-1-10-oct-sales-return.md');
    if (fs.existsSync(oldSalesFile)) {
      const oldSLines = fs.readFileSync(oldSalesFile, 'utf-8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('|-') && !l.startsWith('| ---'));
      for (let i = 1; i < oldSLines.length; i++) {
        const p = parseMarkdownLine(oldSLines[i]);
        if (p[6]) oldInvalidBarcodes.add(p[6].replace(/['"]/g, '').trim());
      }
    }
    if (fs.existsSync(oldReturnsFile)) {
      const oldRLines = fs.readFileSync(oldReturnsFile, 'utf-8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('|-') && !l.startsWith('| ---'));
      for (let i = 1; i < oldRLines.length; i++) {
        const p = parseMarkdownLine(oldRLines[i]);
        if (p[6]) oldInvalidBarcodes.add(p[6].replace(/['"]/g, '').trim());
      }
    }

    // Find any auto-created/invalid items (by barcode from old file, or by ITEM- / POS Item description)
    const badItems = await prisma.item.findMany({
      where: {
        OR: [
          ...(oldInvalidBarcodes.size > 0 ? [{ barCode: { in: Array.from(oldInvalidBarcodes) } }] : []),
          { description: { startsWith: 'POS Item (' } },
          { itemId: { startsWith: 'ITEM-887792000000' } },
          { itemId: { startsWith: 'ITEM-4052000000000' } },
          { itemId: { startsWith: 'ITEM-4067910000000' } },
          { itemId: { startsWith: 'ITEM-197600000000' } },
          { itemId: { startsWith: 'ITEM-4550460000000' } },
        ],
      },
      select: { id: true, barCode: true },
    });
    const badItemIds = new Set(badItems.map((b) => b.id));

    // Calculate net delta per item from existing October stock ledgers to revert inventory
    const saleLedgers = await prisma.stockLedger.findMany({
      where: {
        locationId: ssLocation.id,
        referenceId: { in: sIds },
        referenceType: 'POS_SALE',
      },
      select: { itemId: true, qty: true },
    });

    const returnLedgers = await prisma.stockLedger.findMany({
      where: {
        locationId: ssLocation.id,
        referenceId: { in: rIds },
        referenceType: 'POS_RETURN',
      },
      select: { itemId: true, qty: true },
    });

    const netDeltaRevertMap = new Map<string, number>();
    for (const row of saleLedgers) {
      netDeltaRevertMap.set(row.itemId, (netDeltaRevertMap.get(row.itemId) || 0) + Number(row.qty));
    }
    for (const row of returnLedgers) {
      netDeltaRevertMap.set(row.itemId, (netDeltaRevertMap.get(row.itemId) || 0) + Number(row.qty));
    }

    // Revert inventory balances
    for (const [itemId, netDelta] of netDeltaRevertMap.entries()) {
      if (badItemIds.has(itemId)) {
        await prisma.inventoryItem.deleteMany({
          where: { itemId, locationId: ssLocation.id },
        });
      } else {
        const inv = await prisma.inventoryItem.findFirst({
          where: { itemId, locationId: ssLocation.id },
        });
        if (inv) {
          const otherLedgers = await prisma.stockLedger.count({
            where: {
              locationId: ssLocation.id,
              itemId,
              referenceId: { notIn: [...sIds, ...rIds] },
            },
          });
          if (otherLedgers === 0 && Number(inv.quantity) === netDelta) {
            await prisma.inventoryItem.delete({ where: { id: inv.id } });
          } else {
            await prisma.inventoryItem.update({
              where: { id: inv.id },
              data: { quantity: { decrement: netDelta } },
            });
          }
        }
      }
    }

    // Delete vouchers
    const octVouchers = await prisma.voucher.findMany({
      where: {
        OR: [
          { id: { in: returnVoucherIds } },
          { code: { startsWith: 'EXC-SSONLINE27-004' } },
          { code: 'EXC-67M9ZI' },
          { code: { in: ['GFT-SS1011-2627-0029', 'GFT-SS1011-2627-0030', 'GFT-SS1011-2627-0031'] } },
          { code: 'REF-SSONLINE27-00873' },
          { issuedByLocationId: ssLocation.id, createdAt: { gte: octStart, lte: octEnd } },
        ],
      },
      select: { id: true },
    });
    const vIds = Array.from(new Set([...returnVoucherIds, ...octVouchers.map((v) => v.id)]));

    if (sIds.length > 0 || vIds.length > 0) {
      await prisma.voucherRedemption.deleteMany({
        where: {
          OR: [{ orderId: { in: sIds } }, { voucherId: { in: vIds } }],
        },
      });
    }

    if (vIds.length > 0) {
      await prisma.voucherTransaction.deleteMany({ where: { voucherId: { in: vIds } } });
      await prisma.voucherLocation.deleteMany({ where: { voucherId: { in: vIds } } });
      await prisma.voucher.deleteMany({ where: { id: { in: vIds } } });
    }

    if (sIds.length > 0) {
      console.log(`  Deleting ${sIds.length} existing October Sales Orders & related records...`);
      await prisma.salesOrderItem.deleteMany({ where: { salesOrderId: { in: sIds } } });
      await prisma.salesOrder.deleteMany({ where: { id: { in: sIds } } });
    }

    if (badItems.length > 0) {
      await prisma.salesOrderItem.deleteMany({
        where: { itemId: { in: Array.from(badItemIds) } },
      });
    }

    if (rIds.length > 0) {
      console.log(`  Deleting ${rIds.length} existing October PosReturns & related records...`);
      await prisma.posReturnItem.deleteMany({ where: { posReturnId: { in: rIds } } });
      await prisma.posReturn.deleteMany({ where: { id: { in: rIds } } });
    }

    // Clean stock movements & ledgers for October SS1011
    await prisma.stockMovement.deleteMany({
      where: {
        OR: [
          { referenceId: { in: [...sIds, ...rIds] } },
          { itemId: { in: Array.from(badItemIds) } },
          { movementNo: { startsWith: 'MV-SALE-SI-SSONLINE27-04' } },
          { movementNo: { startsWith: 'MV-RET-SR-SSONLINE27-004' } },
        ],
      },
    });

    await prisma.stockLedger.deleteMany({
      where: {
        OR: [
          { referenceId: { in: [...sIds, ...rIds] } },
          { itemId: { in: Array.from(badItemIds) } },
          { locationId: ssLocation.id, createdAt: { gte: octStart, lte: octEnd } },
        ],
      },
    });

    // Delete auxiliary bad items records and bad items
    if (badItems.length > 0) {
      await prisma.monthlyStockSnapshot.deleteMany({
        where: { itemId: { in: Array.from(badItemIds) } },
      });
      await prisma.inventoryItem.deleteMany({
        where: { itemId: { in: Array.from(badItemIds) } },
      });
      await prisma.stockAdjustmentItem.deleteMany({
        where: { itemId: { in: Array.from(badItemIds) } },
      });
      await prisma.transferRequestItem.deleteMany({
        where: { itemId: { in: Array.from(badItemIds) } },
      });
      await prisma.discountCampaignItem.deleteMany({
        where: { itemId: { in: Array.from(badItemIds) } },
      });
      await prisma.item.deleteMany({
        where: { id: { in: Array.from(badItemIds) } },
      });
    }

    console.log(`  ✅ Existing October records & invalid items cleaned successfully.`);
  }

  // 3. Pre-cache Catalog Items & Barcode Resolution (Strict Exact Matching)
  console.log(`\n🔍 Pre-caching Catalog Items and resolving barcodes...`);
  const itemCacheByBarcode = new Map<string, any>();
  const itemCacheById = new Map<string, any>();

  // Read all distinct barcodes across sales and returns
  const salesRawLines = fs.readFileSync(fileSales, 'utf-8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('|-') && !l.startsWith('| ---'));
  const returnRawLines = fs.readFileSync(fileReturns, 'utf-8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('|-') && !l.startsWith('| ---'));

  const fileBarcodes = new Set<string>();
  const barcodeUnitPrices = new Map<string, number>();

  for (let i = 1; i < salesRawLines.length; i++) {
    const parts = parseMarkdownLine(salesRawLines[i]);
    if (parts[6]) {
      const cleanBar = parts[6].replace(/['"]/g, '').trim();
      fileBarcodes.add(cleanBar);
      if (!barcodeUnitPrices.has(cleanBar)) {
        barcodeUnitPrices.set(cleanBar, parseFloat(parts[8] || '0') || 0);
      }
    }
  }

  for (let i = 1; i < returnRawLines.length; i++) {
    const parts = parseMarkdownLine(returnRawLines[i]);
    if (parts[6]) {
      const cleanBar = parts[6].replace(/['"]/g, '').trim();
      fileBarcodes.add(cleanBar);
      if (!barcodeUnitPrices.has(cleanBar)) {
        barcodeUnitPrices.set(cleanBar, parseFloat(parts[8] || '0') || 0);
      }
    }
  }

  const allDistinctBarcodes = Array.from(fileBarcodes);
  console.log(`  Found ${allDistinctBarcodes.length} distinct barcodes across October sales and returns files.`);

  // Load exact matches
  const exactDbItems = await prisma.item.findMany({
    where: { barCode: { in: allDistinctBarcodes } },
    select: { id: true, barCode: true, sku: true, unitPrice: true, unitCost: true, description: true },
  });

  for (const it of exactDbItems) {
    if (it.barCode) itemCacheByBarcode.set(it.barCode, it);
    itemCacheById.set(it.id, it);
  }

  // Verify all barcodes exist exactly in catalog
  const missingBarcodes = allDistinctBarcodes.filter((b) => !itemCacheByBarcode.has(b));
  if (missingBarcodes.length > 0) {
    throw new Error(`Catalog verification failed: ${missingBarcodes.length} barcodes not found in database: ${missingBarcodes.slice(0, 10).join(', ')}`);
  }

  console.log(`  ✔ Successfully resolved 100% of items (${itemCacheByBarcode.size} barcode mappings indexed).`);

  // Shared Inventory Item tracker to batch updates efficiently
  // Key: itemId, Value: { netQtyDelta: number, warehouseId: string }
  const inventoryDeltaMap = new Map<string, number>();

  // =========================================================================
  // PHASE 1: IMPORT GIFT VOUCHERS (SS1011-1-10-oct-exchange-voucher copy 2.md)
  // =========================================================================
  console.log(`\n----------------------------------------------------------------------`);
  console.log(`🎁 [PHASE 1] Importing Gift Vouchers...`);
  console.log(`----------------------------------------------------------------------`);

  const giftRawLines = fs.readFileSync(fileGiftVouchers, 'utf-8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('|-') && !l.startsWith('| ---'));
  const giftVoucherMap = new Map<string, any>(); // Map by code and by amount for quick sale redemption

  let giftVouchersCreated = 0;

  for (let i = 1; i < giftRawLines.length; i++) {
    const p = parseMarkdownLine(giftRawLines[i]);
    if (p.length < 10) continue;

    const voucherNum = parseInt(p[5] || '0', 10);
    if (!voucherNum) continue;

    const docDate = parseCustomDate(p[6]) || new Date('2026-10-05T00:00:00.000Z');
    const traderDetail = p[7] || '';
    const remarks = p[8] || '';
    const amount = parseFloat(p[10] || '0') || 0;
    const validTill = parseCustomDate(p[14]);

    const { name: customerName, phone: customerPhone } = parseTraderCustomer(traderDetail);

    // Calculate Fiscal Year 2627
    const voucherCode = `GFT-SS1011-2627-${String(voucherNum).padStart(4, '0')}`;
    const voucherId = isDryRun ? `dry-gift-${voucherCode}` : crypto.randomUUID();

    // Check customer in DB
    let customerId: string | null = null;
    if (!isDryRun) {
      if (customerPhone) {
        let cust = await prisma.customer.findFirst({ where: { contactNo: customerPhone } });
        if (!cust) {
          cust = await prisma.customer.create({
            data: {
              name: customerName,
              contactNo: customerPhone,
              customerType: 'POS',
              remarks: `Registered via Gift Voucher #${voucherNum}`,
            },
          });
        }
        customerId = cust.id;
      }
    }

    const giftVoucherRecord = {
      id: voucherId,
      code: voucherCode,
      voucherNum,
      voucherType: 'GIFT',
      faceValue: amount,
      discount: 0,
      description: remarks ? `Gift Voucher #${voucherNum} - ${remarks}` : `Gift Voucher #${voucherNum} issued to ${customerName}`,
      customerId,
      companyName: customerName,
      issuedByLocationId: ssLocation.id,
      paymentMode: 'CARD',
      merchantId: hblMerchant?.id || null,
      cardholderName: customerName,
      isActive: true,
      isRedeemed: false, // Will be set to true if redeemed during Phase 3
      expiresAt: validTill,
      createdAt: docDate,
      updatedAt: docDate,
    };

    if (!isDryRun) {
      const savedGift = await prisma.voucher.upsert({
        where: { code: voucherCode },
        update: {
          faceValue: amount,
          description: giftVoucherRecord.description,
          expiresAt: validTill,
        },
        create: {
          id: voucherId,
          code: voucherCode,
          voucherType: 'GIFT',
          faceValue: new Prisma.Decimal(amount),
          discount: new Prisma.Decimal(0),
          description: giftVoucherRecord.description,
          customerId,
          companyName: customerName,
          issuedByLocationId: ssLocation.id,
          paymentMode: 'CARD',
          merchantId: hblMerchant?.id || null,
          cardholderName: customerName,
          isActive: true,
          isRedeemed: false,
          expiresAt: validTill,
          createdAt: docDate,
          updatedAt: docDate,
        },
        select: { id: true },
      });
      const effectiveGiftId = savedGift.id;
      giftVoucherRecord.id = effectiveGiftId;

      await prisma.voucherLocation.upsert({
        where: { voucherId_locationId: { voucherId: effectiveGiftId, locationId: ssLocation.id } },
        update: {},
        create: { voucherId: effectiveGiftId, locationId: ssLocation.id },
      });

      await prisma.voucherTransaction.create({
        data: {
          voucherId: effectiveGiftId,
          locationId: ssLocation.id,
          action: 'ISSUED',
          amountUsed: new Prisma.Decimal(amount),
          notes: `Issued via HBL portal for ${customerName} (#${voucherNum})`,
          createdAt: docDate,
        },
      });
    }

    giftVoucherMap.set(voucherCode, giftVoucherRecord);
    giftVoucherMap.set(String(voucherNum), giftVoucherRecord);
    giftVoucherMap.set(String(amount), giftVoucherRecord);
    giftVouchersCreated++;

    console.log(`  🎁 Registered Gift Voucher [${voucherCode}] Amount: PKR ${amount.toLocaleString()} | Customer: ${customerName}`);
  }

  // =========================================================================
  // PHASE 2: IMPORT RETURNS, EXCHANGE & REFUND VOUCHERS + RESTORE INVENTORY
  // =========================================================================
  console.log(`\n----------------------------------------------------------------------`);
  console.log(`🔄 [PHASE 2] Importing Returns, Exchange Vouchers & Restoring Stock...`);
  console.log(`----------------------------------------------------------------------`);

  // Load exchange voucher aliases from SS1011-1-10-oct-exchange-voucher copy.md
  const exchangeRawLines = fs.readFileSync(fileExchangeVouchers, 'utf-8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('|-') && !l.startsWith('| ---'));
  const exchangeAliasMap = new Map<string, string>(); // saleDoc -> voucherCode

  for (let i = 1; i < exchangeRawLines.length; i++) {
    const p = parseMarkdownLine(exchangeRawLines[i]);
    const voucherDoc = p[2] || '';
    const saleDoc = p[4] || '';
    if (voucherDoc && saleDoc) {
      exchangeAliasMap.set(saleDoc.trim(), voucherDoc.trim());
    }
  }

  // Group returns by DocumentNumber (e.g. SR-SSONLINE27-00436)
  interface ParsedReturnGroup {
    docNo: string;
    docDate: Date;
    originalSaleDoc: string;
    fbrInvoiceNumber: string;
    remarks: string;
    items: {
      barCode: string;
      item: any;
      qty: number; // positive quantity returned
      unitPrice: number;
      priceWOT: number;
      discountAmount: number;
      valueExTax: number;
      salesTax: number;
      valueInclTax: number;
    }[];
  }

  const returnGroups = new Map<string, ParsedReturnGroup>();

  for (let i = 1; i < returnRawLines.length; i++) {
    const p = parseMarkdownLine(returnRawLines[i]);
    if (p.length < 10) continue;

    const docNo = p[2] || '';
    if (!docNo) continue;

    const docDate = parseCustomDate(p[3]) || new Date('2026-10-01T00:00:00.000Z');
    const barCode = (p[6] || '').replace(/['"]/g, '').trim();
    const item = itemCacheByBarcode.get(barCode) || { id: 'fallback', barCode, unitPrice: 0, unitCost: 0 };
    const rawQty = parseFloat(p[7] || '-1') || -1;
    const qty = Math.abs(rawQty); // 1 item returned
    const unitPrice = parseFloat(p[8] || '0') || 0;
    const priceWOT = Math.abs(parseFloat(p[9] || '0') || unitPrice * 0.8);
    const discountAmount = Math.abs(parseFloat(p[11] || '0') || 0);
    const valueExTax = Math.abs(parseFloat(p[12] || '0') || priceWOT - discountAmount);
    const salesTax = Math.abs(parseFloat(p[15] || '0') || 0);
    const valueInclTax = Math.abs(parseFloat(p[16] || '0') || valueExTax + salesTax);
    const fbrInvoiceNumber = (p[18] || '').replace(/['"]/g, '').trim();
    const originalSaleDoc = (p[19] || '').trim();
    const remarks = p[21] || '';

    if (!returnGroups.has(docNo)) {
      returnGroups.set(docNo, {
        docNo,
        docDate,
        originalSaleDoc,
        fbrInvoiceNumber,
        remarks,
        items: [],
      });
    }

    returnGroups.get(docNo)!.items.push({
      barCode,
      item,
      qty,
      unitPrice,
      priceWOT,
      discountAmount,
      valueExTax,
      salesTax,
      valueInclTax,
    });
  }

  console.log(`  Found ${returnGroups.size} distinct return memos (SR-SSONLINE27-00436 to SR-00476).`);

  const exchangeVoucherByCode = new Map<string, any>();
  let totalReturnsCreated = 0;
  let totalStockRestoredUnits = 0;

  for (const [returnDocNo, group] of returnGroups.entries()) {
    const totalRefund = group.items.reduce((sum, it) => sum + it.valueInclTax, 0);
    const totalSubtotalWost = group.items.reduce((sum, it) => sum + it.priceWOT, 0);
    const totalDiscountWost = group.items.reduce((sum, it) => sum + it.discountAmount, 0);
    const totalTaxAmount = group.items.reduce((sum, it) => sum + it.salesTax, 0);

    // Derive voucher code: e.g. EXC-SSONLINE27-00436 (and check alias)
    const suffixNum = returnDocNo.replace(/^SR-/, '');
    const defaultVoucherCode = `EXC-${suffixNum}`;
    const aliasCode = exchangeAliasMap.get(group.originalSaleDoc);
    const primaryVoucherCode = defaultVoucherCode;

    // Resolve or find linked original SalesOrder in DB
    let targetOrderId: string | null = null;

    if (group.originalSaleDoc && !isDryRun) {
      const originalOrder = await prisma.salesOrder.findFirst({
        where: {
          OR: [
            { orderNumber: group.originalSaleDoc },
            { notes: { contains: group.originalSaleDoc } },
          ],
        },
        select: { id: true, orderNumber: true },
      });
      if (originalOrder) {
        targetOrderId = originalOrder.id;
      }
    }

    // If original order from earlier month is not in DB, create an archived sales order stub for referential integrity
    if (!targetOrderId) {
      const stubOrderNumber = group.originalSaleDoc || `ORIG-${returnDocNo}`;
      const stubOrderId = isDryRun ? `dry-orig-${stubOrderNumber}` : crypto.randomUUID();

      if (!isDryRun) {
        const savedStub = await prisma.salesOrder.upsert({
          where: { orderNumber: stubOrderNumber },
          update: {},
          create: {
            id: stubOrderId,
            orderNumber: stubOrderNumber,
            locationId: ssLocation.id,
            subtotal: new Prisma.Decimal(totalSubtotalWost),
            grandTotal: new Prisma.Decimal(totalRefund),
            discountAmount: new Prisma.Decimal(totalDiscountWost),
            taxAmount: new Prisma.Decimal(totalTaxAmount),
            paymentMethod: 'cash',
            paymentStatus: 'paid',
            status: 'completed',
            notes: `Archived Original Sale for Return ${returnDocNo} (${group.originalSaleDoc})`,
            createdAt: group.docDate,
            updatedAt: group.docDate,
          },
          select: { id: true },
        });
        targetOrderId = savedStub.id;
      } else {
        targetOrderId = stubOrderId;
      }
    }

    const voucherId = isDryRun ? `dry-vouch-${primaryVoucherCode}` : crypto.randomUUID();
    const posReturnId = isDryRun ? `dry-ret-${returnDocNo}` : crypto.randomUUID();

    // 1. Create/Update Voucher
    const voucherObj = {
      id: voucherId,
      code: primaryVoucherCode,
      aliasCode,
      voucherType: 'EXCHANGE',
      faceValue: totalRefund,
      description: `Exchange voucher for return ${returnDocNo} (Sale #${group.originalSaleDoc || 'N/A'})`,
      issuedByLocationId: ssLocation.id,
      sourceOrderId: targetOrderId,
      isActive: true,
      isRedeemed: false, // will be redeemed when matched in October sales
      createdAt: group.docDate,
      updatedAt: group.docDate,
    };

    exchangeVoucherByCode.set(primaryVoucherCode, voucherObj);
    if (aliasCode) exchangeVoucherByCode.set(aliasCode, voucherObj);
    exchangeVoucherByCode.set(suffixNum, voucherObj);

    if (!isDryRun) {
      const savedVoucher = await prisma.voucher.upsert({
        where: { code: primaryVoucherCode },
        update: {
          faceValue: new Prisma.Decimal(totalRefund),
          description: voucherObj.description,
        },
        create: {
          id: voucherId,
          code: primaryVoucherCode,
          voucherType: 'EXCHANGE',
          faceValue: new Prisma.Decimal(totalRefund),
          discount: new Prisma.Decimal(0),
          description: voucherObj.description,
          issuedByLocationId: ssLocation.id,
          sourceOrderId: targetOrderId,
          isActive: true,
          isRedeemed: false,
          createdAt: group.docDate,
          updatedAt: group.docDate,
        },
        select: { id: true },
      });
      const effectiveVoucherId = savedVoucher.id;
      voucherObj.id = effectiveVoucherId;

      await prisma.voucherLocation.upsert({
        where: { voucherId_locationId: { voucherId: effectiveVoucherId, locationId: ssLocation.id } },
        update: {},
        create: { voucherId: effectiveVoucherId, locationId: ssLocation.id },
      });

      await prisma.voucherTransaction.create({
        data: {
          voucherId: effectiveVoucherId,
          locationId: ssLocation.id,
          orderId: targetOrderId,
          action: 'ISSUED',
          amountUsed: new Prisma.Decimal(totalRefund),
          notes: `Auto-issued for Return ${returnDocNo} (Original Sale: ${group.originalSaleDoc})`,
          createdAt: group.docDate,
        },
      });

      // 2. Create PosReturn
      const savedReturn = await prisma.posReturn.upsert({
        where: { returnNumber: returnDocNo },
        update: {
          totalRefundAmount: new Prisma.Decimal(totalRefund),
          subtotalWost: new Prisma.Decimal(totalSubtotalWost),
          taxAmount: new Prisma.Decimal(totalTaxAmount),
          voucherId: effectiveVoucherId,
          salesOrderId: targetOrderId,
        },
        create: {
          id: posReturnId,
          returnNumber: returnDocNo,
          salesOrderId: targetOrderId,
          voucherId: effectiveVoucherId,
          locationId: ssLocation.id,
          returnType: 'RETURN',
          refundMode: 'VOUCHER',
          subtotalWost: new Prisma.Decimal(totalSubtotalWost),
          discountWost: new Prisma.Decimal(totalDiscountWost),
          taxAmount: new Prisma.Decimal(totalTaxAmount),
          totalRefundAmount: new Prisma.Decimal(totalRefund),
          reason: group.remarks || `Return ${returnDocNo} (Sale #${group.originalSaleDoc})`,
          createdAt: group.docDate,
          updatedAt: group.docDate,
        },
        select: { id: true },
      });
      const effectiveReturnId = savedReturn.id;

      // Clean old child return items/movements if updating
      await prisma.posReturnItem.deleteMany({ where: { posReturnId: effectiveReturnId } });
      await prisma.stockMovement.deleteMany({ where: { referenceId: effectiveReturnId, referenceType: 'POS_RETURN' } });
      await prisma.stockLedger.deleteMany({ where: { referenceId: effectiveReturnId, referenceType: 'POS_RETURN' } });

      // 3. Create PosReturnItems & Inbound StockLedger / StockMovement
      for (let idx = 0; idx < group.items.length; idx++) {
        const line = group.items[idx];
        const lineTaxPercent = line.valueExTax > 0 ? Math.round((line.salesTax / line.valueExTax) * 100 * 100) / 100 : 18;

        // Stub/find item in salesOrder
        let salesOrderItem = await prisma.salesOrderItem.findFirst({
          where: { salesOrderId: targetOrderId, itemId: line.item.id },
        });

        if (!salesOrderItem) {
          salesOrderItem = await prisma.salesOrderItem.create({
            data: {
              salesOrderId: targetOrderId,
              itemId: line.item.id,
              quantity: line.qty,
              unitPrice: new Prisma.Decimal(line.unitPrice),
              discountAmount: new Prisma.Decimal(line.discountAmount),
              taxAmount: new Prisma.Decimal(line.salesTax),
              lineTotal: new Prisma.Decimal(line.valueInclTax),
              createdAt: group.docDate,
            },
          });
        }

        await prisma.posReturnItem.create({
          data: {
            posReturnId: effectiveReturnId,
            salesOrderItemId: salesOrderItem.id,
            itemId: line.item.id,
            quantity: line.qty,
            originalUnitPrice: new Prisma.Decimal(line.unitPrice),
            originalPaidPerUnit: new Prisma.Decimal(line.valueInclTax / line.qty),
            refundPerUnit: new Prisma.Decimal(line.valueInclTax / line.qty),
            unitPriceWost: new Prisma.Decimal(line.priceWOT / line.qty),
            lineTotalWost: new Prisma.Decimal(line.priceWOT),
            discountWost: new Prisma.Decimal(line.discountAmount),
            taxPercent: new Prisma.Decimal(lineTaxPercent),
            taxAmount: new Prisma.Decimal(line.salesTax),
            lineTotal: new Prisma.Decimal(line.valueInclTax),
            reason: group.remarks || null,
            createdAt: group.docDate,
            updatedAt: group.docDate,
          },
        });

        // INBOUND Stock Ledger
        await prisma.stockLedger.create({
          data: {
            itemId: line.item.id,
            warehouseId,
            locationId: ssLocation.id,
            qty: line.qty, // positive = stock returned to store
            referenceType: 'POS_RETURN',
            referenceId: effectiveReturnId,
            movementType: MovementType.INBOUND,
            rate: new Prisma.Decimal(line.priceWOT / line.qty),
            unitCost: new Prisma.Decimal(Number(line.item.unitCost) || 0),
            createdAt: group.docDate,
          },
        });

        // Stock Movement (Idempotent upsert)
        const movementNo = `MV-RET-${returnDocNo}-${line.item.barCode || line.barCode}-${idx + 1}`;
        await prisma.stockMovement.upsert({
          where: { movementNo },
          update: {
            itemId: line.item.id,
            fromLocationId: null,
            toLocationId: ssLocation.id,
            quantity: line.qty,
            type: 'POS_RETURN',
            referenceType: 'POS_RETURN',
            referenceId: effectiveReturnId,
            movementDate: group.docDate,
            notes: `POS Return: ${returnDocNo} (Item: ${line.barCode})`,
            createdAt: group.docDate,
          },
          create: {
            movementNo,
            itemId: line.item.id,
            fromLocationId: null,
            toLocationId: ssLocation.id,
            quantity: line.qty,
            type: 'POS_RETURN',
            referenceType: 'POS_RETURN',
            referenceId: effectiveReturnId,
            movementDate: group.docDate,
            notes: `POS Return: ${returnDocNo} (Item: ${line.barCode})`,
            createdAt: group.docDate,
          },
        });

        // Record Inventory Delta for restoration (+qty)
        const currentDelta = inventoryDeltaMap.get(line.item.id) || 0;
        inventoryDeltaMap.set(line.item.id, currentDelta + line.qty);
        totalStockRestoredUnits += line.qty;
      }
    } else {
      totalStockRestoredUnits += group.items.reduce((s, it) => s + it.qty, 0);
      for (const line of group.items) {
        const currentDelta = inventoryDeltaMap.get(line.item.id) || 0;
        inventoryDeltaMap.set(line.item.id, currentDelta + line.qty);
      }
    }

    totalReturnsCreated++;
  }

  // Import Refund Voucher (SS1011-1-10-oct-refund-voucher.md)
  const refundRawLines = fs.readFileSync(fileRefundVouchers, 'utf-8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('|-') && !l.startsWith('| ---'));
  for (let i = 1; i < refundRawLines.length; i++) {
    const p = parseMarkdownLine(refundRawLines[i]);
    const refCode = p[2] || '';
    if (!refCode) continue;
    const docDate = parseCustomDate(p[3]) || new Date('2026-10-08T14:08:00.000Z');
    const origSale = p[4] || '';
    const totalNet = parseFloat(p[6] || '0') || 0;
    const refVoucherId = isDryRun ? `dry-ref-${refCode}` : crypto.randomUUID();

    console.log(`  💵 Registering Refund Voucher: [${refCode}] Amount: PKR ${totalNet.toLocaleString()} against Sale: ${origSale}`);

    if (!isDryRun) {
      const savedRef = await prisma.voucher.upsert({
        where: { code: refCode },
        update: { faceValue: new Prisma.Decimal(totalNet) },
        create: {
          id: refVoucherId,
          code: refCode,
          voucherType: 'REFUND',
          faceValue: new Prisma.Decimal(totalNet),
          discount: new Prisma.Decimal(0),
          description: `Refund Voucher - Cash refunded to customer against ${origSale}`,
          issuedByLocationId: ssLocation.id,
          isActive: false, // REFUND vouchers are non-redeemable cash record vouchers
          isRedeemed: true,
          createdAt: docDate,
          updatedAt: docDate,
        },
        select: { id: true },
      });
      const effectiveRefId = savedRef.id;

      await prisma.voucherLocation.upsert({
        where: { voucherId_locationId: { voucherId: effectiveRefId, locationId: ssLocation.id } },
        update: {},
        create: { voucherId: effectiveRefId, locationId: ssLocation.id },
      });
    }
  }

  console.log(`  ✔ Processed ${totalReturnsCreated} return memos and queued restoration for ${totalStockRestoredUnits} stock units.`);

  // =========================================================================
  // PHASE 3: IMPORT SALES ORDERS, REDEEM VOUCHERS + DECREMENT INVENTORY
  // =========================================================================
  console.log(`\n----------------------------------------------------------------------`);
  console.log(`🛒 [PHASE 3] Importing Sales Orders & Deducting Stock...`);
  console.log(`----------------------------------------------------------------------`);

  interface ParsedSaleGroup {
    docNo: string;
    docDate: Date;
    subType: string;
    shopifyOrder: string;
    posId: string;
    fbrInvoiceNumber: string;
    fkExchangeVoucherNumber: string;
    remarks: string;
    items: {
      barCode: string;
      item: any;
      qty: number;
      unitPrice: number;
      priceWOT: number;
      totalPriceWOT: number;
      discountAmount: number;
      valueExSalesTax: number;
      salesTax: number;
      valueInclSalesTax: number;
      discountRateGiven: number;
      cashSale: number;
      cardSale: number;
      hbl: number;
      exchangeVoucherAmount: number;
      giftVoucherAmount: number;
      creditVoucherIssuedAmount: number;
    }[];
  }

  const salesGroups = new Map<string, ParsedSaleGroup>();

  for (let i = 1; i < salesRawLines.length; i++) {
    const p = parseMarkdownLine(salesRawLines[i]);
    if (p.length < 10) continue;

    const docNo = (p[2] || '').trim();
    if (!docNo) continue;

    const docDate = parseCustomDate(p[3]) || new Date('2026-10-01T00:00:00.000Z');
    const subType = p[4] || 'Sale';
    const shopifyOrder = (p[5] || '').trim();
    const barCode = (p[6] || '').replace(/['"]/g, '').trim();
    const item = itemCacheByBarcode.get(barCode) || { id: 'fallback', barCode, unitPrice: 0, unitCost: 0 };
    const qty = parseFloat(p[7] || '1') || 1;
    const unitPrice = parseFloat(p[8] || '0') || 0;
    const priceWOT = parseFloat(p[9] || '0') || unitPrice * 0.8;
    const totalPriceWOT = parseFloat(p[10] || '0') || priceWOT * qty;
    const discountAmount = parseFloat(p[11] || '0') || 0;
    const valueExSalesTax = parseFloat(p[12] || '0') || totalPriceWOT - discountAmount;
    const salesTax = parseFloat(p[15] || '0') || 0;
    const valueInclSalesTax = parseFloat(p[16] || '0') || valueExSalesTax + salesTax;
    const exchangeVoucherAmount = parseFloat(p[17] || '0') || 0;
    const giftVoucherAmount = parseFloat(p[18] || '0') || 0;
    const cashSale = parseFloat(p[19] || '0') || 0;
    const cardSale = parseFloat(p[20] || '0') || 0;
    const hbl = parseFloat(p[21] || '0') || 0;
    const creditVoucherIssuedAmount = parseFloat(p[22] || '0') || 0;
    const posId = p[23] || '127340';
    const fbrInvoiceNumber = (p[24] || '').replace(/['"]/g, '').trim();
    const fkExchangeVoucherNumber = (p[25] || '').replace(/['"]/g, '').trim();
    const discountRateGiven = parseFloat(p[26] || '0') || 0;
    const remarks = p[27] || '';

    if (!salesGroups.has(docNo)) {
      salesGroups.set(docNo, {
        docNo,
        docDate,
        subType,
        shopifyOrder,
        posId,
        fbrInvoiceNumber,
        fkExchangeVoucherNumber,
        remarks,
        items: [],
      });
    }

    salesGroups.get(docNo)!.items.push({
      barCode,
      item,
      qty,
      unitPrice,
      priceWOT,
      totalPriceWOT,
      discountAmount,
      valueExSalesTax,
      salesTax,
      valueInclSalesTax,
      discountRateGiven,
      cashSale,
      cardSale,
      hbl,
      exchangeVoucherAmount,
      giftVoucherAmount,
      creditVoucherIssuedAmount,
    });
  }

  console.log(`  Found ${salesGroups.size} distinct Sales Orders (SI-SSONLINE27-04603 to SI-04963).`);

  let salesOrdersCreated = 0;
  let totalSalesRevenue = 0;
  let totalStockDecrementedUnits = 0;
  let totalVouchersRedeemed = 0;

  for (const [docNo, group] of salesGroups.entries()) {
    const subtotal = group.items.reduce((sum, it) => sum + it.totalPriceWOT, 0);
    const discountAmount = group.items.reduce((sum, it) => sum + it.discountAmount, 0);
    const taxAmount = group.items.reduce((sum, it) => sum + it.salesTax, 0);
    const grandTotal = group.items.reduce((sum, it) => sum + it.valueInclSalesTax, 0);

    const cashSale = group.items.reduce((sum, it) => sum + it.cashSale, 0);
    const cardSale = group.items.reduce((sum, it) => sum + it.cardSale, 0);
    const hbl = group.items.reduce((sum, it) => sum + it.hbl, 0);
    const exchangeVoucherAmount = group.items.reduce((sum, it) => sum + it.exchangeVoucherAmount, 0);
    const giftVoucherAmount = group.items.reduce((sum, it) => sum + it.giftVoucherAmount, 0);
    const totalVoucherAmount = exchangeVoucherAmount + giftVoucherAmount;

    totalSalesRevenue += grandTotal;

    const activeTenders = [cashSale > 0, (cardSale > 0 || hbl > 0), totalVoucherAmount > 0].filter(Boolean).length;
    let paymentMethod = 'cash';
    if (activeTenders > 1) paymentMethod = 'split';
    else if (cardSale > 0 || hbl > 0) paymentMethod = 'card';
    else if (totalVoucherAmount > 0) paymentMethod = 'voucher';

    const notesParts: string[] = [`DocNo: ${docNo}`, `POS ID: ${group.posId}`];
    if (group.shopifyOrder) notesParts.push(`Shopify: ${group.shopifyOrder}`);
    if (group.fkExchangeVoucherNumber) notesParts.push(`ExVoucherRef: ${group.fkExchangeVoucherNumber}`);
    if (group.remarks && group.remarks !== ';') notesParts.push(`Remarks: ${group.remarks}`);
    if (cashSale > 0) notesParts.push(`[Cash]: ${cashSale.toFixed(2)}`);
    if (cardSale > 0 || hbl > 0) notesParts.push(`[Card HBL]: ${(cardSale || hbl).toFixed(2)}`);
    if (exchangeVoucherAmount > 0) notesParts.push(`[Exchange Voucher]: ${exchangeVoucherAmount.toFixed(2)}`);
    if (giftVoucherAmount > 0) notesParts.push(`[Gift Voucher]: ${giftVoucherAmount.toFixed(2)}`);

    const orderId = isDryRun ? `dry-order-${docNo}` : crypto.randomUUID();

    if (!isDryRun) {
      // 1. Create SalesOrder
      const savedOrder = await prisma.salesOrder.upsert({
        where: { orderNumber: docNo },
        update: {
          subtotal: new Prisma.Decimal(subtotal),
          discountAmount: new Prisma.Decimal(discountAmount),
          taxAmount: new Prisma.Decimal(taxAmount),
          grandTotal: new Prisma.Decimal(grandTotal),
          cashAmount: cashSale > 0 ? new Prisma.Decimal(cashSale) : null,
          cardAmount: (cardSale || hbl) > 0 ? new Prisma.Decimal(cardSale || hbl) : null,
          voucherAmount: totalVoucherAmount > 0 ? new Prisma.Decimal(totalVoucherAmount) : null,
          notes: notesParts.join(' | '),
        },
        create: {
          id: orderId,
          orderNumber: docNo,
          locationId: ssLocation.id,
          posId: group.posId,
          terminalId: group.posId,
          merchantId: (cardSale > 0 || hbl > 0) ? hblMerchant?.id || null : null,
          subtotal: new Prisma.Decimal(subtotal),
          discountAmount: new Prisma.Decimal(discountAmount),
          taxAmount: new Prisma.Decimal(taxAmount),
          grandTotal: new Prisma.Decimal(grandTotal),
          paymentMethod,
          tenderType: activeTenders > 1 ? 'split' : paymentMethod,
          paymentStatus: 'paid',
          status: 'completed',
          notes: notesParts.join(' | '),
          fbrInvoiceNumber: group.fbrInvoiceNumber || null,
          fbrStatus: group.fbrInvoiceNumber ? 'COMPLETED' : 'PENDING',
          cashAmount: cashSale > 0 ? new Prisma.Decimal(cashSale) : null,
          cardAmount: (cardSale || hbl) > 0 ? new Prisma.Decimal(cardSale || hbl) : null,
          voucherAmount: totalVoucherAmount > 0 ? new Prisma.Decimal(totalVoucherAmount) : null,
          createdAt: group.docDate,
          updatedAt: group.docDate,
        },
        select: { id: true },
      });
      const effectiveOrderId = savedOrder.id;

      // Clean old child records if re-running
      await prisma.salesOrderItem.deleteMany({ where: { salesOrderId: effectiveOrderId } });
      await prisma.stockMovement.deleteMany({ where: { referenceId: effectiveOrderId, referenceType: 'POS_SALE' } });
      await prisma.stockLedger.deleteMany({ where: { referenceId: effectiveOrderId, referenceType: 'POS_SALE' } });
      await prisma.voucherRedemption.deleteMany({ where: { orderId: effectiveOrderId } });

      // 2. Create SalesOrderItems & Outbound StockLedger / StockMovement
      for (let idx = 0; idx < group.items.length; idx++) {
        const line = group.items[idx];
        const lineTaxPercent = line.valueExSalesTax > 0 ? Math.round((line.salesTax / line.valueExSalesTax) * 100 * 100) / 100 : 18;

        await prisma.salesOrderItem.create({
          data: {
            salesOrderId: effectiveOrderId,
            itemId: line.item.id,
            quantity: line.qty,
            unitPrice: new Prisma.Decimal(line.unitPrice),
            discountPercent: new Prisma.Decimal(line.discountRateGiven),
            discountAmount: new Prisma.Decimal(line.discountAmount),
            taxPercent: new Prisma.Decimal(lineTaxPercent),
            taxAmount: new Prisma.Decimal(line.salesTax),
            lineTotal: new Prisma.Decimal(line.valueInclSalesTax),
            createdAt: group.docDate,
          },
        });

        // OUTBOUND Stock Ledger
        await prisma.stockLedger.create({
          data: {
            itemId: line.item.id,
            warehouseId,
            locationId: ssLocation.id,
            qty: -line.qty, // negative = stock deducted upon sale
            referenceType: 'POS_SALE',
            referenceId: effectiveOrderId,
            movementType: MovementType.OUTBOUND,
            rate: new Prisma.Decimal(line.priceWOT),
            unitCost: new Prisma.Decimal(Number(line.item.unitCost) || 0),
            createdAt: group.docDate,
          },
        });

        // Stock Movement (Idempotent upsert)
        const movementNo = `MV-SALE-${docNo}-${line.item.barCode || line.barCode}-${idx + 1}`;
        await prisma.stockMovement.upsert({
          where: { movementNo },
          update: {
            itemId: line.item.id,
            fromLocationId: ssLocation.id,
            toLocationId: null,
            quantity: line.qty,
            type: 'POS_SALE',
            referenceType: 'POS_SALE',
            referenceId: effectiveOrderId,
            movementDate: group.docDate,
            notes: `POS Sale: ${docNo} (${line.barCode})`,
            createdAt: group.docDate,
          },
          create: {
            movementNo,
            itemId: line.item.id,
            fromLocationId: ssLocation.id,
            toLocationId: null,
            quantity: line.qty,
            type: 'POS_SALE',
            referenceType: 'POS_SALE',
            referenceId: effectiveOrderId,
            movementDate: group.docDate,
            notes: `POS Sale: ${docNo} (${line.barCode})`,
            createdAt: group.docDate,
          },
        });

        // Record Inventory Delta for deduction (-qty)
        const currentDelta = inventoryDeltaMap.get(line.item.id) || 0;
        inventoryDeltaMap.set(line.item.id, currentDelta - line.qty);
        totalStockDecrementedUnits += line.qty;
      }

      // 3. Link Exchange Voucher Redemption
      if (exchangeVoucherAmount > 0 || group.fkExchangeVoucherNumber) {
        const targetVoucherKey = group.fkExchangeVoucherNumber.trim();
        const matchedVoucher = exchangeVoucherByCode.get(targetVoucherKey) ||
          exchangeVoucherByCode.get(targetVoucherKey.replace(/^EXC-/, '')) ||
          null;

        if (matchedVoucher) {
          await prisma.voucher.update({
            where: { id: matchedVoucher.id },
            data: { isRedeemed: true },
          });

          await prisma.voucherRedemption.create({
            data: {
              voucherId: matchedVoucher.id,
              orderId: effectiveOrderId,
              amountUsed: new Prisma.Decimal(exchangeVoucherAmount || matchedVoucher.faceValue),
              createdAt: group.docDate,
            },
          });

          await prisma.voucherTransaction.create({
            data: {
              voucherId: matchedVoucher.id,
              orderId: effectiveOrderId,
              locationId: ssLocation.id,
              action: 'REDEEMED',
              amountUsed: new Prisma.Decimal(exchangeVoucherAmount || matchedVoucher.faceValue),
              notes: `Redeemed in Sales Order ${docNo}`,
              createdAt: group.docDate,
            },
          });
          totalVouchersRedeemed++;
        }
      }

      // 4. Link Gift Voucher Redemption
      if (giftVoucherAmount > 0) {
        // Look up by amount (e.g. 28500 -> voucher 30, 20400 -> voucher 31)
        const matchedGift = giftVoucherMap.get(String(Math.round(giftVoucherAmount)));
        if (matchedGift) {
          await prisma.voucher.update({
            where: { id: matchedGift.id },
            data: { isRedeemed: true },
          });

          await prisma.voucherRedemption.create({
            data: {
              voucherId: matchedGift.id,
              orderId: effectiveOrderId,
              amountUsed: new Prisma.Decimal(giftVoucherAmount),
              createdAt: group.docDate,
            },
          });

          await prisma.voucherTransaction.create({
            data: {
              voucherId: matchedGift.id,
              orderId: effectiveOrderId,
              locationId: ssLocation.id,
              action: 'REDEEMED',
              amountUsed: new Prisma.Decimal(giftVoucherAmount),
              notes: `Redeemed in Sales Order ${docNo}`,
              createdAt: group.docDate,
            },
          });
          totalVouchersRedeemed++;
        }
      }
    } else {
      totalStockDecrementedUnits += group.items.reduce((s, it) => s + it.qty, 0);
      for (const line of group.items) {
        const currentDelta = inventoryDeltaMap.get(line.item.id) || 0;
        inventoryDeltaMap.set(line.item.id, currentDelta - line.qty);
      }
      if (exchangeVoucherAmount > 0 || giftVoucherAmount > 0) totalVouchersRedeemed++;
    }

    salesOrdersCreated++;
  }

  // =========================================================================
  // PHASE 4: UPDATE INVENTORYITEM BALANCES (CONSOLIDATED SYNC)
  // =========================================================================
  console.log(`\n----------------------------------------------------------------------`);
  console.log(`📦 [PHASE 4] Consolidating and Updating InventoryItem Balances...`);
  console.log(`----------------------------------------------------------------------`);

  console.log(`  Calculated net inventory adjustments across ${inventoryDeltaMap.size} distinct items.`);

  if (!isDryRun) {
    let updatedInvCount = 0;
    let createdInvCount = 0;

    for (const [itemId, netDelta] of inventoryDeltaMap.entries()) {
      if (netDelta === 0) continue;

      const existingInv = await prisma.inventoryItem.findFirst({
        where: {
          locationId: ssLocation.id,
          itemId,
          status: 'AVAILABLE',
        },
        select: { id: true, quantity: true },
      });

      if (existingInv) {
        await prisma.inventoryItem.update({
          where: { id: existingInv.id },
          data: {
            quantity: {
              increment: netDelta, // positive increments stock (returns), negative decrements stock (sales)
            },
          },
        });
        updatedInvCount++;
      } else {
        await prisma.inventoryItem.create({
          data: {
            locationId: ssLocation.id,
            warehouseId,
            itemId,
            quantity: netDelta,
            status: 'AVAILABLE',
          },
        });
        createdInvCount++;
      }
    }

    console.log(`  ✔ Successfully synced InventoryItem table: ${updatedInvCount} records updated, ${createdInvCount} records initialized.`);
  } else {
    console.log(`  ✔ [DRY RUN] Would update/initialize ${inventoryDeltaMap.size} InventoryItem records.`);
  }

  // =========================================================================
  // FINAL RECONCILIATION SUMMARY
  // =========================================================================
  console.log(`\n======================================================================`);
  console.log(`✨ ${isDryRun ? '[DRY RUN COMPLETED - NO DATA MODIFIED]' : '[OCTOBER DATA IMPORT COMPLETED SUCCESSFULLY]'}`);
  console.log(`======================================================================`);
  console.log(` 📍 Location                        : ${ssLocation.name} (${ssLocation.code})`);
  console.log(` 🏬 Warehouse                       : ${defaultWarehouse.name} (${defaultWarehouse.code})`);
  console.log(` 🎁 Gift Vouchers Imported           : ${giftVouchersCreated}`);
  console.log(` 🔄 PosReturns Imported             : ${totalReturnsCreated}`);
  console.log(` 💵 Refund Vouchers Registered      : 1 (REF-SSONLINE27-00873)`);
  console.log(` 🛒 Sales Orders Created            : ${salesOrdersCreated}`);
  console.log(` 💰 Total Sales Revenue (PKR)       : ${totalSalesRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(` 📦 Stock Restored (Returns)        : +${totalStockRestoredUnits} units`);
  console.log(` 📉 Stock Decremented (Sales)       : -${totalStockDecrementedUnits} units`);
  console.log(` 📊 Net Inventory Adjustment        : ${totalStockRestoredUnits - totalStockDecrementedUnits} units`);
  console.log(` 🎟️ Total Vouchers Redeemed Linked  : ${totalVouchersRedeemed}`);
  console.log(`======================================================================\n`);
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('-d');
  const cleanOctober = process.argv.includes('--clean-october') || process.argv.includes('--wipe');

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (managementUrl && masterKey) {
    const pool = new Pool({ connectionString: managementUrl });
    const adapter = new PrismaPg(pool);
    const management = new ManagementClient({ adapter } as any);

    let companies: any[] = [];
    try {
      companies = await management.company.findMany({ where: { status: 'active' } });
    } catch (err: any) {
      console.warn(`Management client connection warning: ${err.message}`);
    } finally {
      await management.$disconnect();
      await pool.end();
    }

    if (companies.length > 0) {
      for (const company of companies) {
        console.log(`\n🏢 Found Tenant: ${company.name} (${company.dbName})`);
        let connectionString = company.dbUrl;
        if (company.dbPassword) {
          try {
            const dec = decrypt(company.dbPassword, masterKey);
            if (dec) {
              connectionString = `postgresql://${company.dbUser}:${encodeURIComponent(dec)}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
            }
          } catch {}
        }
        if (!connectionString) {
          connectionString = `postgresql://${company.dbUser || 'postgres'}:root@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
        }

        const tenantPool = new Pool({ connectionString });
        const tenantAdapter = new PrismaPg(tenantPool);
        const tenantPrisma = new PrismaClient({ adapter: tenantAdapter as any });

        try {
          await tenantPrisma.$connect();
          await processSsOnlineOctober(tenantPrisma, isDryRun, cleanOctober);
        } finally {
          await tenantPrisma.$disconnect();
          await tenantPool.end();
        }
      }
      return;
    }
  }

  // Fallback to DATABASE_URL
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL is missing in environment.');
  }

  const pool = new Pool({ connectionString: dbUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter: adapter as any });

  try {
    await prisma.$connect();
    await processSsOnlineOctober(prisma, isDryRun, cleanOctober);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ Error executing SS-ONLINE October import script:', err);
  process.exit(1);
});
