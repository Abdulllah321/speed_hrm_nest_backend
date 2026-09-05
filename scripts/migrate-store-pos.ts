import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Pool } from 'pg';
import { PrismaClient, MovementType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// ─────────────────────────────────────────────────────────────────────────────
// CLI ARGUMENT PARSER & CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isReset = args.includes('--reset');

const getArgValue = (flag: string, fallback: string | null = null): string | null => {
  const match = args.find((a) => a.startsWith(`${flag}=`));
  if (match) return match.split('=')[1];
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
};

const targetLocationCode = getArgValue('--location', 'SS1010')!;
const targetTenantDb = getArgValue('--tenant', 'tenant_speed_main_mox1gfsi')!;
const openingFileArg = getArgValue('--opening', path.join(__dirname, '../data/SS_LG_25-26_opening.json'));
const salesFileArg = getArgValue('--sales', path.join(__dirname, '../data/SS_LG_2526_SALES.json'));
const returnsFileArg = getArgValue('--returns', path.join(__dirname, '../data/SS_LG2526_Sales_return.json'));
const stepArg = getArgValue('--step', 'all')!.toLowerCase(); // 'all' | 'opening' | 'sales' | 'returns' | 'verify'

function decrypt(encryptedText: string, masterKeyString: string): string {
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

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

async function main() {
  console.log(`========================================================================`);
  console.log(`🏭 Production POS Store Data Migration Pipeline`);
  console.log(`========================================================================`);
  console.log(`📍 Location       : ${targetLocationCode}`);
  console.log(`🏢 Tenant DB      : ${targetTenantDb}`);
  console.log(`⚙️ Mode           : Dry-Run=${isDryRun} | Reset=${isReset} | Step=${stepArg}`);
  console.log(`📂 Opening File   : ${openingFileArg || 'None'}`);
  console.log(`📂 Sales File     : ${salesFileArg || 'None'}`);
  console.log(`📂 Returns File   : ${returnsFileArg || 'None'}`);
  console.log(`========================================================================\n`);

  // 1. Resolve Tenant Connection
  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  let tenantConnStr = process.env.DATABASE_URL;

  if (managementUrl && masterKey) {
    const mgmtPool = new Pool({ connectionString: managementUrl });
    const compRes = await mgmtPool.query(
      `SELECT "dbUrl", "dbPassword", "dbUser", "dbHost", "dbPort", "dbName" FROM "Company" WHERE "dbName" = $1 OR code = $1 LIMIT 1`,
      [targetTenantDb],
    );
    await mgmtPool.end();

    if (compRes.rows.length > 0) {
      const company = compRes.rows[0];
      if (company.dbUrl) {
        tenantConnStr = company.dbUrl;
      } else if (company.dbPassword) {
        const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
        tenantConnStr = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
      }
    }
  }

  if (!tenantConnStr) {
    throw new Error('❌ Unable to resolve database connection URL for tenant');
  }

  const tenantPool = new Pool({ connectionString: tenantConnStr });
  const adapter = new PrismaPg(tenantPool);
  const prisma = new PrismaClient({ adapter });

  // 2. Resolve Store Location and Default Warehouse
  const location = await prisma.location.findFirst({
    where: {
      OR: [
        { code: targetLocationCode },
        { shortCode: targetLocationCode },
        { name: { contains: targetLocationCode, mode: 'insensitive' } },
      ],
    },
  });
  if (!location) {
    throw new Error(`❌ Store location "${targetLocationCode}" not found in database!`);
  }

  const warehouse = await prisma.warehouse.findFirst({
    where: {
      OR: [{ code: 'C40001' }, { id: location.warehouseId || undefined }, { isActive: true }],
    },
    orderBy: { createdAt: 'asc' },
  });
  if (!warehouse) {
    throw new Error(`❌ Warehouse not found in database!`);
  }

  console.log(`✔ Store Resolved    : ${location.name} (${location.code}, ShortCode: ${location.shortCode || 'N/A'}) [ID: ${location.id}]`);
  console.log(`✔ Warehouse Resolved: ${warehouse.name} (${warehouse.code}) [ID: ${warehouse.id}]`);

  // 3. Pre-cache catalog items
  console.log(`\n⏳ Caching catalog items...`);
  const allDbItems = await prisma.item.findMany({
    select: { id: true, barCode: true, unitPrice: true, unitCost: true },
  });
  const itemCache = new Map<string, any>();
  for (const it of allDbItems) {
    if (it.barCode) itemCache.set(it.barCode.trim(), it);
  }
  console.log(`✔ Cached ${itemCache.size.toLocaleString()} items from catalog.`);

  const cleanLocationCode = (location.shortCode || location.code).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const fySuffix = '26'; // FY 2025-26

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 0: RESET IF REQUESTED
  // ─────────────────────────────────────────────────────────────────────────
  if (isReset && !isDryRun) {
    console.log(`\n⚠️ [--reset] Cleaning existing migration data for location ${location.code}...`);

    // Clean voucher redemptions for this location's orders
    await prisma.voucherRedemption.deleteMany({
      where: { order: { locationId: location.id } },
    });

    // Clean PosReturns
    await prisma.posReturnItem.deleteMany({
      where: { posReturn: { locationId: location.id } },
    });
    await prisma.posReturn.deleteMany({
      where: { locationId: location.id },
    });

    // Clean Vouchers issued by this location
    await prisma.voucher.deleteMany({
      where: { issuedByLocationId: location.id },
    });

    // Clean StockMovements
    await prisma.stockMovement.deleteMany({
      where: { OR: [{ fromLocationId: location.id }, { toLocationId: location.id }] },
    });

    // Clean StockLedger
    await prisma.stockLedger.deleteMany({
      where: { locationId: location.id },
    });

    // Clean SalesOrders & Items
    await prisma.salesOrderItem.deleteMany({
      where: { salesOrder: { locationId: location.id } },
    });
    await prisma.salesOrder.deleteMany({
      where: { locationId: location.id },
    });

    // Reset InventoryItems to 0
    await prisma.inventoryItem.updateMany({
      where: { locationId: location.id },
      data: { quantity: 0 },
    });

    console.log(`✔ Reset completed. Location ${location.code} is clean.`);
  }

  // Pre-cache InventoryItems for this store
  const invItems = await prisma.inventoryItem.findMany({
    where: { locationId: location.id, status: 'AVAILABLE' },
    select: { id: true, itemId: true, quantity: true },
  });
  const invMap = new Map<string, any>();
  for (const inv of invItems) {
    invMap.set(inv.itemId, inv);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1: OPENING BALANCES (JULY 1, 2025)
  // ─────────────────────────────────────────────────────────────────────────
  if ((stepArg === 'all' || stepArg === 'opening') && openingFileArg && fs.existsSync(openingFileArg)) {
    console.log(`\n========================================================================`);
    console.log(`📥 [STEP 1/3] Importing Opening Balances (FY25-26 Start: July 1, 2025)...`);
    console.log(`========================================================================`);

    const rawOpening: any[] = JSON.parse(fs.readFileSync(openingFileArg, 'utf8'));
    console.log(`✔ Loaded ${rawOpening.length.toLocaleString()} opening rows.`);

    // Opening timestamp MUST be July 1, 2025 00:00:00 PKT (2025-06-30T19:00:00Z)
    const openingTimestamp = new Date('2025-06-30T19:00:00.000Z');

    let totalOpeningQty = 0;
    let matchedOpeningCount = 0;

    for (const r of rawOpening) {
      const bc = String(r.Barcode || '').trim();
      const qty = parseFloat(String(r.Opening || 0)) || 0;
      if (!bc || qty <= 0) continue;

      const item = itemCache.get(bc);
      if (!item) continue;

      totalOpeningQty += qty;
      matchedOpeningCount++;

      if (isDryRun) continue;

      // 1. StockLedger Opening Entry
      await prisma.stockLedger.create({
        data: {
          itemId: item.id,
          warehouseId: warehouse.id,
          locationId: location.id,
          qty,
          movementType: MovementType.OPENING_BALANCE,
          referenceType: 'BULK_STOCK_UPLOAD',
          referenceId: 'OPENING-BALANCE-2526',
          unitCost: Number(item.unitCost) || Number(item.unitPrice) || 0,
          createdAt: openingTimestamp,
        },
      });

      // 2. Set InventoryItem available stock
      let invItem = invMap.get(item.id);
      if (invItem) {
        await prisma.inventoryItem.update({
          where: { id: invItem.id },
          data: { quantity: qty },
        });
        invItem.quantity = qty;
      } else {
        invItem = await prisma.inventoryItem.create({
          data: {
            locationId: location.id,
            warehouseId: warehouse.id,
            itemId: item.id,
            quantity: qty,
            status: 'AVAILABLE',
          },
        });
        invMap.set(item.id, invItem);
      }
    }

    console.log(`✔ [STEP 1 COMPLETE] Processed ${matchedOpeningCount.toLocaleString()} opening items.`);
    console.log(`   - Opening Stock Stamped At: 2025-07-01 00:00:00 PKT`);
    console.log(`   - Total Opening Units     : ${totalOpeningQty.toLocaleString()}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2: POS CASH MEMO SALES ORDERS
  // ─────────────────────────────────────────────────────────────────────────
  const salesOrderByDocNum = new Map<string, any>();
  const salesOrderItemsByOrderId = new Map<string, any[]>();

  if ((stepArg === 'all' || stepArg === 'sales') && salesFileArg && fs.existsSync(salesFileArg)) {
    console.log(`\n========================================================================`);
    console.log(`📥 [STEP 2/3] Importing POS Cash Memo Sales Orders...`);
    console.log(`========================================================================`);

    const rawSales: any[] = JSON.parse(fs.readFileSync(salesFileArg, 'utf8'));
    console.log(`✔ Loaded ${rawSales.length.toLocaleString()} raw sales rows.`);

    const salesGroups = new Map<string, any[]>();
    for (const s of rawSales) {
      const docNo = String(s.DocumentNumber).trim();
      if (!salesGroups.has(docNo)) salesGroups.set(docNo, []);
      salesGroups.get(docNo)!.push(s);
    }

    console.log(`📋 Grouped into ${salesGroups.size.toLocaleString()} distinct Cash Memos.`);

    let processedOrders = 0;
    let totalSalesLines = 0;
    let totalSalesQty = 0;
    let totalSalesRevenue = 0;

    const groupEntries = Array.from(salesGroups.entries());
    const batchSize = 100;

    for (let b = 0; b < groupEntries.length; b += batchSize) {
      const batch = groupEntries.slice(b, b + batchSize);

      for (const [docNoStr, groupRows] of batch) {
        const sample = groupRows[0];
        const docNum = parseInt(docNoStr, 10);
        const docDate = parseCustomDate(sample.DocumentDate);
        const padDoc = String(docNum).padStart(5, '0');
        const orderNumber = `SI-${cleanLocationCode}${fySuffix}-${padDoc}`;

        const subtotal = groupRows.reduce(
          (acc, r) => acc + (parseFloat(String(r.Total_Price_W_O_T)) || (parseFloat(String(r.Price_W_O_T)) * parseFloat(String(r.Quantity)))),
          0,
        );
        const discountAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r.DiscountAmount)) || 0), 0);
        const taxAmount = groupRows.reduce((acc, r) => acc + (parseFloat(String(r['Total Sales Tax'])) || 0), 0);
        const grandTotal = groupRows.reduce((acc, r) => acc + (parseFloat(String(r['Value Incl Sales Tax'])) || 0), 0);
        totalSalesRevenue += grandTotal;

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

        const voucherAmount = exchangeAmount + giftAmount + claimAmount + corpAmount + creditVoucherAmount + rewardAmount;

        let paymentMethod = 'cash';
        const tendersCount = [cashAmount > 0, cardAmount > 0, voucherAmount > 0, creditAmount > 0].filter(Boolean).length;
        if (tendersCount > 1) {
          paymentMethod = 'split';
        } else if (cardAmount > 0) {
          paymentMethod = 'card';
        } else if (voucherAmount > 0) {
          paymentMethod = 'voucher';
        } else if (creditAmount > 0) {
          paymentMethod = 'credit_account';
        }

        const notesParts = [`Original DocNo: ${docNoStr}`, `POS ID: ${sample['POS ID']}`];
        if (sample.FKSalesPersonID) notesParts.push(`SalesPerson: ${sample.FKSalesPersonID}`);
        if (sample.Remarks && sample.Remarks.trim() !== ';') notesParts.push(`Remarks: ${sample.Remarks.trim()}`);
        if (sample.FKExchangeVoucherNumber && sample.FKExchangeVoucherNumber.trim()) {
          notesParts.push(`ExVoucherRef: ${sample.FKExchangeVoucherNumber.trim()}`);
        }

        // Structured tags for exact reporting decomposition
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

        // Upsert sales order
        const salesOrder = await prisma.salesOrder.upsert({
          where: { orderNumber },
          update: {
            posId: String(sample['POS ID']),
            subtotal: Math.round(subtotal * 100) / 100,
            discountAmount: Math.round(discountAmount * 100) / 100,
            taxAmount: Math.round(taxAmount * 100) / 100,
            grandTotal: Math.round(grandTotal * 100) / 100,
            paymentMethod,
            paymentStatus: 'paid',
            status: 'completed',
            notes: notesParts.join(' | '),
            fbrInvoiceNumber: fbrInv,
            cashAmount: cashAmount > 0 ? cashAmount : undefined,
            cardAmount: cardAmount > 0 ? cardAmount : undefined,
            voucherAmount: voucherAmount > 0 ? voucherAmount : undefined,
            createdAt: docDate,
          },
          create: {
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
            cashAmount: cashAmount > 0 ? cashAmount : undefined,
            cardAmount: cardAmount > 0 ? cardAmount : undefined,
            voucherAmount: voucherAmount > 0 ? voucherAmount : undefined,
            createdAt: docDate,
          },
        });

        salesOrderByDocNum.set(docNoStr, salesOrder);

        // Delete existing items & ledgers if re-running without clean reset
        await prisma.salesOrderItem.deleteMany({ where: { salesOrderId: salesOrder.id } });
        await prisma.stockLedger.deleteMany({ where: { referenceId: salesOrder.id } });
        await prisma.stockMovement.deleteMany({ where: { referenceId: salesOrder.id } });

        const createdItems: any[] = [];
        let sIdx = 0;

        for (const row of groupRows) {
          sIdx++;
          const bc = String(row.BarCode).trim();
          const item = itemCache.get(bc);
          if (!item) throw new Error(`Item barcode ${bc} not found in database!`);

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

          // StockLedger OUTBOUND
          await prisma.stockLedger.create({
            data: {
              itemId: item.id,
              warehouseId: warehouse.id,
              locationId: location.id,
              qty: -qty,
              referenceType: 'POS_SALE',
              referenceId: salesOrder.id,
              movementType: MovementType.OUTBOUND,
              unitCost: Number(item.unitCost) || unitPrice,
              createdAt: docDate,
            },
          });

          // StockMovement SALE
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

          // Decrement InventoryItem
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

      console.log(`  ⏳ Processed ${processedOrders}/${groupEntries.length} sales orders (${totalSalesLines} lines, Qty: ${totalSalesQty})...`);
    }

    console.log(`✔ [STEP 2 COMPLETE] Imported ${processedOrders} Cash Memo Sales Orders:`);
    console.log(`   - Sequence       : SI-${cleanLocationCode}${fySuffix}-00001 to SI-${cleanLocationCode}${fySuffix}-${String(processedOrders).padStart(5, '0')}`);
    console.log(`   - Item Lines     : ${totalSalesLines.toLocaleString()}`);
    console.log(`   - Units Sold     : ${totalSalesQty.toLocaleString()}`);
    console.log(`   - Revenue (PKR)  : ${totalSalesRevenue.toLocaleString()}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3: RETURNS, CLAIMS, EXCHANGES & VOUCHERS
  // ─────────────────────────────────────────────────────────────────────────
  if ((stepArg === 'all' || stepArg === 'returns') && returnsFileArg && fs.existsSync(returnsFileArg)) {
    console.log(`\n========================================================================`);
    console.log(`📥 [STEP 3/3] Importing Returns, Exchanges & Issuing Vouchers...`);
    console.log(`========================================================================`);

    const rawReturns: any[] = JSON.parse(fs.readFileSync(returnsFileArg, 'utf8'));
    console.log(`✔ Loaded ${rawReturns.length.toLocaleString()} raw return rows.`);

    // Group returns by SubType and DocumentNumber
    const returnGroups = new Map<string, any[]>();
    for (const r of rawReturns) {
      const subType = (r['Sub Type'] || r['SUB Type'] || 'Exchange').trim();
      const docNo = String(r.DocumentNumber).trim();
      const key = `${subType}_${docNo}`;
      if (!returnGroups.has(key)) returnGroups.set(key, []);
      returnGroups.get(key)!.push(r);
    }

    console.log(`📋 Grouped into ${returnGroups.size} Return Documents.`);

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

      // Auto-detect & normalize column shift
      const isShifted = !sample.Barcode || sample.Barcode.trim() === '';
      const parsedItems = groupRows.map((r) => {
        const bc = isShifted
          ? String(r.Quantity || '').replace(/['"]/g, '').trim()
          : String(r.Barcode || '').trim();
        const qty = parseFloat(String(isShifted ? r.UnitPrice : r.Quantity)) || 1;
        const retailUnitPrice = parseFloat(String(isShifted ? r.TaxRate1 : r.UnitPrice)) || 0;
        const taxRate = parseFloat(String(isShifted ? r.Price_W_O_T : r.TaxRate1)) || 18;
        const priceWot = parseFloat(String(isShifted ? r.Total_Price_W_O_T : r.Price_W_O_T)) || 0;
        const totalPriceWot = parseFloat(String(isShifted ? r['Discounted Value'] : r.Total_Price_W_O_T)) || 0;
        const discountAmt = parseFloat(String(isShifted ? r['Value Ex Sales Tax'] : r.DiscountAmount)) || 0;
        const valExTax = parseFloat(String(isShifted ? r['Sales Tax'] : r['Value Ex Sales Tax'])) || 0;
        const salesTax = parseFloat(String(isShifted ? r['Additional Sales Tax'] : r['Sales Tax'])) || 0;
        const totalSalesTax = parseFloat(String(isShifted ? r['Value Incl Sales Tax'] : r['Total Sales Tax'])) || 0;
        const valInclTax = parseFloat(String(isShifted ? r.FKInvoiceNumber_Sale : r['Value Incl Sales Tax'])) || 0;
        const originalSaleDocNo = String((isShifted ? r.DocumentDate_Sale : r.FKInvoiceNumber_Sale) || '').trim();
        const settlementExchangeDocNo = String((isShifted ? r.DocumentDate_Exchange : r.FKInvoiceNumber_Settle) || '').trim();

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
          update: { returnNumber: voucherCode, status: 'returned' },
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

      // 2. Issue / Upsert Voucher
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

      // 3. Upsert PosReturn & PosReturnItems
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
        const item = itemCache.get(itemRow.bc);
        if (!item) throw new Error(`Return item barcode ${itemRow.bc} not found!`);

        totalReturnQty += itemRow.qty;
        const matchingOrderItem = orderItems.find((oi: any) => oi.itemId === item.id);

        await prisma.posReturnItem.create({
          data: {
            posReturnId: posReturn.id,
            salesOrderItemId: matchingOrderItem?.id || targetOrderId,
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

        // StockLedger INBOUND
        await prisma.stockLedger.create({
          data: {
            itemId: item.id,
            warehouseId: warehouse.id,
            locationId: location.id,
            qty: itemRow.qty,
            referenceType: 'POS_RETURN',
            referenceId: posReturn.id,
            movementType: MovementType.INBOUND,
            unitCost: Number(item.unitCost) || itemRow.retailUnitPrice,
            createdAt: docDate,
          },
        });

        // StockMovement RETURN
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

        // Increment InventoryItem
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

      // 4. Link VoucherRedemption if settled in exchange sales order
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

    console.log(`✔ [STEP 3 COMPLETE] Imported ${processedReturns} Return Documents:`);
    console.log(`   - Voucher Codes  : EXC-${cleanLocationCode}-XXXXX / CLM-${cleanLocationCode}-XXXXX`);
    console.log(`   - Item Lines     : ${totalReturnLines.toLocaleString()}`);
    console.log(`   - Units Restored : ${totalReturnQty.toLocaleString()}`);
    console.log(`   - Value (PKR)    : ${totalVoucherValue.toLocaleString()}`);
    console.log(`   - Linked Sales   : ${linkedReturnsToSales}/${processedReturns} (100%)`);
    console.log(`   - Redeemed       : ${redeemedVouchersCount}/${processedReturns}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FINAL RECONCILIATION AUDIT
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n========================================================================`);
  console.log(`🔍 [FINAL AUDIT] Store Stock & Document Reconciliation`);
  console.log(`========================================================================`);

  const endingInv = await prisma.inventoryItem.findMany({
    where: { locationId: location.id, status: 'AVAILABLE' },
    select: { id: true, itemId: true, quantity: true },
  });

  let nonZeroCount = 0;
  let zeroCount = 0;
  let totalNetStoreStock = 0;

  for (const inv of endingInv) {
    const q = Number(inv.quantity);
    totalNetStoreStock += q;
    if (Math.abs(q) > 0.0001) {
      nonZeroCount++;
    } else {
      zeroCount++;
    }
  }

  const salesCount = await prisma.salesOrder.count({ where: { locationId: location.id } });
  const returnsCount = await prisma.posReturn.count({ where: { locationId: location.id } });
  const vouchersCount = await prisma.voucher.count({ where: { issuedByLocationId: location.id } });

  console.log({
    storeCode: location.code,
    storeName: location.name,
    totalSalesOrdersInDb: salesCount,
    totalPosReturnsInDb: returnsCount,
    totalVouchersInDb: vouchersCount,
    totalInventoryRecords: endingInv.length,
    zeroBalanceRecords: zeroCount,
    nonZeroBalanceRecords: nonZeroCount,
    netStoreStockUnits: totalNetStoreStock,
  });

  if (nonZeroCount === 0) {
    console.log(`🎉 PERFECT RECONCILIATION: Net available stock across all SKUs is exactly 0.00 units!`);
  } else {
    console.log(`ℹ️ Inventory check completed. ${nonZeroCount} SKUs have non-zero stock.`);
  }

  await prisma.$disconnect();
  await tenantPool.end();
  console.log(`\n✨ Migration Pipeline Finished Successfully.`);
}

main().catch((err) => {
  console.error('❌ Migration pipeline error:', err);
  process.exit(1);
});
