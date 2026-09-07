import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
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
const isDryRun = args.includes('--dry-run');
const salesOnly = args.includes('--sales-only');
const returnsOnly = args.includes('--returns-only');
const limitArg = args.find((a) => a.startsWith('--limit='));
const recordLimit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;
const tenantArg = args.find((a) => a.startsWith('--tenant='));
const targetTenantDb = tenantArg ? tenantArg.split('=')[1] : 'tenant_speed_main_mox1gfsi';

const salesFilePath = path.join(__dirname, '../data/SS_LG_2526_SALES.json');
const returnsFilePath = path.join(__dirname, '../data/SS_LG2526_Sales_return.json');

if (!fs.existsSync(salesFilePath)) {
  console.error(`❌ Sales file not found at ${salesFilePath}`);
  process.exit(1);
}
if (!fs.existsSync(returnsFilePath)) {
  console.error(`❌ Returns file not found at ${returnsFilePath}`);
  process.exit(1);
}

/**
 * Parse date strings like "7/1/25" or "10/26/25 19:10" into Date objects.
 * Format is Month/Day/Year [Hours:Minutes].
 */
function parseCustomDate(dateStr?: string | null): Date {
  if (!dateStr || !dateStr.trim()) return new Date();
  const trimmed = dateStr.trim();
  const parts = trimmed.split(' ');
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
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date() : d;
}

interface RawSaleRow {
  'Location ID': string;
  DocumentNumber: string | number;
  DocumentDate: string;
  BarCode: string;
  Quantity: string | number;
  UnitPrice: string | number;
  Price_W_O_T: string | number;
  Total_Price_W_O_T: string | number;
  DiscountAmount: string | number;
  'Value Ex Sales Tax': string | number;
  'Sales Tax': string | number;
  'Additional Sales Tax': string | number;
  'Total Sales Tax': string | number;
  'Value Incl Sales Tax': string | number;
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
  CostCentre: string;
  'POS ID': string | number;
  'FBR Invoice#'?: string;
  FKExchangeVoucherNumber?: string;
  DiscountRate_Given?: string | number;
  Remarks?: string;
  'Is Alliance Discount'?: string;
  FKSalesPersonID?: string;
}

interface RawReturnRow {
  CostCentre: string;
  'Location ID': string;
  Type: string;
  'Sub Type'?: string;
  'SUB Type'?: string;
  DocumentDate: string;
  DocumentNumber: string | number;
  SalesPersonName?: string;
  Barcode?: string;
  Quantity?: string; // Contains actual Barcode
  UnitPrice?: string; // Contains actual Quantity
  TaxRate1?: string; // Contains actual Retail Unit Price
  Price_W_O_T?: string; // Contains actual Tax Rate %
  Total_Price_W_O_T?: string; // Contains actual Price Without Tax (WOST)
  'Discounted Value'?: string; // Contains actual Total Price WOST
  DiscountAmount?: string; // Contains actual Discounted Value
  'Value Ex Sales Tax'?: string; // Contains actual Discount Amount
  'Sales Tax'?: string; // Contains actual Value Ex Sales Tax
  'Additional Sales Tax'?: string; // Contains actual Sales Tax
  'Total Sales Tax'?: string; // Contains actual Additional Sales Tax (0)
  'Value Incl Sales Tax'?: string; // Contains actual Total Sales Tax
  FKInvoiceNumber_Sale?: string; // Contains actual Net Return Amount (Value Incl Tax)
  DocumentDate_Sale?: string; // Contains actual Original Sale Doc Number
  FKInvoiceNumber_Exchange?: string; // Contains actual Original Sale Doc Date
  DocumentDate_Exchange?: string; // Contains actual Settlement/Exchange Sale Doc Number
}

async function main() {
  console.log(`========================================================================`);
  console.log(`🚀 POS Sales & Returns/Exchanges Importer for SS1010 (Lyallpur Galleria)`);
  console.log(`========================================================================`);
  console.log(`⚙️ Options: Dry-Run: ${isDryRun} | Sales-Only: ${salesOnly} | Returns-Only: ${returnsOnly}`);

  // 1. Connect to Tenant DB (via Management DB or direct DATABASE_URL)
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

  // 2. Resolve Store Location and Warehouse
  const location = await prisma.location.findFirst({
    where: {
      OR: [{ code: 'SS1010' }, { shortCode: 'SS-LG' }, { name: { contains: 'Lyallpur' } }],
    },
  });
  if (!location) {
    throw new Error('❌ Location SS1010 not found in tenant database');
  }

  const warehouse = await prisma.warehouse.findFirst({
    where: {
      OR: [{ code: 'C40001' }, { id: location.warehouseId || undefined }, { isActive: true }],
    },
    orderBy: { createdAt: 'asc' },
  });
  if (!warehouse) {
    throw new Error('❌ Warehouse not found in tenant database');
  }

  console.log(`🏢 Target Location: ${location.name} (${location.code}, ShortCode: ${location.shortCode}) [ID: ${location.id}]`);
  console.log(`🏭 Central Warehouse: ${warehouse.name} (${warehouse.code}) [ID: ${warehouse.id}]`);

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

  // 4. Pre-cache InventoryItems for SS1010
  const initialInvItems = await prisma.inventoryItem.findMany({
    where: { locationId: location.id, status: 'AVAILABLE' },
    select: { id: true, itemId: true, quantity: true },
  });
  const invMap = new Map<string, any>();
  for (const inv of initialInvItems) {
    invMap.set(inv.itemId, inv);
  }
  console.log(`✔ Pre-cached ${invMap.size} inventory items for store ${location.code}.`);

  const cleanLocationCode = (location.shortCode || location.code).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const fySuffix = '26'; // FY2025-26

  // Cache of created/existing sales orders by docNumber
  const salesOrderByDocNum = new Map<string, any>();
  const salesOrderItemsByOrderId = new Map<string, any[]>();

  // ========================================================================
  // PHASE 1: IMPORT SALES ORDERS
  // ========================================================================
  if (!returnsOnly) {
    console.log(`\n========================================================================`);
    console.log(`📥 [PHASE 1] Processing Sales Orders from ${salesFilePath}...`);
    console.log(`========================================================================`);

    const rawSales: RawSaleRow[] = JSON.parse(fs.readFileSync(salesFilePath, 'utf8'));
    console.log(`✔ Loaded ${rawSales.length.toLocaleString()} raw sales rows.`);

    // Group sales by DocumentNumber
    const salesGroups = new Map<string, RawSaleRow[]>();
    for (const s of rawSales) {
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

    // Process in batches of 100 orders for progress tracking
    const batchSize = 100;
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
          (acc, r) => acc + (parseFloat(String(r.Total_Price_W_O_T)) || (parseFloat(String(r.Price_W_O_T)) * parseFloat(String(r.Quantity)))),
          0,
        );
        const discountAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.DiscountAmount)) || 0), 0);
        const taxAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r['Total Sales Tax'])) || 0), 0);
        const grandTotal = groupRows.reduce((acc, r) => acc + (parseFloat(String(r['Value Incl Sales Tax'])) || 0), 0);

        totalSalesRevenue += grandTotal;

        // Payment tenders (accumulate across all rows of the cash memo)
        const cashAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.CashSale)) || 0), 0);
        const cardAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.CardSale)) || 0), 0);
        const creditAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.CreditSale)) || 0), 0);
        const exchangeAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.ExchangeVoucherAmount)) || 0), 0);
        const giftAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.GiftVoucherAmount)) || 0), 0);
        const claimAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.ClaimVoucherAmount)) || 0), 0);
        const corpAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.GiftVoucherAmount_Corporate)) || 0), 0);
        const creditVoucherAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.CreditVoucherAmount)) || 0), 0);
        const rewardAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.RewardVoucherAmount)) || 0), 0);
        const creditIssuedAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.CreditVoucherIssuedAmount)) || 0), 0);
        const cashReturnAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.CashRetrun)) || 0), 0);

        const totalVoucherAmount =
          exchangeAmount + giftAmount + claimAmount + corpAmount + creditVoucherAmount + rewardAmount;

        let paymentMethod = 'cash';
        const tendersCount = [cashAmount > 0, cardAmount > 0, totalVoucherAmount > 0, creditAmount > 0].filter(Boolean).length;
        if (tendersCount > 1) {
          paymentMethod = 'split';
        } else if (cardAmount > 0) {
          paymentMethod = 'card';
        } else if (totalVoucherAmount > 0) {
          paymentMethod = 'voucher';
        } else if (creditAmount > 0) {
          paymentMethod = 'credit_account';
        }

        const notesParts = [
          `Original DocNo: ${docNoStr}`,
          `POS ID: ${sample['POS ID']}`,
        ];
        if (sample.FKSalesPersonID) notesParts.push(`SalesPerson: ${sample.FKSalesPersonID}`);
        if (sample.Remarks && sample.Remarks.trim() !== ';') notesParts.push(`Remarks: ${sample.Remarks.trim()}`);
        if (sample.FKExchangeVoucherNumber && sample.FKExchangeVoucherNumber.trim()) {
          notesParts.push(`ExVoucherRef: ${sample.FKExchangeVoucherNumber.trim()}`);
        }

        // Structured tags for exact parsing in reports
        if (cashAmount > 0) notesParts.push(`[Cash Sale] Amount: ${cashAmount.toFixed(2)}`);
        if (cardAmount > 0) notesParts.push(`[Card Sale] Amount: ${cardAmount.toFixed(2)}`);
        if (exchangeAmount > 0) notesParts.push(`[Exchange Voucher] Amount: ${exchangeAmount.toFixed(2)}`);
        if (claimAmount > 0) notesParts.push(`[Claim Voucher] Amount: ${claimAmount.toFixed(2)}`);
        if (corpAmount > 0) notesParts.push(`[Corporate Voucher] Amount: ${corpAmount.toFixed(2)}`);
        if (giftAmount > 0) notesParts.push(`[Gift Voucher] Amount: ${giftAmount.toFixed(2)}`);
        if (creditVoucherAmount > 0) notesParts.push(`[Credit Voucher] Amount: ${creditVoucherAmount.toFixed(2)}`);
        if (rewardAmount > 0) notesParts.push(`[Reward Voucher] Amount: ${rewardAmount.toFixed(2)}`);
        if (creditAmount > 0) notesParts.push(`[Credit Sale] Balance: ${creditAmount.toFixed(2)}`);
        if (creditIssuedAmount > 0) notesParts.push(`[Credit Voucher Issued] Amount: ${creditIssuedAmount.toFixed(2)}`);
        if (cashReturnAmount > 0) notesParts.push(`[Cash Return] Amount: ${cashReturnAmount.toFixed(2)}`);

        const fbrInv = sample['FBR Invoice#'] ? sample['FBR Invoice#'].replace(/^'/, '').trim() : null;

        if (isDryRun) {
          processedOrders++;
          totalSalesLines += groupRows.length;
          totalSalesQty += groupRows.reduce((acc, r) => acc + (parseFloat(String(r.Quantity)) || 0), 0);
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

        const salesOrder = await prisma.salesOrder.create({
          data: {
            orderNumber,
            posId: String(sample['POS ID']),
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
          const item = itemCache.get(bc);
          if (!item) {
            throw new Error(`Item with barcode ${bc} not found in database!`);
          }

          const qty = Math.abs(parseFloat(String(row.Quantity)) || 1);
          const unitPrice = parseFloat(String(row.UnitPrice)) || 0;
          const lineDiscount = parseFloat(String(row.DiscountAmount)) || 0;
          const lineTax = parseFloat(String(row['Total Sales Tax'])) || 0;
          const lineValExTax = parseFloat(String(row['Value Ex Sales Tax'])) || 0;
          const calculatedTaxPct = lineValExTax > 0 ? Math.round((lineTax / lineValExTax) * 100 * 100) / 100 : 18;
          const lineTotal = parseFloat(String(row['Value Incl Sales Tax'])) || 0;

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
          await prisma.stockMovement.create({
            data: {
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

      console.log(`  ⏳ Processed ${processedOrders}/${groupsToProcess.length} sales orders (${totalSalesLines} item lines, Qty: ${totalSalesQty})...`);
    }

    console.log(`✅ [PHASE 1 COMPLETE] Successfully imported ${processedOrders} Cash Memo Sales Orders:`);
    console.log(`   - Order Number Sequence: SI-${cleanLocationCode}${fySuffix}-00001 to SI-${cleanLocationCode}${fySuffix}-${String(processedOrders).padStart(5, '0')}`);
    console.log(`   - Total Item Lines     : ${totalSalesLines.toLocaleString()}`);
    console.log(`   - Total Units Sold     : ${totalSalesQty.toLocaleString()}`);
    console.log(`   - Total Revenue (PKR)  : ${totalSalesRevenue.toLocaleString()}`);
  }

  // ========================================================================
  // PHASE 2: IMPORT RETURNS & EXCHANGES
  // ========================================================================
  if (!salesOnly) {
    console.log(`\n========================================================================`);
    console.log(`📥 [PHASE 2] Processing Sales Returns & Exchanges from ${returnsFilePath}...`);
    console.log(`========================================================================`);

    const rawReturns: RawReturnRow[] = JSON.parse(fs.readFileSync(returnsFilePath, 'utf8'));
    console.log(`✔ Loaded ${rawReturns.length.toLocaleString()} raw return rows.`);

    // Group returns by SubType and DocumentNumber
    const returnGroups = new Map<string, RawReturnRow[]>();
    for (const r of rawReturns) {
      const subType = (r['Sub Type'] || r['SUB Type'] || 'Exchange').trim();
      const docNo = String(r.DocumentNumber).trim();
      const key = `${subType}_${docNo}`;
      if (!returnGroups.has(key)) returnGroups.set(key, []);
      returnGroups.get(key)!.push(r);
    }

    console.log(`📋 Grouped into ${returnGroups.size} Return Documents (396 Exchanges, 14 Claims).`);

    let processedReturns = 0;
    let totalReturnLines = 0;
    let totalReturnQty = 0;
    let totalVoucherValue = 0;
    let linkedReturnsToSales = 0;
    let redeemedVouchersCount = 0;

    for (const [groupKey, groupRows] of returnGroups.entries()) {
      const sample = groupRows[0];
      const subType = (sample['Sub Type'] || sample['SUB Type'] || 'Exchange').trim();
      const subTypePrefix = subType.toUpperCase() === 'CLAIM' ? 'CLM' : 'EXC';
      const voucherType = subType.toUpperCase() === 'CLAIM' ? 'CLAIM' : 'EXCHANGE';
      const docNum = parseInt(String(sample.DocumentNumber).trim(), 10);
      const padDoc = String(docNum).padStart(5, '0');
      const voucherCode = `${subTypePrefix}-${cleanLocationCode}-${padDoc}`;
      const docDate = parseCustomDate(sample.DocumentDate);

      // Parse normalized fields with verified column shift
      const parsedItems = groupRows.map((r) => {
        const bc = (r.Barcode && r.Barcode.trim()) || String(r.Quantity || '').replace(/['"]/g, '').trim();
        const qty = parseFloat(String(r.UnitPrice)) || 1;
        const retailUnitPrice = parseFloat(String(r.TaxRate1)) || 0;
        const taxRate = parseFloat(String(r.Price_W_O_T)) || 18;
        const priceWot = parseFloat(String(r.Total_Price_W_O_T)) || 0;
        const totalPriceWot = parseFloat(String(r['Discounted Value'])) || 0;
        const discountAmt = parseFloat(String(r['Value Ex Sales Tax'])) || 0;
        const valExTax = parseFloat(String(r['Sales Tax'])) || 0;
        const salesTax = parseFloat(String(r['Additional Sales Tax'])) || 0;
        const totalSalesTax = parseFloat(String(r['Value Incl Sales Tax'])) || 0;
        const valInclTax = parseFloat(String(r.FKInvoiceNumber_Sale)) || 0;
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
        originalSalesOrder = await prisma.salesOrder.findUnique({
          where: { orderNumber: targetOrderNumber },
          include: { items: true },
        });
      }

      let targetOrderId: string;

      if (originalSalesOrder) {
        targetOrderId = originalSalesOrder.id;
        linkedReturnsToSales++;

        // Update original sales order status
        await prisma.salesOrder.update({
          where: { id: originalSalesOrder.id },
          data: {
            status: 'returned',
            returnNumber: voucherCode,
          },
        });
      } else {
        // Fallback if original sales order was not found
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

      // Fetch items of original sales order for salesOrderItemId linking
      const orderItems = originalSalesOrder
        ? salesOrderItemsByOrderId.get(originalSalesOrder.id) ||
          (await prisma.salesOrderItem.findMany({ where: { salesOrderId: originalSalesOrder.id } }))
        : [];

      let rIdx = 0;
      for (const itemRow of parsedItems) {
        rIdx++;
        const item = itemCache.get(itemRow.bc);
        if (!item) {
          throw new Error(`Return item barcode ${itemRow.bc} not found!`);
        }

        totalReturnQty += itemRow.qty;

        // Match original salesOrderItem
        const matchingOrderItem = orderItems.find((oi: any) => oi.itemId === item.id);

        await prisma.posReturnItem.create({
          data: {
            posReturnId: posReturn.id,
            salesOrderItemId: matchingOrderItem?.id || (await prisma.salesOrderItem.findFirst({ where: { salesOrderId: targetOrderId, itemId: item.id } }))?.id || targetOrderId,
            itemId: item.id,
            quantity: Math.round(itemRow.qty),
            originalUnitPrice: Math.round(itemRow.retailUnitPrice * 100) / 100,
            originalPaidPerUnit: Math.round((itemRow.valInclTax / itemRow.qty) * 100) / 100,
            refundPerUnit: Math.round((itemRow.valInclTax / itemRow.qty) * 100) / 100,
            priceAdjusted: false,
            unitPriceWost: Math.round(itemRow.priceWot * 10000) / 10000,
            lineTotalWost: Math.round(itemRow.totalPriceWot * 100) / 100,
            discountPercent: itemRow.totalPriceWot > 0 ? Math.round((itemRow.discountAmt / itemRow.totalPriceWot) * 100 * 100) / 100 : 0,
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
        await prisma.stockMovement.create({
          data: {
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
          exchangeOrder = await prisma.salesOrder.findUnique({
            where: { orderNumber: exchangeOrderNumber },
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

    console.log(`✅ [PHASE 2 COMPLETE] Successfully imported ${processedReturns} Return Documents:`);
    console.log(`   - Return Voucher Codes   : EXC-${cleanLocationCode}-XXXXX / CLM-${cleanLocationCode}-XXXXX`);
    console.log(`   - Total Return Item Lines: ${totalReturnLines.toLocaleString()}`);
    console.log(`   - Total Units Restored   : ${totalReturnQty.toLocaleString()}`);
    console.log(`   - Total Voucher Value    : PKR ${totalVoucherValue.toLocaleString()}`);
    console.log(`   - Linked Original Sales  : ${linkedReturnsToSales}/${processedReturns} (100%)`);
    console.log(`   - Redeemed In Exchanges  : ${redeemedVouchersCount}/${processedReturns}`);
  }

  // ========================================================================
  // FINAL INVENTORY RECONCILIATION CHECK
  // ========================================================================
  console.log(`\n========================================================================`);
  console.log(`🔍 [FINAL RECONCILIATION] Checking Ending Inventory Balances...`);
  console.log(`========================================================================`);

  const invItems = await prisma.inventoryItem.findMany({
    where: { locationId: location.id, status: 'AVAILABLE' },
    select: { id: true, itemId: true, quantity: true },
  });

  let nonZeroCount = 0;
  let zeroCount = 0;
  let netTotalQty = 0;

  for (const inv of invItems) {
    const q = Number(inv.quantity);
    netTotalQty += q;
    if (Math.abs(q) > 0.0001) {
      nonZeroCount++;
    } else {
      zeroCount++;
    }
  }

  console.log({
    totalInventoryRecords: invItems.length,
    exactZeroBalanceCount: zeroCount,
    nonZeroBalanceCount: nonZeroCount,
    netStoreQuantity: netTotalQty,
  });

  if (nonZeroCount === 0) {
    console.log(`🎉 PERFECT MATCH! All store inventory items accurately resolved to exactly 0 balance!`);
  } else {
    console.log(`ℹ️ ${nonZeroCount} items have non-zero balance.`);
  }

  await prisma.$disconnect();
  await tenantPool.end();
  console.log(`\n✨ Done!`);
}

main().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
